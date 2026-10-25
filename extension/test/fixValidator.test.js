const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateProposedFix,
} = require('../out/diagnostics/fixValidator');

describe('Fix Validator Safety', () => {
  test('does not verify a fix just because a type-error code matches', () => {
    const fileContent = 'const amount: number = "wrong";';
    const originalCode = 'const amount: number = "wrong";';
    const correctedCode = 'const amount: number = "still wrong";';

    const result = validateProposedFix({
      filePath: 'example.ts',
      fileContent,
      originalCode,
      correctedCode,
      diagnostic: {
        severity: 'error',
        message: 'Type mismatch',
        code: 'TS2322',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 10,
      },
    });

    assert.notStrictEqual(
      result.verificationStatus,
      'VERIFIED',
      'A matching diagnostic code must not prove the fix is correct'
    );
  });

  test('does not verify a null-safety fix from optional chaining alone', () => {
    const result = validateProposedFix({
      filePath: 'example.ts',
      fileContent: 'const result = user.name;',
      originalCode: 'user.name',
      correctedCode: 'user?.name',
      diagnostic: {
        severity: 'error',
        message: 'Object may be undefined',
        code: 'TS2532',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 10,
      },
    });

    assert.notStrictEqual(
      result.verificationStatus,
      'VERIFIED',
      'Optional chaining alone must not prove the diagnostic is resolved'
    );
  });

  test('withholds a fix when corrected code is missing', () => {
    const result = validateProposedFix({
      originalCode: 'const value = 1;',
      correctedCode: null,
    });

    assert.strictEqual(result.status, 'needs_context');
    assert.strictEqual(result.verificationStatus, 'NOT_VERIFIED');
  });

  test('rejects a candidate identical to the original code', () => {
    const result = validateProposedFix({
      originalCode: 'const value = 1;',
      correctedCode: 'const value = 1;',
    });

    assert.strictEqual(result.status, 'validation_failed');
    assert.strictEqual(result.verificationStatus, 'NOT_VERIFIED');
  });

  test('rejects malformed candidate syntax', () => {
    const result = validateProposedFix({
      filePath: 'example.ts',
      originalCode: 'const value = 1;',
      correctedCode: 'const = ;',
    });

    assert.strictEqual(result.status, 'validation_failed');
    assert.strictEqual(result.verificationStatus, 'NOT_VERIFIED');
  });
});