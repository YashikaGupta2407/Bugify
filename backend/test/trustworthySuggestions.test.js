'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Isolated CommonJS loads: no live AI/Judge0 calls, server, database, or timers.
function load(relative, { mocks = {}, globals = {}, env = {} } = {}) {
  const filename = path.resolve(__dirname, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const context = {
    Buffer, URL, console, process: { env },
    fetch: async () => { throw new Error('Unexpected network call'); },
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, ...globals,
  };
  vm.runInNewContext('(function(require,module,exports,__filename,__dirname){' + fs.readFileSync(filename, 'utf8') + '\n})', context, { filename })(
    id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports, filename, path.dirname(filename),
  );
  return module.exports;
}

// All wire lines/columns are 1-based; window endpoints are inclusive absolute
// file lines. No wire field contains compiler offsets or array indices.
const diag = (code = '2322', startLine = 1, startColumn = 5) => ({
  code, startLine, startColumn, endLine: startLine, endColumn: startColumn + 7,
  severity: 'error', message: 'Type string is not assignable to type number',
});
const replacement = overrides => ({
  language: 'typescript', filePath: 'inventory.ts',
  originalCode: 'let inventory: number = "empty";',
  correctedCode: 'let inventory: string = "empty";',
  diagnostic: diag(), ...overrides,
});
function validator() {
  return load('../src/services/validationService.js', {
    mocks: { child_process: { spawnSync: () => ({ status: 0, stderr: '' }) } },
  }).validateFix;
}

test('D1 backend: syntax-only validation records SYNTAX_CHECKED and snippet scope', () => {
  const result = validator()(replacement());
  assert.equal(result.checkStatus, 'SYNTAX_CHECKED');
  assert.equal(result.scope, 'snippet');
});

test('D1 backend: a supplied code window never becomes VERIFIED', () => {
  const result = validator()(replacement({
    codeContext: 'let inventory: number = "empty";', codeContextStartLine: 40, codeContextEndLine: 40,
  }));
  assert.equal(result.checkStatus, 'SYNTAX_CHECKED');
  assert.equal(result.scope, 'code_window');
});

test('D1 backend: valid correction is VERIFIED only with full file content', () => {
  const result = validator()(replacement({ fullFileContent: 'let inventory: number = "empty";' }));
  assert.equal(result.checkStatus, 'VERIFIED');
  assert.equal(result.scope, 'full_file');
});

test('D1 backend: still-invalid correction with full content is never VERIFIED', () => {
  const result = validator()(replacement({
    fullFileContent: 'let inventory: number = "empty";', correctedCode: 'let inventory: number = "missing";',
  }));
  assert.equal(result.status, 'validation_failed');
  assert.notEqual(result.checkStatus, 'VERIFIED');
});

test('D1 backend: resolving one diagnostic must not introduce a new type error', () => {
  const result = validator()(replacement({
    fullFileContent: 'let inventory: number = "empty";\nconst next: number = inventory + 1;',
  }));
  assert.equal(result.status, 'validation_failed');
});

test('D1 backend: full content with a mismatched original diagnostic location is not VERIFIED', () => {
  const result = validator()(replacement({
    fullFileContent: 'let inventory: number = "empty";', diagnostic: diag('2322', 2, 5),
  }));
  assert.notEqual(result.checkStatus, 'VERIFIED');
  assert.equal(result.scope, 'full_file');
});

test('D1 backend: a full Python file with mocked successful AST parsing is only SYNTAX_CHECKED', () => {
  const result = validator()({
    language: 'python', originalCode: 'print(unknown)', correctedCode: 'print("ready")',
    fullFileContent: 'print(unknown)', diagnostic: diag('NameError'),
  });
  assert.equal(result.checkStatus, 'SYNTAX_CHECKED');
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

test('D4 backend validator: exact unchanged code requests context', () => {
  const data = replacement();
  assert.equal(validator()({ ...data, correctedCode: data.originalCode }).status, 'needs_context');
});

test('D4 backend validator: whitespace is not ignored when comparing replacements', () => {
  const data = replacement();
  const result = validator()({ ...data, correctedCode: data.originalCode + ' ' });
  assert.equal(result.checkStatus, 'SYNTAX_CHECKED');
});

function rules(overrides = {}) {
  return load('../src/services/aiExplanationService.js').buildRuleBasedAnalysis({
    mode: 'analyze_error', file: { path: 'ledger.ts', language: 'typescript' }, language: 'typescript',
    errorType: 'TypeError', diagnostic: diag(), codeContextStartLine: 1, codeContextEndLine: 1,
    codeContext: 'const subtotal: number = "125";', ...overrides,
  });
}
function withheld(result) {
  assert.equal(result.status, 'NEEDS_CONTEXT');
  assert.equal(result.correctedCode, null);
}

test('D2: a fallback cannot replace an arbitrary variable with a canned example', () => {
  const result = rules();
  if (result.correctedCode == null) withheld(result);
  else {
    assert.match(result.correctedCode, /subtotal/);
    assert.match(result.correctedCode, /125/);
    assert.doesNotMatch(result.correctedCode, /userId|user_42/);
  }
});

for (const [language, codeContext, message, errorType] of [
  ['javascript', 'console.log(customerRecord);', "Cannot find name 'customerRecord'", 'ReferenceError'],
  ['python', 'print(tax_band)', "name 'tax_band' is not defined", 'NameError'],
]) {
  test(`D2: ${language} unknown identifiers never receive invented values`, () => {
    withheld(rules({ language, codeContext, errorType, diagnostic: { ...diag('2304'), message } }));
  });
}

test('D2: Python index fallback never invents collection names or a hardcoded index', () => {
  const result = rules({
    language: 'python', codeContext: '    print(totals[offset])', errorType: 'IndexError',
    diagnostic: { ...diag('IndexError'), message: 'list index out of range' },
  });
  if (result.correctedCode == null) withheld(result);
  else {
    assert.doesNotMatch(result.correctedCode, /numbers|\[10\]|const |console\.log/);
    assert.match(result.correctedCode, /totals/);
    assert.match(result.correctedCode, /offset/);
  }
});

test('D2: property suggestions cannot invent a logger or unrelated user access', () => {
  const result = rules({
    codeContext: '    const title = customer.name;',
    diagnostic: { ...diag('18048'), message: "Object is possibly 'undefined'." },
  });
  if (result.correctedCode == null) withheld(result);
  else {
    assert.match(result.correctedCode, /customer/);
    assert.doesNotMatch(result.correctedCode, /console\.log|user\?/);
  }
});

for (const [startLine, endLine, targetLine, index] of [[73, 75, 73, 0], [73, 75, 75, 2]]) {
  test(`D3: inclusive window boundary ${targetLine} selects the actual indented line`, () => {
    const lines = ['    inspect(first);', '      inspect(middle);', '        inspect(last);'];
    const result = rules({
      codeContext: lines.join('\n'), codeContextStartLine: startLine, codeContextEndLine: endLine,
      diagnostic: { ...diag('9999', targetLine, 1), message: 'Unknown diagnostic' },
    });
    assert.equal(result.originalCode, lines[index]);
    assert.equal(result.location.startLine, targetLine);
  });
}

for (const targetLine of [72, 76]) {
  test(`D3: diagnostic ${targetLine} outside window 73..75 never falls back to first line`, () => {
    withheld(rules({
      codeContext: 'first();\nmiddle();\nlast();', codeContextStartLine: 73, codeContextEndLine: 75,
      diagnostic: diag('2322', targetLine),
    }));
  });
}

test('D3: missing window coordinates cannot imply a window begins at file line 1', () => {
  withheld(rules({ codeContextStartLine: undefined, codeContextEndLine: undefined }));
});

test('D3: contradictory window endpoints request context', () => {
  withheld(rules({ codeContextStartLine: 1, codeContextEndLine: 3 }));
});

test('D4: a generic fallback with no real replacement requests context', () => {
  withheld(rules({ codeContext: 'keepExisting();', diagnostic: { ...diag('9999'), message: 'Unknown diagnostic' } }));
});

test('D4: an AI provider claiming unchanged code is fixed is overridden', async () => {
  const text = '    const subtotal = calculate();';
  const ai = load('../src/services/aiExplanationService.js', {
    env: { AI_API_KEY: 'test-only', AI_PROVIDER: 'openai' },
    globals: { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      summary: 'Proposed repair', rootCause: 'Example cause', status: 'fixed', originalCode: text, correctedCode: text,
    }) } }] }) }) },
  });
  const result = await ai.explainExtensionDiagnostic({
    file: { path: 'ledger.js', language: 'javascript' }, language: 'javascript',
    codeContext: text, codeContextStartLine: 20, codeContextEndLine: 20,
    diagnostic: diag('9999', 20, 5), errorType: 'DiagnosticError',
  });
  withheld(result);
});

