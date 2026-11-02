const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { planPatches } = require('../out/diagnostics/patchPlanner');

const apply = (text, patches) => {
  const sorted = [...patches].sort((a, b) => b.startOffset - a.startOffset);
  let result = text;
  for (const patch of sorted) {
    result = result.slice(0, patch.startOffset) + patch.after + result.slice(patch.endOffset);
  }
  return result;
};

describe('Patch planner', () => {
  test('builds an exact replacement for the declared line', () => {
    const text = 'const a = 1;\nlet port: number = "8080";\nconsole.log(port);\n';
    const plan = planPatches({
      text,
      changes: [{ line: 2, before: 'let port: number = "8080";', after: 'let port = "8080";', reason: '' }],
    });

    assert.strictEqual(plan.ok, true);
    assert.strictEqual(
      apply(text, plan.patches),
      'const a = 1;\nlet port = "8080";\nconsole.log(port);\n'
    );
  });

  test('applies every change, not just the first one', () => {
    const text = 'const a = wrongA;\nconst b = wrongB;\n';
    const plan = planPatches({
      text,
      changes: [
        { line: 1, before: 'wrongA', after: 'rightA', reason: '' },
        { line: 2, before: 'wrongB', after: 'rightB', reason: '' },
      ],
    });

    assert.strictEqual(plan.ok, true);
    assert.strictEqual(apply(text, plan.patches), 'const a = rightA;\nconst b = rightB;\n');
  });

  test('disambiguates repeated text using the declared line', () => {
    const text = 'return value;\nreturn value;\n';
    const plan = planPatches({
      text,
      changes: [{ line: 2, before: 'return value;', after: 'return other;', reason: '' }],
    });

    assert.strictEqual(plan.ok, true);
    assert.strictEqual(apply(text, plan.patches), 'return value;\nreturn other;\n');
  });

  test('rejects text that is missing from the file', () => {
    const plan = planPatches({
      text: 'const a = 1;\n',
      changes: [{ line: 1, before: 'const b = 2;', after: 'const b = 3;', reason: '' }],
    });

    assert.strictEqual(plan.ok, false);
    assert.match(plan.reason, /not found/);
  });

  test('rejects ambiguous text when no line is given', () => {
    const plan = planPatches({
      text: 'return value;\nreturn value;\n',
      changes: [{ line: 0, before: 'return value;', after: 'return other;', reason: '' }],
    });

    assert.strictEqual(plan.ok, false);
    assert.match(plan.reason, /more than once/);
  });

  test('rejects overlapping changes', () => {
    const plan = planPatches({
      text: 'const value = 1;\n',
      changes: [
        { line: 1, before: 'const value', after: 'let value', reason: '' },
        { line: 1, before: 'value = 1', after: 'value = 2', reason: '' },
      ],
    });

    assert.strictEqual(plan.ok, false);
    assert.match(plan.reason, /overlap/);
  });

  test('rejects a no-op change', () => {
    const plan = planPatches({
      text: 'const value = 1;\n',
      changes: [{ line: 1, before: 'const value = 1;', after: 'const value = 1;', reason: '' }],
    });

    assert.strictEqual(plan.ok, false);
    assert.match(plan.reason, /does not modify/);
  });

  test('supports multi-line replacements', () => {
    const text = 'function f() {\n  stepOne();\n  stepTwo();\n}\n';
    const plan = planPatches({
      text,
      changes: [
        {
          line: 2,
          before: '  stepOne();\n  stepTwo();',
          after: '  stepOne();\n  stepTwo();\n  stepThree();',
          reason: '',
        },
      ],
    });

    assert.strictEqual(plan.ok, true);
    assert.match(apply(text, plan.patches), /stepThree\(\);/);
  });

  test('falls back to originalCode/correctedCode when no changes are supplied', () => {
    const text = 'let count: number = "10";\n';
    const plan = planPatches({
      text,
      targetLine: 1,
      originalCode: 'let count: number = "10";',
      correctedCode: 'let count = 10;',
    });

    assert.strictEqual(plan.ok, true);
    assert.strictEqual(apply(text, plan.patches), 'let count = 10;\n');
  });

  test('rejects an empty plan', () => {
    const plan = planPatches({ text: 'const a = 1;\n' });
    assert.strictEqual(plan.ok, false);
  });
});
