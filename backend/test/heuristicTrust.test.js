'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateHeuristicExplanation } = require('../src/services/aiExplanationService');

for (const [errorType, code, errorMessage] of [
  ['ZERO_DIVISION_ERROR', 'print(42 / 0)', 'division by zero'],
  ['INDEX_ERROR', 'entries = [1, 2, 3]\nprint(entries[10])', 'list index out of range'],
  ['NAME_ERROR', 'print(record_id)', "name 'record_id' is not defined"],
  ['TYPE_ERROR', 'print("20" + 7)', 'incompatible operands'],
  ['SYNTAX_ERROR', 'if True\n    print(42)', 'expected colon'],
  ['TIME_LIMIT', 'while True: pass', 'time limit exceeded'],
]) {
  test(`D2 website fallback: ${errorType} explains without inventing or silently changing intent`, () => {
    const result = generateHeuristicExplanation({ code, errorType, errorMessage });
    assert.equal(result.correctedCode, null);
    assert.equal(result.status, 'NEEDS_CONTEXT');
    assert.ok(result.explanation);
  });
}
