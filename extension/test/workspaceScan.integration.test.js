const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runTscAnalyzer } = require('../out/scanner/analyzers/tscAnalyzer');
const { detectProjectCapabilities } = require('../out/scanner/projectDetector');
const { normalizeAndDeduplicateIssues } = require('../out/scanner/normalizer');

describe('Integration Test: Closed-File Workspace Scan (test-workspace)', () => {
  test('discovers errors in hidden-error.ts and another-error.ts while clean.ts has no errors', async () => {
    const wsRoot = path.resolve(__dirname, '../test-workspace');
    const caps = await detectProjectCapabilities(wsRoot);

    assert.strictEqual(caps.hasTypeScript, true, 'Must detect TypeScript project');
    assert.ok(caps.tsconfigPaths.length >= 1, 'Must find tsconfig.json in test-workspace');

    // Execute project-level TypeScript analyzer on the closed files
    const result = await runTscAnalyzer(
      wsRoot,
      caps.tsconfigPaths,
      caps.tscExecutable
    );

    assert.strictEqual(result.status.status, 'completed', 'Scan must complete successfully');
    assert.ok(result.issues.length >= 2, `Expected at least 2 issues, found ${result.issues.length}`);

    // Verify hidden-error.ts is found with line and column
    const hiddenError = result.issues.find((i) => i.filePath.includes('hidden-error.ts'));
    assert.ok(hiddenError, 'hidden-error.ts MUST be discovered even when closed');
    assert.strictEqual(hiddenError.line, 3);
    assert.strictEqual(hiddenError.code, 'TS2322');
    assert.ok(
      hiddenError.message.includes("Type 'string' is not assignable to type 'number'"),
      `Unexpected message: ${hiddenError.message}`
    );

    // Verify another-error.ts is found with line and column
    const anotherError = result.issues.find((i) => i.filePath.includes('another-error.ts'));
    assert.ok(anotherError, 'another-error.ts MUST be discovered even when closed');
    assert.strictEqual(anotherError.line, 3);
    assert.strictEqual(anotherError.code, 'TS2322');
    assert.ok(
      anotherError.message.includes("Type 'boolean' is not assignable to type 'number'"),
      `Unexpected message: ${anotherError.message}`
    );

    // Verify clean.ts is NOT reported
    const cleanFile = result.issues.find((i) => i.filePath.includes('clean.ts'));
    assert.strictEqual(cleanFile, undefined, 'clean.ts has no errors and must not be reported');
  });
});

describe('Integration Test: Closed-File Workspace Scan (test-fixtures)', () => {
  test('discovers ts-mismatch.ts and js-reference.js in test-fixtures', async () => {
    const fixturesRoot = path.resolve(__dirname, '../test-fixtures');
    const caps = await detectProjectCapabilities(fixturesRoot);

    assert.strictEqual(caps.hasTypeScript, true);

    const result = await runTscAnalyzer(
      fixturesRoot,
      caps.tsconfigPaths,
      caps.tscExecutable
    );

    assert.strictEqual(result.status.status, 'completed');

    // 1. Verify ts-mismatch.ts is discovered
    const tsMismatch = result.issues.find((i) => i.filePath.includes('ts-mismatch.ts'));
    assert.ok(tsMismatch, 'ts-mismatch.ts must be found in test-fixtures');
    assert.strictEqual(tsMismatch.line, 3);
    assert.strictEqual(tsMismatch.code, 'TS2322');

    // 2. Verify js-reference.js is discovered
    const jsRef = result.issues.find((i) => i.filePath.includes('js-reference.js'));
    assert.ok(jsRef, 'js-reference.js must be found in test-fixtures');
    assert.strictEqual(jsRef.line, 3);
    assert.strictEqual(jsRef.code, 'TS2304');
    assert.ok(jsRef.message.includes("Cannot find name 'username'"));

    // 3. Verify deduplication
    const deduped = normalizeAndDeduplicateIssues(result.issues);
    assert.ok(deduped.length >= 2);
  });
});
