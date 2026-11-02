// backend/test/fixPipeline.test.js
// Regression tests for the extension fix pipeline's context handling.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildRuleBasedAnalysis } = require('../src/services/aiExplanationService');

describe('Context window line offsets', () => {
  const makeWindow = (startLine, endLine) =>
    Array.from({ length: endLine - startLine + 1 }, (_, i) => {
      const line = startLine + i;
      return line === 120 ? 'let port: number = "8080";' : `// filler ${line}`;
    }).join('\n');

  test('reads the target line relative to the window start, not the file start', () => {
    const analysis = buildRuleBasedAnalysis({
      mode: 'analyze_error',
      file: { path: 'src/example.ts', language: 'typescript' },
      diagnostic: {
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.",
        code: '2322',
        startLine: 120,
        startColumn: 5,
        endLine: 120,
        endColumn: 9,
      },
      errorType: 'TypeError',
      codeContext: makeWindow(101, 140),
      contextStartLine: 101,
      contextEndLine: 140,
      language: 'typescript',
    });

    assert.match(
      String(analysis.originalCode),
      /let port: number = "8080";/,
      'must use the line at the diagnostic position inside the window'
    );
    assert.doesNotMatch(
      String(analysis.originalCode),
      /filler 101/,
      'must not silently fall back to the first line of the window'
    );
  });

  test('does not guess a line when the diagnostic is outside the window', () => {
    const analysis = buildRuleBasedAnalysis({
      mode: 'analyze_error',
      file: { path: 'src/example.ts', language: 'typescript' },
      diagnostic: {
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.",
        code: '2322',
        startLine: 500,
        startColumn: 5,
        endLine: 500,
        endColumn: 9,
      },
      errorType: 'TypeError',
      codeContext: makeWindow(101, 140),
      contextStartLine: 101,
      contextEndLine: 140,
      language: 'typescript',
    });

    assert.doesNotMatch(
      String(analysis.originalCode),
      /filler 101/,
      'an out-of-window diagnostic must not be replaced with the first context line'
    );
  });
});
