const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Import compiled pure modules
const { isSensitiveFile, redactSecrets } = require('../out/context/redact');
const { extractCodeWindow, capSelection } = require('../out/context/windowing');
const {
  normalizeDiagnosticCode,
  mapDiagnosticSeverity,
  convertTo1Based,
  findDiagnosticAtCursor,
  findNearestDiagnostic,
} = require('../out/diagnostics/diagnosticUtils');

describe('Client-side Privacy & File-skip Rules', () => {
  test('correctly flags sensitive filenames', () => {
    const sensitive = [
      '.env',
      '.env.production',
      '.env.local',
      'id_rsa',
      'id_rsa.pub',
      'id_ed25519',
      'server.key',
      'cert.pem',
      'credentials.json',
      'secrets.json',
      'secret.yaml',
      'my-key.pfx',
    ];

    for (const file of sensitive) {
      assert.strictEqual(
        isSensitiveFile(file),
        true,
        `Expected ${file} to be flagged as sensitive`
      );
      assert.strictEqual(
        isSensitiveFile(`config/subfolder/${file}`),
        true,
        `Expected nested ${file} to be flagged as sensitive`
      );
    }
  });

  test('allows standard safe project files', () => {
    const safeFiles = [
      'src/auth.js',
      'components/Button.jsx',
      'package.json',
      'tsconfig.json',
      'README.md',
      'index.html',
      'style.css',
      'test-fixtures/js-undefined.js',
    ];

    for (const file of safeFiles) {
      assert.strictEqual(
        isSensitiveFile(file),
        false,
        `Expected ${file} to be permitted`
      );
    }
  });
});

