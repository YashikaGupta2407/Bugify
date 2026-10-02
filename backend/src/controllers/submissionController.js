// backend/src/controllers/submissionController.js
// Handles submissions: input validation, execution service dispatch, and database persistence.
const prisma = require('../prisma');
const { executeCode } = require('../services/executionService');

/**
 * POST /api/submissions
 * Submits code for execution and analysis.
 */
async function createSubmission(req, res, next) {
  try {
    const { code, language } = req.body;

    // 1. Validate input: code and language must be provided and non-empty
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Code is required and cannot be empty' });
    }

    if (!language || typeof language !== 'string' || !language.trim()) {
      return res.status(400).json({ error: 'Language is required and cannot be empty' });
    }

    // 2. Look up the language record in database
    const normalizedLanguage = language.trim().toLowerCase();
    const languageRecord = await prisma.language.findFirst({
      where: {
        name: {
          equals: normalizedLanguage,
          mode: 'insensitive',
        },
      },
    });

    if (!languageRecord) {
      return res.status(400).json({
        error: `Language '${language}' is not supported. Supported languages: python, javascript.`,
      });
    }

    // Retrieve the demo user (seeded in database)
    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@bugify.dev' },
    });

    if (!demoUser) {
      return res.status(500).json({
        error: 'Demo user not found. Please ensure database seed has run.',
      });
    }

    // 3. Dispatch to mock execution service
    const executionResult = executeCode({
      code,
      language: normalizedLanguage,
    });

    const isSuccess = executionResult.status === 'success';

    // 4. In ONE Prisma transaction: create Submission, create SubmissionResult, and update UserProgress
    const transactionResult = await prisma.$transaction(async (tx) => {
      // Create submission
      const submission = await tx.submission.create({
        data: {
          userId: demoUser.id,
          languageId: languageRecord.id,
          code,
        },
      });

      // Create submission result
      const submissionResult = await tx.submissionResult.create({
        data: {
          submissionId: submission.id,
          status: executionResult.status,
          errorType: executionResult.errorType,
          errorMessage: executionResult.errorMessage,
          output: executionResult.output,
          executionTime: executionResult.executionTime,
        },
      });

      // Update progress counters for demo user
      const progressUpdate = {
        totalSubmissions: { increment: 1 },
      };
      if (isSuccess) {
        progressUpdate.successfulSubmissions = { increment: 1 };
      } else {
        progressUpdate.failedSubmissions = { increment: 1 };
      }

      await tx.userProgress.upsert({
        where: { userId: demoUser.id },
        create: {
          userId: demoUser.id,
          totalSubmissions: 1,
          successfulSubmissions: isSuccess ? 1 : 0,
          failedSubmissions: isSuccess ? 0 : 1,
        },
        update: progressUpdate,
      });

      return {
        submissionId: submission.id,
        status: submissionResult.status,
        errorType: submissionResult.errorType,
        errorMessage: submissionResult.errorMessage,
        output: submissionResult.output,
        executionTime: submissionResult.executionTime,
      };
    });

    // 5. Return standardized response JSON
    return res.status(200).json(transactionResult);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createSubmission,
};
