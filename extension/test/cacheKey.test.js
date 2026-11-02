const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildAnalyzeCacheKey } = require('../out/api/cacheKey');

const basePayload = {
  mode: 'analyze_error',
  detail: 'normal',
  file: { path: 'src/example.ts', language: 'typescript' },
  cursor: { line: 2, column: 1 },
  codeContext: 'let port: number = "8080";',
  contextStartLine: 1,
  contextEndLine: 1,
  documentVersion: 1,
  diagnostics: [
    {
      severity: 'error',
      message: "Type 'string' is not assignable to type 'number'.",
      code: 'TS2322',
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 10,
    },
  ],
};

describe('Analyze cache key', () => {
  test('is stable for identical requests', () => {
    assert.strictEqual(buildAnalyzeCacheKey(basePayload), buildAnalyzeCacheKey({ ...basePayload }));
  });

  test('changes when the document version changes', () => {
    const edited = { ...basePayload, documentVersion: 2 };
    assert.notStrictEqual(buildAnalyzeCacheKey(basePayload), buildAnalyzeCacheKey(edited));
  });

  test('changes when any part of the code window changes', () => {
    const edited = { ...basePayload, codeContext: 'let port: number = "9090";' };
    assert.notStrictEqual(buildAnalyzeCacheKey(basePayload), buildAnalyzeCacheKey(edited));
  });

  test('changes when the window position changes', () => {
    const shifted = { ...basePayload, contextStartLine: 40, contextEndLine: 60 };
    assert.notStrictEqual(buildAnalyzeCacheKey(basePayload), buildAnalyzeCacheKey(shifted));
  });
});