describe('Client-side Secret Redaction', () => {
  test('redacts private key blocks', () => {
    const code = `
const key = \`-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0m4wz7
-----END RSA PRIVATE KEY-----\`;
`;
    const redacted = redactSecrets(code);
    assert.strictEqual(redacted.includes('MIIEowIBAAKCAQEA0m4wz7'), false);
    assert.strictEqual(redacted.includes('[REDACTED PRIVATE KEY]'), true);
  });

  test('redacts API keys and tokens', () => {
    const code = `
const gemini = "AIzaSyD_EXAMPLE1234567890ABCDEFGH_ZZ";
const openai = "sk-abcdef12345678901234567890";
const github = "ghp_123456789012345678901234567890123456";
const aws = "AKIAIOSFODNN7EXAMPLE";
`;
    const redacted = redactSecrets(code);
    assert.strictEqual(redacted.includes('AIzaSyD_EXAMPLE'), false);
    assert.strictEqual(redacted.includes('sk-abcdef1234'), false);
    assert.strictEqual(redacted.includes('ghp_1234567890'), false);
    assert.strictEqual(redacted.includes('AKIAIOSFODNN7EXAMPLE'), false);
    assert.strictEqual(redacted.includes('[REDACTED GOOGLE KEY]'), true);
    assert.strictEqual(redacted.includes('[REDACTED API KEY]'), true);
  });

  test('redacts Authorization Bearer tokens', () => {
    const code = `headers['Authorization'] = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';`;
    const redacted = redactSecrets(code);
    assert.strictEqual(redacted.includes('Bearer [REDACTED TOKEN]'), true);
    assert.strictEqual(redacted.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
  });

  test('redacts sensitive assignment values', () => {
    const code = `
password = "supersecretpassword123";
const secret = 'my_super_secret_value';
const api_key = "123456789012345";
`;
    const redacted = redactSecrets(code);
    assert.strictEqual(redacted.includes('supersecretpassword123'), false);
    assert.strictEqual(redacted.includes('my_super_secret_value'), false);
    assert.strictEqual(redacted.includes('123456789012345'), false);
    assert.strictEqual(redacted.includes('[REDACTED]'), true);
  });
});

describe('Code Windowing & Payload Capping', () => {
  const sampleLines = Array.from({ length: 100 }, (_, i) => `const line${i + 1} = ${i + 1};`);
  const sampleContent = sampleLines.join('\n');

  test('handles beginning of file edge case (line 1)', () => {
    const res = extractCodeWindow({
      content: sampleContent,
      targetLine: 1,
      contextLines: 20,
    });

    assert.strictEqual(res.startLine, 1);
    assert.strictEqual(res.endLine, 21);
    assert.strictEqual(res.truncated, false);
    assert.strictEqual(res.codeContext.startsWith('const line1 = 1;'), true);
    assert.strictEqual(res.codeContext.endsWith('const line21 = 21;'), true);
  });

  test('handles end of file edge case (line 100)', () => {
    const res = extractCodeWindow({
      content: sampleContent,
      targetLine: 100,
      contextLines: 20,
    });

    assert.strictEqual(res.startLine, 80);
    assert.strictEqual(res.endLine, 100);
    assert.strictEqual(res.truncated, false);
    assert.strictEqual(res.codeContext.endsWith('const line100 = 100;'), true);
  });

  test('handles empty file cleanly', () => {
    const res = extractCodeWindow({
      content: '',
      targetLine: 1,
    });
    assert.strictEqual(res.codeContext, '');
    assert.strictEqual(res.truncated, false);
  });

  test('prioritizes selection with tighter cushion', () => {
    const res = extractCodeWindow({
      content: sampleContent,
      targetLine: 50,
      contextLines: 20,
      selectionText: 'const line50 = 50;',
    });

    assert.strictEqual(res.startLine, 45); // 50 - 5 cushion
    assert.strictEqual(res.endLine, 55);   // 50 + 5 cushion
  });

  test('caps payload size when character count exceeds maxChars', () => {
    const largeContent = 'a'.repeat(50000);
    const res = extractCodeWindow({
      content: largeContent,
      targetLine: 1,
      contextLines: 50,
      maxChars: 1000,
    });

    assert.strictEqual(res.truncated, true);
    assert.strictEqual(res.codeContext.includes('[TRUNCATED DUE TO SIZE LIMIT]'), true);
    assert.ok(res.codeContext.length <= 1100);
  });

  test('capSelection truncates oversized selection text', () => {
    const hugeSelection = 'x'.repeat(20000);
    const capped = capSelection(hugeSelection, 5000);
    assert.strictEqual(capped.includes('[SELECTION TRUNCATED]'), true);
    assert.ok(capped.length <= 5100);
  });
});

describe('Diagnostic Normalization & Coordinate Conversion', () => {
  test('normalizes diagnostic codes', () => {
    assert.strictEqual(normalizeDiagnosticCode(2532), '2532');
    assert.strictEqual(normalizeDiagnosticCode('TS2304'), 'TS2304');
    assert.strictEqual(normalizeDiagnosticCode({ value: 2322, target: 'uri' }), '2322');
    assert.strictEqual(normalizeDiagnosticCode(undefined), undefined);
    assert.strictEqual(normalizeDiagnosticCode(null), undefined);
  });

  test('maps VS Code severity enums to strings', () => {
    assert.strictEqual(mapDiagnosticSeverity(0), 'error');
    assert.strictEqual(mapDiagnosticSeverity(1), 'warning');
    assert.strictEqual(mapDiagnosticSeverity(2), 'information');
    assert.strictEqual(mapDiagnosticSeverity(3), 'hint');
    assert.strictEqual(mapDiagnosticSeverity('warning'), 'warning');
    assert.strictEqual(mapDiagnosticSeverity('info'), 'information');
  });

  test('converts 0-based coordinates to 1-based coordinates consistently', () => {
    const pos1 = convertTo1Based(0, 0);
    assert.strictEqual(pos1.line, 1);
    assert.strictEqual(pos1.column, 1);

    const pos2 = convertTo1Based(46, 14);
    assert.strictEqual(pos2.line, 47);
    assert.strictEqual(pos2.column, 15);
  });

  test('finds diagnostic at cursor position', () => {
    const diags = [
      { severity: 'error', message: 'First error', startLine: 10, startColumn: 1, endLine: 10, endColumn: 20 },
      { severity: 'warning', message: 'Second issue', startLine: 25, startColumn: 5, endLine: 25, endColumn: 15 },
    ];

    const match = findDiagnosticAtCursor(diags, 10, 5);
    assert.ok(match);
    assert.strictEqual(match.message, 'First error');

    const noMatch = findDiagnosticAtCursor(diags, 50, 1);
    assert.strictEqual(noMatch, undefined);
  });

  test('finds nearest diagnostic to cursor', () => {
    const diags = [
      { severity: 'error', message: 'Line 10 error', startLine: 10, startColumn: 1, endLine: 10, endColumn: 20 },
      { severity: 'error', message: 'Line 80 error', startLine: 80, startColumn: 1, endLine: 80, endColumn: 20 },
    ];

    const nearestTo15 = findNearestDiagnostic(diags, 15);
    assert.strictEqual(nearestTo15.message, 'Line 10 error');

    const nearestTo75 = findNearestDiagnostic(diags, 75);
    assert.strictEqual(nearestTo75.message, 'Line 80 error');
  });
});

describe('Local Diagnostic Explanations (Instant Offline Display)', () => {
  const { buildLocalAnalysis } = require('../out/diagnostics/localAnalysis');

  test('builds instant local analysis for TypeScript type mismatch (code 2322)', () => {
    const diagnostic = {
      severity: 'error',
      message: "Type 'string' is not assignable to type 'number'.",
      source: 'ts',
      code: '2322',
      startLine: 3,
      startColumn: 5,
      endLine: 3,
      endColumn: 11,
    };

    const res = buildLocalAnalysis(diagnostic, 'extension/test-fixtures/ts-mismatch.ts');

    assert.strictEqual(res.errorType, 'TypeScript Error');
    assert.strictEqual(res.location.file, 'extension/test-fixtures/ts-mismatch.ts');
    assert.strictEqual(res.location.line, 3);
    assert.strictEqual(res.summary, "Type 'string' is not assignable to type 'number'.");
    assert.ok(res.explanation.includes('string value was assigned to a variable that was declared as a number'));
    assert.ok(res.cause.includes('userId expects a number'));
    assert.ok(res.suggestion.includes('Change the type or provide a numeric value'));
    assert.strictEqual(res.analysisSource, 'rules');
  });

  test('builds instant local analysis for undefined property access (code 2532)', () => {
    const diagnostic = {
      severity: 'error',
      message: "Object is possibly 'undefined'.",
      source: 'ts',
      code: '2532',
      startLine: 4,
      startColumn: 13,
      endLine: 4,
      endColumn: 22,
    };

    const res = buildLocalAnalysis(diagnostic, 'extension/test-fixtures/js-undefined.js');

    assert.strictEqual(res.errorType, 'TypeError');
    assert.ok(res.suggestion.includes('optional chaining'));
  });

  test('builds instant local analysis for undeclared variable (code 2304)', () => {
    const diagnostic = {
      severity: 'error',
      message: "Cannot find name 'username'.",
      source: 'ts',
      code: '2304',
      startLine: 3,
      startColumn: 13,
      endLine: 3,
      endColumn: 21,
    };

    const res = buildLocalAnalysis(diagnostic, 'extension/test-fixtures/js-reference.js');

    assert.strictEqual(res.errorType, 'ReferenceError');
    assert.ok(res.explanation.includes('declared or imported'));
  });
});

describe('Workspace-wide Diagnostics & File Grouping', () => {
  const { isWorkspaceRelevantPath, groupDiagnosticsByFile } = require('../out/diagnostics/diagnosticUtils');

  test('correctly identifies workspace-relevant paths and filters node_modules/build', () => {
    const roots = ['/Users/dev/project'];

    // Safe workspace files
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/src/payment.ts', 'src/payment.ts', roots), true);
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/components/Login.tsx', 'components/Login.tsx', roots), true);
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/server.ts', 'server.ts', roots), true);

    // Outside workspace
    assert.strictEqual(isWorkspaceRelevantPath('/Users/other/app.js', 'app.js', roots), false);

    // Ignored / Vendor folders
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/node_modules/pkg/index.js', 'node_modules/pkg/index.js', roots), false);
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/.git/config', '.git/config', roots), false);
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/dist/bundle.js', 'dist/bundle.js', roots), false);
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/build/main.js', 'build/main.js', roots), false);
    assert.strictEqual(isWorkspaceRelevantPath('/Users/dev/project/.venv/lib/py.py', '.venv/lib/py.py', roots), false);
  });

  test('groups diagnostics by file and calculates error and warning counts', () => {
    const diagnostics = [
      {
        severity: 'error',
        message: "Type 'string' is not assignable to type 'number'.",
        source: 'ts',
        code: '2322',
        startLine: 42,
        startColumn: 18,
        endLine: 42,
        endColumn: 25,
        filePath: 'src/payment.ts',
        uri: 'file:///Users/dev/project/src/payment.ts',
      },
      {
        severity: 'error',
        message: 'Cannot find name user.',
        source: 'ts',
        code: '2304',
        startLine: 27,
        startColumn: 9,
        endLine: 27,
        endColumn: 13,
        filePath: 'components/Login.tsx',
        uri: 'file:///Users/dev/project/components/Login.tsx',
      },
      {
        severity: 'warning',
        message: 'Unused variable paymentMethod.',
        source: 'ts',
        code: '6133',
        startLine: 10,
        startColumn: 5,
        endLine: 10,
        endColumn: 18,
        filePath: 'src/payment.ts',
        uri: 'file:///Users/dev/project/src/payment.ts',
      },
    ];

    const grouped = groupDiagnosticsByFile(diagnostics);

    assert.strictEqual(grouped.length, 2, 'Should group into 2 files');

    // First file: src/payment.ts (has 1 error, 1 warning = 2 total)
    const paymentFile = grouped.find((f) => f.filePath === 'src/payment.ts');
    assert.ok(paymentFile, 'src/payment.ts must be present');
    assert.strictEqual(paymentFile.errorCount, 1);
    assert.strictEqual(paymentFile.warningCount, 1);
    assert.strictEqual(paymentFile.diagnostics.length, 2);
    // Verified sorted by startLine
    assert.strictEqual(paymentFile.diagnostics[0].startLine, 10);
    assert.strictEqual(paymentFile.diagnostics[1].startLine, 42);

    // Second file: components/Login.tsx (has 1 error)
    const loginFile = grouped.find((f) => f.filePath === 'components/Login.tsx');
    assert.ok(loginFile, 'components/Login.tsx must be present');
    assert.strictEqual(loginFile.errorCount, 1);
    assert.strictEqual(loginFile.warningCount, 0);
    assert.strictEqual(loginFile.diagnostics.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Workspace Scan Engine Tests
// ---------------------------------------------------------------------------
const { parseTscOutput } = require('../out/scanner/parsers/tscParser');
const { parseEslintOutput } = require('../out/scanner/parsers/eslintParser');
const { parsePythonOutput } = require('../out/scanner/parsers/pythonParser');
const {
  isWorkspaceRelevantPath: isScannerRelevantPath,
  normalizeAndDeduplicateIssues,
  buildStateMessage,
} = require('../out/scanner/normalizer');
const { detectProjectCapabilities } = require('../out/scanner/projectDetector');

describe('TypeScript Compiler (tsc) Output Parser', () => {
  test('parses standard colon-formatted tsc error', () => {
    const raw = `src/payment.ts:42:18 - error TS2532: Object is possibly 'undefined'.\nFound 1 error in src/payment.ts:42`;
    const issues = parseTscOutput(raw, '/workspace');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'src/payment.ts');
    assert.strictEqual(issues[0].line, 42);
    assert.strictEqual(issues[0].column, 18);
    assert.strictEqual(issues[0].severity, 'error');
    assert.strictEqual(issues[0].code, 'TS2532');
    assert.strictEqual(issues[0].message, "Object is possibly 'undefined'.");
    assert.strictEqual(issues[0].analyzer, 'tsc');
  });

  test('parses parenthesized tsc error', () => {
    const raw = `components/Login.tsx(27,9): error TS2304: Cannot find name 'username'.`;
    const issues = parseTscOutput(raw, '/workspace');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'components/Login.tsx');
    assert.strictEqual(issues[0].line, 27);
    assert.strictEqual(issues[0].column, 9);
    assert.strictEqual(issues[0].code, 'TS2304');
    assert.strictEqual(issues[0].message, "Cannot find name 'username'.");
  });

  test('strips ANSI escape codes from colored tsc output', () => {
    const raw = `\x1b[96msrc/auth.ts\x1b[0m:\x1b[93m15\x1b[0m:\x1b[93m5\x1b[0m - \x1b[91merror\x1b[0m \x1b[90mTS2322: \x1b[0mType 'string' is not assignable to type 'number'.`;
    const issues = parseTscOutput(raw, '/workspace');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'src/auth.ts');
    assert.strictEqual(issues[0].line, 15);
    assert.strictEqual(issues[0].column, 5);
    assert.strictEqual(issues[0].code, 'TS2322');
  });
});

describe('ESLint Output Parser', () => {
  test('parses structured JSON ESLint output', () => {
    const jsonOutput = JSON.stringify([
      {
        filePath: '/workspace/src/auth.js',
        messages: [
          {
            ruleId: 'no-undef',
            severity: 2,
            message: "'user' is not defined.",
            line: 47,
            column: 12,
            endLine: 47,
            endColumn: 16,
          },
        ],
        errorCount: 1,
        warningCount: 0,
      },
    ]);

    const issues = parseEslintOutput(jsonOutput, '/workspace');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'src/auth.js');
    assert.strictEqual(issues[0].line, 47);
    assert.strictEqual(issues[0].column, 12);
    assert.strictEqual(issues[0].severity, 'error');
    assert.strictEqual(issues[0].code, 'no-undef');
    assert.strictEqual(issues[0].message, "'user' is not defined.");
    assert.strictEqual(issues[0].analyzer, 'eslint');
  });

  test('parses fallback text ESLint output', () => {
    const textOutput = `src/auth.js:47:12: error: 'user' is not defined. [no-undef]`;
    const issues = parseEslintOutput(textOutput, '/workspace');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'src/auth.js');
    assert.strictEqual(issues[0].line, 47);
    assert.strictEqual(issues[0].column, 12);
    assert.strictEqual(issues[0].code, 'no-undef');
  });
});

describe('Python Analyzer Output Parser', () => {
  test('parses Pyright JSON diagnostics and converts 0-based coordinates', () => {
    const jsonOutput = JSON.stringify({
      generalDiagnostics: [
        {
          file: '/workspace/server.py',
          severity: 'error',
          message: 'Type "str" is not assignable to "int"',
          range: {
            start: { line: 11, character: 4 },
            end: { line: 11, character: 15 },
          },
          rule: 'reportGeneralTypeIssues',
        },
      ],
    });

    const issues = parsePythonOutput(jsonOutput, '/workspace');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].filePath, 'server.py');
    assert.strictEqual(issues[0].line, 12, 'Converts line 11 (0-based) to 12 (1-based)');
    assert.strictEqual(issues[0].column, 5, 'Converts char 4 (0-based) to 5 (1-based)');
    assert.strictEqual(issues[0].code, 'reportGeneralTypeIssues');
    assert.strictEqual(issues[0].analyzer, 'pyright');
  });
});

