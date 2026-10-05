const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { detectProjectCapabilities, findSourceFiles } = require('../out/scanner/projectDetector');
const { runTscAnalyzer } = require('../out/scanner/analyzers/tscAnalyzer');
const { runPythonAnalyzer } = require('../out/scanner/analyzers/pythonAnalyzer');
const { normalizeAndDeduplicateIssues, buildStateMessage } = require('../out/scanner/normalizer');
const { buildLocalAnalysis } = require('../out/diagnostics/localAnalysis');
const { classifyErrorCategory, isActionableSeverity, mapDiagnosticSeverity } = require('../out/diagnostics/diagnosticUtils');
const { validateProposedFix } = require('../out/diagnostics/fixValidator');

describe('Phase 14 Mandatory Acceptance Test: Plain JS Workspace with Closed Error File', () => {
  const phase14Dir = path.resolve(__dirname, '../test-realworld-phase14');
  const srcDir = path.join(phase14Dir, 'src');

  before(() => {
    if (fs.existsSync(phase14Dir)) {
      fs.rmSync(phase14Dir, { recursive: true, force: true });
    }
    fs.mkdirSync(srcDir, { recursive: true });

    // 1. app.js (clean file)
    fs.writeFileSync(
      path.join(srcDir, 'app.js'),
      'console.log("Bugify App Server initialized.");\n'
    );

    // 2. database.js (clean file)
    fs.writeFileSync(
      path.join(srcDir, 'database.js'),
      'const isConnected = true;\nfunction getStatus() { return isConnected; }\n'
    );

    // 3. auth.js (contains actual error: undeclared variable 'username')
    fs.writeFileSync(
      path.join(srcDir, 'auth.js'),
      'function authenticateUser() {\n  return username;\n}\n'
    );
  });

  after(() => {
    if (fs.existsSync(phase14Dir)) {
      fs.rmSync(phase14Dir, { recursive: true, force: true });
    }
  });

  test('Step 1: Workspace contains app.js, database.js, auth.js without tsconfig.json', () => {
    assert.strictEqual(fs.existsSync(path.join(phase14Dir, 'tsconfig.json')), false);
    assert.strictEqual(fs.existsSync(path.join(srcDir, 'app.js')), true);
    assert.strictEqual(fs.existsSync(path.join(srcDir, 'database.js')), true);
    assert.strictEqual(fs.existsSync(path.join(srcDir, 'auth.js')), true);
  });

  test('Step 2: Project capability detector discovers plain JS source files', async () => {
    const caps = await detectProjectCapabilities(phase14Dir);
    assert.strictEqual(caps.hasTypeScript, true, 'Plain JS project must be flagged for JS/TS scanning');
    assert.strictEqual(caps.tsconfigPaths.length, 0, 'Must have 0 tsconfig files');
    assert.ok(caps.sourceFiles && caps.sourceFiles.length >= 3, 'Must discover all 3 source files');
    assert.ok(caps.sourceFiles.some((f) => f.includes('auth.js')), 'sourceFiles must include auth.js');
    assert.ok(caps.sourceFiles.some((f) => f.includes('app.js')), 'sourceFiles must include app.js');
    assert.ok(caps.sourceFiles.some((f) => f.includes('database.js')), 'sourceFiles must include database.js');
  });

  test('Step 3: Scanner discovers error in CLOSED auth.js while app.js and database.js are clean', async () => {
    const caps = await detectProjectCapabilities(phase14Dir);
    const result = await runTscAnalyzer(phase14Dir, caps.tsconfigPaths, caps.sourceFiles);

    assert.strictEqual(result.status.status, 'completed');
    assert.ok(result.issues.length >= 1, `Expected at least 1 issue, got ${result.issues.length}`);

    // Verify auth.js is discovered
    const authIssue = result.issues.find((i) => i.filePath.includes('auth.js'));
    assert.ok(authIssue, 'Must discover error in closed file auth.js');
    assert.strictEqual(authIssue.line, 2);
    assert.strictEqual(authIssue.severity, 'error');
    assert.strictEqual(authIssue.code, 'TS2304');
    assert.ok(authIssue.message.includes("Cannot find name 'username'"));

    // Verify clean files produce 0 errors
    const appIssue = result.issues.find((i) => i.filePath.includes('app.js'));
    assert.strictEqual(appIssue, undefined, 'Clean app.js must have 0 issues');
    const dbIssue = result.issues.find((i) => i.filePath.includes('database.js'));
    assert.strictEqual(dbIssue, undefined, 'Clean database.js must have 0 issues');
  });

  test('Step 4: Normalizer retains workspace-relative path and coordinates', async () => {
    const caps = await detectProjectCapabilities(phase14Dir);
    const result = await runTscAnalyzer(phase14Dir, caps.tsconfigPaths, caps.sourceFiles);
    const normalized = normalizeAndDeduplicateIssues(result.issues);

    assert.strictEqual(normalized.length, 1);
    assert.strictEqual(normalized[0].filePath, 'src/auth.js');
    assert.strictEqual(normalized[0].line, 2);
    assert.strictEqual(normalized[0].column, 10);
    assert.strictEqual(normalized[0].severity, 'error');
  });

  test('Step 5: Local root cause analysis accurately explains undeclared username without fake fixes', () => {
    const diagnostic = {
      severity: 'error',
      message: "Cannot find name 'username'.",
      source: 'typescript',
      code: 'TS2304',
      startLine: 2,
      startColumn: 10,
      endLine: 2,
      endColumn: 18,
      filePath: 'src/auth.js',
    };

    const authFile = path.join(srcDir, 'auth.js');
    const analysis = buildLocalAnalysis(diagnostic, authFile);

    assert.strictEqual(analysis.errorType, 'ReferenceError');
    assert.strictEqual(analysis.category, 'REFERENCE');
    assert.strictEqual(analysis.status, 'needs_context');
    assert.strictEqual(analysis.correctedCode, null, 'Never fabricate arbitrary fake code like const username = ""');
    assert.strictEqual(analysis.verificationStatus, 'NOT_VERIFIED');
    assert.ok(analysis.rootCause.includes('username'));
    assert.ok(analysis.rootCause.includes('line 2'));
    assert.ok(analysis.why.includes('username'));
    assert.ok(analysis.recommendedAction.includes('username'));
  });
});

