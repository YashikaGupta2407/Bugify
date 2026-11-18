/**
 * Mock Execution Service
 * 
 * NOTE: This service is intentionally isolated and does NOT know about Express,
 * Prisma, or the database. In future phases, this module can be directly swapped
 * with a real execution engine (such as Judge0 or Docker sandboxing) without touching
 * controllers, routes, or database logic.
 * 
 * FAKE/MOCK DETECTION:
 * Analyzes code strings for known synthetic failure patterns to simulate code execution.
 */

function executeCode({ code, language }) {
  if (typeof code !== 'string') {
    code = '';
  }

  // 1. Division by zero simulation: 10/0, / 0, /0
  if (code.includes('10/0') || code.includes('/ 0') || /\/\s*0(?![0-9])/.test(code)) {
    return {
      status: 'error',
      errorType: 'ZeroDivisionError',
      errorMessage: 'division by zero',
      output: null,
      executionTime: 0,
    };
  }

  // 2. Undefined variable reference simulation
  if (code.includes('undefined_var')) {
    return {
      status: 'error',
      errorType: 'NameError',
      errorMessage: "name 'undefined_var' is not defined",
      output: null,
      executionTime: 0,
    };
  }

  // 3. Unbalanced parentheses simulation
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return {
      status: 'error',
      errorType: 'SyntaxError',
      errorMessage: 'unmatched parentheses',
      output: null,
      executionTime: 0,
    };
  }

  // 4. Default success case
  return {
    status: 'success',
    errorType: null,
    errorMessage: null,
    output: 'Mock execution: no errors detected',
    executionTime: 0,
  };
}

module.exports = {
  executeCode,
};
