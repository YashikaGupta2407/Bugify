/**
 * Bugify VS Code Extension - Entry Point
 * Registers commands, diagnostic listener, status bar, and code actions provider.
 */

import * as vscode from 'vscode';
import { DiagnosticCollector } from './diagnostics/diagnosticCollector';
import { WorkspaceScanner } from './scanner/workspaceScanner';
import { BugifyApiClient } from './api/bugifyApi';
import { BugifyPanel } from './ui/bugifyPanel';
import { BugifyStatusBar } from './ui/statusBar';
import { BugifyCodeActionProvider } from './ui/codeActions';
import {
  findDiagnosticAtCursor,
  findNearestDiagnostic,
} from './diagnostics/diagnosticUtils';
import { BugifyDiagnostic } from './types/bugify';
import { logger } from './logger';

export function activate(context: vscode.ExtensionContext): void {
  logger.init();
  logger.log('[Bugify] Extension activated');

  const diagnosticCollector = new DiagnosticCollector(context);
  const workspaceScanner = new WorkspaceScanner(context);
  const apiClient = new BugifyApiClient();
  const statusBar = new BugifyStatusBar(context, diagnosticCollector, workspaceScanner);

  // Register CodeAction Provider ("Debug with Bugify" lightbulb / Ctrl+.)
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' },
    new BugifyCodeActionProvider(),
    {
      providedCodeActionKinds: BugifyCodeActionProvider.providedCodeActionKinds,
    }
  );
  context.subscriptions.push(codeActionDisposable);

  // Command handler: Open or show panel
  const handleOpenPanel = async () => {
    logger.log('[Bugify] Open command triggered');
    const panel = BugifyPanel.createOrShow(
      context.extensionUri,
      apiClient,
      diagnosticCollector,
      workspaceScanner
    );
    const editor = vscode.window.activeTextEditor;

    if (editor) {
      const fileDiagnostics = diagnosticCollector.getActiveFileDiagnostics(editor.document.uri, true);
      if (fileDiagnostics.length > 0) {
        const cursorLine = editor.selection.active.line + 1;
        const target =
          findDiagnosticAtCursor(fileDiagnostics, cursorLine, editor.selection.active.character + 1) ||
          findNearestDiagnostic(fileDiagnostics, cursorLine);
        await panel.analyzeEditor(editor, 'analyze_error', target);
      } else {
        const lastScan = workspaceScanner.getLastResult();
        if (lastScan && lastScan.issues.length > 0) {
          panel.showWorkspaceResults(lastScan);
        } else {
          // Trigger workspace scan to discover project issues in closed files
          await panel.scanWorkspace();
        }
      }
    } else {
      const lastScan = workspaceScanner.getLastResult();
      if (lastScan && lastScan.issues.length > 0) {
        panel.showWorkspaceResults(lastScan);
      } else {
        await panel.scanWorkspace();
      }
    }
  };

  // Command 1: bugify.openWorkspace (Primary workspace overview action)
  const openWorkspaceCommand = vscode.commands.registerCommand('bugify.openWorkspace', async () => {
    logger.log('[Bugify] Open workspace command triggered');
    const panel = BugifyPanel.createOrShow(
      context.extensionUri,
      apiClient,
      diagnosticCollector,
      workspaceScanner
    );
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
    logger.log('[Bugify] Scan workspace command triggered');
    const panel = BugifyPanel.createOrShow(
      context.extensionUri,
      apiClient,
      diagnosticCollector,
      workspaceScanner
    );
    await panel.scanWorkspace();
  });

  // Command 4: bugify.analyzeCurrentError
  const analyzeErrorCommand = vscode.commands.registerCommand(
    'bugify.analyzeCurrentError',
    async (argDiagnostic?: vscode.Diagnostic | BugifyDiagnostic) => {
      logger.log('[Bugify] Analyze command triggered');
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Bugify: Please open a code file to analyze.');
        return;
      }

      const panel = BugifyPanel.createOrShow(
        context.extensionUri,
        apiClient,
        diagnosticCollector,
        workspaceScanner
      );
      const fileDiagnostics = diagnosticCollector.getActiveFileDiagnostics(editor.document.uri, true);

      let targetDiagnostic: BugifyDiagnostic | undefined;

      if (argDiagnostic) {
        if ('startLine' in argDiagnostic) {
          targetDiagnostic = argDiagnostic as BugifyDiagnostic;
        } else {
          const transformed = diagnosticCollector.transformDiagnostics(
            [argDiagnostic as vscode.Diagnostic],
            editor.document.uri
          );
          targetDiagnostic = transformed[0];
        }
      }

      if (!targetDiagnostic) {
        const cursorLine = editor.selection.active.line + 1;
        const cursorCol = editor.selection.active.character + 1;

        targetDiagnostic =
          findDiagnosticAtCursor(fileDiagnostics, cursorLine, cursorCol) ||
          findNearestDiagnostic(fileDiagnostics, cursorLine);
      }

      if (!targetDiagnostic && fileDiagnostics.length === 0) {
        panel.showCleanState();
        return;
      }

      await panel.analyzeEditor(editor, 'analyze_error', targetDiagnostic);
    }
  );

  // Command 5: bugify.analyzeCurrentCode
  const analyzeCodeCommand = vscode.commands.registerCommand(
    'bugify.analyzeCurrentCode',
    async () => {
      logger.log('[Bugify] Analyze code command triggered');
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Bugify: Please open a code file to analyze.');
        return;
      }

      const panel = BugifyPanel.createOrShow(
        context.extensionUri,
        apiClient,
        diagnosticCollector,
        workspaceScanner
      );
      await panel.analyzeEditor(editor, 'analyze_code');
    }
  );

  // Command 6: bugify.refreshDiagnostics
  const refreshCommand = vscode.commands.registerCommand('bugify.refreshDiagnostics', () => {
    statusBar.update();
    const editor = vscode.window.activeTextEditor;
    if (editor && BugifyPanel.currentPanel) {
      vscode.commands.executeCommand('bugify.openPanel');
    }
  });

  context.subscriptions.push(
    openWorkspaceCommand,
    openPanelCommand,
    openCommand,
    scanWorkspaceCommand,
    analyzeErrorCommand,
    analyzeCodeCommand,
    refreshCommand,
    diagnosticCollector,
    statusBar,
    { dispose: () => logger.dispose() }
  );
}

export function deactivate(): void {
  if (BugifyPanel.currentPanel) {
    BugifyPanel.currentPanel.dispose();
  }
}
