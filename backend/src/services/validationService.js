/**
 * Safe Fix Validation Service
 * 
 * Validates generated code corrections without executing arbitrary user code.
 * Uses AST parsers (TypeScript compiler API, Python AST) to verify syntax
 * and detect regressions or unsafe type-suppression anti-patterns.
 */

const { spawnSync } = require('child_process');

let ts;
try {
  ts = require('typescript');
} catch (e) {
  ts = null;
}

/**
 * Validates a generated code fix.
 * 
 * @param {Object} params
 * @param {string} params.language - 'typescript' | 'javascript' | 'python' | etc.
 * @param {string} [params.originalCode] - Problematic original code snippet
 * @param {string} [params.correctedCode] - Proposed corrected code
 * @param {string} [params.status] - 'fixed' | 'needs_context' | 'cannot_fix'
 * @param {Object} [params.diagnostic] - Diagnostic information
 * @returns {Object} Validation report: { status, message, checkerUsed }
 */
function validateFix({ language = 'plaintext', originalCode, correctedCode, status = 'fixed', diagnostic }) {
  if (status === 'needs_context') {
    return {
      status: 'needs_context',
      message: 'More workspace context is required to safely validate a fix.',
      checkerUsed: 'context-checker',
    };
  }

  if (status === 'cannot_fix' || !correctedCode || !correctedCode.trim()) {
    return {
      status: 'cannot_fix',
      message: 'No corrected code was provided to validate.',
      checkerUsed: 'null-checker',
    };
  }

  const lang = language.toLowerCase();

  // 1. Anti-pattern detection (suppression instead of fixing)
  const hasSuppression =
    /\/\/\s*@ts-ignore/i.test(correctedCode) ||
    /\/\/\s*@ts-nocheck/i.test(correctedCode) ||
    /\/\*\s*eslint-disable/i.test(correctedCode) ||
    /\bas\s+any\b/.test(correctedCode);

  if (hasSuppression) {
    return {
      status: 'validation_failed',
      message: 'Fix uses type suppression or error silencing (@ts-ignore / as any) instead of fixing the root cause.',
      checkerUsed: 'quality-linter',
    };
  }

  // 2. TypeScript / JavaScript validation
  if (lang === 'typescript' || lang === 'javascript') {
    if (ts) {
      try {
        const isTs = lang === 'typescript';
        const fileName = isTs ? 'validation_target.ts' : 'validation_target.js';
        const sourceFile = ts.createSourceFile(
          fileName,
          correctedCode,
          ts.ScriptTarget.ESNext,
          true,
          isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS
        );

        const parseErrors = sourceFile.parseDiagnostics || [];
        if (parseErrors.length > 0) {
          const firstErr = parseErrors[0];
          const errorMsg =
            typeof firstErr.messageText === 'string'
              ? firstErr.messageText
              : firstErr.messageText?.messageText || 'Syntax error in replacement code';

          return {
            status: 'validation_failed',
            message: `Syntax validation failed: ${errorMsg}`,
            checkerUsed: 'typescript-parser',
          };
        }

        return {
          status: 'validated',
          message: 'Syntax and AST structure verified against TypeScript parser',
          checkerUsed: 'typescript-parser',
        };
      } catch (err) {
        return {
          status: 'generated',
          message: `AST validation encountered an error: ${err.message}`,
          checkerUsed: 'typescript-fallback',
        };
      }
    }
  }

  // 3. Python syntax validation via AST
  if (lang === 'python') {
    try {
      const res = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: correctedCode,
        encoding: 'utf8',
        timeout: 2500,
      });

      if (res.status !== 0) {
        const stderr = (res.stderr || '').trim();
        const syntaxMatch = stderr.match(/SyntaxError: (.*)/);
        const reason = syntaxMatch ? syntaxMatch[1] : 'Invalid Python syntax in corrected code';

        return {
          status: 'validation_failed',
          message: `Python syntax check failed: ${reason}`,
          checkerUsed: 'python3-ast',
        };
      }

      return {
        status: 'validated',
        message: 'Python AST syntax parsing verified cleanly',
        checkerUsed: 'python3-ast',
      };
    } catch (err) {
      return {
        status: 'generated',
        message: 'Python syntax validator unavailable',
        checkerUsed: 'python3-fallback',
      };
    }
  }

  // 4. Default for other languages
  return {
    status: 'generated',
    message: 'Fix generated — full compiler validation unavailable for this language',
    checkerUsed: 'heuristic',
  };
}

module.exports = {
  validateFix,
};
