/**
 * AI Bug Explanation Service
 * 
 * Provides beginner-friendly, mentor-style explanations for runtime,
 * syntax, and logic errors detected during code execution.
 * 
 * Configurable with external LLM providers (e.g., Google Gemini, OpenAI, Groq),
 * with a robust fallback analyzer to ensure 100% resilience if the AI API is
 * unreachable or unconfigured.
 */

const SYSTEM_PROMPT = `You are Bugify's AI debugging mentor for programming students.
Your job is to explain why a program failed and how to fix it, in a clear, encouraging, beginner-friendly way.

Rules:
1. Explain the underlying concept rather than simply repeating the error message.
2. Use the actual user code and the actual error traceback provided.
3. Do not invent line numbers, outputs, or facts not present in the code or error.
4. Do not claim that you executed the code.
5. Provide a constructive, actionable suggestion on how to fix the bug.
6. Preserve the user's original coding intent when providing corrected code.
7. Return ONLY a valid JSON object matching this exact structure:
{
  "summary": "A concise one-sentence description of the problem.",
  "cause": "Specific explanation of why this error occurred in this code.",
  "location": "The exact line, function, or statement where the error occurred (e.g. 'return a / b' or 'Line 2'). If indeterminate, state 'Could not be determined precisely'.",
  "explanation": "A beginner-friendly explanation of the relevant programming concept and why Python raised this error.",
  "suggestion": "Specific, actionable guidance on what the developer should check or change.",
  "correctedCode": "The corrected version of the code snippet that fixes the bug while preserving the user's logic."
}`;
const AI_TIMEOUT_MS = 12000;
const MAX_AI_ATTEMPTS = 1;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`AI request timed out after ${AI_TIMEOUT_MS} ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
/**
 * Builds a heuristic mentor explanation when external LLM is not configured or fails.
 */
function generateHeuristicExplanation({ code, errorType, errorMessage, stderr }) {
  const cleanCode = (code || '').trim();
  const lines = cleanCode.split('\n');

  switch (errorType) {
    case 'ZERO_DIVISION_ERROR': {
      // Find line with division
      const divLine = lines.find((l) => l.includes('/') || l.includes('%')) || 'Division statement';
      let corrected = cleanCode;
      if (cleanCode.includes('def divide(a, b):')) {
        corrected = `def divide(a, b):
    if b == 0:
        return "Cannot divide by zero"
    return a / b

