/**
 * Client-side Privacy & Secret Redaction (Pure functions, no VS Code dependencies)
 */

const SENSITIVE_FILENAME_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa.*$/i,
  /^id_ed25519.*$/i,
  /^credentials\.json$/i,
  /^secrets?(\..+)?$/i,
  /\.pfx$/i,
  /\.p12$/i,
];

/**
 * Checks whether a given relative workspace file path is considered sensitive and should be skipped.
 */
export function isSensitiveFile(relativePath: string): boolean {
  if (!relativePath) return false;
  const basename = relativePath.split(/[/\\]/).pop() || '';
  return SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

/**
 * Scans code text for obvious secrets (API keys, tokens, passwords) and redacts them.
 */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || !text) {
    return text || '';
  }

  let sanitized = text;

  // 1. Private key blocks
  sanitized = sanitized.replace(
    /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+PRIVATE KEY-----/gi,
    '[REDACTED PRIVATE KEY]'
  );

  // 2. Specific known API key patterns
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
