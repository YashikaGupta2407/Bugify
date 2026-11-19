const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createCodeExecutionService } = require('../src/services/codeExecutionService');
const { classifyResult } = require('../src/services/errorClassifier');

function judgeResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function service(options) {
  return createCodeExecutionService(options);
}

const executeParams = { code: 'print(1)', language: 'python' };

describe('Judge0 provider handling', () => {
  test('accepts a valid Judge0 Accepted result with status ID 3', async () => {
    const executeCode = service({
      fetchImplementation: async () => judgeResponse({ status: { id: 3, description: 'Accepted' }, stdout: '1\n' }),
    });
    const raw = await executeCode(executeParams);
    assert.equal(raw.statusId, 3);
    assert.equal(classifyResult(raw).status, 'success');
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

    const timedOut = service({
      requestTimeoutMs: 1,
      fetchImplementation: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
      }),
    });
    const timeoutResult = await timedOut(executeParams);
    assert.equal(classifyResult(timeoutResult).isInfrastructureFailure, true);

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
