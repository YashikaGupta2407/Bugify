// backend/src/controllers/extensionController.js
// Handles VS Code extension requests: validation, error classification, AI/rules analysis, and session persistence.
const prisma = require('../prisma');
const { classifyDiagnostic } = require('../services/errorClassifier');
const { explainExtensionDiagnostic } = require('../services/aiExplanationService');

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100 KB max payload limit

/**
 * POST /api/extension/analyze
 * Analyzes diagnostics and context sent from the VS Code extension.
 */
async function analyzeDiagnostic(req, res, next) {
  try {
    // 1. Enforce payload size limit defensively
    const payloadStr = JSON.stringify(req.body || {});
    if (Buffer.byteLength(payloadStr, 'utf8') > MAX_PAYLOAD_BYTES) {
      return res.status(400).json({
        error: 'Payload exceeds maximum limit of 100 KB',
        status: 'bad_request',
      });
    }

    const {
      mode = 'analyze_error',
      detail = 'normal',
      workspace,
      file,
      cursor,
      selection,
      codeContext,
      functionContext,
      imports,
      dependencies,
      diagnostic,
      diagnostics = [],
    } = req.body || {};

    // 2. Input validation
    if (mode !== 'analyze_error' && mode !== 'analyze_code') {
      return res.status(400).json({
        error: "Mode must be either 'analyze_error' or 'analyze_code'",
        status: 'bad_request',
      });
    }

    if (!file || typeof file.path !== 'string' || !file.path.trim()) {
      return res.status(400).json({
        error: "File object with a valid 'path' is required",
        status: 'bad_request',
      });
    }

    if (!file.language || typeof file.language !== 'string') {
      return res.status(400).json({
        error: "File object must specify a 'language'",
        status: 'bad_request',
      });
    }

    if (mode === 'analyze_error' && !diagnostic && (!Array.isArray(diagnostics) || diagnostics.length === 0)) {
      return res.status(400).json({
        error: "A diagnostic object or non-empty diagnostics array is required in 'analyze_error' mode",
        status: 'bad_request',
      });
    }

    // 3. Classify error from diagnostic (or code inspection)
    const primaryDiag = diagnostic || (diagnostics && diagnostics.length > 0 ? diagnostics[0] : null);
    const severity = primaryDiag?.severity || (mode === 'analyze_error' ? 'error' : 'info');

    let errorType = 'CodeInspection';
    if (primaryDiag) {
      errorType = classifyDiagnostic({
        message: primaryDiag.message,
        source: primaryDiag.source,
        code: primaryDiag.code,
        language: file.language,
      });
    }

    // 4. Retrieve demo user (temporary until full auth is added)
    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@bugify.dev' },
    });

    if (!demoUser) {
      return res.status(500).json({
        error: 'Demo user not found. Please ensure database seed has run.',
        status: 'server_error',
      });
    }

    // 5. Generate AI or deterministic rule-based analysis
    const analysis = await explainExtensionDiagnostic({
      mode,
      detail,
      workspace,
      file,
      cursor,
      selection,
      codeContext,
      functionContext,
      imports,
      dependencies,
      diagnostic: primaryDiag,
      diagnostics,
      errorType,
      language: file.language,
      severity,
    });

    // 6. Persist to PostgreSQL ExtensionDebugSession
    const session = await prisma.extensionDebugSession.create({
      data: {
        userId: demoUser.id,
        workspaceName: workspace?.name || null,
        filePath: file.path,
        language: file.language,
        errorType: analysis.errorType || errorType,
        errorMessage: primaryDiag?.message || analysis.summary,
        diagnosticCode: primaryDiag?.code ? String(primaryDiag.code) : null,
        diagnosticSource: primaryDiag?.source || null,
        line: analysis.location?.startLine || analysis.location?.line || primaryDiag?.startLine || cursor?.line || null,
        severity: analysis.severity || severity,
        analysisSource: analysis.analysisSource,
        aiExplanation: analysis,
        resolved: false,
      },
    });

    // 7. Return predictable, full structured response contract
    return res.status(200).json({
      sessionId: session.id,
      analysisSource: analysis.analysisSource,
      status: analysis.status || 'fixed',
      errorType: analysis.errorType,
      title: analysis.title || analysis.errorType,
      location: analysis.location,
      summary: analysis.summary,
      rootCause: analysis.rootCause || analysis.cause,
      whyItHappens: analysis.whyItHappens || analysis.explanation,
      originalCode: analysis.originalCode || '',
      correctedCode: analysis.correctedCode,
      changes: analysis.changes || [],
      explanation: analysis.explanation,
      confidence: analysis.confidence || 0.9,
      validation: analysis.validation || { status: 'generated', message: 'Analysis generated' },
      severity: analysis.severity,
      // Backward compatibility
      cause: analysis.cause || analysis.rootCause,
      suggestion: analysis.suggestion || analysis.explanation,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/extension/sessions
 * Retrieves recent extension debug sessions for the dashboard.
 */
async function getExtensionSessions(req, res, next) {
  try {
    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@bugify.dev' },
    });

    if (!demoUser) {
      return res.status(200).json([]);
    }

    const sessions = await prisma.extensionDebugSession.findMany({
      where: { userId: demoUser.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.status(200).json(sessions);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/extension/stats
 * Retrieves diagnostic counts grouped by errorType.
 */
async function getExtensionStats(req, res, next) {
  try {
    const demoUser = await prisma.user.findUnique({
      where: { email: 'demo@bugify.dev' },
    });

    if (!demoUser) {
      return res.status(200).json({});
    }

    const grouped = await prisma.extensionDebugSession.groupBy({
      by: ['errorType'],
      where: { userId: demoUser.id },
      _count: {
        errorType: true,
      },
    });

    const stats = {};
    for (const item of grouped) {
      stats[item.errorType || 'Unknown'] = item._count.errorType;
    }

    return res.status(200).json({
      total: await prisma.extensionDebugSession.count({ where: { userId: demoUser.id } }),
      byErrorType: stats,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  analyzeDiagnostic,
  getExtensionSessions,
  getExtensionStats,
};
