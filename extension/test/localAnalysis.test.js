const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildLocalAnalysis } = require('../out/diagnostics/localAnalysis');

const diag = (overrides) => ({
  severity: 'error',
  message: '',
  code: '',
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 10,
  filePath: 'src/example.ts',
  ...overrides,
});

describe('Local analysis never fabricates a fix', () => {
  test('type mismatch explains the trade-off instead of flipping the annotation', () => {
    const analysis = buildLocalAnalysis(
      diag({
        message: "Type 'string' is not assignable to type 'number'.",
        code: 'TS2322',
      }),
      'src/example.ts',
      'let port: number = "8080";'
    );

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
    assert.strictEqual(analysis.verificationStatus, 'NOT_VERIFIED');
    assert.ok(!String(analysis.correctedCode).includes(': string'));
    assert.ok(!JSON.stringify(analysis).includes(': string'));
  });

  test('null access is not fixed by blind optional chaining', () => {
    const analysis = buildLocalAnalysis(
      diag({
        message: "Object is possibly 'undefined'.",
        code: 'TS2532',
      }),
      'src/example.ts',
      'const result = user.name;'
    );

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
    assert.ok(!JSON.stringify(analysis).includes('user?.name'));
  });

  test('unused identifier is not renamed with an underscore prefix', () => {
    const analysis = buildLocalAnalysis(
      diag({
        severity: 'warning',
        message: "'unused' is declared but its value is never read.",
        code: 'TS6133',
      }),
      'src/example.ts',
      'function handler(unused) { return 1; }'
    );

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
    assert.ok(!JSON.stringify(analysis).includes('_unused'));
  });

  test('undefined name stays explanation-only in any language', () => {
    const analysis = buildLocalAnalysis(
      diag({
        message: "name 'username' is not defined",
        code: 'undefined-variable',
        source: 'pylint',
      }),
      'src/example.py',
      'return username'
    );

    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null);
    assert.deepStrictEqual(analysis.changes, []);
    assert.strictEqual(analysis.verificationStatus, 'NOT_VERIFIED');
  });
});
