/**
 * Code Execution Service
 * 
 * Submits source code to the external Judge0 execution service.
 * Handles language mapping, request dispatch, polling if asynchronous,
 * and normalizes the external API response into a standardized Bugify format.
 */

// Supported language mappings for Judge0
// Starts with Python; architected to easily add JavaScript, C++, Java, etc. later.
const LANGUAGE_MAP = {
  python: 92, // Python (3.11.2) on Judge0 CE
};
const { isConsistentJudge0Status } = require('./errorClassifier');
const { executeCode: executeLocalFallback } = require('./executionService');

const FALLBACK_ERROR_TYPES = Object.freeze({
  ZeroDivisionError: 'ZERO_DIVISION_ERROR',
  NameError: 'NAME_ERROR',
  SyntaxError: 'SYNTAX_ERROR',
});

class ProviderUnavailableError extends Error {}

/**
 * Executes source code via the external Judge0 service.
 * 
 * @param {Object} params
 * @param {string} params.code - Source code to execute
 * @param {string} params.language - Programming language (e.g. 'python')
 * @param {string} [params.stdin=''] - Optional standard input
 * @returns {Promise<Object>} Normalized execution response
 */
function createCodeExecutionService({
  fetchImplementation = (...args) => fetch(...args),
  fallbackImplementation = executeLocalFallback,
  judge0Enabled,
  maxPollAttempts = 10,
  pollIntervalMs = 800,
  requestTimeoutMs = 15000,
} = {}) {
  return async function executeCode({ code, language, stdin = '' }) {
    const normalizedLang = (language || '').trim().toLowerCase();
    const languageId = LANGUAGE_MAP[normalizedLang];

    if (!languageId) {
      throw new Error(`Unsupported execution language: '${language}'. Supported languages: ${Object.keys(LANGUAGE_MAP).join(', ')}`);
    }

    async function useLocalFallback(message) {
      try {
        const result = await fallbackImplementation({ code, language: normalizedLang, stdin });
        const errorType = FALLBACK_ERROR_TYPES[result?.errorType];
        if (
          result?.status !== 'error' ||
          !errorType ||
          typeof result.errorMessage !== 'string' ||
          !Number.isFinite(result.executionTime)
        ) {
          return infrastructureFailure(
            'Judge0 was unavailable and the local fallback could not identify a supported error.',
            'local_fallback'
          );
        }

        return {
          status: 'error',
          errorType,
          errorMessage: result.errorMessage,
          output: typeof result.output === 'string' ? result.output : '',
          executionTime: result.executionTime,
          executionSource: 'local_fallback',
        };
      } catch {
        return infrastructureFailure(
          message || 'Judge0 was unavailable and the local fallback failed.',
          'local_fallback'
        );
      }
    }

    const providerEnabled = judge0Enabled === undefined
      ? String(process.env.JUDGE0_ENABLED || '').trim().toLowerCase() !== 'false'
      : judge0Enabled !== false;
    if (!providerEnabled) {
      return useLocalFallback('Judge0 is disabled.');
    }

    const baseUrl = (process.env.JUDGE0_API_URL || 'https://ce.judge0.com').replace(/\/+$/, '');
    const apiKey = process.env.JUDGE0_API_KEY;

    const headers = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['X-RapidAPI-Key'] = apiKey;
      try {
        const urlObj = new URL(baseUrl);
        headers['X-RapidAPI-Host'] = urlObj.host;
      } catch {
        // Ignore URL parsing errors if any
      }
    }

    // Set reasonable safety limits (5 seconds CPU execution limit)
    const payload = {
      source_code: code,
      language_id: languageId,
      stdin: stdin || '',
      cpu_time_limit: 5,
      wall_time_limit: 10,
    };

    function validateResponse(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !isConsistentJudge0Status(data.status?.id, data.status?.description)) {
        throw new Error('Execution provider returned a malformed or unknown response.');
      }
      for (const key of ['stdout', 'stderr', 'compile_output', 'message']) {
        if (data[key] != null && typeof data[key] !== 'string') {
          throw new Error('Execution provider returned an invalid output field.');
        }
      }
      for (const key of ['time', 'memory']) {
        if (data[key] != null && !Number.isFinite(Number(data[key]))) {
          throw new Error('Execution provider returned an invalid numeric field.');
        }
      }
    }

    async function fetchProvider(url, options) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        let response;
        try {
          response = await fetchImplementation(url, { ...options, signal: controller.signal });
        } catch (error) {
          throw new ProviderUnavailableError(error.message || 'Judge0 network request failed.');
        }
        const data = response.ok ? await response.json() : null;
        return { response, data };
      } catch (error) {
        if (controller.signal.aborted || error.name === 'AbortError') {
          throw new ProviderUnavailableError('Judge0 request timed out.');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    function handleHttpFailure(response, context) {
      const message = `Judge0 ${context} failed with status ${response.status}`;
      if (response.status === 429 || response.status >= 500) {
        return useLocalFallback(message);
      }
      return Promise.resolve(infrastructureFailure(message, 'judge0'));
    }

    try {
      const submitUrl = `${baseUrl}/submissions?wait=true`;
      const { response, data: submittedData } = await fetchProvider(submitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return handleHttpFailure(response, 'API request');
      }

      let data = submittedData;
      validateResponse(data);
      if (data.status.id === 13) {
        return useLocalFallback(data.message || data.status.description);
      }

      // Judge0 status 1/2 means the provider has not returned a code result yet.
      if (data.status.id === 1 || data.status.id === 2) {
        if (!data.token || typeof data.token !== 'string') {
          return infrastructureFailure('Execution provider returned an incomplete result.');
        }
        const token = data.token;

        for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
          if (pollIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          const { response: pollResponse, data: polledData } = await fetchProvider(`${baseUrl}/submissions/${token}`, { headers });
          if (!pollResponse.ok) {
            return handleHttpFailure(pollResponse, 'polling request');
          }
          data = polledData;
          validateResponse(data);
          if (data.status.id === 13) {
            return useLocalFallback(data.message || data.status.description);
          }
          if (data.status.id !== 1 && data.status.id !== 2) break;
        }

        if (data.status.id === 1 || data.status.id === 2) {
          return useLocalFallback('Execution provider did not finish processing the request.');
        }
      }

      return {
        status: data.status.description,
        statusId: data.status.id,
        stdout: data.stdout || null,
        stderr: data.stderr || null,
        compileOutput: data.compile_output || null,
        message: data.message || null,
        executionTime: data.time ? parseFloat(data.time) : 0,
        memory: data.memory ? parseFloat(data.memory) : null,
        executionSource: 'judge0',
      };
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        return useLocalFallback(error.message);
      }
      return infrastructureFailure(error.message || 'Execution provider request failed.', 'judge0');
    }
  };
}

function infrastructureFailure(message, executionSource = 'judge0') {
  return {
    status: 'PROVIDER_ERROR',
    isInfrastructureFailure: true,
    message,
    executionSource,
    stdout: null,
    stderr: null,
    compileOutput: null,
    executionTime: 0,
    memory: null,
  };
}

const executeCode = createCodeExecutionService();

module.exports = {
  executeCode,
  createCodeExecutionService,
  LANGUAGE_MAP,
};
