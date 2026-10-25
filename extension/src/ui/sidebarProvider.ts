/**
 * Bugify Sidebar View Provider
 * Provides the Bugify scanning and debugging interface in the VS Code Activity Bar / Left Sidebar.
 */

import * as vscode from 'vscode';
import { BugifyPanel } from './bugifyPanel';
import { BugifyApiClient } from '../api/bugifyApi';
import { DiagnosticCollector } from '../diagnostics/diagnosticCollector';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { logger } from '../logger';

export class BugifySidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'bugify.sidebarView';
  public static currentProvider?: BugifySidebarViewProvider;

  private _view?: vscode.WebviewView;
  private _panel?: BugifyPanel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly apiClient: BugifyApiClient,
    private readonly diagnosticCollector: DiagnosticCollector,
    private readonly workspaceScanner?: WorkspaceScanner
  ) {
    BugifySidebarViewProvider.currentProvider = this;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    try {
      logger.log('[Bugify] Resolving Bugify sidebar WebviewView');
      this._view = webviewView;

      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [this.extensionUri],
      };

      this._panel = BugifyPanel.createForWebviewView(
        webviewView,
        this.extensionUri,
        this.apiClient,
        this.diagnosticCollector,
        this.workspaceScanner
      );

      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          this._panel?.refreshWorkspaceData();
          this._panel?.render();
        }
      });

      webviewView.onDidDispose(() => {
        logger.log('[Bugify] Sidebar WebviewView disposed');
        this._panel?.dispose();
        this._panel = undefined;
        this._view = undefined;
      });
    } catch (err: any) {
      logger.log(`[Bugify] Error resolving sidebar WebviewView: ${err?.message || err}`);
      webviewView.webview.html = `<!DOCTYPE html><html><body style="padding:16px;color:#F5F5F5;background:#070707;font-family:sans-serif;"><h3>Bugify</h3><p style="color:#FF6A00;">Initialization error: ${err?.message || err}</p></body></html>`;
    }
  }

  public getPanel(): BugifyPanel | undefined {
    return this._panel;
  }

  public getView(): vscode.WebviewView | undefined {
    return this._view;
  }
}
