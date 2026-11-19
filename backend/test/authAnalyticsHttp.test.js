const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'http-test-secret-for-bugify-auth';

const app = require('../src/server');
const prisma = require('../src/prisma');

describe('authenticated website API routes', () => {
  let server;
  let baseUrl;
  const users = new Map();
  let nextId = 1;

  before(async () => {
    prisma.user.create = async ({ data, select }) => {
      if (users.has(data.email)) {
        const error = new Error('Unique constraint failed');
        error.code = 'P2002';
        throw error;
      }
      const user = { id: nextId++, ...data };
      users.set(user.email, user);
      return selectUser(user, select);
    };
    prisma.user.findUnique = async ({ where, select }) => {
      const user = where.id ? [...users.values()].find((item) => item.id === where.id) : users.get(where.email);
      return user ? selectUser(user, select) : null;
    };
    prisma.submissionResult.count = async ({ where }) => where.submission.is.userId === 1 ? 2 : 1;
    prisma.submissionResult.groupBy = async ({ where }) => {
      const userId = where.submission.is.userId;
      return [{ errorType: userId === 1 ? 'TYPE_ERROR' : 'SYNTAX_ERROR', _count: { _all: userId === 1 ? 2 : 1 } }];
    };
    prisma.submission.groupBy = async ({ where }) => {
      const userId = where.userId;
      const languageId = userId === 1 ? 10 : 20;
      const count = userId === 1 ? 2 : 1;
      return [{ languageId, _count: { _all: count } }];
    };
    prisma.language.findMany = async ({ where }) => where.id.in.map((id) => ({ id, name: id === 10 ? 'python' : 'javascript' }));
    prisma.submission.findMany = async ({ where }) => [{ id: 1, userId: where.userId }];

    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  });

  test('sign up, sign in, enforce protection, and isolate analytics by user', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/analytics/errors?range=30d`);
    assert.equal(unauthenticated.status, 401);
    const protectedSubmissions = await fetch(`${baseUrl}/api/submissions`);
    assert.equal(protectedSubmissions.status, 401);

    const first = await signUp('Ada Example', 'ada@example.test');
    const second = await signUp('Grace Example', 'grace@example.test');
    assert.equal(first.user.name, 'Ada Example');
    assert.equal(second.user.name, 'Grace Example');
    assert.notEqual(first.cookie, second.cookie);

    const firstAnalytics = await getJson('/api/analytics/errors?range=30d', first.cookie);
    const secondAnalytics = await getJson('/api/analytics/errors?range=30d', second.cookie);
    assert.equal(firstAnalytics.overview.totalErrors, 2);
    assert.equal(firstAnalytics.languages[0].language, 'python');
    assert.equal(firstAnalytics.errorTypes[0].errorType, 'TYPE_ERROR');
    assert.equal(secondAnalytics.overview.totalErrors, 1);
    assert.equal(secondAnalytics.languages[0].language, 'javascript');
    assert.equal(secondAnalytics.errorTypes[0].errorType, 'SYNTAX_ERROR');

    const badRange = await fetch(`${baseUrl}/api/analytics/errors?range=year`, { headers: { Cookie: first.cookie } });
    assert.equal(badRange.status, 400);
    const loginFailure = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.test', password: 'incorrect-password' }),
    });
    assert.equal(loginFailure.status, 401);

    const loginSuccess = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.test', password: 'account-password-123' }),
    });
    assert.equal(loginSuccess.status, 200);
    assert.match(loginSuccess.headers.get('set-cookie'), /HttpOnly/i);
  });

  async function signUp(name, email) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'account-password-123' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    return { user: body.user, cookie: response.headers.get('set-cookie').split(';')[0] };
  }

  async function getJson(path, cookie) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    return response.json();
  }
});

function selectUser(user, select) {
  if (!select) return user;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, user[key]]));
}
