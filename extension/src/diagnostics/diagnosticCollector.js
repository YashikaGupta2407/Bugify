"use strict";
/**
 * VS Code Diagnostic Collector
 * Listens to language server diagnostics, debounces changes (300ms),
 * and translates diagnostics into normalized 1-based BugifyDiagnostic objects.
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
exports.DiagnosticCollector = void 0;
const vscode = __importStar(require("vscode"));
const redact_1 = require("../context/redact");
const diagnosticUtils_1 = require("./diagnosticUtils");
const logger_1 = require("../logger");
class DiagnosticCollector {
    context;
    debounceTimer = null;
    onDiagnosticsChangedEmitter = new vscode.EventEmitter();
    onDiagnosticsChanged = this.onDiagnosticsChangedEmitter.event;
    constructor(context) {
        this.context = context;
        // Listen to diagnostics change events with 300ms debounce
        const disposable = vscode.languages.onDidChangeDiagnostics(() => {
            this.triggerDebouncedUpdate();
        });
        context.subscriptions.push(disposable, this.onDiagnosticsChangedEmitter);
    }
    triggerDebouncedUpdate() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            logger_1.logger.log('[Bugify] Diagnostics changed');
            const summary = this.getGlobalSummary();
            logger_1.logger.log(`[Bugify] Found ${summary.totalCount} actionable issues (${summary.errorCount} errors, ${summary.warningCount} warnings) across workspace`);
            this.onDiagnosticsChangedEmitter.fire();
        }, 300);
    }
    /**
     * Determines if a URI belongs to the user's active workspace and is not an external/ignored file.
     */
    isWorkspaceRelevantFile(uri) {
        if (!uri || uri.scheme !== 'file') {
            return false;
        }
        const fsPath = uri.fsPath.replace(/\\/g, '/');
        // If workspace folders exist, verify file resides within at least one workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const isInside = workspaceFolders.some((f) => {
                const rootPath = f.uri.fsPath.replace(/\\/g, '/');
                return fsPath.startsWith(rootPath + '/') || fsPath === rootPath;
            });
            if (!isInside) {
                return false;
            }
        }
        // Exclude standard build, cache, and 3rd-party vendor folders
        if (fsPath.includes('/node_modules/') ||
            fsPath.includes('/.git/') ||
            fsPath.includes('/.vscode/') ||
            fsPath.includes('/.venv/') ||
            fsPath.includes('/venv/') ||
            fsPath.includes('/dist/') ||
            fsPath.includes('/build/') ||
            fsPath.includes('/out/') ||
            fsPath.includes('/.next/') ||
            fsPath.includes('/.turbo/') ||
            fsPath.includes('/target/')) {
            return false;
        }
        // Exclude sensitive files (.env, private keys, secrets)
        const relPath = vscode.workspace.asRelativePath(uri, false);
        if ((0, redact_1.isSensitiveFile)(relPath)) {
            return false;
        }
        return true;
    }
    /**
     * Retrieves normalized diagnostics for the active editor or a specific URI.
     * By default returns all diagnostics; pass actionableOnly = true to filter to Error/Warning.
     */
    getActiveFileDiagnostics(uri, actionableOnly = false) {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!targetUri) {
            return [];
        }
        const rawDiagnostics = vscode.languages.getDiagnostics(targetUri);
        const transformed = this.transformDiagnostics(rawDiagnostics, targetUri);
        const result = actionableOnly
            ? transformed.filter((d) => (0, diagnosticUtils_1.isActionableSeverity)(d.severity))
            : transformed;
        logger_1.logger.log(`[Bugify] Found ${result.length} diagnostics in ${vscode.workspace.asRelativePath(targetUri, false)}`);
        return result;
    }
    /**
     * Retrieves all diagnostics across the entire workspace, including unopened files.
     * Excludes non-actionable suggestions (Information and Hint) by default.
     */
    getWorkspaceDiagnostics(actionableOnly = true) {
        const allDiagnostics = vscode.languages.getDiagnostics();
        const results = [];
        for (const [uri, fileDiags] of allDiagnostics) {
            if (!this.isWorkspaceRelevantFile(uri) || !fileDiags || fileDiags.length === 0) {
                continue;
            }
            const transformed = this.transformDiagnostics(fileDiags, uri);
            const filtered = actionableOnly
                ? transformed.filter((d) => (0, diagnosticUtils_1.isActionableSeverity)(d.severity))
                : transformed;
            results.push(...filtered);
        }
        // Sort: errors first, then warnings, then file path and line number
        return results.sort((a, b) => {
            if (a.severity === 'error' && b.severity !== 'error')
                return -1;
            if (a.severity !== 'error' && b.severity === 'error')
                return 1;
            const fileCompare = (a.filePath || '').localeCompare(b.filePath || '');
            if (fileCompare !== 0)
                return fileCompare;
            return a.startLine - b.startLine;
        });
    }
    /**
     * Groups workspace diagnostics by file for clear workspace scan UI presentation.
     * Excludes non-actionable suggestions (Information and Hint) by default.
     */
    getWorkspaceIssuesByFile(actionableOnly = true) {
        const allDiagnostics = vscode.languages.getDiagnostics();
        const groups = [];
        for (const [uri, fileDiags] of allDiagnostics) {
            if (!this.isWorkspaceRelevantFile(uri) || !fileDiags || fileDiags.length === 0) {
                continue;
            }
            const transformed = this.transformDiagnostics(fileDiags, uri);
            const filtered = actionableOnly
                ? transformed.filter((d) => (0, diagnosticUtils_1.isActionableSeverity)(d.severity))
                : transformed;
            if (filtered.length === 0)
                continue;
            const relPath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
            let errorCount = 0;
            let warningCount = 0;
            for (const d of filtered) {
                if (d.severity === 'error') {
                    errorCount++;
                }
                else if (d.severity === 'warning') {
                    warningCount++;
                }
            }
            groups.push({
                filePath: relPath,
                uri: uri.toString(),
                errorCount,
                warningCount,
                diagnostics: filtered.sort((a, b) => a.startLine - b.startLine),
            });
        }
        // Sort files: files with errors first, then most issues, then alphabetical
        return groups.sort((a, b) => {
            if (a.errorCount > 0 && b.errorCount === 0)
                return -1;
            if (a.errorCount === 0 && b.errorCount > 0)
                return 1;
            const totalA = a.errorCount + a.warningCount;
            const totalB = b.errorCount + b.warningCount;
            if (totalA !== totalB)
                return totalB - totalA;
            return a.filePath.localeCompare(b.filePath);
        });
    }
    /**
     * Retrieves global diagnostic summary counts across all workspace files.
     * totalCount represents actionable issues (errors + warnings), excluding informational hints.
     */
    getGlobalSummary() {
        const allDiagnostics = vscode.languages.getDiagnostics();
        let errorCount = 0;
        let warningCount = 0;
        for (const [uri, fileDiags] of allDiagnostics) {
            if (!this.isWorkspaceRelevantFile(uri)) {
                continue;
            }
            for (const diag of fileDiags) {
                if (diag.severity === vscode.DiagnosticSeverity.Error) {
                    errorCount++;
                }
                else if (diag.severity === vscode.DiagnosticSeverity.Warning) {
                    warningCount++;
                }
            }
        }
        return { errorCount, warningCount, totalCount: errorCount + warningCount };
    }
    /**
     * Transforms VS Code Diagnostic array into normalized BugifyDiagnostic array.
     * Converts 0-based VS Code line/char coordinates to 1-based positions.
     */
    transformDiagnostics(rawDiagnostics, targetUri) {
        const relativePath = targetUri
            ? vscode.workspace.asRelativePath(targetUri, false).replace(/\\/g, '/')
            : undefined;
        return rawDiagnostics.map((d) => {
            const start = (0, diagnosticUtils_1.convertTo1Based)(d.range.start.line, d.range.start.character);
            const end = (0, diagnosticUtils_1.convertTo1Based)(d.range.end.line, d.range.end.character);
            return {
                severity: (0, diagnosticUtils_1.mapDiagnosticSeverity)(d.severity),
                message: d.message,
                source: d.source || 'compiler',
                code: (0, diagnosticUtils_1.normalizeDiagnosticCode)(d.code),
                startLine: start.line,
                startColumn: start.column,
                endLine: end.line,
                endColumn: end.column,
                filePath: relativePath,
                uri: targetUri?.toString(),
            };
        });
    }
    dispose() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}
exports.DiagnosticCollector = DiagnosticCollector;