print(divide(10, 0))`;
      } else if (cleanCode.includes('/ 0') || cleanCode.includes('/0')) {
        corrected = cleanCode.replace(/\/\s*0(?![0-9])/, '/ 1');
      }

      return {
        summary: 'The program attempted to divide a number by zero.',
        cause: 'A division operation was executed where the denominator (divisor) evaluated to zero.',
        location: divLine.trim(),
        explanation: 'In mathematics and programming, division by zero is undefined. Python raises a ZeroDivisionError whenever a division (/) or modulo (%) operator receives zero as its second operand.',
        suggestion: 'Add a conditional check before dividing to ensure the divisor is not zero (e.g., check if divisor == 0), or provide a safe default value.',
        correctedCode: corrected,
      };
    }

    case 'INDEX_ERROR': {
      const idxLine = lines.find((l) => l.includes('[') && l.includes(']')) || 'Array/list index access';
      let corrected = cleanCode;
      if (cleanCode.includes('[10]') && cleanCode.includes('[1, 2, 3]')) {
        corrected = cleanCode.replace('[10]', '[len(numbers) - 1]');
      } else {
        corrected = `# Ensure index is within 0 <= index < len(list)\n${cleanCode}`;
      }

      return {
        summary: 'The program attempted to access an element outside the boundaries of a list.',
        cause: 'The requested index does not exist in the collection because the list contains fewer items than the index requested.',
        location: idxLine.trim(),
        explanation: 'Python lists use zero-based indexing. For a list of length N, valid indices range from 0 to N-1 (or -N to -1 for reverse indexing). Accessing any index >= N raises an IndexError.',
        suggestion: 'Verify the length of the list using len() before accessing elements, or ensure your loop/index variables stay strictly within bounds.',
        correctedCode: corrected,
      };
    }

    case 'NAME_ERROR': {
      // Extract variable name from errorMessage (e.g. "name 'username' is not defined")
      const varMatch = (errorMessage || '').match(/name '([^']+)' is not defined/);
      const varName = varMatch ? varMatch[1] : 'variable';
      const nameLine = lines.find((l) => l.includes(varName)) || `Reference to '${varName}'`;

      let corrected = cleanCode;
      if (varMatch) {
        corrected = `${varName} = "Default Value"\n${cleanCode}`;
      }

      return {
        summary: `The variable or function '${varName}' was referenced before being defined.`,
        cause: `Python encountered the identifier '${varName}', but could not find a local or global definition for it.`,
        location: nameLine.trim(),
        explanation: 'Before using any variable or calling a function in Python, it must first be declared and assigned a value. If an identifier is misspelled or referenced before its assignment, Python raises a NameError.',
        suggestion: `Check the spelling of '${varName}' and ensure it is assigned a value above this line or properly passed as an argument.`,
        correctedCode: corrected,
      };
    }

    case 'TYPE_ERROR': {
      const typeLine = lines.find((l) => l.includes('+') || l.includes('(')) || 'Operation with incompatible types';
      let corrected = cleanCode;
      if (cleanCode.includes('"20"') || cleanCode.includes("'20'")) {
        corrected = cleanCode.replace(/"20"/g, 'int("20")').replace(/'20'/g, "int('20')");
      }

      return {
        summary: 'An operation was performed on values of incompatible types.',
        cause: errorMessage || 'An operator or function received arguments of unexpected types (such as combining a string with an integer).',
        location: typeLine.trim(),
        explanation: 'Python is strongly typed and will not automatically convert incompatible types like strings and integers during operations like addition (+). Combining them directly raises a TypeError.',
        suggestion: 'Explicitly convert values to the matching type before combining them (for example, use int() for numbers or str() for text representation).',
        correctedCode: corrected,
      };
    }

    case 'SYNTAX_ERROR': {
      const synLine = lines[0] || 'Statement with missing syntax';
      let corrected = cleanCode;
      if (cleanCode.includes('if True\n') || cleanCode.includes('if True:')) {
        corrected = cleanCode.replace(/if True(?!\:)/, 'if True:');
      }

      return {
        summary: 'Python could not parse the code due to incorrect syntax.',
        cause: errorMessage || 'A required syntax character (such as a colon :) or parenthesis was omitted.',
        location: synLine.trim(),
        explanation: 'Python requires specific grammatical rules, such as ending compound statements (if, for, while, def, class) with a colon (:) and properly indenting code blocks.',
        suggestion: 'Review the flagged line for missing colons, unmatched quotes, or unclosed parentheses.',
        correctedCode: corrected,
      };
    }

    case 'TIME_LIMIT': {
      return {
        summary: 'The program exceeded the execution time limit.',
        cause: 'The code likely contains an infinite loop or an extremely deep recursive call that prevented completion.',
        location: 'Loop or recursive construct',
        explanation: 'When a loop condition never becomes False, or when recursion has no terminating base case, the program runs endlessly until terminated by the execution sandbox.',
        suggestion: 'Ensure your while/for loop has an update statement that eventually terminates the condition, or verify your recursive base case.',
        correctedCode: cleanCode,
      };
    }

    default: {
      return {
        summary: errorMessage || 'An unexpected runtime error occurred.',
        cause: errorMessage || 'The program encountered an exception during execution.',
        location: 'Could not be determined precisely',
        explanation: 'An unhandled exception was raised by Python during the execution of this code.',
        suggestion: 'Inspect the error message and the surrounding statements to ensure all values and conditions are valid.',
        correctedCode: cleanCode,
      };
    }
  }
}

