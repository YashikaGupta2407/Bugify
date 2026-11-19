const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createErrorAnalyticsHandler } = require('../src/controllers/analyticsController');
const { buildAnalyticsPayload, getRangeBounds } = require('../src/services/analyticsService');

describe('error analytics aggregation', () => {
  test('validates range names and uses the result timestamp window', () => {
    const now = new Date('2026-11-18T12:00:00.000Z');
    const bounds = getRangeBounds('7d', now);
    assert.equal(bounds.start.toISOString(), '2026-11-11T12:00:00.000Z');
    assert.equal(bounds.end, now);
    assert.equal(getRangeBounds('invalid', now), null);
    assert.equal(getRangeBounds('all', now).start, null);
  });

  test('sorts both breakdowns by count, calculates shares, and derives only supported insights', () => {
    const bounds = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-18T00:00:00Z') };
    const payload = buildAnalyticsPayload({
      range: '30d', bounds, totalErrors: 5,
      errorLanguageGroups: [{ languageId: 2, count: 2 }, { languageId: 1, count: 3 }],
      allLanguageGroups: [{ languageId: 1 }, { languageId: 2 }],
      errorTypeGroups: [{ errorType: 'TYPE_ERROR', count: 1 }, { errorType: 'SYNTAX_ERROR', count: 4 }],
      languageNames: new Map([[1, 'Python'], [2, 'JavaScript']]),
    });
    assert.deepEqual(payload.languages.map((row) => row.language), ['Python', 'JavaScript']);
    assert.deepEqual(payload.languages.map((row) => row.percentage), [60, 40]);
    assert.deepEqual(payload.errorTypes.map((row) => row.errorType), ['SYNTAX_ERROR', 'TYPE_ERROR']);
    assert.equal(payload.errorTypes[0].percentage, 80);
    assert.equal(payload.overview.totalErrors, payload.languages.reduce((sum, row) => sum + row.errorCount, 0));
    assert.equal(payload.overview.totalErrors, payload.errorTypes.reduce((sum, row) => sum + row.occurrences, 0));
    assert.equal(payload.overview.languagesUsed, 2);
    assert.equal(payload.insights.length, 2);
    assert.match(payload.errorTypeMethod, /stored SubmissionResult\.errorType/);
  });

  test('keeps sparse datasets free of inferred insights', () => {
    const payload = buildAnalyticsPayload({
      range: '7d', bounds: { start: null, end: new Date('2026-11-18T00:00:00Z') }, totalErrors: 1,
      errorLanguageGroups: [{ languageId: 1, count: 1 }], allLanguageGroups: [{ languageId: 1 }],
      errorTypeGroups: [{ errorType: null, count: 1 }], languageNames: new Map([[1, 'Python']]),
    });
    assert.equal(payload.errorTypes[0].errorType, 'Other');
    assert.deepEqual(payload.insights, []);
  });

  test('scopes every analytics query to the session user and excludes successful runs', async () => {
    const calls = [];
    const database = {
      submissionResult: {
        count: async (args) => { calls.push(['total', args]); return args.where.submission.is.userId === 22 ? 2 : 1; },
        groupBy: async (args) => {
          calls.push(['types', args]);
          return [{ errorType: args.where.submission.is.userId === 22 ? 'TYPE_ERROR' : 'SYNTAX_ERROR', _count: { _all: args.where.submission.is.userId === 22 ? 2 : 1 } }];
        },
      },
      submission: {
        groupBy: async (args) => {
          calls.push(['languages', args]);
          const id = args.where.userId === 22 ? 4 : 8;
          const count = args.where.userId === 22 ? 2 : 1;
          return args.where.result.is.status ? [{ languageId: id, _count: { _all: count } }] : [{ languageId: id, _count: { _all: count + 1 } }];
        },
      },
      language: { findMany: async (args) => args.where.id.in.map((id) => ({ id, name: id === 4 ? 'Python' : 'JavaScript' })) },
    };
    const handler = createErrorAnalyticsHandler(database);
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ query: { range: '30d' }, user: { id: 22 } }, response, (error) => { throw error; });
    const firstUserPayload = response.body;
    await handler({ query: { range: '30d' }, user: { id: 33 } }, response, (error) => { throw error; });

    assert.equal(response.statusCode, 200);
    assert.equal(firstUserPayload.overview.totalErrors, 2);
    assert.equal(firstUserPayload.languages[0].language, 'Python');
    assert.equal(response.body.overview.totalErrors, 1);
    assert.equal(response.body.languages[0].language, 'JavaScript');
    assert.equal(calls.find(([kind]) => kind === 'total')[1].where.submission.is.userId, 22);
    assert.equal(calls.find(([kind]) => kind === 'types')[1].where.submission.is.userId, 22);
    assert.equal(calls.filter(([kind]) => kind === 'languages').every(([, args], index) => args.where.userId === (index < 2 ? 22 : 33)), true);
    assert.equal(calls.find(([kind]) => kind === 'total')[1].where.status.not, 'success');
    assert.ok(calls.find(([kind]) => kind === 'total')[1].where.createdAt.gte instanceof Date);
  });

  test('rejects unknown ranges before querying storage', async () => {
    let queried = false;
    const handler = createErrorAnalyticsHandler({
      submissionResult: { count: async () => { queried = true; } },
      submission: { groupBy: async () => { queried = true; } },
    });
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ query: { range: 'year' }, user: { id: 22 } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 400);
    assert.equal(queried, false);
  });
});
