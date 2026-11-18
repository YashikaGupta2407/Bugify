'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('D4 website AI: exact unchanged submitted code is withheld as NEEDS_CONTEXT', async () => {
  const filename = path.resolve(__dirname, '../src/services/aiExplanationService.js');
  const module = { exports: {} };
  const code = 'print(missing_reference)';
  const fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
    summary: 'Explanation', cause: 'Missing binding', explanation: 'Binding not available', correctedCode: code,
  }) } }] }) });
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(filename, 'utf8') + '\n})', {
    process: { env: { AI_PROVIDER: 'openai', AI_API_KEY: 'test-only' } }, fetch, console,
  }, { filename })(createRequire(filename), module, module.exports);
  const result = await module.exports.generateExplanation({ language: 'python', code, errorType: 'NAME_ERROR', errorMessage: 'Missing binding' });
  assert.equal(result.correctedCode, null);
  assert.equal(result.status, 'NEEDS_CONTEXT');
});
