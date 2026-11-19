const { getRangeBounds, makeRangeWhere, buildAnalyticsPayload } = require('../services/analyticsService');

function createErrorAnalyticsHandler(database) {
  return async function getErrorAnalytics(req, res, next) {
    try {
      const range = req.query.range || '30d';
      const bounds = getRangeBounds(range);
      if (!bounds) {
        return res.status(400).json({ success: false, message: 'Range must be one of: 7d, 30d, 90d, all.' });
      }

      const createdAt = makeRangeWhere(bounds);
      const ownedSubmission = { is: { userId: req.user.id } };
      const errorResult = { is: { status: { not: 'success' }, createdAt } };
      const allResults = { is: { createdAt } };

      const [totalErrors, errorLanguageRows, allLanguageRows, errorTypeRows] = await Promise.all([
        database.submissionResult.count({
          where: { status: { not: 'success' }, createdAt, submission: ownedSubmission },
        }),
        database.submission.groupBy({
          by: ['languageId'],
          where: { userId: req.user.id, result: errorResult },
          _count: { _all: true },
        }),
        database.submission.groupBy({
          by: ['languageId'],
          where: { userId: req.user.id, result: allResults },
          _count: { _all: true },
        }),
        database.submissionResult.groupBy({
          by: ['errorType'],
          where: { status: { not: 'success' }, createdAt, submission: ownedSubmission },
          _count: { _all: true },
        }),
      ]);

      const languageIds = [...new Set([
        ...errorLanguageRows.map((row) => row.languageId),
        ...allLanguageRows.map((row) => row.languageId),
      ])];
      const languageRows = languageIds.length
        ? await database.language.findMany({ where: { id: { in: languageIds } }, select: { id: true, name: true } })
        : [];
      const languageNames = new Map(languageRows.map((language) => [language.id, language.name]));

      const payload = buildAnalyticsPayload({
        range,
        bounds,
        totalErrors,
        errorLanguageGroups: errorLanguageRows.map((row) => ({ languageId: row.languageId, count: row._count._all })),
        allLanguageGroups: allLanguageRows,
        errorTypeGroups: errorTypeRows.map((row) => ({ errorType: row.errorType, count: row._count._all })),
        languageNames,
      });

      return res.status(200).json(payload);
    } catch (error) {
      return next(error);
    }
  };
}

async function getErrorAnalytics(req, res, next) {
  try {
    const prisma = require('../prisma');
    return createErrorAnalyticsHandler(prisma)(req, res, next);
  } catch (error) {
    return next(error);
  }
}

module.exports = { getErrorAnalytics, createErrorAnalyticsHandler };
