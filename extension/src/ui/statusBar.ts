/**
 * Status Bar Item for Bugify
 * Displays clean state: "BUGIFY"
 * Or issue state: "BUGIFY N" with accent text color.
 * Clicking opens the Bugify debugging panel via command: bugify.openPanel.
 */

import * as vscode from 'vscode';
import { DiagnosticCollector } from '../diagnostics/diagnosticCollector';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { logger } from '../logger';

export class BugifyStatusBar {
  private item: vscode.StatusBarItem;
  private lastScanCount: number | null = null;
  private lastScanErrorCount = 0;
  private lastScanWarningCount = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private collector: DiagnosticCollector,
    private scanner?: WorkspaceScanner
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'bugify.openPanel';
    context.subscriptions.push(this.item);

    // Update whenever VS Code live diagnostics change
    collector.onDiagnosticsChanged(() => {
      this.update();
    });

    // Update whenever full workspace scanner completes
    if (scanner) {
      scanner.onScanComplete((result) => {
        this.lastScanCount = result.summary.totalIssues;
        this.lastScanErrorCount = result.summary.errorCount;
        this.lastScanWarningCount = result.summary.warningCount;
        this.update();
      });
    }

    this.update();
    this.item.show();
    logger.log('[Bugify] Status bar initialized');
  }

  public update(): void {
    // If a workspace scan has been performed, use the workspace scan count as ground truth
    // Otherwise fallback to currently published VS Code diagnostics
    let count: number;
    let errorCount: number;
    let warningCount: number;

    if (this.lastScanCount !== null) {
      count = this.lastScanCount;
      errorCount = this.lastScanErrorCount;
      warningCount = this.lastScanWarningCount;
    } else {
      const summary = this.collector.getGlobalSummary();
      count = summary.totalCount;
      errorCount = summary.errorCount;
      warningCount = summary.warningCount;
    }

    if (count > 0) {
      this.item.text = `BUGIFY ${count}`;
      this.item.tooltip = `Bugify: ${count} workspace issue${count === 1 ? '' : 's'} (${errorCount} error${errorCount === 1 ? '' : 's'}, ${warningCount} warning${warningCount === 1 ? '' : 's'}). Click to open Bugify.`;
      this.item.color = '#FF6A00';
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `BUGIFY`;
      this.item.tooltip = 'Bugify: Workspace analyzed. Click to open Bugify.';
      this.item.color = undefined;
      this.item.backgroundColor = undefined;
    }
  }

  public setScanCount(count: number, errorCount: number, warningCount: number): void {
    this.lastScanCount = count;
    this.lastScanErrorCount = errorCount;
    this.lastScanWarningCount = warningCount;
    this.update();
  }

  public dispose(): void {
    this.item.dispose();
  }
}
