'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { validateProposedFix } = require('../src/diagnostics/fixValidator');
const { extractCodeWindow } = require('../src/context/windowing');

// Public diagnostic/cursor lines and columns are 1-based. Window endpoints are
// inclusive absolute file lines. JavaScript array indices are internal, 0-based.
const diagnostic = (code = '2322', startLine = 1, startColumn = 5) => ({
  code, severity: 'error', message: 'Incompatible assignment',
  startLine, startColumn, endLine: startLine, endColumn: startColumn + 7,
});

function candidate(overrides = {}) {
  return {
    filePath: 'inventory.ts',
    fileContent: 'let inventory: number = "empty";',
    originalCode: 'let inventory: number = "empty";',
    correctedCode: 'let inventory: string = "empty";',
    diagnostic: diagnostic(),
    ...overrides,
  };
}

function loadWithVscode(relative, vscode) {
  const cache = new Map();
  const sourceRoot = path.resolve(__dirname, '../src') + path.sep;
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    cache.set(filename, module);
    vm.runInNewContext('(function(require,module,exports,__filename,__dirname){' + fs.readFileSync(filename, 'utf8') + '\n})', {
      console, process, Buffer, URL, TextDecoder, setTimeout, clearTimeout,
    }, { filename })(id => {
      if (id === 'vscode') return vscode;
      const resolved = localRequire.resolve(id);
      return resolved.startsWith(sourceRoot) ? load(resolved) : localRequire(id);
    }, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  return load(path.resolve(__dirname, relative));
}

test('D1: a still-invalid type replacement is never VERIFIED', () => {
  const result = validateProposedFix(candidate({ correctedCode: 'let inventory: number = "unavailable";' }));
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

test('D1: a genuine full-file compiler rerun records VERIFIED and full_file scope', () => {
  const result = validateProposedFix(candidate());
  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.checkStatus, 'VERIFIED');
  assert.equal(result.scope, 'full_file');
});

test('D1: resolving the original error while introducing another error is not VERIFIED', () => {
  const result = validateProposedFix(candidate({
    fileContent: 'let inventory: number = "empty";\nconst next: number = inventory + 1;',
  }));
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

test('D1: matching diagnostic code at the wrong location cannot establish verification', () => {
  const result = validateProposedFix(candidate({ diagnostic: diagnostic('2322', 2, 5) }));
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

test('D1: snippet-only parsing is SYNTAX_CHECKED with snippet scope', () => {
  const result = validateProposedFix(candidate({ fileContent: undefined }));
  assert.equal(result.verificationStatus, 'SYNTAX_CHECKED');
  assert.equal(result.checkStatus, 'SYNTAX_CHECKED');
  assert.equal(result.scope, 'snippet');
});

for (const replacement of [
  'if (true) { console.log(account.balance); }',
  'console.log(account.balance); const unrelated = other?.value;',
]) {
  test('D1: unrelated null guards cannot prove resolution: ' + replacement, () => {
    const result = validateProposedFix({
      filePath: 'ledger.ts',
      fileContent: 'let account: { balance: number } | undefined;\nconsole.log(account.balance);',
      originalCode: 'console.log(account.balance);', correctedCode: replacement,
      diagnostic: diagnostic('18048', 2, 13),
    });
    assert.notEqual(result.verificationStatus, 'VERIFIED');
  });
}

test('D1: valid JavaScript fix is checked semantically against the full file', () => {
  const result = validateProposedFix({
    filePath: 'inventory.js', fileContent: 'const units = missingUnits;',
    originalCode: 'const units = missingUnits;', correctedCode: 'const units = 3;',
    diagnostic: diagnostic('2304', 1, 15),
  });
  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.scope, 'full_file');
});

test('D1: Python never receives VERIFIED from a TypeScript parse', () => {
  const result = validateProposedFix({
    filePath: 'ledger.py', fileContent: 'print(unknown)',
    originalCode: 'print(unknown)', correctedCode: 'print("ready")',
    diagnostic: diagnostic('2322'),
  });
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

test('D4: an exactly unchanged replacement requests context', () => {
  const data = candidate();
  const result = validateProposedFix({ ...data, correctedCode: data.originalCode });
  assert.equal(result.status, 'needs_context');
  assert.equal(result.verificationStatus, 'NOT_VERIFIED');
});

test('D4: whitespace differences are not treated as exact equality', () => {
  const result = validateProposedFix(candidate({
    fileContent: undefined, correctedCode: 'let inventory: number = "empty"; ',
  }));
  assert.equal(result.verificationStatus, 'SYNTAX_CHECKED');
});

for (const [targetLine, startLine, endLine] of [[1, 1, 3], [6, 4, 6]]) {
  test(`D3: collector transmits inclusive 1-based endpoints at file line ${targetLine}`, async () => {
    const content = Array.from({ length: 6 }, (_, i) => `const item${i + 1} = ${i + 1};`).join('\n');
    const { collectDocumentContext } = loadWithVscode('../src/context/contextCollector.js', {
      workspace: { name: 'window-test', workspaceFolders: [], asRelativePath: () => 'ledger.js' },
    });
    const collected = await collectDocumentContext({
      uri: { fsPath: '/test/ledger.js' }, languageId: 'javascript', getText: () => content,
    }, { mode: 'analyze_error', targetDiagnostic: diagnostic('2304', targetLine, 1), contextLines: 2 });
    assert.equal(collected.payload.codeContextStartLine, startLine);
    assert.equal(collected.payload.codeContextEndLine, endLine);
    assert.equal(collected.payload.cursor.line, targetLine);
    assert.equal(collected.payload.cursor.column, 1);
    const window = extractCodeWindow({ content, targetLine, contextLines: 2 });
    assert.equal(window.startLine, startLine);
    assert.equal(window.endLine, endLine);
    assert.equal(collected.payload.codeContext, window.codeContext);
  });
}

const uiDiagnostic = diagnostic('2322');
function renderAnalysis(analysis) {
  const { BugifyPanel } = loadWithVscode('../src/ui/bugifyPanel.js', {
    Uri: { joinPath: (...parts) => parts.join('/') },
  });
  const panel = Object.create(BugifyPanel.prototype);
  panel.webview = { cspSource: 'test:', asWebviewUri: uri => uri };
  panel.extensionUri = '/extension';
  panel.state = {
    viewMode: 'current_file', loading: false, aiAnalyzing: false,
    issues: [uiDiagnostic], selectedIssueIndex: 0, analysis,
    activeFilePath: 'ledger.ts', workspaceTotalCount: 0, workspaceIssues: [],
  };
  return panel.getHtmlForWebview();
}

test('D1 UI: legacy validated status alone never displays FIX VERIFIED', () => {
  const html = renderAnalysis({
    status: 'fixed', originalCode: 'a', correctedCode: 'b',
    validation: { status: 'validated' },
  });
  assert.doesNotMatch(html, /FIX VERIFIED/);
});

test('D1 UI: code-window evidence is labeled syntax checked, never verified', () => {
  const html = renderAnalysis({
    status: 'fixed', originalCode: 'a', correctedCode: 'b', verificationStatus: 'SYNTAX_CHECKED',
    validation: { status: 'validated', checkStatus: 'SYNTAX_CHECKED', scope: 'code_window' },
  });
  assert.match(html, /SYNTAX CHECKED/i);
  assert.doesNotMatch(html, /FIX VERIFIED/);
});

test('D1 UI: inconsistent VERIFIED flag with code-window scope is not trusted', () => {
  const html = renderAnalysis({
    status: 'fixed', originalCode: 'a', correctedCode: 'b', verificationStatus: 'VERIFIED',
    validation: { status: 'validated', checkStatus: 'SYNTAX_CHECKED', scope: 'code_window' },
  });
  assert.doesNotMatch(html, /FIX VERIFIED/);
});

test('D1 UI: apply confirmation identifies a syntax-only suggestion without changing edit behavior', async () => {
  let confirmation;
  const { BugifyPanel } = loadWithVscode('../src/ui/bugifyPanel.js', {
    workspace: {
      workspaceFolders: [{ uri: '/test' }],
      openTextDocument: async () => ({ lineCount: 1, lineAt: () => ({ text: 'before();', range: {} }) }),
    },
    Uri: { joinPath: (...parts) => parts.join('/') },
    window: { showInformationMessage: async (message, options) => {
      confirmation = message + '\n' + options.detail;
      return 'Cancel';
    } },
  });
  const panel = Object.create(BugifyPanel.prototype);
  panel.state = { analysis: { verificationStatus: 'SYNTAX_CHECKED', validation: { checkStatus: 'SYNTAX_CHECKED', scope: 'snippet' } } };
  await panel.applyFixToEditor('ledger.ts', 1, 'after();', 'before();');
  assert.match(confirmation, /syntax.checked|not.verified/i);
  assert.match(confirmation, /BEFORE:\nbefore\(\);/);
  assert.match(confirmation, /AFTER:\nafter\(\);/);
});
