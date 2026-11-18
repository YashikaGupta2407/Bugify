"use strict";

/**
 * @typedef {Object} BugifyDiagnostic
 * @property {'error' | 'warning' | 'information' | 'hint'} severity
 * @property {string} message
 * @property {string} [source]
 * @property {string} [code]
 * @property {number} startLine
 * @property {number} startColumn
 * @property {number} endLine
 * @property {number} endColumn
 * @property {string} [filePath]
 * @property {string} [uri]
 * @property {ErrorCategory} [category]
 */

/** @typedef {'SYNTAX' | 'TYPE' | 'REFERENCE' | 'IMPORT' | 'NULL / UNDEFINED' | 'LOGIC' | 'ASYNC' | 'API' | 'DATABASE' | 'CONFIGURATION' | 'LINT' | 'RUNTIME' | 'SECURITY' | 'UNKNOWN'} ErrorCategory */

/**
 * @typedef {Object} CodeChange
 * @property {number} line
 * @property {string} before
 * @property {string} after
 * @property {string} reason
 */

/**
 * @typedef {Object} FixValidationResult
 * @property {'validated' | 'generated' | 'needs_context' | 'validation_failed' | 'cannot_fix'} status
 * @property {string} message
 * @property {string} [checkerUsed]
 */

/**
 * @typedef {Object} AnalyzeRequest
 * @property {'analyze_error' | 'analyze_code'} mode
 * @property {'normal' | 'deep'} detail
 * @property {{ name: string; }} [workspace]
 * @property {{ path: string; language: string; }} file
 * @property {{ line: number; column: number; }} [cursor]
 * @property {string} [selection]
 * @property {string} codeContext
 * @property {string} [functionContext]
 * @property {string} [imports]
 * @property {Record<string, string>} [dependencies]
 * @property {BugifyDiagnostic} [diagnostic]
 * @property {BugifyDiagnostic[]} [diagnostics]
 */

/**
 * @typedef {Object} AnalysisLocation
 * @property {string} file
 * @property {number} startLine
 * @property {number} [startColumn]
 * @property {number} [endLine]
 * @property {number} [endColumn]
 * @property {number} [line]
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {number} [sessionId]
 * @property {'ai' | 'rules'} analysisSource
 * @property {'fixed' | 'needs_context' | 'cannot_fix'} status
 * @property {string} errorType
 * @property {ErrorCategory} [category]
 * @property {string} title
 * @property {AnalysisLocation} location
 * @property {string} summary
 * @property {string} rootCause
 * @property {string} whyItHappens
 * @property {string} [why]
 * @property {string} [recommendedAction]
 * @property {string} originalCode
 * @property {string | null} correctedCode
 * @property {CodeChange[]} changes
 * @property {string} explanation
 * @property {number} confidence
 * @property {'HIGH' | 'MEDIUM' | 'LOW'} [confidenceLevel]
 * @property {'VERIFIED' | 'NOT_VERIFIED'} [verificationStatus]
 * @property {FixValidationResult} validation
 * @property {'error' | 'warning' | 'info' | 'information' | 'hint'} [severity]
 * @property {string} [cause]
 * @property {string} [suggestion]
 */

/**
 * @typedef {Object} WorkspaceFileIssues
 * @property {string} filePath
 * @property {string} uri
 * @property {number} errorCount
 * @property {number} warningCount
 * @property {BugifyDiagnostic[]} diagnostics
 */

/**
 * @typedef {Object} WebviewIncomingMessage
 * @property {'run-analysis' | 'analyze-ai' | 'explain-more' | 'reveal-line' | 'copy-code' | 'apply-fix' | 'select-issue' | 'retry' | 'switch-mode' | 'scan-workspace' | 'open-issue' | 'explain-issue' | 'view-issue' | 'cancel-scan'} command
 * @property {'workspace' | 'current_file'} [mode]
 * @property {number} [diagnosticIndex]
 * @property {number} [index]
 * @property {number} [line]
 * @property {number} [column]
 * @property {number} [endLine]
 * @property {number} [endColumn]
 * @property {string} [file]
 * @property {string} [uri]
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [source]
 * @property {'error' | 'warning' | 'information' | 'hint' | string} [severity]
 * @property {string} [originalCode]
 * @property {'normal' | 'deep'} [detail]
 * @property {BugifyDiagnostic} [diagnostic]
 */
/**
 * Bugify TypeScript Data Types & Contracts
 */
Object.defineProperty(exports, "__esModule", { value: true });
