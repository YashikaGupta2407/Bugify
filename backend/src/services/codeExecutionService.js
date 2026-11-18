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

/**
 * Executes source code via the external Judge0 service.
 * 
 * @param {Object} params
 * @param {string} params.code - Source code to execute
 * @param {string} params.language - Programming language (e.g. 'python')
 * @param {string} [params.stdin=''] - Optional standard input
 * @returns {Promise<Object>} Normalized execution response
 */
async function executeCode({ code, language, stdin = '' }) {
  const normalizedLang = (language || '').trim().toLowerCase();
  const languageId = LANGUAGE_MAP[normalizedLang];

  if (!languageId) {
    throw new Error(`Unsupported execution language: '${language}'. Supported languages: ${Object.keys(LANGUAGE_MAP).join(', ')}`);
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
    if (!data || typeof data !== 'object' || !Number.isInteger(data.status?.id) || data.status.id < 1 || data.status.id > 14) {
      throw new Error('Execution provider returned a malformed or unknown response.');
    }
    for (const key of ['stdout', 'stderr', 'compile_output', 'message']) {
      if (data[key] != null && typeof data[key] !== 'string') throw new Error('Execution provider returned an invalid output field.');
    }
    for (const key of ['time', 'memory']) {
      if (data[key] != null && !Number.isFinite(Number(data[key]))) throw new Error('Execution provider returned an invalid numeric field.');
    }
  }

  try {
    const submitUrl = `${baseUrl}/submissions?wait=true`;
    const response = await fetch(submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Judge0 API request failed with status ${response.status}`);
    }

    let data = await response.json();
    validateResponse(data);

    // If status is in queue (id 1) or processing (id 2), poll until completed
    if (data.token && (data.status?.id === 1 || data.status?.id === 2)) {
      const token = data.token;
      const maxPollAttempts = 10;
      const pollIntervalMs = 800;

      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const pollResponse = await fetch(`${baseUrl}/submissions/${token}`, {
          headers,
        });

        if (!pollResponse.ok) throw new Error(`Judge0 polling request failed with status ${pollResponse.status}`);
        if (pollResponse.ok) {
          data = await pollResponse.json();
          validateResponse(data);
          if (data.status?.id !== 1 && data.status?.id !== 2) {
            break;
          }
        }
      }
    }

    if (data.status.id === 1 || data.status.id === 2) {
      return { status: 'TIMEOUT', statusId: data.status.id, isInfrastructureFailure: true,
        message: 'Execution polling budget exhausted while the provider was still processing.',
        stdout: null, stderr: null, compileOutput: null, executionTime: 0, memory: null };
    }

    // Normalize into standard Bugify execution format
    return {
      status: data.status?.description || 'Unknown',
      statusId: data.status?.id || null,
      stdout: data.stdout || null,
      stderr: data.stderr || null,
      compileOutput: data.compile_output || null,
      message: data.message || null,
      executionTime: data.time ? parseFloat(data.time) : 0,
      memory: data.memory ? parseFloat(data.memory) : null,
    };
  } catch (error) {
    return { status: 'PROVIDER_ERROR', isInfrastructureFailure: true, message: error.message,
      stdout: null, stderr: null, compileOutput: null, executionTime: 0, memory: null };
  }
}

module.exports = {
  executeCode,
  LANGUAGE_MAP,
};
