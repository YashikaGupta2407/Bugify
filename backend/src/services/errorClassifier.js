/**
 * Error Classifier Service
 * 
 * Inspects execution output, stderr, and status from the code execution service
 * to classify the outcome into standard Bugify categories:
 * 
 * - SUCCESS
 * - SYNTAX_ERROR
 * - NAME_ERROR
 * - TYPE_ERROR
 * - INDEX_ERROR
 * - KEY_ERROR
 * - ZERO_DIVISION_ERROR
 * - ATTRIBUTE_ERROR
 * - RUNTIME_ERROR
 * - TIME_LIMIT
 * - COMPILATION_ERROR
 * - UNKNOWN_ERROR
 */

const ErrorTypes = {
  SUCCESS: 'SUCCESS',
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  NAME_ERROR: 'NAME_ERROR',
  TYPE_ERROR: 'TYPE_ERROR',
  INDEX_ERROR: 'INDEX_ERROR',
  KEY_ERROR: 'KEY_ERROR',
  ZERO_DIVISION_ERROR: 'ZERO_DIVISION_ERROR',
  ATTRIBUTE_ERROR: 'ATTRIBUTE_ERROR',
  RUNTIME_ERROR: 'RUNTIME_ERROR',
  TIME_LIMIT: 'TIME_LIMIT',
  COMPILATION_ERROR: 'COMPILATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

/**
 * Classifies the raw execution result into standardized Bugify format.
 * 
 * @param {Object} executionResult
 * @param {string} executionResult.status - External status description
 * @param {number} [executionResult.statusId] - Judge0 status ID
 * @param {string|null} executionResult.stdout - Standard output
 * @param {string|null} executionResult.stderr - Standard error
 * @param {string|null} executionResult.compileOutput - Compilation output
 * @param {string|null} executionResult.message - Execution status message
 * @param {number} executionResult.executionTime - Execution time in seconds
 * @returns {Object} Classified result
 */
function classifyResult(executionResult) {
  const {
    status: externalStatus,
    statusId,
    stdout,
    stderr,
    compileOutput,
    message,
    executionTime = 0,
  } = executionResult;

  // 1. Time Limit Exceeded (Judge0 status 5)
  if (
    statusId === 5 ||
    (externalStatus && externalStatus.toLowerCase().includes('time limit')) ||
    (message && message.toLowerCase().includes('time limit'))
  ) {
    return {
      status: 'error',
      errorType: ErrorTypes.TIME_LIMIT,
      errorMessage: 'Time limit exceeded',
      output: stdout || '',
      executionTime,
    };
  }

  // 2. Compilation Error (Judge0 status 6)
  if (
    statusId === 6 ||
    (externalStatus && externalStatus.toLowerCase().includes('compilation error'))
  ) {
    return {
      status: 'error',
      errorType: ErrorTypes.COMPILATION_ERROR,
      errorMessage: compileOutput || stderr || 'Compilation error occurred',
      output: compileOutput || stdout || '',
      executionTime,
    };
  }

  // 3. Accepted with no standard error -> SUCCESS
  if (statusId === 3 && (!stderr || !stderr.trim())) {
    return {
      status: 'success',
      errorType: null,
      errorMessage: null,
      output: stdout || '',
      executionTime,
    };
  }

  // 4. Parse Python Traceback from stderr or compileOutput
  const errorText = (stderr || compileOutput || '').trim();

  if (errorText) {
    const lines = errorText.split('\n').map((line) => line.trim()).filter(Boolean);

    // Look for standard Python error patterns: ErrorName: Message
    // Search from the end backwards to find the exception header
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const match = line.match(/^([A-Za-z0-9_]+(?:Error|Exception))(?::\s*(.*))?$/);

      if (match) {
        const errorName = match[1];
        const errorMsg = match[2] ? match[2].trim() : '';

        switch (errorName) {
          case 'ZeroDivisionError':
            return {
              status: 'error',
              errorType: ErrorTypes.ZERO_DIVISION_ERROR,
              errorMessage: errorMsg || 'division by zero',
              output: stdout || '',
              executionTime,
            };

          case 'NameError':
            return {
              status: 'error',
              errorType: ErrorTypes.NAME_ERROR,
              errorMessage: errorMsg || 'name is not defined',
              output: stdout || '',
              executionTime,
            };

          case 'SyntaxError':
          case 'IndentationError':
          case 'TabError':
            return {
              status: 'error',
              errorType: ErrorTypes.SYNTAX_ERROR,
              errorMessage: errorMsg || 'syntax error',
              output: stdout || '',
              executionTime,
            };

          case 'TypeError':
            return {
              status: 'error',
              errorType: ErrorTypes.TYPE_ERROR,
              errorMessage: errorMsg || 'type error',
              output: stdout || '',
              executionTime,
            };

          case 'IndexError':
            return {
              status: 'error',
              errorType: ErrorTypes.INDEX_ERROR,
              errorMessage: errorMsg || 'list index out of range',
              output: stdout || '',
              executionTime,
            };

          case 'KeyError':
            return {
              status: 'error',
              errorType: ErrorTypes.KEY_ERROR,
              errorMessage: errorMsg || 'key error',
              output: stdout || '',
              executionTime,
            };

          case 'AttributeError':
            return {
              status: 'error',
              errorType: ErrorTypes.ATTRIBUTE_ERROR,
              errorMessage: errorMsg || 'attribute error',
              output: stdout || '',
              executionTime,
            };

          default:
            return {
              status: 'error',
              errorType: ErrorTypes.RUNTIME_ERROR,
              errorMessage: errorMsg || errorName,
              output: stdout || '',
              executionTime,
            };
        }
      }
    }

    // If stderr exists but no specific Python error class was parsed
    return {
      status: 'error',
      errorType: ErrorTypes.RUNTIME_ERROR,
      errorMessage: lines[lines.length - 1] || 'Runtime error occurred',
      output: stdout || '',
      executionTime,
    };
  }

  // 5. Fallback for non-zero statuses without stderr
  if (statusId && statusId !== 3) {
    return {
      status: 'error',
      errorType: ErrorTypes.UNKNOWN_ERROR,
      errorMessage: message || externalStatus || 'Unknown execution error',
      output: stdout || '',
      executionTime,
    };
  }

  // Default success if no errors detected
  return {
    status: 'success',
    errorType: null,
    errorMessage: null,
    output: stdout || '',
    executionTime,
  };
}

module.exports = {
  classifyResult,
  ErrorTypes,
};
