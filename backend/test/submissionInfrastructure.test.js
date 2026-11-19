const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyResult, isConsistentJudge0Status } = require('../src/services/errorClassifier');
const { createSubmissionHandler } = require('../src/controllers/submissionController');

function makeResponse() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeDatabase() {
  const calls = { transactions: 0, progress: [] };
  const tx = {
    submission: { create: async () => ({ id: 101 }) },
    submissionResult: { create: async ({ data }) => ({ id: 201, ...data }) },
    debuggingExplanation: { create: async ({ data }) => data },
    userProgress: { upsert: async ({ create, update }) => { calls.progress.push({ create, update }); } },
  };
  const database = {
    language: { findFirst: async () => ({ id: 7, name: 'python' }) },
    $transaction: async (work) => { calls.transactions += 1; return work(tx); },
  };
  return { database, calls };
}

async function submitWith(rawExecution) {
  const { database, calls } = makeDatabase();
  let explanationCalls = 0;
  const response = makeResponse();
  await createSubmissionHandler(
    { body: { code: 'print(1)', language: 'python' }, user: { id: 9 } },
    response,
    (error) => { throw error; },
    { database, runExecution: async () => rawExecution, explain: async () => { explanationCalls += 1; return null; } },
  );
  return { response, calls, explanationCalls };
}

describe('submission infrastructure failures', () => {
  test('requires a matching Judge0 status ID and description', () => {
    assert.equal(isConsistentJudge0Status(3, 'Accepted'), true);
    assert.equal(isConsistentJudge0Status(5, 'Time Limit Exceeded'), true);
    assert.equal(isConsistentJudge0Status(13, 'Internal Error'), true);
    assert.equal(isConsistentJudge0Status(3, undefined), false);
    assert.equal(isConsistentJudge0Status(5, 'Accepted'), false);
    assert.equal(isConsistentJudge0Status(13, 'Runtime Error'), false);

    for (const result of [
      { statusId: 3, stdout: '1' },
      { status: 'Accepted', statusId: 5 },
      { status: 'Runtime Error', statusId: 13 },
    ]) {
      assert.equal(classifyResult(result).isInfrastructureFailure, true);
    }
  });

  test('classifies Judge0 status ID 13 as infrastructure failure', () => {
    const result = classifyResult({ status: 'Internal Error', statusId: 13, message: 'Internal Error' });
    assert.equal(result.isInfrastructureFailure, true);
    assert.equal(result.status, 'PROVIDER_ERROR');
  });

  test('does not generate AI, persist results, or increment either progress counter for infrastructure failures', async () => {
    const outcomes = [
      { status: 'PROVIDER_ERROR', isInfrastructureFailure: true, message: 'provider unavailable' },
      { status: 'Internal Error', statusId: 13, message: 'provider internal error' },
      { status: 'Processing', statusId: 2 },
      {
        status: 'success',
        executionSource: 'local_fallback',
        output: 'Mock execution: no errors detected',
        executionTime: 0,
      },
    ];

    for (const rawExecution of outcomes) {
      const { response, calls, explanationCalls } = await submitWith(rawExecution);
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.body, { success: false, message: 'Unable to execute code' });
      assert.equal(explanationCalls, 0);
      assert.equal(calls.transactions, 0);
      assert.deepEqual(calls.progress, []);
    }
  });

  test('preserves accepted-success and status ID 5 user-code progress behavior', async () => {
    const success = await submitWith({
      status: 'Accepted', statusId: 3, stdout: '1\n', executionTime: 0.01, executionSource: 'judge0',
    });
    assert.equal(success.response.statusCode, 200);
    assert.equal(success.response.body.result.executionSource, 'judge0');
    assert.equal(success.calls.progress[0].update.successfulSubmissions.increment, 1);

    const timeLimit = await submitWith({
      status: 'Time Limit Exceeded', statusId: 5, stderr: '', message: 'Time limit exceeded', executionTime: 5,
    });
    assert.equal(timeLimit.response.statusCode, 200);
    assert.equal(timeLimit.calls.progress[0].update.failedSubmissions.increment, 1);
    assert.equal(timeLimit.calls.progress[0].update.successfulSubmissions, undefined);
    assert.equal(classifyResult({
      status: 'Time Limit Exceeded', statusId: 5, executionTime: 5,
    }).errorType, 'TIME_LIMIT');

    const fallbackError = await submitWith({
      status: 'error',
      errorType: 'ZERO_DIVISION_ERROR',
      errorMessage: 'division by zero',
      output: '',
      executionTime: 0,
      executionSource: 'local_fallback',
    });
    assert.equal(fallbackError.response.statusCode, 200);
    assert.equal(fallbackError.response.body.result.errorType, 'ZERO_DIVISION_ERROR');
    assert.equal(fallbackError.response.body.result.executionSource, 'local_fallback');
    assert.equal(fallbackError.calls.progress[0].update.failedSubmissions.increment, 1);
    assert.equal(fallbackError.calls.progress[0].update.successfulSubmissions, undefined);
  });
});
