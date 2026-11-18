"use strict";

/**
 * @typedef {Object} ContextCollectionResult
 * @property {boolean} isSensitive
 * @property {string} [sensitiveReason]
 * @property {AnalyzeRequest} [payload]
 */
/**
 * Context Collector
 * Gathers comprehensive, bounded debugging context from VS Code documents:
 * 1. Diagnostic details (start/end lines and columns, message, code)
 * 2. Active file language and relative path
 * 3. Surrounding code window (25-30 lines before and after error)
 * 4. Active user selection & cursor coordinates
 * 5. Enclosing function context
 * 6. Top-of-file imports
 * 7. Workspace dependencies
 * 8. Strict sensitive file protection and secret redaction
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
exports.collectDocumentContext = collectDocumentContext;
exports.collectActiveContext = collectActiveContext;
const vscode = __importStar(require("vscode"));
const redact_1 = require("./redact");
const windowing_1 = require("./windowing");
const codeStructure_1 = require("./codeStructure");
const diagnosticUtils_1 = require("../diagnostics/diagnosticUtils");
/**
 * Safely reads workspace dependencies from package.json if present.
 */
async function getWorkspaceDependencies() {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return undefined;
        const pkgUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'package.json');
        const bytes = await vscode.workspace.fs.readFile(pkgUri);
        const content = new TextDecoder().decode(bytes);
        const json = JSON.parse(content);
        const merged = {};
        if (json.dependencies)
            Object.assign(merged, json.dependencies);
        if (json.devDependencies)
            Object.assign(merged, json.devDependencies);
        return Object.keys(merged).length > 0 ? merged : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Collects context from any vscode.TextDocument (even closed files opened in background).
 */
async function collectDocumentContext(document, options) {
    const rawRelativePath = vscode.workspace.asRelativePath(document.uri, false);
    // Normalize path to relative forward-slash format
    const relativePath = rawRelativePath.replace(/\\/g, '/');
    // 1. Check for sensitive files
    if ((0, redact_1.isSensitiveFile)(relativePath)) {
        return {
            isSensitive: true,
            sensitiveReason: `Bugify skipped "${relativePath}" because it matches sensitive file patterns (.env, keys, credentials). Code from this file is never sent.`,
        };
    }
    // 2. Coordinates
    const cursorLine = options.cursorLine || (options.targetDiagnostic ? options.targetDiagnostic.startLine : 1);
    const cursorColumn = options.cursorColumn || (options.targetDiagnostic ? options.targetDiagnostic.startColumn : 1);
    // 3. Selection
    const rawSelection = options.selection || '';
    const cappedSelection = (0, windowing_1.capSelection)(rawSelection, 16000);
    const redactedSelection = (0, redact_1.redactSecrets)(cappedSelection);
    // 4. Target line for windowing and function context
    const targetLine = options.targetDiagnostic
        ? options.targetDiagnostic.startLine
        : cursorLine;
    const fullContent = document.getText();
    const language = document.languageId || 'plaintext';
    // 5. Surrounding code window (25 lines before and after by default)
    const contextLinesCount = options.contextLines ?? 25;
    const windowResult = (0, windowing_1.extractCodeWindow)({
        content: fullContent,
        targetLine,
        contextLines: contextLinesCount,
        selectionText: rawSelection,
        maxChars: 64000,
    });
    const redactedCodeContext = (0, redact_1.redactSecrets)(windowResult.codeContext);
    // 6. Enclosing function context
    const rawFunctionContext = (0, codeStructure_1.extractEnclosingFunction)(fullContent, targetLine, language);
    const redactedFunctionContext = rawFunctionContext ? (0, redact_1.redactSecrets)(rawFunctionContext) : undefined;
    // 7. Top-of-file imports
    const rawImports = (0, codeStructure_1.extractTopImports)(fullContent, language);
    const redactedImports = rawImports ? (0, redact_1.redactSecrets)(rawImports) : undefined;
    // 8. Diagnostics
    let diagnosticsToSend = [];
    if (options.mode === 'analyze_error') {
        if (options.targetDiagnostic) {
            diagnosticsToSend = [options.targetDiagnostic];
        }
        else if (options.allFileDiagnostics && options.allFileDiagnostics.length > 0) {
            diagnosticsToSend = options.allFileDiagnostics;
        }
    }
    // 9. Workspace info & dependencies
    const workspaceName = vscode.workspace.name || 'workspace';
    const dependencies = await getWorkspaceDependencies();
    const payload = {
        mode: options.mode,
        detail: options.detail || 'normal',
        workspace: {
            name: workspaceName,
        },
        file: {
            path: relativePath,
            language,
        },
        cursor: {
            line: cursorLine,
            column: cursorColumn,
        },
        selection: redactedSelection,
        codeContext: redactedCodeContext,
        // Inclusive, 1-based absolute file lines. Diagnostic/cursor positions
        // are also 1-based; their end position is exclusive.
        codeContextStartLine: windowResult.startLine,
        codeContextEndLine: windowResult.endLine,
        functionContext: redactedFunctionContext,
        imports: redactedImports,
        dependencies,
        diagnostic: options.targetDiagnostic || diagnosticsToSend[0],
        diagnostics: diagnosticsToSend,
    };
    return {
        isSensitive: false,
        payload,
    };
}
/**
 * Gathers context from the active editor.
 */
async function collectActiveContext(editor, options) {
    const cursorZero = editor.selection.active;
    const cursor = (0, diagnosticUtils_1.convertTo1Based)(cursorZero.line, cursorZero.character);
    const rawSelection = editor.document.getText(editor.selection);
    return collectDocumentContext(editor.document, {
        ...options,
        cursorLine: cursor.line,
        cursorColumn: cursor.column,
        selection: rawSelection,
    });
}
