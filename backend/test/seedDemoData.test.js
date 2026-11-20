const test = require('node:test');
const assert = require('node:assert/strict');
const { DEMO_SUBMISSIONS, seedDemoSubmissions } = require('../prisma/seed');

function createFakeDatabase() {
  const submissions = [
    { id: 1, userId: 1, code: 'print(10/0)', genuine: true },
  ];
  const progress = {
    userId: 1,
    totalSubmissions: 1,
    successfulSubmissions: 0,
    failedSubmissions: 1,
  };
  let nextId = 2;

  const tx = {
    submission: {
      async findFirst({ where }) {
        return submissions.find(
          (submission) =>
            submission.userId === where.userId && submission.code === where.code,
        ) || null;
      },
      async create({ data }) {
        const submission = { id: nextId++, ...data };
        submissions.push(submission);
        return { id: submission.id };
      },
    },
    userProgress: {
      async upsert({ create, update }) {
        if (!progress.userId) Object.assign(progress, create);
        else {
          progress.totalSubmissions += update.totalSubmissions.increment;
          progress.successfulSubmissions += update.successfulSubmissions.increment;
          progress.failedSubmissions += update.failedSubmissions.increment;
        }
        return progress;
      },
    },
  };

  return {
    submissions,
    progress,
    $transaction: (callback) => callback(tx),
  };
}

const languages = [
  { id: 1, name: 'python' },
  { id: 2, name: 'javascript' },
];

test('demo analytics seed creates 18 marked records and increments progress once', async () => {
  const database = createFakeDatabase();
  const seededAt = new Date('2026-11-20T12:00:00.000Z');

  const inserted = await seedDemoSubmissions(database, 1, languages, seededAt);

  assert.deepEqual(inserted, { total: 18, successful: 4, failed: 14 });
  assert.equal(DEMO_SUBMISSIONS.length, 18);
  assert.equal(database.submissions.length, 19);
  assert.equal(database.submissions[0].genuine, true);
  assert.equal(database.submissions.slice(1).every((row) => row.userId === 1), true);
  assert.equal(database.submissions.slice(1).every((row) => row.result.create), true);
  assert.equal(database.submissions.slice(1).every((row) => row.code.includes('BUGIFY_SYNTHETIC_DEMO:v1:')), true);
  assert.deepEqual(database.progress, {
    userId: 1,
    totalSubmissions: 19,
    successfulSubmissions: 4,
    failedSubmissions: 15,
  });

  const failedCategories = new Set(
    DEMO_SUBMISSIONS.filter((item) => item.status === 'error').map((item) => item.errorType),
  );
  for (const category of [
    'ZERO_DIVISION_ERROR',
    'NAME_ERROR',
    'SYNTAX_ERROR',
    'TYPE_ERROR',
    'INDEX_ERROR',
    'KEY_ERROR',
    'ATTRIBUTE_ERROR',
    'RUNTIME_ERROR',
    'COMPILATION_ERROR',
  ]) {
    assert.equal(failedCategories.has(category), true, `${category} is represented`);
  }

  const createdDates = database.submissions.slice(1).map((row) => row.createdAt);
  assert.equal(createdDates.every((date) => date instanceof Date), true);
  assert.equal(
    createdDates.every((date) => date >= new Date('2026-10-21T12:00:00.000Z') && date <= seededAt),
    true,
  );
});

test('rerunning demo analytics seed skips marked rows and preserves genuine data and progress', async () => {
  const database = createFakeDatabase();
  const seededAt = new Date('2026-11-20T12:00:00.000Z');

  await seedDemoSubmissions(database, 1, languages, seededAt);
  const snapshot = structuredClone({ submissions: database.submissions, progress: database.progress });
  const insertedAgain = await seedDemoSubmissions(database, 1, languages, seededAt);

  assert.deepEqual(insertedAgain, { total: 0, successful: 0, failed: 0 });
  assert.deepEqual(database.submissions, snapshot.submissions);
  assert.deepEqual(database.progress, snapshot.progress);
});