describe('Phase 13 Acceptance Tests: Real-World Multi-Language Scenarios', () => {
  const multiProjectDir = path.resolve(__dirname, '../test-realworld-multi');

  before(() => {
    if (fs.existsSync(multiProjectDir)) {
      fs.rmSync(multiProjectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(multiProjectDir, 'src'), { recursive: true });

    // 1. JS undefined variable (ReferenceError)
    fs.writeFileSync(
      path.join(multiProjectDir, 'src/ref.js'),
      'function testRef() {\n  return missingVar + 1;\n}\n'
    );

    // 2. TS Type mismatch
    fs.writeFileSync(
      path.join(multiProjectDir, 'src/mismatch.ts'),
      'let port: number = "8080";\nconsole.log(port);\n'
    );

    // 3. TS missing import
    fs.writeFileSync(
      path.join(multiProjectDir, 'src/badImport.ts'),
      'import { nonExistentModule } from "./nonExistentFile";\nconsole.log(nonExistentModule);\n'
    );

    // 4. Python syntax error
    fs.writeFileSync(
      path.join(multiProjectDir, 'src/script.py'),
      'def compute_total(\n  return 42\n'
    );

    // 5. Clean files
    fs.writeFileSync(
      path.join(multiProjectDir, 'src/clean.js'),
      'const version = "1.0.0";\nconsole.log(version);\n'
    );
  });

  after(() => {
    if (fs.existsSync(multiProjectDir)) {
      fs.rmSync(multiProjectDir, { recursive: true, force: true });
    }
  });

  test('Test Case 1 & 8: JavaScript undefined variable in closed file', async () => {
    const caps = await detectProjectCapabilities(multiProjectDir);
    const result = await runTscAnalyzer(multiProjectDir, caps.tsconfigPaths, caps.sourceFiles);

    const refIssue = result.issues.find((i) => i.filePath.includes('ref.js'));
    assert.ok(refIssue, 'Must discover error in closed ref.js');
    assert.strictEqual(refIssue.line, 2);
    assert.strictEqual(refIssue.severity, 'error');
    assert.ok(refIssue.message.includes('missingVar'));

    const category = classifyErrorCategory(refIssue);
    assert.strictEqual(category, 'REFERENCE');
  });

  test('Test Case 3: TypeScript type mismatch in closed file', async () => {
    const caps = await detectProjectCapabilities(multiProjectDir);
    const result = await runTscAnalyzer(multiProjectDir, caps.tsconfigPaths, caps.sourceFiles);

    const mismatchIssue = result.issues.find((i) => i.filePath.includes('mismatch.ts'));
    assert.ok(mismatchIssue, 'Must discover error in closed mismatch.ts');
    assert.strictEqual(mismatchIssue.line, 1);
    assert.strictEqual(mismatchIssue.severity, 'error');
    assert.strictEqual(mismatchIssue.code, 'TS2322');

    const category = classifyErrorCategory(mismatchIssue);
    assert.strictEqual(category, 'TYPE');

    // Test fix generation and validation
    const mismatchFile = path.join(multiProjectDir, 'src/mismatch.ts');
    const analysis = buildLocalAnalysis(
      {
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.",
        source: 'typescript',
        code: 'TS2322',
        startLine: 1,
        startColumn: 5,
        endLine: 1,
        endColumn: 9,
        filePath: 'src/mismatch.ts',
      },
      mismatchFile
    );

    assert.strictEqual(analysis.status, 'fixed');
    assert.strictEqual(analysis.originalCode, 'let port: number = "8080";');
    assert.strictEqual(analysis.correctedCode, 'let port: string = "8080";');
    assert.strictEqual(analysis.verificationStatus, 'VERIFIED');
  });

  test('Test Case 5: TypeScript missing import module', async () => {
    const caps = await detectProjectCapabilities(multiProjectDir);
    const result = await runTscAnalyzer(multiProjectDir, caps.tsconfigPaths, caps.sourceFiles);

    const importIssue = result.issues.find((i) => i.filePath.includes('badImport.ts'));
    assert.ok(importIssue, 'Must discover error in closed badImport.ts');
    assert.strictEqual(importIssue.line, 1);
    assert.strictEqual(importIssue.code, 'TS2307');
    assert.ok(importIssue.message.includes('Cannot find module'));

    const category = classifyErrorCategory(importIssue);
    assert.strictEqual(category, 'IMPORT');
  });

  test('Test Case 6: Python syntax error in closed script.py', async () => {
    const caps = await detectProjectCapabilities(multiProjectDir);
    assert.strictEqual(caps.hasPython, true);
    assert.ok(caps.pythonSourceFiles && caps.pythonSourceFiles.length >= 1);

    const pyResult = await runPythonAnalyzer(multiProjectDir, true, caps.pythonSourceFiles);
    assert.ok(pyResult.issues.length >= 1, 'Python analyzer must discover syntax error in script.py');

    const pyIssue = pyResult.issues.find((i) => i.filePath.includes('script.py'));
    assert.ok(pyIssue, 'Must discover issue in script.py');
    assert.strictEqual(pyIssue.line, 1);
    assert.strictEqual(pyIssue.severity, 'error');

    const category = classifyErrorCategory(pyIssue, 'python');
    assert.strictEqual(category, 'SYNTAX');
  });

  test('Test Case 9: Multiple errors across multiple closed files simultaneously', async () => {
    const caps = await detectProjectCapabilities(multiProjectDir);
    const tscResult = await runTscAnalyzer(multiProjectDir, caps.tsconfigPaths, caps.sourceFiles);
    const pyResult = await runPythonAnalyzer(multiProjectDir, true, caps.pythonSourceFiles);

    const allIssues = [...tscResult.issues, ...pyResult.issues];
    const deduped = normalizeAndDeduplicateIssues(allIssues);

    const filesWithIssues = new Set(deduped.map((i) => i.filePath));
    assert.ok(filesWithIssues.size >= 4, `Expected at least 4 files with issues, found ${filesWithIssues.size}`);
    assert.strictEqual(filesWithIssues.has('src/clean.js'), false, 'Clean file must never be reported');
  });

  test('Test Case 10: Warnings mixed with Errors properly classified by severity', () => {
    const issues = [
      {
        id: '1',
        filePath: 'src/app.ts',
        line: 10,
        column: 1,
        severity: 'error',
        message: "Cannot find name 'config'.",
        source: 'ts',
        analyzer: 'tsc',
      },
      {
        id: '2',
        filePath: 'src/app.ts',
        line: 15,
        column: 5,
        severity: 'warning',
        message: "'unusedVar' is declared but its value is never read.",
        source: 'ts',
        analyzer: 'tsc',
      },
      {
        id: '3',
        filePath: 'src/app.ts',
        line: 1,
        column: 1,
        severity: 'information',
        message: 'File is a CommonJS module.',
        source: 'ts',
        analyzer: 'tsc',
      },
      {
        id: '4',
        filePath: 'src/app.ts',
        line: 20,
        column: 1,
        severity: 'hint',
        message: 'Consider using const.',
        source: 'ts',
        analyzer: 'tsc',
      },
    ];

    const actionable = issues.filter((i) => isActionableSeverity(i.severity));
    assert.strictEqual(actionable.length, 2, 'Only Error and Warning are actionable by default');
    assert.strictEqual(actionable[0].severity, 'error');
    assert.strictEqual(actionable[1].severity, 'warning');

    const nonActionable = issues.filter((i) => !isActionableSeverity(i.severity));
    assert.strictEqual(nonActionable.length, 2, 'Information and Hint are non-actionable suggestions');
  });

  test('Test Case 11: Completely clean workspace reports 0 issues without false claims', async () => {
    const cleanDir = path.resolve(__dirname, '../test-realworld-clean');
    if (!fs.existsSync(cleanDir)) fs.mkdirSync(cleanDir, { recursive: true });
    fs.writeFileSync(path.join(cleanDir, 'main.js'), 'const a = 1; console.log(a);\n');

    try {
      const caps = await detectProjectCapabilities(cleanDir);
      const res = await runTscAnalyzer(cleanDir, caps.tsconfigPaths, caps.sourceFiles);

      assert.strictEqual(res.issues.length, 0);
      const stateMsg = buildStateMessage(0, [res.status]);
      assert.strictEqual(stateMsg, '✓ No diagnostics found by available analyzers.');
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  test('Phase 7 & 8: Safe fix validation only marks VERIFIED when AST check succeeds', () => {
    // Case A: Validated fix
    const verifiedOutput = validateProposedFix({
      filePath: 'test.ts',
      fileContent: 'let count: number = "10";\n',
      originalCode: 'let count: number = "10";',
      correctedCode: 'let count: string = "10";',
      diagnostic: {
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 10,
        code: '2322',
      },
    });

    assert.strictEqual(verifiedOutput.verificationStatus, 'VERIFIED');
    assert.strictEqual(verifiedOutput.status, 'validated');

    // Case B: Syntax error in proposed fix -> validation fails
    const invalidOutput = validateProposedFix({
      filePath: 'test.ts',
      fileContent: 'let count: number = "10";\n',
      originalCode: 'let count: number = "10";',
      correctedCode: 'let count: string = ;;;;', // syntax error
    });

    assert.strictEqual(invalidOutput.verificationStatus, 'NOT_VERIFIED');
    assert.strictEqual(invalidOutput.status, 'validation_failed');

    // Case C: Fix withheld (needs_context)
    const withheldOutput = validateProposedFix({
      filePath: 'test.ts',
      fileContent: 'console.log(username);\n',
      originalCode: 'username',
      correctedCode: null,
    });

    assert.strictEqual(withheldOutput.verificationStatus, 'NOT_VERIFIED');
    assert.strictEqual(withheldOutput.status, 'needs_context');
  });
});