describe('Workspace Issue Normalization & Deduplication', () => {
  test('deduplicates identical issues between VS Code diagnostics and tsc', () => {
    const rawIssues = [
      {
        id: 'vscode-1',
        filePath: 'src/payment.ts',
        line: 42,
        column: 18,
        severity: 'error',
        message: "Object is possibly 'undefined'.",
        source: 'typescript',
        code: '2532',
        analyzer: 'vscode',
      },
      {
        id: 'tsc-1',
        filePath: 'src/payment.ts',
        line: 42,
        column: 18,
        severity: 'error',
        message: "Object is possibly 'undefined'.",
        source: 'typescript',
        code: 'TS2532',
        analyzer: 'tsc',
      },
    ];

    const deduped = normalizeAndDeduplicateIssues(rawIssues);
    assert.strictEqual(deduped.length, 1, 'Duplicate issue must be merged into 1 card');
    assert.strictEqual(deduped[0].filePath, 'src/payment.ts');
    assert.strictEqual(deduped[0].line, 42);
    assert.strictEqual(deduped[0].code, 'TS2532');
    assert.strictEqual(deduped[0].analyzer, 'tsc');
  });

  test('filters out issues from node_modules, .git, and build directories', () => {
    const rawIssues = [
      {
        id: '1',
        filePath: 'node_modules/express/index.d.ts',
        line: 10,
        column: 1,
        severity: 'error',
        message: 'Module error',
        source: 'ts',
        analyzer: 'tsc',
      },
      {
        id: '2',
        filePath: 'dist/bundle.js',
        line: 1,
        column: 1,
        severity: 'error',
        message: 'Syntax error',
        source: 'ts',
        analyzer: 'tsc',
      },
      {
        id: '3',
        filePath: 'src/valid.ts',
        line: 5,
        column: 2,
        severity: 'error',
        message: 'Valid error',
        source: 'ts',
        analyzer: 'tsc',
      },
    ];

    const deduped = normalizeAndDeduplicateIssues(rawIssues);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].filePath, 'src/valid.ts');
  });

  test('builds accurate honest state message without false clean claims', () => {
    // Case 1: Issues found
    const msgWithIssues = buildStateMessage(3, [
      { name: 'TypeScript', type: 'tsc', status: 'completed', issueCount: 3 },
    ]);
    assert.strictEqual(msgWithIssues, '3 issues found');

    // Case 2: Zero issues, analyzer completed
    const msgCleanAnalyzed = buildStateMessage(0, [
      { name: 'TypeScript', type: 'tsc', status: 'completed', issueCount: 0 },
    ]);
    assert.strictEqual(
      msgCleanAnalyzed,
      '✓ No diagnostics found by available analyzers.'
    );

    // Case 3: No analyzers configured
    const msgNoAnalyzer = buildStateMessage(0, [
      { name: 'TypeScript', type: 'tsc', status: 'not_configured', issueCount: 0 },
      { name: 'ESLint', type: 'eslint', status: 'not_configured', issueCount: 0 },
      { name: 'Python', type: 'pyright', status: 'not_configured', issueCount: 0 },
    ]);
    assert.strictEqual(msgNoAnalyzer, '⚠ No supported workspace analyzer detected.');
  });
});

describe('Project Capability Detection', () => {
  test('discovers tsconfig in test-workspace', async () => {
    const path = require('path');
    const wsRoot = path.resolve(__dirname, '../test-workspace');
    const caps = await detectProjectCapabilities(wsRoot);

    assert.strictEqual(caps.hasTypeScript, true);
    assert.ok(caps.tsconfigPaths.length >= 1);
    assert.ok(caps.tsconfigPaths[0].includes('tsconfig.json'));
  });

  test('discovers tsconfig in test-fixtures', async () => {
    const path = require('path');
    const fixturesRoot = path.resolve(__dirname, '../test-fixtures');
    const caps = await detectProjectCapabilities(fixturesRoot);

    assert.strictEqual(caps.hasTypeScript, true);
    assert.ok(caps.tsconfigPaths.length >= 1);
  });
});

