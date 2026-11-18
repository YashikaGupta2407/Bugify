"use strict";
/**
 * Bugify Workspace Scanner - Main Orchestrator
 * Coordinates Layer 1 (VS Code diagnostics) and Layer 2-5 (Project Static Analyzers).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceScanner = void 0;
const vscode = __importStar(require("vscode"));
const projectDetector_1 = require("./projectDetector");
const tscAnalyzer_1 = require("./analyzers/tscAnalyzer");
const eslintAnalyzer_1 = require("./analyzers/eslintAnalyzer");
const pythonAnalyzer_1 = require("./analyzers/pythonAnalyzer");
const normalizer_1 = require("./normalizer");
const diagnosticUtils_1 = require("../diagnostics/diagnosticUtils");
const logger_1 = require("../logger");
class WorkspaceScanner {
    context;
    lastResult = null;
    isScanning = false;
    activeCancellationToken = null;
    onScanCompleteEmitter = new vscode.EventEmitter();
    onScanComplete = this.onScanCompleteEmitter.event;
    constructor(context) {
        this.context = context;
    }
    getLastResult() {
        return this.lastResult;
    }
    cancelScan() {
        if (this.activeCancellationToken) {
            this.activeCancellationToken.isCancellationRequested = true;
            logger_1.logger.log('[Bugify] Workspace scan cancellation requested');
        }
    }
    /**
     * Executes a complete workspace scan across all workspace folders.
     */
    async scan(progressCallback) {
        if (this.isScanning) {
            this.cancelScan();
        }
        this.isScanning = true;
        const token = { isCancellationRequested: false };
        this.activeCancellationToken = token;
        const startTime = Date.now();
        logger_1.logger.log('[Bugify] Workspace scan started');
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        if (workspaceFolders.length === 0) {
            logger_1.logger.log('[Bugify] No workspace folders open');
            const emptyResult = {
                issues: [],
                analyzers: [],
                scannedAt: new Date(),
                summary: { totalIssues: 0, errorCount: 0, warningCount: 0, infoCount: 0, fileCount: 0 },
                stateMessage: '⚠ No workspace folder open.',
                durationMs: 0,
            };
            this.lastResult = emptyResult;
            this.isScanning = false;
            return emptyResult;
        }
        const allRawIssues = [];
        const analyzerStatuses = [];
        // ----------------------------------------------------
        // LAYER 1: Collect existing VS Code diagnostics
        // ----------------------------------------------------
        const vsCodeIssues = this.collectVsCodeDiagnostics();
        allRawIssues.push(...vsCodeIssues);
        logger_1.logger.log(`[Bugify] Layer 1 (VS Code diagnostics): found ${vsCodeIssues.length} issue(s)`);
        // ----------------------------------------------------
        // LAYER 2-4: Run project static analyzers per workspace folder
        // ----------------------------------------------------
        for (const folder of workspaceFolders) {
            if (token.isCancellationRequested)
                break;
            const wsRoot = folder.uri.fsPath;
            logger_1.logger.log(`[Bugify] Workspace root: ${wsRoot}`);
            const capabilities = await (0, projectDetector_1.detectProjectCapabilities)(wsRoot);
            // 1. TypeScript Analyzer
            if (capabilities.hasTypeScript) {
                logger_1.logger.log('[Bugify] Detected TypeScript project');
                if (progressCallback) {
                    progressCallback({
                        name: 'TypeScript',
                        type: 'tsc',
                        status: 'running',
                        issueCount: 0,
                        message: 'Running tsc --noEmit...',
                    });
                }
                const tscRes = await (0, tscAnalyzer_1.runTscAnalyzer)(wsRoot, capabilities.tsconfigPaths, capabilities.sourceFiles, token);
                allRawIssues.push(...tscRes.issues);
                analyzerStatuses.push(tscRes.status);
                if (progressCallback)
                    progressCallback(tscRes.status);
            }
            else {
                analyzerStatuses.push({
                    name: 'TypeScript',
                    type: 'tsc',
                    status: 'not_configured',
                    issueCount: 0,
                    message: 'No TypeScript or JavaScript files found.',
                });
            }
            // 2. ESLint Analyzer
            if (capabilities.hasESLint) {
                logger_1.logger.log('[Bugify] Detected ESLint');
                if (progressCallback) {
                    progressCallback({
                        name: 'ESLint',
                        type: 'eslint',
                        status: 'running',
                        issueCount: 0,
                        message: 'Running eslint...',
                    });
                }
                const eslintRes = await (0, eslintAnalyzer_1.runEslintAnalyzer)(wsRoot, capabilities.hasESLint, capabilities.eslintConfigPath, capabilities.eslintExecutable, token);
                allRawIssues.push(...eslintRes.issues);
                analyzerStatuses.push(eslintRes.status);
                if (progressCallback)
                    progressCallback(eslintRes.status);
            }
            else {
                analyzerStatuses.push({
                    name: 'ESLint',
                    type: 'eslint',
                    status: 'not_configured',
                    issueCount: 0,
                    message: 'No ESLint configuration found.',
                });
            }
            // 3. Python Analyzer
            if (capabilities.hasPython) {
                logger_1.logger.log('[Bugify] Detected Python files');
                if (progressCallback) {
                    progressCallback({
                        name: 'Python',
                        type: 'pyright',
                        status: 'running',
                        issueCount: 0,
                        message: 'Running Python analyzer...',
                    });
                }
                const pyRes = await (0, pythonAnalyzer_1.runPythonAnalyzer)(wsRoot, capabilities.hasPython, capabilities.pythonSourceFiles, token);
                allRawIssues.push(...pyRes.issues);
                analyzerStatuses.push(pyRes.status);
                if (progressCallback)
                    progressCallback(pyRes.status);
            }
            else {
                analyzerStatuses.push({
                    name: 'Python',
                    type: 'pyright',
                    status: 'not_configured',
                    issueCount: 0,
                    message: 'No Python files found.',
                });
            }
        }
        // ----------------------------------------------------
        // LAYER 5: Normalization, Deduplication & Summarization
        // ----------------------------------------------------
        const unifiedIssues = (0, normalizer_1.normalizeAndDeduplicateIssues)(allRawIssues);
        logger_1.logger.log(`[Bugify] Total normalized issues: ${unifiedIssues.length}`);
        // Attach proper file URIs to issues
        for (const issue of unifiedIssues) {
            if (!issue.uri) {
                for (const folder of workspaceFolders) {
                    const candidateUri = vscode.Uri.joinPath(folder.uri, issue.filePath);
                    issue.uri = candidateUri.toString();
                    break;
                }
            }
        }
        let errorCount = 0;
        let warningCount = 0;
        let infoCount = 0;
        const fileSet = new Set();
        for (const issue of unifiedIssues) {
            if (issue.severity === 'error')
                errorCount++;
            else if (issue.severity === 'warning')
                warningCount++;
            else
                infoCount++;
            fileSet.add(issue.filePath);
        }
        const durationMs = Date.now() - startTime;
        const stateMessage = (0, normalizer_1.buildStateMessage)(unifiedIssues.length, analyzerStatuses);
        const scanResult = {
            issues: unifiedIssues,
            analyzers: analyzerStatuses,
            scannedAt: new Date(),
            summary: {
                totalIssues: unifiedIssues.length,
                errorCount,
                warningCount,
                infoCount,
                fileCount: fileSet.size,
            },
            stateMessage,
            durationMs,
        };
        logger_1.logger.log(`[Bugify] Scan complete in ${durationMs}ms: ${stateMessage}`);
        this.lastResult = scanResult;
        this.isScanning = false;
        this.activeCancellationToken = null;
        this.onScanCompleteEmitter.fire(scanResult);
        return scanResult;
    }
    /**
     * Reads existing VS Code diagnostics into BugifyIssue format.
     */
    collectVsCodeDiagnostics() {
        const rawAll = vscode.languages.getDiagnostics();
        const issues = [];
        for (const [uri, diags] of rawAll) {
            const relPath = vscode.workspace.asRelativePath(uri, false);
            if (!(0, normalizer_1.isWorkspaceRelevantPath)(relPath) || !diags || diags.length === 0) {
                continue;
            }
            for (const d of diags) {
                const start = (0, diagnosticUtils_1.convertTo1Based)(d.range.start.line, d.range.start.character);
                const end = (0, diagnosticUtils_1.convertTo1Based)(d.range.end.line, d.range.end.character);
                const severity = d.severity === vscode.DiagnosticSeverity.Error
                    ? 'error'
                    : d.severity === vscode.DiagnosticSeverity.Warning
                        ? 'warning'
                        : 'info';
                const code = typeof d.code === 'object'
                    ? String(d.code?.value)
                    : d.code !== undefined
                        ? String(d.code)
                        : undefined;
                issues.push({
                    id: `vscode-${relPath}:${start.line}:${start.column}:${code || ''}`,
                    filePath: relPath,
                    line: start.line,
                    column: start.column,
                    endLine: end.line,
                    endColumn: end.column,
                    severity,
                    message: d.message,
                    source: d.source || 'vscode',
                    code,
                    analyzer: 'vscode',
                    uri: uri.toString(),
                });
            }
        }
        return issues;
    }
}
exports.WorkspaceScanner = WorkspaceScanner;
