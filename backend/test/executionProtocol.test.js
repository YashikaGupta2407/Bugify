'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { classifyResult } = require('../src/services/errorClassifier');

function service(fetch) {
  const filename = path.resolve(__dirname, '../src/services/codeExecutionService.js');
  const module = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', {
    process: { env: {} }, URL, fetch, setTimeout: callback => callback(),
  }, { filename })(createRequire(filename), module, module.exports);
  return module.exports;
}

for (const [name, fetch] of [
  ['network failure', async () => { throw new Error('Offline'); }],
  ['upstream rejection', async () => ({ ok: false, status: 503, text: async () => 'Unavailable' })],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } })],
  ['null JSON', async () => ({ ok: true, json: async () => null })],
]) {
  test(`D5: ${name} returns a saveable PROVIDER_ERROR outcome`, async () => {
    const result = classifyResult(await service(fetch).executeCode({ code: 'print(42)', language: 'python' }));
    assert.equal(result.status, 'PROVIDER_ERROR');
    assert.equal(result.isInfrastructureFailure, true);
  });
}

test('D5: a rejected polling request is a provider error, not an execution timeout', async () => {
  let requests = 0;
  const result = classifyResult(await service(async () => ++requests === 1
    ? { ok: true, json: async () => ({ token: 'test', status: { id: 2, description: 'Processing' } }) }
    : { ok: false, status: 503, text: async () => 'Unavailable' }
  ).executeCode({ code: 'print(42)', language: 'python' }));
  assert.equal(result.status, 'PROVIDER_ERROR');
});

test('D5 control: a terminal Judge0 acceptance passes through the adapter', async () => {
  const result = classifyResult(await service(async () => ({ ok: true, json: async () => ({
    status: { id: 3, description: 'Accepted' }, stdout: '42\n', time: '0.01', memory: 1024,
  }) })).executeCode({ code: 'print(42)', language: 'python' }));
  assert.equal(result.status, 'success');
  assert.equal(result.output, '42\n');
});
