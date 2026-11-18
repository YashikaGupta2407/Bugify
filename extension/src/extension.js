"use strict";
/**
 * Bugify VS Code Extension - Entry Point
 * Registers commands, diagnostic listener, status bar, and code actions provider.
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const diagnosticCollector_1 = require("./diagnostics/diagnosticCollector");
const workspaceScanner_1 = require("./scanner/workspaceScanner");
const bugifyApi_1 = require("./api/bugifyApi");
const bugifyPanel_1 = require("./ui/bugifyPanel");
const sidebarProvider_1 = require("./ui/sidebarProvider");
const statusBar_1 = require("./ui/statusBar");
const codeActions_1 = require("./ui/codeActions");
const diagnosticUtils_1 = require("./diagnostics/diagnosticUtils");
const logger_1 = require("./logger");
function activate(context) {
    logger_1.logger.init();
    logger_1.logger.log('[Bugify] Extension activated');
    const diagnosticCollector = new diagnosticCollector_1.DiagnosticCollector(context);
    const workspaceScanner = new workspaceScanner_1.WorkspaceScanner(context);
    const apiClient = new bugifyApi_1.BugifyApiClient();
    const statusBar = new statusBar_1.BugifyStatusBar(context, diagnosticCollector, workspaceScanner);
    // Register Sidebar Webview View Provider (Activity Bar)
    const sidebarProvider = new sidebarProvider_1.BugifySidebarViewProvider(context.extensionUri, apiClient, diagnosticCollector, workspaceScanner);
    const sidebarDisposable = vscode.window.registerWebviewViewProvider(sidebarProvider_1.BugifySidebarViewProvider.viewType, sidebarProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    });
    context.subscriptions.push(sidebarDisposable);
    // Register CodeAction Provider ("Debug with Bugify" lightbulb / Ctrl+.)
    const codeActionDisposable = vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new codeActions_1.BugifyCodeActionProvider(), {
        providedCodeActionKinds: codeActions_1.BugifyCodeActionProvider.providedCodeActionKinds,
    });
    context.subscriptions.push(codeActionDisposable);
    // Command handler: Open or show panel
    const handleOpenPanel = async () => {
        logger_1.logger.log('[Bugify] Open command triggered');
        const panel = bugifyPanel_1.BugifyPanel.createOrShow(context.extensionUri, apiClient, diagnosticCollector, workspaceScanner);
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const fileDiagnostics = diagnosticCollector.getActiveFileDiagnostics(editor.document.uri, true);
            if (fileDiagnostics.length > 0) {
                const cursorLine = editor.selection.active.line + 1;
                const target = (0, diagnosticUtils_1.findDiagnosticAtCursor)(fileDiagnostics, cursorLine, editor.selection.active.character + 1) ||
                    (0, diagnosticUtils_1.findNearestDiagnostic)(fileDiagnostics, cursorLine);
                await panel.analyzeEditor(editor, 'analyze_error', target);
            }
            else {
                const lastScan = workspaceScanner.getLastResult();
                if (lastScan && lastScan.issues.length > 0) {
                    panel.showWorkspaceResults(lastScan);
                }
                else {
                    // Trigger workspace scan to discover project issues in closed files
                    await panel.scanWorkspace();
                }
            }
        }
        else {
            const lastScan = workspaceScanner.getLastResult();
            if (lastScan && lastScan.issues.length > 0) {
                panel.showWorkspaceResults(lastScan);
            }
            else {
                await panel.scanWorkspace();
            }
        }
    };
    // Command 1: bugify.openWorkspace (Primary workspace overview action)
    const openWorkspaceCommand = vscode.commands.registerCommand('bugify.openWorkspace', async () => {
        logger_1.logger.log('[Bugify] Open workspace command triggered');
        try {
            await vscode.commands.executeCommand('bugify.sidebarView.focus');
        }
        catch {
            // fallback if sidebar view is not active
        }
        const panel = bugifyPanel_1.BugifyPanel.createOrShow(context.extensionUri, apiClient, diagnosticCollector, workspaceScanner);
        panel.openWorkspaceView();
    });
    // Command 2: bugify.openPanel (Context-aware panel open)
    const openPanelCommand = vscode.commands.registerCommand('bugify.openPanel', handleOpenPanel);
    // Command 3: bugify.open (Alias)
    const openCommand = vscode.commands.registerCommand('bugify.open', async () => {
        vscode.commands.executeCommand('bugify.openWorkspace');
    });
    // Command 4: bugify.scanWorkspace (Workspace Scan)
    const scanWorkspaceCommand = vscode.commands.registerCommand('bugify.scanWorkspace', async () => {
        logger_1.logger.log('[Bugify] Scan workspace command triggered');
        const panel = bugifyPanel_1.BugifyPanel.createOrShow(context.extensionUri, apiClient, diagnosticCollector, workspaceScanner);
        await panel.scanWorkspace();
    });
    // Command 4: bugify.analyzeCurrentError
    const analyzeErrorCommand = vscode.commands.registerCommand('bugify.analyzeCurrentError', async (argDiagnostic) => {
        logger_1.logger.log('[Bugify] Analyze command triggered');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Bugify: Please open a code file to analyze.');
            return;
        }
        const panel = bugifyPanel_1.BugifyPanel.createOrShow(context.extensionUri, apiClient, diagnosticCollector, workspaceScanner);
        const fileDiagnostics = diagnosticCollector.getActiveFileDiagnostics(editor.document.uri, true);
        let targetDiagnostic;
        if (argDiagnostic) {
            if ('startLine' in argDiagnostic) {
                targetDiagnostic = argDiagnostic;
            }
            else {
                const transformed = diagnosticCollector.transformDiagnostics([argDiagnostic], editor.document.uri);
                targetDiagnostic = transformed[0];
            }
        }
        if (!targetDiagnostic) {
            const cursorLine = editor.selection.active.line + 1;
            const cursorCol = editor.selection.active.character + 1;
            targetDiagnostic =
                (0, diagnosticUtils_1.findDiagnosticAtCursor)(fileDiagnostics, cursorLine, cursorCol) ||
                    (0, diagnosticUtils_1.findNearestDiagnostic)(fileDiagnostics, cursorLine);
        }
        if (!targetDiagnostic && fileDiagnostics.length === 0) {
            panel.showCleanState();
            return;
        }
        await panel.analyzeEditor(editor, 'analyze_error', targetDiagnostic);
    });
    // Command 5: bugify.analyzeCurrentCode
    const analyzeCodeCommand = vscode.commands.registerCommand('bugify.analyzeCurrentCode', async () => {
        logger_1.logger.log('[Bugify] Analyze code command triggered');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Bugify: Please open a code file to analyze.');
            return;
        }
        const panel = bugifyPanel_1.BugifyPanel.createOrShow(context.extensionUri, apiClient, diagnosticCollector, workspaceScanner);
        await panel.analyzeEditor(editor, 'analyze_code');
    });
    // Command 6: bugify.refreshDiagnostics
    const refreshCommand = vscode.commands.registerCommand('bugify.refreshDiagnostics', () => {
        statusBar.update();
        const editor = vscode.window.activeTextEditor;
        if (editor && bugifyPanel_1.BugifyPanel.currentPanel) {
            vscode.commands.executeCommand('bugify.openPanel');
        }
    });
    context.subscriptions.push(openWorkspaceCommand, openPanelCommand, openCommand, scanWorkspaceCommand, analyzeErrorCommand, analyzeCodeCommand, refreshCommand, diagnosticCollector, statusBar, { dispose: () => logger_1.logger.dispose() });
}
function deactivate() {
    if (bugifyPanel_1.BugifyPanel.currentPanel) {
        bugifyPanel_1.BugifyPanel.currentPanel.dispose();
    }
    if (bugifyPanel_1.BugifyPanel.currentSidebarPanel) {
        bugifyPanel_1.BugifyPanel.currentSidebarPanel.dispose();
    }
}
