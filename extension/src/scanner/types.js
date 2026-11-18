"use strict";

/**
 * @typedef {Object} BugifyIssue
 * @property {string} id
 * @property {string} filePath
 * @property {number} line
 * @property {number} column
 * @property {number} [endLine]
 * @property {number} [endColumn]
 * @property {'error' | 'warning' | 'information' | 'hint' | 'info'} severity
 * @property {ErrorCategory} [category]
 * @property {string} message
 * @property {string} source
 * @property {string} [code]
 * @property {'tsc' | 'eslint' | 'pyright' | 'vscode' | string} analyzer
 * @property {string} [uri]
 * @property {string} [rawOutput]
 */

/** @typedef {'tsc' | 'eslint' | 'pyright' | 'vscode'} AnalyzerType */

/** @typedef {'pending' | 'running' | 'completed' | 'not_configured' | 'timed_out' | 'failed'} AnalyzerRunStatus */

/**
 * @typedef {Object} AnalyzerStatus
 * @property {string} name
 * @property {AnalyzerType} type
 * @property {AnalyzerRunStatus} status
 * @property {number} issueCount
 * @property {string} [message]
 * @property {number} [durationMs]
 */

/**
 * @typedef {Object} ProjectCapabilities
 * @property {string} workspaceRoot
 * @property {boolean} hasTypeScript
 * @property {string[]} tsconfigPaths
 * @property {string} [tscExecutable]
 * @property {string[]} [sourceFiles]
 * @property {boolean} hasESLint
 * @property {string} [eslintConfigPath]
 * @property {string} [eslintExecutable]
 * @property {boolean} hasPython
 * @property {number} pythonFilesCount
 * @property {string[]} [pythonSourceFiles]
 * @property {string} [pyrightExecutable]
 */

/**
 * @typedef {Object} WorkspaceScanResult
 * @property {BugifyIssue[]} issues
 * @property {AnalyzerStatus[]} analyzers
 * @property {Date} scannedAt
 * @property {{ totalIssues: number; errorCount: number; warningCount: number; infoCount: number; fileCount: number; }} summary
 * @property {string} stateMessage
 * @property {number} durationMs
 */

/** @typedef {(status: AnalyzerStatus) => void} ScanProgressCallback */

/**
 * @typedef {Object} CancellationToken
 * @property {boolean} isCancellationRequested
 */
Object.defineProperty(exports, "__esModule", { value: true });
