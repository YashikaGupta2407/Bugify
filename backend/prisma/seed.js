// Seeds initial account data and clearly marked synthetic analytics examples.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/services/authService');

const DAYS_MS = 24 * 60 * 60 * 1000;

// These stored examples are synthetic analytics data, not executed submissions.
// The marker makes each record recognizable and lets ordinary seed reruns skip it.
const DEMO_SUBMISSIONS = Object.freeze([
  { key: '01', language: 'python', daysAgo: 1, status: 'error', errorType: 'ZERO_DIVISION_ERROR', errorMessage: 'division by zero', output: '', executionTime: 0.021, code: '# BUGIFY_SYNTHETIC_DEMO:v1:01\nrevenue = 240\ncost = 0\nprint(revenue / cost)' },
  { key: '02', language: 'python', daysAgo: 2, status: 'error', errorType: 'NAME_ERROR', errorMessage: "name 'total' is not defined", output: '', executionTime: 0.018, code: "# BUGIFY_SYNTHETIC_DEMO:v1:02\nprices = [12, 18, 9]\nprint(total(prices))" },
  { key: '03', language: 'python', daysAgo: 4, status: 'error', errorType: 'SYNTAX_ERROR', errorMessage: "expected ':' after function definition", output: '', executionTime: 0.012, code: '# BUGIFY_SYNTHETIC_DEMO:v1:03\ndef average(values)\n    print(sum(values) / len(values))' },
  { key: '04', language: 'python', daysAgo: 5, status: 'success', errorType: null, errorMessage: null, output: 'Average: 14.0', executionTime: 0.019, code: '# BUGIFY_SYNTHETIC_DEMO:v1:04\nvalues = [12, 18, 12]\nprint(f"Average: {sum(values) / len(values)}")' },
  { key: '05', language: 'python', daysAgo: 7, status: 'error', errorType: 'TYPE_ERROR', errorMessage: "unsupported operand type(s) for +: 'int' and 'str'", output: '', executionTime: 0.017, code: "# BUGIFY_SYNTHETIC_DEMO:v1:05\ncount = 4\nlabel = 'items'\nprint(count + label)" },
  { key: '06', language: 'python', daysAgo: 8, status: 'error', errorType: 'INDEX_ERROR', errorMessage: 'list index out of range', output: '', executionTime: 0.016, code: '# BUGIFY_SYNTHETIC_DEMO:v1:06\nresults = [81, 92, 76]\nprint(results[3])' },
  { key: '07', language: 'python', daysAgo: 10, status: 'error', errorType: 'ZERO_DIVISION_ERROR', errorMessage: 'division by zero', output: '', executionTime: 0.020, code: '# BUGIFY_SYNTHETIC_DEMO:v1:07\ncompleted = 0\nassigned = 12\nprint(assigned / completed)' },
  { key: '08', language: 'python', daysAgo: 11, status: 'success', errorType: null, errorMessage: null, output: '3 active tasks', executionTime: 0.014, code: "# BUGIFY_SYNTHETIC_DEMO:v1:08\ntasks = ['review', 'test', 'ship']\nprint(len(tasks), 'active tasks')" },
  { key: '09', language: 'python', daysAgo: 13, status: 'error', errorType: 'KEY_ERROR', errorMessage: "'email'", output: '', executionTime: 0.015, code: "# BUGIFY_SYNTHETIC_DEMO:v1:09\nprofile = {'name': 'Ari'}\nprint(profile['email'])" },
  { key: '10', language: 'python', daysAgo: 15, status: 'error', errorType: 'ATTRIBUTE_ERROR', errorMessage: "'NoneType' object has no attribute 'strip'", output: '', executionTime: 0.018, code: "# BUGIFY_SYNTHETIC_DEMO:v1:10\nusername = None\nprint(username.strip())" },
  { key: '11', language: 'python', daysAgo: 17, status: 'error', errorType: 'RUNTIME_ERROR', errorMessage: 'unexpected runtime failure in report generation', output: '', executionTime: 0.043, code: "# BUGIFY_SYNTHETIC_DEMO:v1:11\nrecords = ['ok', 'ok']\nraise RuntimeError('report generation failed')" },
  { key: '12', language: 'python', daysAgo: 19, status: 'error', errorType: 'COMPILATION_ERROR', errorMessage: 'source could not be compiled', output: '', executionTime: 0.011, code: '# BUGIFY_SYNTHETIC_DEMO:v1:12\nprint("weekly summary"' },
  { key: '13', language: 'python', daysAgo: 22, status: 'error', errorType: 'ZERO_DIVISION_ERROR', errorMessage: 'division by zero', output: '', executionTime: 0.022, code: '# BUGIFY_SYNTHETIC_DEMO:v1:13\nsubtotal = 0\nitems = 5\nprint(items / subtotal)' },
  { key: '14', language: 'javascript', daysAgo: 3, status: 'success', errorType: null, errorMessage: null, output: '4 active projects', executionTime: 0.023, code: '// BUGIFY_SYNTHETIC_DEMO:v1:14\nconst projects = ["web", "api", "cli", "docs"];\nconsole.log(`${projects.length} active projects`);' },
  { key: '15', language: 'javascript', daysAgo: 6, status: 'error', errorType: 'TYPE_ERROR', errorMessage: 'Cannot read properties of undefined', output: '', executionTime: 0.026, code: '// BUGIFY_SYNTHETIC_DEMO:v1:15\nconst user = undefined;\nconsole.log(user.name.toUpperCase());' },
  { key: '16', language: 'javascript', daysAgo: 9, status: 'error', errorType: 'INDEX_ERROR', errorMessage: 'requested array element is undefined', output: '', executionTime: 0.024, code: '// BUGIFY_SYNTHETIC_DEMO:v1:16\nconst scores = [88, 91];\nconsole.log(scores[4].toFixed(1));' },
  { key: '17', language: 'javascript', daysAgo: 14, status: 'success', errorType: null, errorMessage: null, output: 'Build complete', executionTime: 0.031, code: '// BUGIFY_SYNTHETIC_DEMO:v1:17\nconst modules = ["auth", "analytics"];\nconsole.log("Build complete");' },
  { key: '18', language: 'javascript', daysAgo: 25, status: 'error', errorType: 'ZERO_DIVISION_ERROR', errorMessage: 'division by zero', output: '', executionTime: 0.029, code: '// BUGIFY_SYNTHETIC_DEMO:v1:18\nconst total = 120;\nconst completed = 0;\nconsole.log(total / completed);' },
]);