test('D1 AI: model-provided verification claims cannot verify a code window', async () => {
  const ai = load('../src/services/aiExplanationService.js', {
    env: { AI_API_KEY: 'test-only', AI_PROVIDER: 'openai' },
    globals: { fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      summary: 'Proposed repair', rootCause: 'Incompatible annotation', status: 'fixed',
      originalCode: 'const subtotal: number = "125";', correctedCode: 'const subtotal: string = "125";',
      verificationStatus: 'VERIFIED', validation: { checkStatus: 'VERIFIED', scope: 'full_file' },
    }) } }] }) }) },
  });
  const result = await ai.explainExtensionDiagnostic({
    file: { path: 'ledger.ts', language: 'typescript' }, language: 'typescript',
    codeContext: 'const subtotal: number = "125";', codeContextStartLine: 40, codeContextEndLine: 40,
    diagnostic: diag('2322', 40, 7), errorType: 'TypeError',
  });
  assert.equal(result.validation.checkStatus, 'SYNTAX_CHECKED');
  assert.equal(result.validation.scope, 'code_window');
  assert.notEqual(result.verificationStatus, 'VERIFIED');
});

const classify = load('../src/services/errorClassifier.js').classifyResult;
for (const [name, input, expected] of [
  ['empty response', {}, 'PROVIDER_ERROR'],
  ['unknown provider status', { statusId: 999, status: 'Mystery' }, 'PROVIDER_ERROR'],
  ['provider internal error', { statusId: 13, status: 'Internal Error' }, 'PROVIDER_ERROR'],
  ['queued', { statusId: 1, status: 'In Queue' }, 'PENDING'],
  ['processing', { statusId: 2, status: 'Processing' }, 'PENDING'],
]) {
  test('D5: ' + name + ' is an infrastructure outcome', () => {
    const result = classify(input);
    assert.equal(result.status, expected);
    assert.equal(result.isInfrastructureFailure, true);
  });
}

