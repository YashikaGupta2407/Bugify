/**
 * Server-side Secret Redaction Service
 * 
 * Scans code snippets and text contexts for credentials, API keys, bearer tokens,
 * passwords, and private key blocks, replacing them with [REDACTED] prior to
 * AI provider transmission or persistent logging.
 */

const SENSITIVE_PATTERNS = [
  // Private key blocks
  /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----/gi,

  // Common API key patterns
  /\b(sk-[a-zA-Z0-9_\-]{20,})\b/g, // OpenAI-style
  /\b(AIza[0-9A-Za-z\-_]{30,40})\b/g, // Google API Key
  /\b(gh[pousr]_[0-9a-zA-Z]{36})\b/g, // GitHub Personal Access Token
  /\b(AKIA[0-9A-Z]{16})\b/g, // AWS Access Key ID

  // Bearer tokens
  /\bBearer\s+[a-zA-Z0-9_\-\.]{20,}\b/gi,

  // Key-value password/secret/token assignments
  /(['"]?(?:password|passwd|secret|token|api_?key|auth_?token)['"]?\s*[:=]\s*['"])([^'"\n\r]{6,})(['"])/gi,
];

/**
 * Redacts secrets from the given input string.
 * @param {string} text
 * @returns {string} Redacted text
 */
function redactSecrets(text) {
  if (typeof text !== 'string' || !text) {
    return text || '';
  }

  let sanitized = text;

  // 1. Private key blocks
  sanitized = sanitized.replace(
    /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----/gi,
    '[REDACTED PRIVATE KEY]'
  );

  // 2. Specific API key patterns
  sanitized = sanitized.replace(/\b(sk-[a-zA-Z0-9_\-]{20,})\b/g, '[REDACTED API KEY]');
  sanitized = sanitized.replace(/\b(AIza[0-9A-Za-z\-_]{25,45})\b/g, '[REDACTED GOOGLE KEY]');
  sanitized = sanitized.replace(/\b(gh[pousr]_[0-9a-zA-Z]{36})\b/g, '[REDACTED GITHUB TOKEN]');
  sanitized = sanitized.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED AWS KEY]');

  // 3. Bearer tokens
  sanitized = sanitized.replace(/\bBearer\s+[a-zA-Z0-9_\-\.]{20,}\b/gi, 'Bearer [REDACTED TOKEN]');

  // 4. Assignments
  sanitized = sanitized.replace(
    /(['"]?(?:password|passwd|secret|token|api_?key|auth_?token)['"]?\s*[:=]\s*\\?['"])([^'"\n\r]{4,})(\\?['"])/gi,
    '$1[REDACTED]$3'
  );

  return sanitized;
}

module.exports = {
  redactSecrets,
};
