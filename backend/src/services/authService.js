const {
  createHmac,
  randomBytes,
  scrypt: callbackScrypt,
  timingSafeEqual,
} = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(callbackScrypt);
const SESSION_COOKIE = 'bugify_session';
const SESSION_SECONDS = 12 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;
const INVALID_PASSWORD_SALT = 'bad-password-user-salt';

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (secret) {
    if (process.env.NODE_ENV === 'production' && secret.length < 32) {
      throw new Error('AUTH_SECRET must contain at least 32 characters in production.');
    }
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be configured in production.');
  }
  return 'bugify-local-development-secret-change-before-deploying';
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const [algorithm, salt, hash] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/i.test(hash || '')) {
    await scrypt(password, INVALID_PASSWORD_SALT, 64);
    return false;
  }
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function signPayload(payload, secret = getAuthSecret()) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionToken(userId, maxAgeSeconds = SESSION_SECONDS, secret = getAuthSecret()) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  })).toString('base64url');
  return `${payload}.${signPayload(payload, secret)}`;
}

function verifySessionToken(token, secret = getAuthSecret()) {
  if (typeof token !== 'string') return null;
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const providedSignature = Buffer.from(token.slice(separator + 1));
  const expectedSignature = Buffer.from(signPayload(payload, secret));
  if (providedSignature.length !== expectedSignature.length || !timingSafeEqual(providedSignature, expectedSignature)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isInteger(decoded.sub) || !Number.isInteger(decoded.exp) || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    return { userId: decoded.sub, expiresAt: decoded.exp };
  } catch {
    return null;
  }
}

function readSessionCookie(cookieHeader = '') {
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null;
  }
}

function sessionCookieOptions(maxAgeSeconds) {
  const options = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  if (maxAgeSeconds) options.maxAge = maxAgeSeconds * 1000;
  return options;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_SECONDS,
  REMEMBERED_SESSION_SECONDS,
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  readSessionCookie,
  sessionCookieOptions,
};