async function seedDemoSubmissions(database, demoUserId, languages, seededAt = new Date()) {
  const languageIds = new Map(
    languages.map((language) => [language.name.toLowerCase(), language.id]),
  );
  const missingLanguage = [...new Set(DEMO_SUBMISSIONS.map((item) => item.language))]
    .find((name) => !languageIds.has(name));
  if (missingLanguage) {
    throw new Error(`Required demo language is missing: ${missingLanguage}`);
  }

  return database.$transaction(async (tx) => {
    const inserted = { total: 0, successful: 0, failed: 0 };

    for (const item of DEMO_SUBMISSIONS) {
      const exists = await tx.submission.findFirst({
        where: { userId: demoUserId, code: item.code },
        select: { id: true },
      });
      if (exists) continue;

      const createdAt = new Date(seededAt.getTime() - item.daysAgo * DAYS_MS);
      await tx.submission.create({
        data: {
          userId: demoUserId,
          languageId: languageIds.get(item.language),
          code: item.code,
          createdAt,
          result: {
            create: {
              status: item.status,
              errorType: item.errorType,
              errorMessage: item.errorMessage,
              output: item.output,
              executionTime: item.executionTime,
              createdAt,
            },
          },
        },
        select: { id: true },
      });

      inserted.total += 1;
      if (item.status === 'success') inserted.successful += 1;
      else inserted.failed += 1;
    }

    if (inserted.total > 0) {
      await tx.userProgress.upsert({
        where: { userId: demoUserId },
        create: {
          userId: demoUserId,
          totalSubmissions: inserted.total,
          successfulSubmissions: inserted.successful,
          failedSubmissions: inserted.failed,
        },
        update: {
          totalSubmissions: { increment: inserted.total },
          successfulSubmissions: { increment: inserted.successful },
          failedSubmissions: { increment: inserted.failed },
        },
      });
    }

    return inserted;
  });
}

async function main() {
  const demoPassword = process.env.DEMO_USER_PASSWORD;
  if (typeof demoPassword !== 'string' || demoPassword.trim().length === 0) {
    throw new Error('DEMO_USER_PASSWORD must be set to a nonempty value before seeding.');
  }

  const prisma = new PrismaClient();
  try {
    console.log('Starting Bugify database seeding...');

    const demoUser = await prisma.user.upsert({
      where: { email: 'demo@bugify.dev' },
      update: {},
      create: {
        name: 'Demo User',
        email: 'demo@bugify.dev',
        password: await hashPassword(demoPassword),
      },
    });

    await prisma.userProgress.upsert({
      where: { userId: demoUser.id },
      update: {},
      create: {
        userId: demoUser.id,
        totalSubmissions: 0,
        successfulSubmissions: 0,
        failedSubmissions: 0,
      },
    });

    const python = await prisma.language.upsert({
      where: { name: 'python' },
      update: {},
      create: { name: 'python', version: '3.10' },
    });
    const javascript = await prisma.language.upsert({
      where: { name: 'javascript' },
      update: {},
      create: { name: 'javascript', version: 'ES2022' },
    });

    const inserted = await seedDemoSubmissions(
      prisma,
      demoUser.id,
      [python, javascript],
    );
    console.log(`Demo analytics examples added: ${inserted.total}`);
    console.log('Seeding completed successfully!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Error during seeding:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { DEMO_SUBMISSIONS, seedDemoSubmissions };
