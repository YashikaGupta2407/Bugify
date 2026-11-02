// backend/test/fixPipeline.test.js
// Regression tests for the extension fix pipeline's context handling.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildRuleBasedAnalysis, validateModelChanges } = require('../src/services/aiExplanationService');
const { validateFix } = require('../src/services/validationService');

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

    assert.strictEqual(
      analysis.originalCode,
      '',
      'an out-of-window diagnostic must not be replaced with the first context line'
    );
  });
});

describe('Rule engine never fabricates a patch', () => {
  const analyze = (diagnostic, codeContext = 'let port: number = "8080";') =>
    buildRuleBasedAnalysis({
      mode: 'analyze_error',
      file: { path: 'src/example.ts', language: 'typescript' },
      diagnostic,
      errorType: 'TypeError',
      codeContext,
      contextStartLine: 1,
      contextEndLine: 1,
      language: 'typescript',
    });

  test('type mismatch explains the choice instead of rewriting the annotation', () => {
    const analysis = analyze({
      severity: 'error',
      message: "Type 'string' is not assignable to type 'number'.",
      code: '2322',
      startLine: 1,
      startColumn: 5,
      endLine: 1,
      endColumn: 9,
    });

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
    assert.doesNotMatch(JSON.stringify(analysis), /user_42/);
    assert.doesNotMatch(JSON.stringify(analysis), /: string/);
  });

  test('null access does not blindly insert optional chaining', () => {
    const analysis = analyze(
      {
        severity: 'error',
        message: "Object is possibly 'undefined'.",
        code: '2532',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 10,
      },
      'const result = user.name;'
    );

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
    assert.doesNotMatch(JSON.stringify(analysis), /\?\./);
  });

  test('index error does not emit a hardcoded bounds guard', () => {
    const analysis = analyze(
      {
        severity: 'error',
        message: 'list index out of range',
        code: 'IndexError',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 10,
      },
      'print(numbers[10])'
    );

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
  });
});

describe('Validation never reports parse-only checks as validated', () => {
  test('syntactically valid TypeScript is generated, not validated', () => {
    const result = validateFix({
      language: 'typescript',
      originalCode: 'const answer = compute();',
      correctedCode: 'const answer: number = compute();',
      diagnostic: { code: 'TS2322', message: 'Type mismatch' },
    });

    assert.strictEqual(result.status, 'generated');
    assert.match(result.message, /unverified/i);
  });

  test('syntactically valid Python is generated, not validated', () => {
    const result = validateFix({
      language: 'python',
      originalCode: 'value = compute()',
      correctedCode: 'value: int = compute()',
    });

    assert.notStrictEqual(result.status, 'validated');
  });

  test('rejects a candidate identical to the original code', () => {
    const result = validateFix({
      language: 'typescript',
      originalCode: 'const answer = compute();',
      correctedCode: 'const answer = compute();',
    });

    assert.strictEqual(result.status, 'validation_failed');
  });

  test('rejects malformed candidate code before it reaches the editor', () => {
    const result = validateFix({
      language: 'typescript',
      originalCode: 'const answer = compute();',
      correctedCode: 'const = ;',
    });

    assert.strictEqual(result.status, 'validation_failed');
  });
});

describe('Model-proposed changes must be applicable', () => {
  const windowText = [
    '// line 101',
    '// line 102',
    '// line 103',
    'let port: number = "8080";',
    '// line 105',
  ].join('\n');
  const windowStart = 101;

  test('accepts a change whose text and line are inside the window', () => {
    const result = validateModelChanges(
      [{ line: 104, before: 'let port: number = "8080";', after: 'let port = "8080";', reason: 'r' }],
      windowText,
      windowStart
    );

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.changes.length, 1);
    assert.strictEqual(result.changes[0].line, 104);
  });

  test('rejects a change whose original text is absent from the window', () => {
    const result = validateModelChanges(
      [{ line: 104, before: 'let userId: string = "user_42";', after: 'let userId = "user_42";' }],
      windowText,
      windowStart
    );

    assert.match(result.error, /not present/);
  });

  test('rejects a change outside the analysed line window', () => {
    const result = validateModelChanges(
      [{ line: 1, before: 'let port: number = "8080";', after: 'let port = "8080";' }],
      windowText,
      windowStart
    );

    assert.match(result.error, /outside the analysed window/);
  });

  test('rejects no-op changes', () => {
    const result = validateModelChanges(
      [{ line: 104, before: 'let port: number = "8080";', after: 'let port: number = "8080";' }],
      windowText,
      windowStart
    );

    assert.match(result.error, /no-op/);
  });
});
