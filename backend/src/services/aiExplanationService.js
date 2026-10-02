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

module.exports = {
  generateExplanation,
  generateHeuristicExplanation,
};