/**
 * Calls Google Gemini API to generate structured explanation.
 */
// async function callGeminiApi({ apiKey, model, userContent }) {
//   const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
async function callGeminiApi({
  apiKey, model, userContent, systemPrompt = SYSTEM_PROMPT
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const requestBody = {
    contents: [
      {
        parts: [
          { text: `${systemPrompt}\n\n${userContent}` }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    }
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json','x-goog-api-key': apiKey,},
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API returned an empty response.');
  }

  return cleanAndParseJson(rawText);
}

/**
 * Calls OpenAI-compatible API to generate structured explanation.
 */
async function callOpenAiApi({ apiKey, model, baseUrl, userContent,systemPrompt = SYSTEM_PROMPT,}) {
  const endpoint = `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;

  const requestBody = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt},
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  };

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('OpenAI API returned an empty content.');
  }

  return JSON.parse(rawContent);
}
/**
 * Calls a local Ollama model to generate a structured explanation.
 */
async function callOllamaApi({
  model,
  userContent,
  systemPrompt = SYSTEM_PROMPT,
}) {
  const endpoint = `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/chat`;

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'qwen2.5-coder:3b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawContent = data.message?.content;

  if (!rawContent) {
    throw new Error('Ollama returned an empty response.');
  }

  return cleanAndParseJson(rawContent);
}
/**
 * Main service entry point for generating bug explanations.
 * 
 * @param {Object} params
 * @param {string} params.language - Programming language
 * @param {string} params.code - Source code
 * @param {string} params.errorType - Bugify error category
 * @param {string} params.errorMessage - Error description
 * @param {string} [params.stderr] - Standard error output
 * @param {string} [params.stdout] - Standard output
 * @param {Object} [params.executionResult] - Complete execution telemetry
 * @returns {Promise<Object>} Structured explanation
 */
async function generateExplanation({
  language,
  code,
  errorType,
  errorMessage,
  stderr,
  stdout,
  executionResult,
}) {
  // If execution was successful, AI explanation is not needed
  if (errorType === 'SUCCESS' || (!errorType && !errorMessage)) {
    return null;
  }

  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  const provider = (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'gemini')).toLowerCase();
  const model = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash');

  const userContent = `Here is the debugging report to analyze:
- Language: ${language}
- Error Category: ${errorType}
- Error Message: ${errorMessage || 'None'}
- Stderr / Traceback:
${stderr || 'No stderr'}

- Submitted Code:
\`\`\`${language}
${code}
\`\`\`

Explain why this error occurred and how to fix it according to the requested JSON schema.`;

  // 1. If an API key is available, call the configured LLM provider
  if (apiKey) {
    try {
      let aiResult;
      if (provider === 'openai') {
        aiResult = await callOpenAiApi({
          apiKey,
          model,
          baseUrl: process.env.AI_BASE_URL,
          userContent,
        });
      } else {
        aiResult = await callGeminiApi({
          apiKey,
          model,
          userContent,
        });
      }

      // Validate required fields
      if (aiResult && aiResult.summary && aiResult.cause && aiResult.explanation) {
        return {
          summary: String(aiResult.summary),
          cause: String(aiResult.cause),
          location: aiResult.location ? String(aiResult.location) : 'Could not be determined precisely',
          explanation: String(aiResult.explanation),
          suggestion: String(aiResult.suggestion || ''),
          correctedCode: aiResult.correctedCode ? String(aiResult.correctedCode) : null,
        };
      }
    } catch (llmError) {
      console.warn('External AI explanation API call failed, falling back to heuristic mentor:', llmError.message);
    }
  }

  // 2. Intelligent mentor fallback when no external API key is provided or API is unreachable
  return generateHeuristicExplanation({
    code,
    errorType,
    errorMessage,
    stderr,
  });
}

const { validateFix } = require('./validationService');

const DEBUGGER_SYSTEM_PROMPT = `You are Bugify, a software debugging assistant.
Your job is to diagnose the actual root cause of the reported programming error using the diagnostic AND the supplied code context.

Do not merely repeat the compiler/runtime error.

Determine:
1. What is wrong?
2. What is the root cause?
3. Why does the current code cause this?
4. What exact code should be changed?
5. What should the corrected code be?
6. Why does the corrected code solve the problem?

CRITICAL RULES:
- Never suggest hacky workarounds like 'as any', '@ts-ignore', 'eslint-disable', or removing types without strong justification. Fix the actual root cause.
- Preserve original coding intent (variable names, architecture, purpose).
- If the provided context is insufficient to safely produce a fix, explicitly set "status": "needs_context" instead of inventing code.
- Provide line-by-line before and after replacements in the "changes" array.
- Return ONLY a strict JSON object matching this exact schema:
{
  "status": "fixed | needs_context | cannot_fix",
  "errorType": "TypeError",
  "title": "Short human-readable title",
  "location": {
    "file": "src/auth.ts",
    "startLine": 3,
    "startColumn": 5,
    "endLine": 3,
    "endColumn": 35
  },
  "summary": "Short description of the problem.",
  "rootCause": "Actual underlying cause.",
  "whyItHappens": "Detailed explanation.",
  "originalCode": "Relevant original code.",
  "correctedCode": "Exact corrected code.",
  "changes": [
    {
      "line": 3,
      "before": "let userId: number = \\"user_42\\";",
      "after": "let userId: string = \\"user_42\\";",
      "reason": "The assigned value is a string."
    }
  ],
  "explanation": "Why this correction fixes the error.",
  "confidence": 0.95
}`;

/**
 * Builds a deterministic rule-based analysis when AI is unconfigured or unavailable.
 * Strictly labelled as analysisSource: "rules".
 */
function buildRuleBasedAnalysis({
  mode,
  detail,
  file,
  diagnostic,
  diagnostics = [],
  errorType,
  codeContext = '',
  contextStartLine,
  functionContext,
  imports,
  dependencies,
  severity = 'error',
  language = 'plaintext',
}) {
  const primaryDiag = diagnostic || (diagnostics && diagnostics.length > 0 ? diagnostics[0] : null);
  const targetLine = primaryDiag?.startLine || 1;
  const startCol = primaryDiag?.startColumn || 1;
  const endLine = primaryDiag?.endLine || targetLine;
  const endCol = primaryDiag?.endColumn || 20;
  const diagMsg = primaryDiag?.message || 'Code inspection requested';
  const filePath = file?.path || 'unknown';

  // Extract relevant original code line from codeContext if available.
  // codeContext is a window starting at contextStartLine, so the target line
  // must be indexed relative to that window rather than from line 1.
  const contextLines = (codeContext || '').split(/\r?\n/);
  const windowStartLine =
    Number.isInteger(contextStartLine) && contextStartLine > 0 ? contextStartLine : 1;
  const targetLineIdx = targetLine - windowStartLine;
  const relevantLine =
    targetLineIdx >= 0 && targetLineIdx < contextLines.length
      ? (contextLines[targetLineIdx] || '').trim()
      : '';

  // The rule engine only explains diagnostics. It cannot see enough of the
  // program to prove a patch is correct, so it never emits correctedCode or
  // changes; a wrong "fix" is worse than an honest request for more context.
  const status = 'needs_context';
  let title = `Issue at line ${targetLine}`;  let summary = diagMsg;
  let rootCause = 'The language server detected code that does not satisfy language constraints.';
  let whyItHappens = 'Code statements must comply with syntax, scope, and type checking rules.';
  const originalCode = relevantLine;
  const correctedCode = null;
  const changes = [];
  let explanation =
    'No automatic fix was generated because the rule engine cannot verify a replacement without the full program. Inspect the highlighted line and apply the smallest change that satisfies the diagnostic.';
  let confidence = 0.5;

  const codeStr = String(primaryDiag?.code || '');
  const msgLower = diagMsg.toLowerCase();

  // 1. TypeScript Type Mismatch (e.g. 2322)
  if (codeStr === '2322' || msgLower.includes('not assignable to type')) {
    title = 'Type Mismatch';
    summary = 'Type mismatch: assigned value is not assignable to the declared type.';
    rootCause =
      'The variable or property is annotated with a specific type, but received a value of an incompatible type. In statically typed languages, values must match their declared type contracts.';
    whyItHappens =
      'TypeScript catches type discrepancies at compile time to prevent runtime errors and ensure interface contracts remain valid.';
    explanation =
      'Decide which side expresses the intent: change the assigned value so it matches the declared type, or change the annotation if the value is the intended representation. The rule engine does not guess between them.';
    confidence = 0.6;
  }
  // 2. Undefined / Null property access (e.g. 2532)
  else if (
    codeStr === '2532' ||
    codeStr === '2531' ||
    codeStr === '18048' ||
    msgLower.includes('possibly undefined') ||
    msgLower.includes('possibly null') ||
    msgLower.includes('cannot read propert')
  ) {
    errorType = 'TypeError';
    title = 'Undefined Property Access';
    summary = `Attempted property access on an object that is or may be undefined (${diagMsg}).`;
    rootCause =
      'The target reference has not been verified to exist prior to dereferencing properties. In JavaScript/TypeScript, evaluating property access on null or undefined throws a runtime TypeError.';
    whyItHappens =
      'Runtime engines halt execution when attempting to look up keys on uninitialized or nullish object variables.';
    explanation =
      'Decide whether the value should be guaranteed before this line (validate it, default it, or narrow its type) or whether this access is optional. Optional chaining only hides a missing value; it is not always the correct fix.';
    confidence = 0.55;
  }
  // 3. Undeclared Identifier / ReferenceError (e.g. 2304)
  else if (
    codeStr === '2304' ||
    msgLower.includes('cannot find name') ||
    errorType === 'ReferenceError' ||
    errorType === 'NameError'
  ) {
    const varMatch =
      diagMsg.match(/Cannot find name ['"]([^'"]+)['"]/i) ||
      diagMsg.match(/['"]([^'"]+)['"] is not defined/i);

    const varName = varMatch ? varMatch[1] : null;

    errorType = 'ReferenceError';
    title = varName ? `Cannot find name '${varName}'` : 'Undefined identifier';
    summary = varName
      ? `Identifier '${varName}' is referenced but its intended value cannot be determined safely.`
      : 'An identifier may be undefined, but its name could not be identified reliably.';
    rootCause = 'The referenced identifier is not available in the current scope.';
    whyItHappens =
      'The identifier may be misspelled, missing an import, or intended to refer to a variable declared elsewhere.';
    explanation =
      'No automatic fix was generated because inventing a declaration or value could change program behavior. Check the identifier spelling, surrounding scope, and imports.';
  }
  // 4. Python / JS IndexError
  else if (errorType === 'IndexError' || msgLower.includes('index out of range')) {
    errorType = 'IndexError';
    title = 'List Index Out of Range';
    summary = 'Attempted to access an index outside collection boundaries.';
    rootCause =
      'The collection does not contain enough elements to satisfy the requested index. Indices are zero-based and must be strictly less than the length.';
    whyItHappens =
      'Indexing past the end of an array or list attempts to read non-existent memory elements.';
    explanation =
      'Verify the expected collection size and whether the index is correct. Guarding the access is only right when an out-of-range index is a valid state.';
    confidence = 0.55;
  }
  // 5. Default generic rule
  else {
    explanation = `Inspect line ${targetLine} and align the statements with language syntax. No automatic fix was generated.`;
  }

  const analysis = {
    analysisSource: 'rules',
    status,
    errorType: errorType || 'DiagnosticError',
    title,
    location: {
      file: filePath,
      startLine: targetLine,
      startColumn: startCol,
      endLine,
      endColumn: endCol,
      line: targetLine,
    },
    summary,
    rootCause,
    whyItHappens,
    originalCode,
    correctedCode,
    changes,
    explanation,
    confidence,
    severity,
    // Backward compatibility
    cause: rootCause,
    suggestion: explanation,
  };

  // Run fix validation
  const validation = validateFix({
    language,
    originalCode,
    correctedCode,
    status,
    diagnostic: primaryDiag,
  });

  analysis.validation = validation;
  return analysis;
}
/**
 * Strips code fences and parses JSON defensively.
 */
function cleanAndParseJson(rawText) {
  if (!rawText) return null;
  let cleaned = rawText.trim();
  // Strip ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Service to analyze VS Code extension diagnostics with AI, falling back to rules.
 */
/**
 * Rejects model-proposed changes that cannot be applied verbatim to the code window.
 * A patch whose "before" text is absent or outside the window is not a fix; it is a guess.
 */
function validateModelChanges(changes, codeContext, windowStartLine) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { changes: [] };
  }

  const contextLines = (codeContext || '').split(/\r?\n/);
  const windowEndLine = windowStartLine + contextLines.length - 1;
  const accepted = [];

  for (const change of changes) {
    if (!change || typeof change.before !== 'string' || change.before.length === 0) {
      return { error: 'The model proposed a change without verbatim original text.' };
    }
    if (typeof change.after !== 'string' || change.after === change.before) {
      return { error: 'The model proposed a no-op or malformed change.' };
    }

    const line = Number(change.line);
    if (!Number.isInteger(line) || line < windowStartLine || line > windowEndLine) {
      return { error: `The model proposed a change on line ${change.line}, outside the analysed window.` };
    }

    const targetText = contextLines[line - windowStartLine] || '';
    if (!targetText.includes(change.before) && !codeContext.includes(change.before)) {
      return { error: 'The model proposed a change whose original text is not present in the code window.' };
    }

    accepted.push({
      line,
      before: change.before,
      after: change.after,
      reason: String(change.reason || ''),
    });
  }

  return { changes: accepted };
}

async function explainExtensionDiagnostic({
  mode,
  detail = 'normal',
  workspace,
  file,
  cursor,
  selection,
  codeContext,
  contextStartLine,
  contextEndLine,
  functionContext,
  imports,
  dependencies,
  diagnostic,
  diagnostics = [],
  errorType,
  language,
  severity = 'error',
}) {
  const { redactSecrets } = require('./redactService');

  // Redact any secrets before sending to AI or logging
  const safeCodeContext = redactSecrets(codeContext || '');
  const safeSelection = redactSecrets(selection || '');
  const safeFunctionContext = redactSecrets(functionContext || '');
  const safeImports = redactSecrets(imports || '');
  const primaryDiag = diagnostic || (diagnostics && diagnostics.length > 0 ? diagnostics[0] : null);
  const targetLine = primaryDiag?.startLine || cursor?.line || 1;
  const startCol = primaryDiag?.startColumn || 1;
  const endLine = primaryDiag?.endLine || targetLine;
  const endCol = primaryDiag?.endColumn || 20;
  const lang = language || file?.language || 'plaintext';
  const windowStartLine =
    Number.isInteger(contextStartLine) && contextStartLine > 0 ? contextStartLine : 1;

  // const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  // const provider = (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'gemini')).toLowerCase();
  // const model = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash');
  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  const provider = (
    process.env.AI_PROVIDER ||
    (process.env.OPENAI_API_KEY ? 'openai' : 'gemini')
  ).toLowerCase();

  const model =
    process.env.AI_MODEL ||
    (provider === 'openai'
      ? 'gpt-4o-mini'
      : provider === 'ollama'
        ? 'qwen2.5-coder:3b'
        : 'gemini-1.5-flash');

  // Ollama runs locally and does not require an API key.
  if (!apiKey && provider !== 'ollama') {
    return buildRuleBasedAnalysis({
      mode,
      detail,
      file,
      diagnostic: primaryDiag,
      diagnostics,
      errorType,
      codeContext: safeCodeContext,
      contextStartLine,
      functionContext: safeFunctionContext,
      imports: safeImports,
      dependencies,
      severity,
      language: lang,
    });
  }

  // Number the window lines with their real file line numbers so the model
  // can address the diagnostic precisely instead of guessing an index.
  const contextWindowLines = safeCodeContext.split(/\r?\n/);
  const numberedContext = contextWindowLines
    .map((line, index) => `${windowStartLine + index} | ${line}`)
    .join('\n');
  const targetLineIdx = targetLine - windowStartLine;
  const targetLineText =
    targetLineIdx >= 0 && targetLineIdx < contextWindowLines.length
      ? contextWindowLines[targetLineIdx]
      : '';

  const extensionPrompt = `You are Bugify, a software debugging assistant.
Diagnose the actual root cause of this error and propose the exact code fix.

Workspace: ${workspace?.name || 'project'}
File: ${file?.path || 'file'} (${lang})
Target Line: ${targetLine} (Columns ${startCol}-${endCol})
Error Category: ${errorType}
Diagnostic Message: ${primaryDiag?.message || 'N/A'}
Diagnostic Code: ${primaryDiag?.code || 'N/A'}
Source: ${primaryDiag?.source || 'compiler'}
Severity: ${severity}

${safeImports ? `Relevant File Imports:\n\`\`\`${lang}\n${safeImports}\n\`\`\`\n` : ''}
${safeFunctionContext ? `Enclosing Function Context:\n\`\`\`${lang}\n${safeFunctionContext}\n\`\`\`\n` : ''}
Numbered Code Window (left number is the real file line number):
\`\`\`${lang}
${numberedContext}
\`\`\`
Diagnostic Line (verbatim from line ${targetLine}):
\`\`\`${lang}
${targetLineText}
\`\`\`
${safeSelection ? `User Selection:\n\`\`\`${lang}\n${safeSelection}\n\`\`\`\n` : ''}
${dependencies ? `Workspace Dependencies:\n${JSON.stringify(dependencies, null, 2)}\n` : ''}

Determine:
1. What is wrong?
2. What is the root cause?
3. What exact code should be changed?
4. What should the corrected code be? (Do NOT use simplistic workarounds like 'as any', '@ts-ignore', 'eslint-disable')
5. If the context is ambiguous or insufficient to safely fix, set "status": "needs_context".

Patch rules:
- Every "line" value MUST be an absolute file line number from the numbered window.
- "before" MUST be copied verbatim from that line so the client can locate it.
- Only change what the diagnostic requires; do not rewrite unrelated lines.
- If you cannot copy the exact "before" text, set "status": "needs_context".

Return ONLY valid JSON matching this schema:
{
  "status": "fixed | needs_context | cannot_fix",
  "errorType": "${errorType || 'TypeError'}",
  "title": "Short title",
  "location": {
    "file": "${file?.path || 'file'}",
    "startLine": ${targetLine},
    "startColumn": ${startCol},
    "endLine": ${endLine},
    "endColumn": ${endCol}
  },
  "summary": "Short description of the problem.",
  "rootCause": "Actual underlying cause.",
  "whyItHappens": "Detailed technical explanation.",
  "originalCode": "Relevant line(s) before fix.",
  "correctedCode": "Exact corrected line(s).",
  "changes": [
    {
      "line": ${targetLine},
      "before": "Original line",
      "after": "Corrected line",
      "reason": "Why this line was changed"
    }
  ],
  "explanation": "Why this correction fixes the error.",
  "confidence": 0.95
}`;

  let attempts = 0;
  while (attempts < MAX_AI_ATTEMPTS) {
    attempts++;
    try {
      let rawResult;
      if (provider === 'ollama') {
        rawResult = await callOllamaApi({
          model,
          userContent: extensionPrompt,
          systemPrompt: DEBUGGER_SYSTEM_PROMPT,
        });
      } else if (provider === 'openai') {
        rawResult = await callOpenAiApi({
          apiKey,
          model,
          baseUrl: process.env.AI_BASE_URL,
          userContent: extensionPrompt,
          systemPrompt: DEBUGGER_SYSTEM_PROMPT,
        });
      } else {
        rawResult = await callGeminiApi({
          apiKey,
          model,
          userContent: extensionPrompt,
          systemPrompt: DEBUGGER_SYSTEM_PROMPT,
        });
      }
      if (rawResult && rawResult.summary && (rawResult.rootCause || rawResult.cause)) {
        let correctedCode = rawResult.correctedCode ? String(rawResult.correctedCode) : null;
        let originalCode = rawResult.originalCode ? String(rawResult.originalCode) : '';
        let status = rawResult.status || (correctedCode ? 'fixed' : 'needs_context');

        const changesCheck = validateModelChanges(
          rawResult.changes,
          safeCodeContext,
          windowStartLine
        );
        const originalTextInWindow =
          !originalCode || safeCodeContext.includes(originalCode.trim());

        let withheldReason = null;
        if (changesCheck.error) {
          withheldReason = changesCheck.error;
        } else if (correctedCode && !originalTextInWindow) {
          withheldReason =
            'The model proposed a fix whose original text is not present in the code window.';
        } else if (status === 'fixed' && !correctedCode && changesCheck.changes.length === 0) {
          withheldReason = 'The model reported a fix without any applicable change.';
        }

        if (withheldReason) {
          status = 'needs_context';
          correctedCode = null;
          originalCode = '';
        }

        const validation = withheldReason
          ? { status: 'needs_context', message: withheldReason, checkerUsed: 'patch-validator' }
          : validateFix({
              language: lang,
              originalCode,
              correctedCode,
              status,
              diagnostic: primaryDiag,
            });

        return {
          analysisSource: 'ai',
          status,
          errorType: rawResult.errorType || errorType || 'DiagnosticError',
          title: rawResult.title || `${errorType || 'Error'} at line ${targetLine}`,
          location: {
            file: file?.path || 'unknown',
            startLine: rawResult.location?.startLine || targetLine,
            startColumn: rawResult.location?.startColumn || startCol,
            endLine: rawResult.location?.endLine || endLine,
            endColumn: rawResult.location?.endColumn || endCol,
            line: rawResult.location?.startLine || targetLine,
          },
          summary: String(rawResult.summary),
          rootCause: String(rawResult.rootCause || rawResult.cause || ''),
          whyItHappens: String(rawResult.whyItHappens || rawResult.explanation || ''),
          originalCode,
          correctedCode,
          changes: withheldReason ? [] : changesCheck.changes,
          explanation: String(rawResult.explanation || ''),
          confidence: typeof rawResult.confidence === 'number' ? rawResult.confidence : 0.9,
          severity,
          validation,
          // Backward compatibility
          cause: String(rawResult.rootCause || rawResult.cause || ''),
          suggestion: String(rawResult.explanation || rawResult.whyItHappens || ''),
        };
      }
    } catch (err) {
      console.warn(`AI analysis attempt ${attempts} failed:`, err.message);
    }
  }

  // Fallback to deterministic rules if AI failed
  return buildRuleBasedAnalysis({
    mode,
    detail,
    file,
    diagnostic: primaryDiag,
    diagnostics,
    errorType,
    codeContext: safeCodeContext,
    contextStartLine,
    functionContext: safeFunctionContext,
    imports: safeImports,
    dependencies,
    severity,
    language: lang,
  });
}

module.exports = {
  generateExplanation,
  generateHeuristicExplanation,
  explainExtensionDiagnostic,
  buildRuleBasedAnalysis,
  validateModelChanges,
};

