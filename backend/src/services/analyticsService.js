const RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90, all: null });

const ERROR_TYPE_DESCRIPTIONS = Object.freeze({
  SYNTAX_ERROR: 'The source could not be parsed because its syntax is invalid.',
  TYPE_ERROR: 'An operation received a value of an incompatible type.',
  NAME_ERROR: 'The program referenced a name that is not defined.',
  INDEX_ERROR: 'An indexed collection was accessed outside its valid range.',
  KEY_ERROR: 'A requested key was not present in a mapping.',
  ZERO_DIVISION_ERROR: 'A division operation used zero as its divisor.',
  ATTRIBUTE_ERROR: 'An object does not provide the requested attribute.',
  COMPILATION_ERROR: 'The program could not be compiled.',
  TIME_LIMIT: 'Program execution exceeded its allowed time.',
  RUNTIME_ERROR: 'The program failed while it was running.',
  UNKNOWN_ERROR: 'The execution service recorded an unclassified error.',
});

function getRangeBounds(range, now = new Date()) {
  if (!Object.hasOwn(RANGE_DAYS, range)) return null;
  if (range === 'all') return { start: null, end: now };
  const start = new Date(now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
  return { start, end: now };
}

function makeRangeWhere(bounds) {
  if (!bounds.start) return { lt: bounds.end };
  return { gte: bounds.start, lt: bounds.end };
}

function getErrorTypeDescription(type) {
  return ERROR_TYPE_DESCRIPTIONS[type] || 'Recorded error type; no additional category was inferred.';
}

function percentage(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

function buildAnalyticsPayload({
  range,
  bounds,
  totalErrors,
  errorLanguageGroups,
  allLanguageGroups,
  errorTypeGroups,
  languageNames,
}) {
  const nameForId = (id) => languageNames.get(id) || 'Unknown language';
  const languages = errorLanguageGroups
    .map((group) => ({ language: nameForId(group.languageId), errorCount: group.count }))
    .sort((a, b) => b.errorCount - a.errorCount || a.language.localeCompare(b.language));

  for (let index = 0; index < languages.length; index += 1) {
    languages[index].rank = index + 1;
    languages[index].percentage = percentage(languages[index].errorCount, totalErrors);
  }

  const typeCounts = new Map();
  for (const group of errorTypeGroups) {
    const errorType = group.errorType || 'Other';
    typeCounts.set(errorType, (typeCounts.get(errorType) || 0) + group.count);
  }
  const errorTypes = [...typeCounts].map(([errorType, occurrences]) => ({
    errorType,
    occurrences,
    description: getErrorTypeDescription(errorType),
  })).sort((a, b) => b.occurrences - a.occurrences || a.errorType.localeCompare(b.errorType));

  for (let index = 0; index < errorTypes.length; index += 1) {
    errorTypes[index].rank = index + 1;
    errorTypes[index].percentage = percentage(errorTypes[index].occurrences, totalErrors);
  }

  const topLanguage = languages[0] || null;
  const topErrorType = errorTypes[0] || null;
  const languagesUsed = allLanguageGroups.length;
  const insights = [];

  if (totalErrors >= 3 && topLanguage && topLanguage.percentage >= 40) {
    insights.push({
      id: 'leading-language',
      text: `${topLanguage.language} accounts for ${topLanguage.percentage}% of recorded errors in this period.`,
    });
  }
  if (totalErrors >= 3 && topErrorType && topErrorType.percentage >= 30) {
    insights.push({
      id: 'leading-error-type',
      text: `${topErrorType.errorType} is the most repeated recorded error type at ${topErrorType.percentage}%.`,
    });
  }

  return {
    success: true,
    range,
    period: {
      start: bounds.start?.toISOString() || null,
      end: bounds.end.toISOString(),
    },
    definition: 'An error is one SubmissionResult whose status is not "success". Its timestamp is SubmissionResult.createdAt; successful runs are excluded.',
    errorTypeMethod: 'Error types use the stored SubmissionResult.errorType value. Missing values are shown as Other; no category is inferred.',
    overview: {
      totalErrors,
      mostErrorProneLanguage: topLanguage ? { name: topLanguage.language, count: topLanguage.errorCount } : null,
      mostFrequentErrorType: topErrorType ? {
        name: topErrorType.errorType,
        count: topErrorType.occurrences,
        description: topErrorType.description,
      } : null,
      languagesUsed,
    },
    languages,
    errorTypes,
    insights,
  };
}

module.exports = { RANGE_DAYS, getRangeBounds, makeRangeWhere, getErrorTypeDescription, buildAnalyticsPayload };
