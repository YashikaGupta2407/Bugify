const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { runTscAnalyzer } = require('../out/scanner/analyzers/tscAnalyzer');
const { detectProjectCapabilities } = require('../out/scanner/projectDetector');
const { normalizeAndDeduplicateIssues } = require('../out/scanner/normalizer');
const { parseTscOutput } = require('../out/scanner/parsers/tscParser');

describe('Acceptance Test: Closed-File Discovery (Sections 4 & 20)', () => {
  const testWorkspaceRoot = path.resolve(__dirname, '../test-workspace');

  test('Step 1-3: Project has tsconfig.json, clean open.ts/app.ts, and closed error files', () => {
    assert.ok(fs.existsSync(path.join(testWorkspaceRoot, 'tsconfig.json')), 'tsconfig.json must exist');
    assert.ok(fs.existsSync(path.join(testWorkspaceRoot, 'src/app.ts')), 'src/app.ts must exist');
    assert.ok(fs.existsSync(path.join(testWorkspaceRoot, 'src/open.ts')), 'src/open.ts must exist');
    assert.ok(fs.existsSync(path.join(testWorkspaceRoot, 'src/closed-error.ts')), 'src/closed-error.ts must exist');
    assert.ok(fs.existsSync(path.join(testWorkspaceRoot, 'src/hidden-error.ts')), 'src/hidden-error.ts must exist');
    assert.ok(fs.existsSync(path.join(testWorkspaceRoot, 'src/auth.ts')), 'src/auth.ts must exist');

    const appContent = fs.readFileSync(path.join(testWorkspaceRoot, 'src/app.ts'), 'utf8');
    assert.ok(!appContent.includes('error'), 'app.ts must be clean');

    const closedErrorContent = fs.readFileSync(path.join(testWorkspaceRoot, 'src/closed-error.ts'), 'utf8');
    assert.ok(closedErrorContent.includes('let userId: number = "hello"'), 'closed-error.ts must contain type mismatch');
  });

  test('Step 4-7: Bugify Scan Workspace discovers closed file errors without opening them', async () => {
    // 1. Detect project capabilities (project root)
    const caps = await detectProjectCapabilities(testWorkspaceRoot);
    assert.strictEqual(caps.hasTypeScript, true, 'TypeScript project must be detected');
    assert.ok(caps.tsconfigPaths.length >= 1, 'At least 1 tsconfig must be detected');

    // 2. Run static analyzer without opening any files in VS Code
    const scanResult = await runTscAnalyzer(testWorkspaceRoot, caps.tsconfigPaths);
    assert.strictEqual(scanResult.status.status, 'completed', 'Analyzer status must be completed');
    assert.ok(scanResult.issues.length >= 1, 'Analyzer must find errors in closed files');

    // 3. Verify closed-error.ts is found
    const closedError = scanResult.issues.find((i) => i.filePath.includes('closed-error.ts'));
    assert.ok(closedError, 'Bugify MUST find closed-error.ts even though never opened');
    assert.strictEqual(closedError.severity, 'error');
    assert.strictEqual(closedError.source, 'typescript');
    assert.strictEqual(closedError.code, 'TS2322');
    assert.strictEqual(closedError.analyzer, 'tsc');
    assert.ok(
      closedError.message.includes("Type 'string' is not assignable to type 'number'"),
      `Expected TS2322 message, got: ${closedError.message}`
    );

    // 4. Verify hidden-error.ts is found
    const hiddenError = scanResult.issues.find((i) => i.filePath.includes('hidden-error.ts'));
    assert.ok(hiddenError, 'Bugify MUST find hidden-error.ts even though never opened');
    assert.strictEqual(hiddenError.code, 'TS2322');
    assert.ok(hiddenError.message.includes("Type 'string' is not assignable to type 'number'"));

    // 5. Verify auth.ts is found
    const authError = scanResult.issues.find((i) => i.filePath.includes('auth.ts'));
    assert.ok(authError, 'Bugify MUST find auth.ts even though never opened');
    assert.strictEqual(authError.code, 'TS2322');
    assert.ok(authError.message.includes("Type 'string' is not assignable to type 'number'"));

    // 6. Verify clean files are NOT reported as errors
    const appError = scanResult.issues.find((i) => i.filePath.includes('app.ts'));
    assert.strictEqual(appError, undefined, 'Clean app.ts must not have errors');
    const openError = scanResult.issues.find((i) => i.filePath.includes('open.ts'));
    assert.strictEqual(openError, undefined, 'Clean open.ts must not have errors');
    const cleanError = scanResult.issues.find((i) => i.filePath.includes('clean.ts'));
    assert.strictEqual(cleanError, undefined, 'Clean clean.ts must not have errors');
  });

  test('Step 8-10: Unified normalization and deduplication preserves closed file locations', async () => {
    const rawOutput = `src/auth.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const parsed = parseTscOutput(rawOutput, testWorkspaceRoot);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].filePath, 'src/auth.ts');
    assert.strictEqual(parsed[0].line, 3);
    assert.strictEqual(parsed[0].column, 7);
    assert.strictEqual(parsed[0].code, 'TS2322');
    assert.strictEqual(parsed[0].severity, 'error');

    const deduped = normalizeAndDeduplicateIssues(parsed);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].filePath, 'src/auth.ts');
    assert.strictEqual(deduped[0].line, 3);
    assert.strictEqual(deduped[0].column, 7);
  });
});
