// backend/test/extension.test.js
// Node.js built-in test runner for backend extension endpoints and secret redaction.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets } = require('../src/services/redactService');

describe('Secret Redaction Service', () => {
  test('redacts OpenAI, Google, AWS keys, and Bearer tokens', () => {
    const input = `
      const openai = "sk-abcdef1234567890abcdef1234567890";
      const gemini = "AIzaSyD-1234567890abcdefghijklmnopqr";
      const aws = "AKIAIOSFODNN7EXAMPLE";
      const auth = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
      const dbPass = "password = \\"superSecretPassword123\\"";
    `;

    const redacted = redactSecrets(input);

    assert.ok(!redacted.includes('sk-abcdef1234567890abcdef1234567890'), 'OpenAI key not redacted');
    assert.ok(redacted.includes('[REDACTED API KEY]'), 'OpenAI replacement missing');

    assert.ok(!redacted.includes('AIzaSyD-1234567890abcdefghijklmnopqr'), 'Gemini key not redacted');
    assert.ok(redacted.includes('[REDACTED GOOGLE KEY]'), 'Google replacement missing');

    assert.ok(!redacted.includes('AKIAIOSFODNN7EXAMPLE'), 'AWS key not redacted');
    assert.ok(redacted.includes('[REDACTED AWS KEY]'), 'AWS replacement missing');

    assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Bearer token not redacted');
    assert.ok(redacted.includes('Bearer [REDACTED TOKEN]'), 'Bearer replacement missing');

    assert.ok(!redacted.includes('superSecretPassword123'), 'Password not redacted');
    assert.ok(redacted.includes('[REDACTED]'), 'Password replacement missing');
  });

  test('redacts private key blocks', () => {
    const input = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----
`;
    const redacted = redactSecrets(input);
    assert.ok(!redacted.includes('abcdefghijklmnopqrstuvwxyz'), 'Private key body not redacted');
    assert.ok(redacted.includes('[REDACTED PRIVATE KEY]'), 'Private key replacement missing');
  });
});

describe('Extension API Endpoints', () => {
  const BASE_URL = 'http://127.0.0.1:5000';

  test('POST /api/extension/analyze returns 400 for invalid mode', async () => {
    const res = await fetch(`${BASE_URL}/api/extension/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'invalid_mode' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Mode must be either'));
  });

  test('POST /api/extension/analyze returns 400 for missing file', async () => {
    const res = await fetch(`${BASE_URL}/api/extension/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'analyze_code' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("File object with a valid 'path' is required"));
  });

  test('POST /api/extension/analyze succeeds and returns rules analysis', async () => {
    const res = await fetch(`${BASE_URL}/api/extension/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'analyze_error',
        detail: 'normal',
        workspace: { name: 'test-suite' },
        file: { path: 'test.js', language: 'javascript' },
        cursor: { line: 10, column: 5 },
        codeContext: 'const a = undefined;\nconsole.log(a.name);',
        diagnostics: [
          {
            severity: 'error',
            message: "Object is possibly 'undefined'.",
            source: 'ts',
            code: '2532',
            startLine: 10,
            startColumn: 1,
            endLine: 10,
            endColumn: 10,
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.sessionId === 'number', 'Missing sessionId');
    assert.equal(data.errorType, 'TypeError');
    assert.ok(data.summary.includes("possibly 'undefined'"));
    assert.equal(data.location.file, 'test.js');
    assert.ok(data.rootCause, 'Missing rootCause');
    assert.ok(data.validation, 'Missing validation');
    assert.ok(data.analysisSource === 'rules' || data.analysisSource === 'ai');
  });

  test('GET /api/extension/sessions and GET /api/extension/stats succeed', async () => {
    const sessRes = await fetch(`${BASE_URL}/api/extension/sessions`);
    assert.equal(sessRes.status, 200);
    const sessions = await sessRes.json();
    assert.ok(Array.isArray(sessions));

    const statsRes = await fetch(`${BASE_URL}/api/extension/stats`);
    assert.equal(statsRes.status, 200);
    const stats = await statsRes.json();
    assert.ok(typeof stats.total === 'number');
    assert.ok(typeof stats.byErrorType === 'object');
  });
});
