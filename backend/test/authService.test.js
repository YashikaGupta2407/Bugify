const { before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTH_SECRET = 'test-secret-for-bugify-auth-only';

const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  readSessionCookie,
} = require('../src/services/authService');
const { createAuthHandlers } = require('../src/controllers/authController');
const requireAuth = require('../src/middleware/requireAuth');

describe('account password and session helpers', () => {
  let passwordHash;

  before(async () => {
    passwordHash = await hashPassword('correct horse battery staple');
  });

  test('stores passwords as salted scrypt hashes and verifies them', async () => {
    assert.match(passwordHash, /^scrypt\$/);
    assert.notEqual(passwordHash, 'correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', passwordHash), true);
    assert.equal(await verifyPassword('wrong password', passwordHash), false);
    assert.equal(await verifyPassword('anything', 'legacy-plaintext-password'), false);
  });

  test('accepts valid signed sessions and rejects expired or modified sessions', () => {
    const token = createSessionToken(17, 60);
    const session = verifySessionToken(token);
    assert.equal(session.userId, 17);
    assert.ok(session.expiresAt > Math.floor(Date.now() / 1000));
    assert.equal(verifySessionToken(`${token}x`), null);
    assert.equal(verifySessionToken(createSessionToken(17, -1)), null);
    assert.equal(verifySessionToken('not-a-session'), null);
  });

  test('reads only the Bugify session cookie', () => {
    assert.equal(readSessionCookie('other=value; bugify_session=abc.def'), 'abc.def');
    assert.equal(readSessionCookie('other=value'), null);
    assert.equal(readSessionCookie('bugify_session=%E0%A4%A'), null);
  });

  test('protects routes and derives the user ID only from a valid session', () => {
    let statusCode;
    let payload;
    const response = { status(code) { statusCode = code; return this; }, json(body) { payload = body; return this; } };
    let calledNext = false;
    requireAuth({ headers: {} }, response, () => { calledNext = true; });
    assert.equal(statusCode, 401);
    assert.equal(payload.success, false);
    assert.equal(calledNext, false);

    const token = createSessionToken(31, 120);
    const req = { headers: { cookie: `bugify_session=${token}` } };
    requireAuth(req, response, () => { calledNext = true; });
    assert.equal(calledNext, true);
    assert.deepEqual(req.user, { id: 31 });
  });

  test('registers hashed credentials and returns only the public user fields', async () => {
    let storedUser;
    const handlers = createAuthHandlers({
      user: { create: async ({ data }) => { storedUser = data; return { id: 45, name: data.name, email: data.email }; } },
    });
    const response = createResponse();
    await handlers.register({ body: { name: 'Ada Lovelace', email: 'ADA@example.com', password: 'a-secure-password', remember: true } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.equal(storedUser.email, 'ada@example.com');
    assert.match(storedUser.password, /^scrypt\$/);
    assert.deepEqual(response.body.user, { id: 45, name: 'Ada Lovelace', email: 'ada@example.com' });
    assert.equal(Object.hasOwn(response.body.user, 'password'), false);
    assert.equal(response.cookie.options.httpOnly, true);
  });

  test('login rejects bad credentials and establishes a session for a valid password', async () => {
    const password = 'an-existing-secure-password';
    const stored = { id: 51, name: 'Grace Hopper', email: 'grace@example.com', password: await hashPassword(password) };
    const handlers = createAuthHandlers({ user: { findUnique: async ({ where }) => where.email === stored.email ? stored : null } });
    const invalidResponse = createResponse();
    await handlers.login({ body: { email: stored.email, password: 'wrong password' } }, invalidResponse, (error) => { throw error; });
    assert.equal(invalidResponse.statusCode, 401);
    assert.equal(invalidResponse.body.message, 'Email or password is incorrect.');

    const validResponse = createResponse();
    await handlers.login({ body: { email: stored.email.toUpperCase(), password } }, validResponse, (error) => { throw error; });
    assert.equal(validResponse.statusCode, 200);
    assert.equal(verifySessionToken(validResponse.cookie.value).userId, stored.id);
  });

  test('current-user lookup is constrained to the ID in the authenticated session', async () => {
    let lookup;
    const handlers = createAuthHandlers({ user: { findUnique: async (args) => { lookup = args; return { id: 67, name: 'Katherine Johnson', email: 'kj@example.com' }; } } });
    const response = createResponse();
    await handlers.currentUser({ user: { id: 67 } }, response, (error) => { throw error; });
    assert.deepEqual(lookup.where, { id: 67 });
    assert.equal(response.body.user.id, 67);
  });
});

function createResponse() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value, options) { this.cookie = { name, value, options }; return this; },
  };
}