test('D5 control: explicit terminal acceptance still succeeds', () => {
  assert.equal(classify({ statusId: 3, status: 'Accepted', stdout: 'ready' }).status, 'success');
});
test('D5 control: CPU limit and Python failures remain user-code errors', () => {
  assert.equal(classify({ statusId: 5, status: 'Time Limit Exceeded' }).status, 'error');
  assert.equal(classify({ statusId: 11, stderr: 'NameError: missing_reference' }).status, 'error');
});

test('D5: polling exhaustion becomes TIMEOUT, not a user-code failure', async () => {
  let calls = 0;
  const service = load('../src/services/codeExecutionService.js', {
    globals: { fetch: async () => { calls++; return { ok: true, json: async () => ({ token: 'local-test', status: { id: 2, description: 'Processing' } }) }; } },
  });
  const result = classify(await service.executeCode({ code: 'print(42)', language: 'python' }));
  assert.equal(calls, 11);
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.isInfrastructureFailure, true);
});

test('D5: malformed Judge0 JSON body becomes PROVIDER_ERROR', async () => {
  const service = load('../src/services/codeExecutionService.js', {
    globals: { fetch: async () => ({ ok: true, json: async () => ({}) }) },
  });
  assert.equal(classify(await service.executeCode({ code: 'print(42)', language: 'python' })).status, 'PROVIDER_ERROR');
});

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

for (const status of ['PROVIDER_ERROR', 'PENDING', 'TIMEOUT']) {
  test(`D5: ${status} is saved explicitly to history without progress or learning updates`, async () => {
    const saved = []; let progress = 0; let explanations = 0;
    const tx = {
      submission: { create: async ({ data }) => ({ id: 17, ...data }) },
      submissionResult: { create: async ({ data }) => { saved.push(data); return { id: 23, ...data }; } },
      userProgress: { upsert: async () => { progress++; } },
      debuggingExplanation: { create: async () => { throw new Error('Infrastructure explanation must not be persisted'); } },
    };
    const prisma = {
      language: { findFirst: async () => ({ id: 2 }) }, user: { findUnique: async () => ({ id: 1 }) },
      $transaction: async callback => callback(tx),
    };
    const controller = load('../src/controllers/submissionController.js', { mocks: {
      '../prisma': prisma,
      '../services/codeExecutionService': { executeCode: async () => ({ status }) },
      '../services/errorClassifier': { classifyResult: () => ({ status, isInfrastructureFailure: true, errorType: status, errorMessage: 'Execution provider unavailable', executionTime: 0 }) },
      '../services/aiExplanationService': { generateExplanation: async () => { explanations++; return null; } },
    } });
    const res = response(); let caught;
    await controller.createSubmission({ body: { code: 'print(42)', language: 'python' } }, res, err => { caught = err; });
    assert.equal(caught, undefined);
    assert.equal(saved.length, 1, 'Keep infrastructure attempts in history');
    assert.equal(saved[0].status, status);
    assert.equal(progress, 0, 'Do not change any learning counters');
    assert.equal(explanations, 0, 'Do not explain infrastructure failures as code mistakes');
    assert.equal(res.body.result.isInfrastructureFailure, true);
  });
}

test('D3 controller: forwards 1-based window endpoints and optional full file content', async () => {
  let received;
  const controller = load('../src/controllers/extensionController.js', { mocks: {
    '../prisma': { user: { findUnique: async () => ({ id: 1 }) }, extensionDebugSession: { create: async () => ({ id: 9 }) } },
    '../services/aiExplanationService': { explainExtensionDiagnostic: async args => { received = args; return { status: 'NEEDS_CONTEXT', summary: 'More context needed', analysisSource: 'rules' }; } },
  } });
  const res = response(); let caught;
  await controller.analyzeDiagnostic({ body: {
    mode: 'analyze_error', file: { path: 'ledger.ts', language: 'typescript' }, diagnostic: diag('2322', 8),
    codeContext: 'line8();\nline9();', codeContextStartLine: 8, codeContextEndLine: 9,
    fullFileContent: 'full file provided explicitly',
  } }, res, error => { caught = error; });
  assert.equal(caught, undefined);
  assert.equal(received.codeContextStartLine, 8);
  assert.equal(received.codeContextEndLine, 9);
  assert.equal(received.fullFileContent, 'full file provided explicitly');
});
