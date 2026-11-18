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
      return {
        summary: 'The program attempted to divide a number by zero.',
        cause: 'A division operation was executed where the denominator (divisor) evaluated to zero.',
        location: divLine.trim(),
        explanation: 'In mathematics and programming, division by zero is undefined. Python raises a ZeroDivisionError whenever a division (/) or modulo (%) operator receives zero as its second operand.',
        suggestion: 'Add a conditional check before dividing to ensure the divisor is not zero (e.g., check if divisor == 0), or provide a safe default value.',
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }

    case 'INDEX_ERROR': {
      const idxLine = lines.find((l) => l.includes('[') && l.includes(']')) || 'Array/list index access';
      return {
        summary: 'The program attempted to access an element outside the boundaries of a list.',
        cause: 'The requested index does not exist in the collection because the list contains fewer items than the index requested.',
        location: idxLine.trim(),
        explanation: 'Python lists use zero-based indexing. For a list of length N, valid indices range from 0 to N-1 (or -N to -1 for reverse indexing). Accessing any index >= N raises an IndexError.',
        suggestion: 'Verify the length of the list using len() before accessing elements, or ensure your loop/index variables stay strictly within bounds.',
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }

    case 'NAME_ERROR': {
      // Extract variable name from errorMessage (e.g. "name 'username' is not defined")
      const varMatch = (errorMessage || '').match(/name '([^']+)' is not defined/);
      const varName = varMatch ? varMatch[1] : 'variable';
      const nameLine = lines.find((l) => l.includes(varName)) || `Reference to '${varName}'`;

      return {
        summary: `The variable or function '${varName}' was referenced before being defined.`,
        cause: `Python encountered the identifier '${varName}', but could not find a local or global definition for it.`,
        location: nameLine.trim(),
        explanation: 'Before using any variable or calling a function in Python, it must first be declared and assigned a value. If an identifier is misspelled or referenced before its assignment, Python raises a NameError.',
        suggestion: `Check the spelling of '${varName}' and ensure it is assigned a value above this line or properly passed as an argument.`,
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }

    case 'TYPE_ERROR': {
      const typeLine = lines.find((l) => l.includes('+') || l.includes('(')) || 'Operation with incompatible types';
      return {
        summary: 'An operation was performed on values of incompatible types.',
        cause: errorMessage || 'An operator or function received arguments of unexpected types (such as combining a string with an integer).',
        location: typeLine.trim(),
        explanation: 'Python is strongly typed and will not automatically convert incompatible types like strings and integers during operations like addition (+). Combining them directly raises a TypeError.',
        suggestion: 'Explicitly convert values to the matching type before combining them (for example, use int() for numbers or str() for text representation).',
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }

    case 'SYNTAX_ERROR': {
      const synLine = lines[0] || 'Statement with missing syntax';
      return {
        summary: 'Python could not parse the code due to incorrect syntax.',
        cause: errorMessage || 'A required syntax character (such as a colon :) or parenthesis was omitted.',
        location: synLine.trim(),
        explanation: 'Python requires specific grammatical rules, such as ending compound statements (if, for, while, def, class) with a colon (:) and properly indenting code blocks.',
        suggestion: 'Review the flagged line for missing colons, unmatched quotes, or unclosed parentheses.',
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }

    case 'TIME_LIMIT': {
      return {
        summary: 'The program exceeded the execution time limit.',
        cause: 'The code likely contains an infinite loop or an extremely deep recursive call that prevented completion.',
        location: 'Loop or recursive construct',
        explanation: 'When a loop condition never becomes False, or when recursion has no terminating base case, the program runs endlessly until terminated by the execution sandbox.',
        suggestion: 'Ensure your while/for loop has an update statement that eventually terminates the condition, or verify your recursive base case.',
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }

    default: {
      return {
        summary: errorMessage || 'An unexpected runtime error occurred.',
        cause: errorMessage || 'The program encountered an exception during execution.',
        location: 'Could not be determined precisely',
        explanation: 'An unhandled exception was raised by Python during the execution of this code.',
        suggestion: 'Inspect the error message and the surrounding statements to ensure all values and conditions are valid.',
        status: 'NEEDS_CONTEXT',
        correctedCode: null,
      };
    }
  }
}

/**
 * Calls Google Gemini API to generate structured explanation.
 */
async function callGeminiApi({ apiKey, model, userContent }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: `${SYSTEM_PROMPT}\n\n${userContent}` }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  return JSON.parse(rawText);
}

/**
 * Calls OpenAI-compatible API to generate structured explanation.
 */
async function callOpenAiApi({ apiKey, model, baseUrl, userContent }) {
  const endpoint = `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;

  const requestBody = {
    model: model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  };

  const response = await fetch(endpoint, {
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
// Wire lines and columns are 1-based absolute file positions; window endpoints
// are inclusive. Only the array offset below is 0-based.
function getContextLine(codeContext, codeContextStartLine, codeContextEndLine, targetLine) {
  if (typeof codeContext !== 'string' || !Number.isInteger(codeContextStartLine) || codeContextStartLine < 1 ||
      !Number.isInteger(codeContextEndLine) || codeContextEndLine < codeContextStartLine ||
      !Number.isInteger(targetLine) || targetLine < codeContextStartLine || targetLine > codeContextEndLine) return null;
  const lines = codeContext.split(/\r?\n/);
  if (lines.length !== codeContextEndLine - codeContextStartLine + 1) return null;
  return { text: lines[targetLine - codeContextStartLine] };
}

function buildRuleBasedAnalysis({
  mode,
  detail,
  file,
  diagnostic,
  diagnostics = [],
  errorType,
  codeContext = '',
  codeContextStartLine,
  codeContextEndLine,
  fullFileContent,
  cursor,
  functionContext,
  imports,
  dependencies,
  severity = 'error',
  language = 'plaintext',
}) {
  const primaryDiag = diagnostic || (diagnostics && diagnostics.length > 0 ? diagnostics[0] : null);
  const targetLine = primaryDiag?.startLine ?? cursor?.line;
  const startCol = primaryDiag?.startColumn || 1;
  const endLine = primaryDiag?.endLine || targetLine;
  const endCol = primaryDiag?.endColumn || 20;
  const diagMsg = primaryDiag?.message || 'Code inspection requested';
  const filePath = file?.path || 'unknown';

  const contextLine = getContextLine(codeContext, codeContextStartLine, codeContextEndLine, targetLine);
  const relevantLine = contextLine?.text ?? '';

  let status = 'fixed';
  let title = `Issue at line ${targetLine}`;
  let summary = diagMsg;
  let rootCause = 'The language server detected code that does not satisfy language constraints.';
  let whyItHappens = 'Code statements must comply with syntax, scope, and type checking rules.';
  let originalCode = relevantLine;
  let correctedCode = null;
  let changes = [];
  let explanation = 'Review the highlighted statements and adjust types or values accordingly.';
  let confidence = 0.85;

  const codeStr = String(primaryDiag?.code || '');
  const msgLower = diagMsg.toLowerCase();

  // Without enough information about intent, explain rather than invent values,
  // identifiers, access expressions, or a replacement in another language.
  if (codeStr === '2322' || msgLower.includes('not assignable to type')) {
    title = 'Type Mismatch';
    rootCause = 'The assigned value does not satisfy its declared type.';
    explanation = 'Check the intended type and value before changing the annotation or assignment.';
    status = 'NEEDS_CONTEXT';
  } else if (codeStr === '2304' || msgLower.includes('cannot find name') || errorType === 'ReferenceError' || errorType === 'NameError') {
    title = 'Unresolved Identifier';
    rootCause = 'An identifier cannot be resolved in the supplied scope.';
    explanation = 'Check the identifier spelling, declaration, and imports. Its intended value cannot be inferred safely.';
    status = 'NEEDS_CONTEXT';
  } else if (codeStr === '2532' || msgLower.includes('undefined') || msgLower.includes('null') || msgLower.includes('cannot read properties')) {
    title = 'Possibly Missing Value';
    rootCause = 'A property access may depend on a null or undefined value.';
    explanation = 'Confirm which value may be missing and whether the program should skip, default, or reject that case.';
    status = 'NEEDS_CONTEXT';
  } else if (errorType === 'IndexError' || msgLower.includes('index out of range')) {
    title = 'Index Out of Range';
    rootCause = 'The requested position is outside the collection bounds.';
    explanation = 'Check the collection and index against the intended behavior. No replacement index or value is assumed.';
    status = 'NEEDS_CONTEXT';
  } else {
    originalCode = relevantLine;
    correctedCode = relevantLine;
    explanation = 'Inspect the referenced diagnostic and surrounding declarations.';
  }

  if (!contextLine) {
    status = 'NEEDS_CONTEXT';
    correctedCode = null;
    changes = [];
    explanation = 'The diagnostic is outside the supplied window or its 1-based window coordinates are missing or inconsistent.';
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
    codeContext,
    fullFileContent,
    filePath,
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
async function explainExtensionDiagnostic({
  mode,
  detail = 'normal',
  workspace,
  file,
  cursor,
  selection,
  codeContext,
  codeContextStartLine,
  codeContextEndLine,
  fullFileContent,
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
  const targetLine = primaryDiag?.startLine ?? cursor?.line;
  const startCol = primaryDiag?.startColumn || 1;
  const endLine = primaryDiag?.endLine || targetLine;
  const endCol = primaryDiag?.endColumn || 20;
  const lang = language || file?.language || 'plaintext';

  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  const provider = (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'gemini')).toLowerCase();
  const model = process.env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash');

  // If no AI key configured, use deterministic rule-based analysis directly
  if (!apiKey || !getContextLine(safeCodeContext, codeContextStartLine, codeContextEndLine, targetLine)) {
    return buildRuleBasedAnalysis({
      mode,
      detail,
      file,
      diagnostic: primaryDiag,
      diagnostics,
      errorType,
      codeContext: safeCodeContext,
      codeContextStartLine,
      codeContextEndLine,
      fullFileContent,
      cursor,
      functionContext: safeFunctionContext,
      imports: safeImports,
      dependencies,
      severity,
      language: lang,
    });
  }

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
Active Code Window (Surrounding Lines):
\`\`\`${lang}
${safeCodeContext}
\`\`\`
${safeSelection ? `User Selection:\n\`\`\`${lang}\n${safeSelection}\n\`\`\`\n` : ''}
${dependencies ? `Workspace Dependencies:\n${JSON.stringify(dependencies, null, 2)}\n` : ''}

Determine:
1. What is wrong?
2. What is the root cause?
3. What exact code should be changed?
4. What should the corrected code be? (Do NOT use simplistic workarounds like 'as any', '@ts-ignore', 'eslint-disable')
5. If the context is ambiguous or insufficient to safely fix, set "status": "needs_context".

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
  while (attempts < 2) {
    attempts++;
    try {
      let rawResult;
      if (provider === 'openai') {
        rawResult = await callOpenAiApi({
          apiKey,
          model,
          baseUrl: process.env.AI_BASE_URL,
          userContent: extensionPrompt,
        });
      } else {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: `${DEBUGGER_SYSTEM_PROMPT}\n\n${extensionPrompt}` }] }
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            }
          }),
        });

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status}`);
        }
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        rawResult = cleanAndParseJson(text);
      }

      if (rawResult && rawResult.summary && (rawResult.rootCause || rawResult.cause)) {
        const contextLine = getContextLine(safeCodeContext, codeContextStartLine, codeContextEndLine, targetLine);
        const originalCode = contextLine.text;
        if (rawResult.originalCode && String(rawResult.originalCode).trim() !== originalCode.trim()) {
          throw new Error('Model replacement does not target the diagnostic line in the supplied window');
        }
        // Keep the real line's indentation when a provider returns an unindented line.
        const indentation = originalCode.match(/^\s*/)[0];
        const correctedCode = rawResult.correctedCode
          ? indentation + String(rawResult.correctedCode).trimStart()
          : null;
        const status = rawResult.status || (correctedCode ? 'fixed' : 'needs_context');

        // Run validation pipeline on generated fix
        const validation = validateFix({
          language: lang,
          filePath: file?.path,
          codeContext: safeCodeContext,
          fullFileContent,
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
            startLine: targetLine,
            startColumn: startCol,
            endLine,
            endColumn: endCol,
            line: targetLine,
          },
          summary: String(rawResult.summary),
          rootCause: String(rawResult.rootCause || rawResult.cause || ''),
          whyItHappens: String(rawResult.whyItHappens || rawResult.explanation || ''),
          originalCode,
          correctedCode,
          changes: Array.isArray(rawResult.changes) ? rawResult.changes : [],
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
    codeContextStartLine,
    codeContextEndLine,
    fullFileContent,
    cursor,
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
};

