// backend/src/controllers/submissionController.js
// Handles submissions: execution, error classification, AI bug explanations, persistence, and history retrieval.
const prisma = require('../prisma');
const { executeCode } = require('../services/codeExecutionService');
const { classifyResult } = require('../services/errorClassifier');
const { generateExplanation } = require('../services/aiExplanationService');

/**
 * POST /api/submissions
 * Executes user code, classifies errors, generates AI explanation, and persists data.
 */
async function createSubmission(req, res, next) {
  try {
    const { code, language, stdin = '' } = req.body || {};

    // 1. Validate request body and input fields
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Code is required and cannot be empty',
      });
    }

    if (!language || typeof language !== 'string' || !language.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Language is required and cannot be empty',
      });
    }

    const normalizedLanguage = language.trim().toLowerCase();

    // Milestone 3: Python is the primary supported language
    if (normalizedLanguage !== 'python') {
      return res.status(400).json({
        success: false,
        message: `Language '${language}' is not supported yet. Currently supported: python.`,
      });
    }

    // 2. Look up language and demo user in database
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
        success: false,
        message: `Language '${language}' is not registered in the database.`,
      });
    }

    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@bugify.dev' },
    });

    if (!demoUser) {
      return res.status(500).json({
        success: false,
        message: 'Demo user not found. Please run the database seed.',
      });
    }

    // 3. Execute code via external execution service
    let rawExecution;
    try {
      rawExecution = await executeCode({
        code,
        language: normalizedLanguage,
        stdin,
      });
    } catch (execError) {
      console.error('Code execution service failure:', execError);
      return res.status(503).json({
        success: false,
        message: 'Unable to execute code',
      });
    }

    // 4. Classify execution result into Bugify categories
    const classified = classifyResult(rawExecution);
    const isSuccess = classified.status === 'success';

    // 5. Generate AI Explanation for errors only (never for clean success)
    let aiExplanation = null;
    if (!isSuccess && classified.errorType) {
      try {
        aiExplanation = await generateExplanation({
          language: normalizedLanguage,
          code,
          errorType: classified.errorType,
          errorMessage: classified.errorMessage,
          stderr: rawExecution.stderr,
          stdout: rawExecution.stdout,
          executionResult: rawExecution,
        });
      } catch (aiError) {
        console.warn('AI explanation generation failed gracefully:', aiError.message);
        aiExplanation = null;
      }
    }

    // 6. Atomic persistence in PostgreSQL via Prisma transaction
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
          status: classified.status,
          errorType: classified.errorType,
          errorMessage: classified.errorMessage,
          output: classified.output,
          executionTime: classified.executionTime,
          memory: rawExecution.memory,
          stderr: rawExecution.stderr,
          compileOutput: rawExecution.compileOutput,
        },
      });

      // Create debugging explanation if available
      let savedExplanation = null;
      if (aiExplanation) {
        savedExplanation = await tx.debuggingExplanation.create({
          data: {
            submissionResultId: submissionResult.id,
            summary: aiExplanation.summary,
            cause: aiExplanation.cause,
            location: aiExplanation.location || null,
            explanation: aiExplanation.explanation,
            suggestion: aiExplanation.suggestion,
            correctedCode: aiExplanation.correctedCode || null,
          },
        });
      }

      // Update UserProgress statistics
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
        explanation: savedExplanation ? {
          summary: savedExplanation.summary,
          cause: savedExplanation.cause,
          location: savedExplanation.location,
          explanation: savedExplanation.explanation,
          suggestion: savedExplanation.suggestion,
          correctedCode: savedExplanation.correctedCode,
        } : null,
      };
    });

    // 7. Return standardized response
    return res.status(200).json({
      success: true,
      result: {
        status: transactionResult.status,
        errorType: transactionResult.errorType,
        errorMessage: transactionResult.errorMessage,
        output: transactionResult.output,
        executionTime: transactionResult.executionTime,
        submissionId: transactionResult.submissionId,
      },
      explanation: transactionResult.explanation,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/submissions
 * Retrieves debugging history list for the demo user.
 */
async function getSubmissions(req, res, next) {
  try {
    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@bugify.dev' },
    });

    if (!demoUser) {
      return res.status(200).json([]);
    }

    const submissions = await prisma.submission.findMany({
      where: { userId: demoUser.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        language: true,
        result: {
          select: {
            status: true,
            errorType: true,
            executionTime: true,
          },
        },
      },
    });

    const formattedHistory = submissions.map((sub) => ({
      id: sub.id,
      language: sub.language.name,
      errorType: sub.result?.errorType || null,
      status: sub.result?.status || 'unknown',
      createdAt: sub.createdAt,
    }));

    return res.status(200).json(formattedHistory);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/submissions/:id
 * Retrieves complete debugging attempt details by ID including execution result and AI explanation.
 */
async function getSubmissionById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID',
      });
    }

    const submission = await prisma.submission.findUnique({
      where: { id },
      include: {
        language: true,
        result: {
          include: {
            explanation: true,
          },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: `Submission with ID ${id} not found`,
      });
    }

    return res.status(200).json({
      success: true,
      submission: {
        id: submission.id,
        code: submission.code,
        language: submission.language.name,
        createdAt: submission.createdAt,
      },
      result: submission.result ? {
        status: submission.result.status,
        errorType: submission.result.errorType,
        errorMessage: submission.result.errorMessage,
        output: submission.result.output,
        executionTime: submission.result.executionTime,
        memory: submission.result.memory,
      } : null,
      explanation: submission.result?.explanation ? {
        summary: submission.result.explanation.summary,
        cause: submission.result.explanation.cause,
        location: submission.result.explanation.location,
        explanation: submission.result.explanation.explanation,
        suggestion: submission.result.explanation.suggestion,
        correctedCode: submission.result.explanation.correctedCode,
      } : null,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createSubmission,
  getSubmissions,
  getSubmissionById,
};
