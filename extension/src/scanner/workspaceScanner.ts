/**
 * Bugify Workspace Scanner - Main Orchestrator
 * Coordinates Layer 1 (VS Code diagnostics) and Layer 2-5 (Project Static Analyzers).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  BugifyIssue,
  AnalyzerStatus,
  WorkspaceScanResult,
  ScanProgressCallback,
  CancellationToken,
} from './types';
import { detectProjectCapabilities } from './projectDetector';
import { runTscAnalyzer } from './analyzers/tscAnalyzer';
import { runEslintAnalyzer } from './analyzers/eslintAnalyzer';
import { runPythonAnalyzer } from './analyzers/pythonAnalyzer';
import {
  normalizeAndDeduplicateIssues,
  buildStateMessage,
  isWorkspaceRelevantPath,
} from './normalizer';
import { convertTo1Based } from '../diagnostics/diagnosticUtils';
import { logger } from '../logger';

export class WorkspaceScanner {
  private lastResult: WorkspaceScanResult | null = null;
  private isScanning = false;
  private activeCancellationToken: { isCancellationRequested: boolean } | null = null;

  private onScanCompleteEmitter = new vscode.EventEmitter<WorkspaceScanResult>();
  public readonly onScanComplete = this.onScanCompleteEmitter.event;

  constructor(private context: vscode.ExtensionContext) {}

  public getLastResult(): WorkspaceScanResult | null {
    return this.lastResult;
  }

  public cancelScan(): void {
    if (this.activeCancellationToken) {
      this.activeCancellationToken.isCancellationRequested = true;
      logger.log('[Bugify] Workspace scan cancellation requested');
    }
  }

  /**
   * Executes a complete workspace scan across all workspace folders.
   */
  public async scan(progressCallback?: ScanProgressCallback): Promise<WorkspaceScanResult> {
    if (this.isScanning) {
      this.cancelScan();
    }

    this.isScanning = true;
    const token: CancellationToken = { isCancellationRequested: false };
    this.activeCancellationToken = token;

    const startTime = Date.now();
    logger.log('[Bugify] Workspace scan started');

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    if (workspaceFolders.length === 0) {
      logger.log('[Bugify] No workspace folders open');
      const emptyResult: WorkspaceScanResult = {
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

    const allRawIssues: BugifyIssue[] = [];
    const analyzerStatuses: AnalyzerStatus[] = [];

    // ----------------------------------------------------
    // LAYER 1: Collect existing VS Code diagnostics
    // ----------------------------------------------------
    const vsCodeIssues = this.collectVsCodeDiagnostics();
    allRawIssues.push(...vsCodeIssues);
    logger.log(`[Bugify] Layer 1 (VS Code diagnostics): found ${vsCodeIssues.length} issue(s)`);

    // ----------------------------------------------------
    // LAYER 2-4: Run project static analyzers per workspace folder
    // ----------------------------------------------------
    for (const folder of workspaceFolders) {
      if (token.isCancellationRequested) break;

      const wsRoot = folder.uri.fsPath;
      logger.log(`[Bugify] Workspace root: ${wsRoot}`);

      const capabilities = await detectProjectCapabilities(wsRoot);

      // 1. TypeScript Analyzer
      if (capabilities.hasTypeScript) {
        logger.log('[Bugify] Detected TypeScript project');
        if (progressCallback) {
          progressCallback({
            name: 'TypeScript',
            type: 'tsc',
            status: 'running',
            issueCount: 0,
            message: 'Running tsc --noEmit...',
          });
        }

        const tscRes = await runTscAnalyzer(
          wsRoot,
          capabilities.tsconfigPaths,
          capabilities.tscExecutable,
          token
        );
        allRawIssues.push(...tscRes.issues);
        analyzerStatuses.push(tscRes.status);
        if (progressCallback) progressCallback(tscRes.status);
      } else {
        analyzerStatuses.push({
          name: 'TypeScript',
          type: 'tsc',
          status: 'not_configured',
          issueCount: 0,
          message: 'No tsconfig.json or jsconfig.json found.',
        });
      }

      // 2. ESLint Analyzer
      if (capabilities.hasESLint) {
        logger.log('[Bugify] Detected ESLint');
        if (progressCallback) {
          progressCallback({
            name: 'ESLint',
            type: 'eslint',
            status: 'running',
            issueCount: 0,
            message: 'Running eslint...',
          });
        }

        const eslintRes = await runEslintAnalyzer(
          wsRoot,
          capabilities.hasESLint,
          capabilities.eslintConfigPath,
          capabilities.eslintExecutable,
          token
        );
        allRawIssues.push(...eslintRes.issues);
        analyzerStatuses.push(eslintRes.status);
        if (progressCallback) progressCallback(eslintRes.status);
      } else {
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
        logger.log('[Bugify] Detected Python files');
        if (progressCallback) {
          progressCallback({
            name: 'Python',
            type: 'pyright',
            status: 'running',
            issueCount: 0,
            message: 'Running Python analyzer...',
          });
        }

        const pyRes = await runPythonAnalyzer(
          wsRoot,
          capabilities.hasPython,
          capabilities.pyrightExecutable,
          token
        );
        allRawIssues.push(...pyRes.issues);
        analyzerStatuses.push(pyRes.status);
        if (progressCallback) progressCallback(pyRes.status);
      } else {
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
    const unifiedIssues = normalizeAndDeduplicateIssues(allRawIssues);
    logger.log(`[Bugify] Total normalized issues: ${unifiedIssues.length}`);

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
    const fileSet = new Set<string>();

    for (const issue of unifiedIssues) {
      if (issue.severity === 'error') errorCount++;
      else if (issue.severity === 'warning') warningCount++;
      else infoCount++;
      fileSet.add(issue.filePath);
    }

    const durationMs = Date.now() - startTime;
    const stateMessage = buildStateMessage(unifiedIssues.length, analyzerStatuses);

    const scanResult: WorkspaceScanResult = {
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

    logger.log(`[Bugify] Scan complete in ${durationMs}ms: ${stateMessage}`);
    this.lastResult = scanResult;
    this.isScanning = false;
    this.activeCancellationToken = null;
    this.onScanCompleteEmitter.fire(scanResult);

    return scanResult;
  }

  /**
   * Reads existing VS Code diagnostics into BugifyIssue format.
   */
  private collectVsCodeDiagnostics(): BugifyIssue[] {
    const rawAll = vscode.languages.getDiagnostics();
    const issues: BugifyIssue[] = [];

    for (const [uri, diags] of rawAll) {
      const relPath = vscode.workspace.asRelativePath(uri, false);
      if (!isWorkspaceRelevantPath(relPath) || !diags || diags.length === 0) {
        continue;
      }

      for (const d of diags) {
        const start = convertTo1Based(d.range.start.line, d.range.start.character);
        const end = convertTo1Based(d.range.end.line, d.range.end.character);
        const severity: 'error' | 'warning' | 'info' =
          d.severity === vscode.DiagnosticSeverity.Error
            ? 'error'
            : d.severity === vscode.DiagnosticSeverity.Warning
            ? 'warning'
            : 'info';

        const code =
          typeof d.code === 'object'
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
