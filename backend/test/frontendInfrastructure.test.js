'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual App.jsx handlers and render branches using a minimal hook
// harness. All fetches/timers are local stubs. No app changes or live server.
const filename = path.resolve(__dirname, '../../website/src/App.jsx');
const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: 'App.jsx', compilerOptions: {
    allowJs: true, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  },
}).outputText;

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (!tree || typeof tree === 'boolean') return '';
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}

function harness(status) {
  const values = []; const effects = []; let index = 0; let mounting = true;
  const result = { status, isInfrastructureFailure: status !== 'error', errorMessage: 'Execution service outcome', errorType: status };
  const item = { id: 7, status, isInfrastructureFailure: result.isInfrastructureFailure, errorType: status, language: 'python', createdAt: '2026-11-18T00:00:00Z' };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const slot = index++;
      if (!(slot in values)) values[slot] = initial;
      return [values[slot], next => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }];
    },
    useEffect(callback) { if (mounting) effects.push(callback); },
  };
  const module = { exports: {} };
  const context = {
    console, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options = {}) => ({ ok: true, json: async () => {
      if (options.method === 'POST') return { success: true, result, explanation: null };
      if (url === '/api/submissions/7') return { success: true, submission: { code: 'print(42)', language: 'python' }, result, explanation: null };
      if (url === '/api/submissions') return [item];
      throw new Error('Unexpected request: ' + url);
    } }),
  };
  vm.runInNewContext('(function(require,module,exports){' + javascript + '\n})', context, { filename })(
    id => { if (id === 'react') return react; if (id === './styles/App.css') return {}; throw new Error('Unexpected import: ' + id); },
    module, module.exports,
  );
  const render = () => { index = 0; const tree = module.exports.default(); mounting = false; return tree; };
  render();
  return { render, mount: async () => { effects.forEach(fn => fn()); await new Promise(setImmediate); } };
}

for (const status of ['PROVIDER_ERROR', 'PENDING', 'TIMEOUT']) {
  test(`D5 frontend: submitting ${status} does not render a user-code error`, async () => {
    const app = harness(status);
    const form = nodes(app.render()).find(node => node.type === 'form');
    await form.props.onSubmit({ preventDefault() {} });
    const tree = app.render();
    assert.equal(nodes(tree).some(node => node.props.id === 'error-card'), false);
    assert.match(text(tree), /provider|pending|timeout|timed out|execution service/i);
  });

  test(`D5 frontend: ${status} history is clearly marked without the user-error badge`, async () => {
    const app = harness(status);
    await app.mount();
    nodes(app.render()).find(node => node.props.title === 'Toggle Debugging History').props.onClick();
    const item = nodes(app.render()).find(node => node.props.className?.startsWith('history-item '));
    assert.ok(item, 'History attempt should remain visible');
    assert.doesNotMatch(text(item), /🔴/);
    assert.match(text(item), /provider|pending|timeout|timed out|execution service/i);
    await item.props.onClick();
    assert.equal(nodes(app.render()).some(node => node.props.id === 'error-card'), false);
  });
}

test('D5 frontend control: actual user-code errors retain their error view', async () => {
  const app = harness('error');
  const form = nodes(app.render()).find(node => node.type === 'form');
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(nodes(app.render()).some(node => node.props.id === 'error-card'), true);
});
