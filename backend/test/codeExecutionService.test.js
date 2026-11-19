const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createCodeExecutionService } = require('../src/services/codeExecutionService');
const { classifyResult } = require('../src/services/errorClassifier');

function judgeResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function service(options) {
  return createCodeExecutionService({ judge0Enabled: true, ...options });
}

const executeParams = { code: 'print(1)', language: 'python' };
const zeroDivisionFallback = async () => ({
  status: 'error',
  errorType: 'ZeroDivisionError',
  errorMessage: 'division by zero',
  output: null,
  executionTime: 0,
});

describe('Judge0 provider handling', () => {
  test('accepts a valid Judge0 Accepted result with status ID 3', async () => {
    const executeCode = service({
      fetchImplementation: async () => judgeResponse({ status: { id: 3, description: 'Accepted' }, stdout: '1\n' }),
    });
    const raw = await executeCode(executeParams);
    assert.equal(raw.statusId, 3);
    assert.equal(raw.executionSource, 'judge0');
    assert.equal(classifyResult(raw).status, 'success');
  });

  test('falls back after a Judge0 network failure and normalizes a recognized zero-division error', async () => {
    const previousUrl = process.env.JUDGE0_API_URL;
    process.env.JUDGE0_API_URL = 'http://invalid.local';
    let requestCount = 0;
    let fallbackParams;
    try {
      const executeCode = service({
        fetchImplementation: async () => {
          requestCount += 1;
          throw new Error('network unavailable');
        },
        fallbackImplementation: async (params) => {
          fallbackParams = params;
          return zeroDivisionFallback();
        },
      });
      const raw = await executeCode({ code: 'print(10/0)', language: 'python' });
      assert.equal(requestCount, 1);
      assert.deepEqual(fallbackParams, { code: 'print(10/0)', language: 'python', stdin: '' });
      assert.equal(raw.executionSource, 'local_fallback');
      assert.equal(raw.errorType, 'ZERO_DIVISION_ERROR');
      assert.equal(classifyResult(raw).errorType, 'ZERO_DIVISION_ERROR');
      assert.equal(classifyResult(raw).status, 'error');
    } finally {
      if (previousUrl === undefined) delete process.env.JUDGE0_API_URL;
      else process.env.JUDGE0_API_URL = previousUrl;
    }
  });

  test('falls back after Judge0 HTTP 429 rate limiting', async () => {
    let fallbackCalls = 0;
    const executeCode = service({
      fetchImplementation: async () => judgeResponse({}, { ok: false, status: 429 }),
      fallbackImplementation: async () => { fallbackCalls += 1; return zeroDivisionFallback(); },
    });
    const raw = await executeCode({ code: 'print(10/0)', language: 'python' });
    assert.equal(fallbackCalls, 1);
    assert.equal(raw.executionSource, 'local_fallback');
    assert.equal(classifyResult(raw).errorType, 'ZERO_DIVISION_ERROR');
  });

  test('invokes the local fallback exactly once after Judge0 HTTP 5xx responses', async () => {
    for (const status of [500, 503]) {
      let fallbackCalls = 0;
      const executeCode = service({
        fetchImplementation: async () => judgeResponse({}, { ok: false, status }),
        fallbackImplementation: async () => { fallbackCalls += 1; return zeroDivisionFallback(); },
      });
      const raw = await executeCode({ code: 'print(10/0)', language: 'python' });
      assert.equal(fallbackCalls, 1, `HTTP ${status} should invoke fallback exactly once`);
      assert.equal(raw.executionSource, 'local_fallback');
      assert.equal(classifyResult(raw).errorType, 'ZERO_DIVISION_ERROR');
    }
  });

  test('normalizes a recognized NameError from the local fallback', async () => {
    const executeCode = service({
      fetchImplementation: async () => { throw new Error('network unavailable'); },
      fallbackImplementation: async () => ({
        status: 'error',
        errorType: 'NameError',
        errorMessage: "name 'missing_name' is not defined",
        output: null,
        executionTime: 0,
      }),
    });
    const raw = await executeCode({ code: 'print(missing_name)', language: 'python' });
    const classified = classifyResult(raw);
    assert.equal(raw.executionSource, 'local_fallback');
    assert.equal(classified.status, 'error');
    assert.equal(classified.errorType, 'NAME_ERROR');
  });

  test('normalizes a recognized SyntaxError from the local fallback', async () => {
    const executeCode = service({
      fetchImplementation: async () => { throw new Error('network unavailable'); },
      fallbackImplementation: async () => ({
        status: 'error',
        errorType: 'SyntaxError',
        errorMessage: 'unmatched parentheses',
        output: null,
        executionTime: 0,
      }),
    });
    const raw = await executeCode({ code: 'print(', language: 'python' });
    const classified = classifyResult(raw);
    assert.equal(raw.executionSource, 'local_fallback');
    assert.equal(classified.status, 'error');
    assert.equal(classified.errorType, 'SYNTAX_ERROR');
  });

  test('uses the local fallback when JUDGE0_ENABLED is explicitly false', async () => {
    const previousEnabled = process.env.JUDGE0_ENABLED;
    process.env.JUDGE0_ENABLED = 'false';
    let providerCalls = 0;
    try {
      const executeCode = service({
        judge0Enabled: undefined,
        fetchImplementation: async () => { providerCalls += 1; return judgeResponse({}); },
        fallbackImplementation: zeroDivisionFallback,
      });
      const raw = await executeCode({ code: 'print(10/0)', language: 'python' });
      assert.equal(providerCalls, 0);
      assert.equal(raw.executionSource, 'local_fallback');
      assert.equal(classifyResult(raw).errorType, 'ZERO_DIVISION_ERROR');
    } finally {
      if (previousEnabled === undefined) delete process.env.JUDGE0_ENABLED;
      else process.env.JUDGE0_ENABLED = previousEnabled;
    }
  });

  test('does not treat the local heuristic generic mock success as a successful execution', async () => {
    const executeCode = service({
      fetchImplementation: async () => { throw new Error('network unavailable'); },
      fallbackImplementation: async () => ({
        status: 'success',
        errorType: null,
        errorMessage: null,
        output: 'Mock execution: no errors detected',
        executionTime: 0,
      }),
    });
    const raw = await executeCode({ code: 'print(1)', language: 'python' });
    const classified = classifyResult(raw);
    assert.equal(raw.executionSource, 'local_fallback');
    assert.equal(raw.isInfrastructureFailure, true);
    assert.equal(classified.isInfrastructureFailure, true);
    assert.notEqual(classified.status, 'success');
  });

  test('turns missing and inconsistent status descriptions into infrastructure outcomes', async () => {
    const malformedResponses = [
      { status: { id: 3 } },
      { status: { description: 'Accepted' } },
      { status: { id: 3, description: 'Internal Error' } },
      { status: { id: 5, description: 'Accepted' } },
      { status: { id: 13, description: 'Runtime Error' } },
    ];

    for (const data of malformedResponses) {
      const executeCode = service({ fetchImplementation: async () => judgeResponse(data) });
      const raw = await executeCode(executeParams);
      assert.equal(raw.isInfrastructureFailure, true);
      assert.equal(classifyResult(raw).isInfrastructureFailure, true);
    }
  });

  test('treats Judge0 status ID 13 as an infrastructure failure', async () => {
    const executeCode = service({
      fetchImplementation: async () => judgeResponse({ status: { id: 13, description: 'Internal Error' } }),
    });
    const raw = await executeCode(executeParams);
    assert.equal(raw.isInfrastructureFailure, true);
    assert.equal(classifyResult(raw).isInfrastructureFailure, true);
  });

  test('maps HTTP 429, 500, and 503 responses to infrastructure failures', async () => {
    for (const status of [429, 500, 503]) {
      const executeCode = service({
        fetchImplementation: async () => judgeResponse({}, { ok: false, status }),
      });
      const raw = await executeCode(executeParams);
      assert.equal(raw.isInfrastructureFailure, true);
      assert.equal(classifyResult(raw).isInfrastructureFailure, true);
    }
  });

  test('maps network and request-timeout errors to infrastructure failures', async () => {
    const networkFailure = service({
      fetchImplementation: async () => { throw new Error('network unavailable'); },
    });
    const networkResult = await networkFailure(executeParams);
    assert.equal(classifyResult(networkResult).isInfrastructureFailure, true);

    let timeoutFallbackCalls = 0;
    const timedOut = service({
      requestTimeoutMs: 1,
      fetchImplementation: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
      }),
      fallbackImplementation: async () => { timeoutFallbackCalls += 1; return zeroDivisionFallback(); },
    });
    const timeoutResult = await timedOut(executeParams);
    assert.equal(timeoutFallbackCalls, 1);
    assert.equal(timeoutResult.executionSource, 'local_fallback');
    assert.equal(classifyResult(timeoutResult).errorType, 'ZERO_DIVISION_ERROR');

    const stalledBody = service({
      requestTimeoutMs: 1,
      fetchImplementation: async (_url, { signal }) => ({
        ok: true,
        json: () => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('response body timed out')), { once: true });
        }),
      }),
    });
    const bodyTimeoutResult = await stalledBody(executeParams);
    assert.equal(classifyResult(bodyTimeoutResult).isInfrastructureFailure, true);
  });

  test('maps exhausted polling and poll HTTP failures to infrastructure failures', async () => {
    let requestCount = 0;
    const pending = service({
      maxPollAttempts: 2,
      pollIntervalMs: 0,
      fetchImplementation: async () => {
        requestCount += 1;
        return judgeResponse({
          token: 'provider-token',
          status: { id: requestCount === 1 ? 1 : 2, description: requestCount === 1 ? 'In Queue' : 'Processing' },
        });
      },
    });
    const pendingResult = await pending(executeParams);
    assert.equal(classifyResult(pendingResult).isInfrastructureFailure, true);

    let pollCount = 0;
    const pollFailure = service({
      pollIntervalMs: 0,
      fetchImplementation: async () => {
        pollCount += 1;
        return pollCount === 1
          ? judgeResponse({ token: 'provider-token', status: { id: 1, description: 'In Queue' } })
          : judgeResponse({}, { ok: false, status: 500 });
      },
    });
    const failedPollResult = await pollFailure(executeParams);
    assert.equal(classifyResult(failedPollResult).isInfrastructureFailure, true);
  });

  test('preserves Judge0 status ID 5 as a user-code time-limit failure', async () => {
    const executeCode = service({
      fetchImplementation: async () => judgeResponse({
        status: { id: 5, description: 'Time Limit Exceeded' }, time: '5.0',
      }),
    });
    const raw = await executeCode(executeParams);
    const classified = classifyResult(raw);
    assert.equal(classified.isInfrastructureFailure, undefined);
    assert.equal(classified.errorType, 'TIME_LIMIT');
  });
});
