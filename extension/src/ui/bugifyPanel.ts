/**
 * Bugify Webview Panel
 * Provides a minimal, premium, developer-focused debugging interface.
 * Implements local diagnostic display (never hangs or breaks when backend is offline),
 * explicit AI analysis trigger, strict CSP, zero external CDNs, theme awareness,
 * and copy-safe fix recommendations.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  AnalysisResult,
  BugifyDiagnostic,
  AnalyzeRequest,
  WorkspaceFileIssues,
} from '../types/bugify';
import { BugifyApiClient } from '../api/bugifyApi';
import { DiagnosticCollector } from '../diagnostics/diagnosticCollector';
import { collectActiveContext, collectDocumentContext } from '../context/contextCollector';
import { buildLocalAnalysis } from '../diagnostics/localAnalysis';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { BugifyIssue, AnalyzerStatus, WorkspaceScanResult } from '../scanner/types';
import { logger } from '../logger';

export interface PanelViewState {
  viewMode: 'workspace' | 'current_file';
  loading: boolean;
  aiAnalyzing: boolean;
  empty?: boolean;
  sensitive?: boolean;
  sensitiveReason?: string;
  errorMessage?: string;
  aiError?: string;
  canRetry?: boolean;
  issues: BugifyDiagnostic[];
  selectedIssueIndex: number;
  analysis?: AnalysisResult | null;
  activeFilePath?: string;
  workspaceGrouped: WorkspaceFileIssues[];
  workspaceTotalCount: number;
  // Layered Workspace Scan state
  isScanningWorkspace?: boolean;
  scanProgressList?: AnalyzerStatus[];
  workspaceScanResult?: WorkspaceScanResult | null;
  workspaceIssues?: BugifyIssue[];
}

export class BugifyPanel {
  public static currentPanel: BugifyPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private apiClient: BugifyApiClient;
  private diagnosticCollector: DiagnosticCollector;
  private workspaceScanner?: WorkspaceScanner;

  private state: PanelViewState = {
    viewMode: 'current_file',
    loading: false,
    aiAnalyzing: false,
    issues: [],
    selectedIssueIndex: 0,
    analysis: null,
    workspaceGrouped: [],
    workspaceTotalCount: 0,
    isScanningWorkspace: false,
    scanProgressList: [],
    workspaceIssues: [],
  };

  private lastRequestPayload: AnalyzeRequest | null = null;

  public static createOrShow(
    extensionUri: vscode.Uri,
    apiClient: BugifyApiClient,
    diagnosticCollector: DiagnosticCollector,
    workspaceScanner?: WorkspaceScanner
  ): BugifyPanel {
    const column = vscode.ViewColumn.Beside;

    if (BugifyPanel.currentPanel) {
      BugifyPanel.currentPanel.diagnosticCollector = diagnosticCollector;
      if (workspaceScanner) {
        BugifyPanel.currentPanel.workspaceScanner = workspaceScanner;
      }
      BugifyPanel.currentPanel.refreshWorkspaceData();
      BugifyPanel.currentPanel.render();
      BugifyPanel.currentPanel.panel.reveal(column);
      return BugifyPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'bugifyPanel',
      'Bugify',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    BugifyPanel.currentPanel = new BugifyPanel(
      panel,
      extensionUri,
      apiClient,
      diagnosticCollector,
      workspaceScanner
    );
    return BugifyPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    apiClient: BugifyApiClient,
    diagnosticCollector: DiagnosticCollector,
    workspaceScanner?: WorkspaceScanner
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.diagnosticCollector = diagnosticCollector;
    this.workspaceScanner = workspaceScanner;

    this.refreshWorkspaceData();
    this.render();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Auto-refresh when diagnostics change across the workspace
    this.diagnosticCollector.onDiagnosticsChanged(() => {
      this.refreshWorkspaceData();
      if (this.state.viewMode === 'workspace') {
        this.render();
      }
    }, null, this.disposables);

    // Handle messages coming from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'switch-mode':
            if (message.mode === 'workspace' || message.mode === 'current_file') {
              this.state.viewMode = message.mode;
              this.refreshWorkspaceData();
              this.render();
            }
            break;

          case 'scan-workspace':
            await this.scanWorkspace();
            break;

          case 'cancel-scan':
            this.workspaceScanner?.cancelScan();
            this.state.isScanningWorkspace = false;
            this.render();
            break;

          case 'view-issue':
            if (message.file && message.line) {
              await this.viewIssue(
                message.file,
                message.line,
                message.column,
                message.uri,
                message.endLine,
                message.endColumn
              );
            }
            break;

          case 'explain-issue':
            if (message.file && message.line) {
              await this.explainIssue(
                message.file,
                message.line,
                message.column,
                message.uri,
                message.code,
                message.message,
                message.source
              );
            }
            break;

          case 'open-issue':
            if (message.file && message.line) {
              await this.viewIssue(
                message.file,
                message.line,
                message.column,
                message.uri
              );
            }
            break;

          case 'select-issue':
            if (typeof message.index === 'number' && this.state.issues[message.index]) {
              this.state.selectedIssueIndex = message.index;
              const editor = vscode.window.activeTextEditor;
              if (editor) {
                await this.selectDiagnostic(editor, this.state.issues[message.index]);
              }
            }
            break;

          case 'analyze-ai':
            logger.log('[Bugify] Analyze command triggered');
            await this.runAiAnalysis('normal');
            break;

          case 'explain-more':
            logger.log('[Bugify] Analyze command triggered (deep)');
            await this.runAiAnalysis('deep');
            break;

          case 'reveal-line':
            if (message.file && message.line) {
              await this.revealLocation(message.file, message.line);
            }
            break;

          case 'copy-code':
            if (message.code) {
              await vscode.env.clipboard.writeText(message.code);
              vscode.window.showInformationMessage('Copied corrected code.');
            }
            break;

          case 'apply-fix':
            await this.applyFixToEditor(
              message.file,
              message.line,
              message.code,
              message.originalCode,
              message.changes
            );
            break;

          case 'retry':
            await this.runAiAnalysis('normal', true);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Safely applies the proposed fix to the workspace file after explicit user confirmation.
   */
  private async applyFixToEditor(
    filePath?: string,
    targetLine?: number,
    correctedCode?: string,
    originalCode?: string,
    changes?: any[]
  ): Promise<void> {
    if (!correctedCode) {
      vscode.window.showWarningMessage('Bugify: No corrected code available to apply.');
      return;
    }

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let targetUri: vscode.Uri | undefined;

      if (filePath && workspaceFolders && workspaceFolders.length > 0) {
        targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
      } else {
        const activeDoc = vscode.window.activeTextEditor?.document;
        if (activeDoc) targetUri = activeDoc.uri;
      }

      if (!targetUri) {
        vscode.window.showErrorMessage('Bugify: Could not determine target file to apply fix.');
        return;
      }

      const doc = await vscode.workspace.openTextDocument(targetUri);
      const lineNum = targetLine && targetLine > 0 ? targetLine : 1;
      const lineIdx = Math.max(0, Math.min(lineNum - 1, doc.lineCount - 1));
      const docLine = doc.lineAt(lineIdx);

      // Prepare preview detail for user confirmation
      const changeDetail =
        changes && changes.length > 0 && changes[0].before
          ? `BEFORE:\n${changes[0].before}\n\nAFTER:\n${changes[0].after}`
          : `BEFORE:\n${docLine.text}\n\nAFTER:\n${correctedCode}`;

      const choice = await vscode.window.showInformationMessage(
        `Apply Bugify fix to ${filePath || 'file'} at line ${lineNum}?`,
        { modal: true, detail: changeDetail },
        'Apply Fix',
        'Cancel'
      );

      if (choice !== 'Apply Fix') {
        return;
      }

      const edit = new vscode.WorkspaceEdit();

      // Check if this is a partial line replacement or full line replacement
      if (changes && changes.length > 0 && changes[0].before && docLine.text.includes(changes[0].before)) {
        const startCol = docLine.text.indexOf(changes[0].before);
        const endCol = startCol + changes[0].before.length;
        const targetRange = new vscode.Range(lineIdx, startCol, lineIdx, endCol);
        edit.replace(targetUri, targetRange, changes[0].after);
      } else {
        edit.replace(targetUri, docLine.range, correctedCode);
      }

      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        vscode.window.showInformationMessage(
          `Bugify: Fix applied to line ${lineNum}. Press Cmd+Z / Ctrl+Z to undo.`
        );
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        const pos = new vscode.Position(lineIdx, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showErrorMessage('Bugify: Could not apply workspace edit.');
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Bugify: Error applying fix: ${err.message || err}`);
    }
  }

  /**
   * Refreshes workspace-level diagnostics and file groupings.
   */
  public refreshWorkspaceData(): void {
    if (this.diagnosticCollector) {
      this.state.workspaceGrouped = this.diagnosticCollector.getWorkspaceIssuesByFile();
      const summary = this.diagnosticCollector.getGlobalSummary();
      this.state.workspaceTotalCount = summary.totalCount;
    }
  }

  /**
   * Switches panel to Workspace Scan mode and executes the multi-layer workspace scan.
   */
  public async scanWorkspace(): Promise<void> {
    this.state.viewMode = 'workspace';
    this.state.isScanningWorkspace = true;
    this.state.scanProgressList = [
      { name: 'TypeScript', type: 'tsc', status: 'pending', issueCount: 0, message: 'Waiting...' },
      { name: 'ESLint', type: 'eslint', status: 'pending', issueCount: 0, message: 'Waiting...' },
      { name: 'Python', type: 'pyright', status: 'pending', issueCount: 0, message: 'Waiting...' },
    ];
    this.render();

    if (this.workspaceScanner) {
      const scanResult = await this.workspaceScanner.scan((status) => {
        if (this.state.scanProgressList) {
          const idx = this.state.scanProgressList.findIndex((p) => p.type === status.type);
          if (idx >= 0) {
            this.state.scanProgressList[idx] = status;
          } else {
            this.state.scanProgressList.push(status);
          }
          this.render();
        }
      });

      this.state.isScanningWorkspace = false;
      this.state.workspaceScanResult = scanResult;
      this.state.workspaceIssues = scanResult.issues;
      this.state.workspaceTotalCount = scanResult.summary.totalIssues;
      this.state.empty = scanResult.summary.totalIssues === 0;
    } else {
      this.refreshWorkspaceData();
      this.state.isScanningWorkspace = false;
      this.state.empty = this.state.workspaceTotalCount === 0;
    }

    this.render();
  }

  /**
   * Opens a file, jumps to the exact line/column, and reveals it in the editor.
   * Works reliably even when the file was completely closed.
   */
  public async viewIssue(
    filePath: string,
    line: number,
    column?: number,
    uriString?: string,
    endLine?: number,
    endColumn?: number
  ): Promise<void> {
    try {
      let targetUri: vscode.Uri | undefined;
      if (uriString) {
        targetUri = vscode.Uri.parse(uriString);
      } else if (filePath) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        }
      }

      if (!targetUri) {
        vscode.window.showErrorMessage(`Bugify: Could not locate file ${filePath}`);
        return;
      }

      const doc = await vscode.workspace.openTextDocument(targetUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

      const targetLine = Math.max(0, line - 1);
      const targetCol = Math.max(0, (column || 1) - 1);
      const targetEndLine = Math.max(0, (endLine || line) - 1);
      const targetEndCol = Math.max(targetCol + 1, (endColumn || (column || 1) + 6) - 1);

      const startPos = new vscode.Position(targetLine, targetCol);
      const endPos = new vscode.Position(targetEndLine, targetEndCol);

      editor.selection = new vscode.Selection(startPos, endPos);
      editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Bugify: Failed to open ${filePath}: ${err.message || err}`);
    }
  }

  /**
   * Explains a specific issue using the target file's real context, even if previously closed.
   */
  public async explainIssue(
    filePath: string,
    line: number,
    column?: number,
    uriString?: string,
    code?: string,
    messageText?: string,
    source?: string
  ): Promise<void> {
    try {
      let targetUri: vscode.Uri | undefined;
      if (uriString) {
        targetUri = vscode.Uri.parse(uriString);
      } else if (filePath) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        }
      }

      if (!targetUri) {
        vscode.window.showErrorMessage(`Bugify: Could not locate file ${filePath}`);
        return;
      }

      const doc = await vscode.workspace.openTextDocument(targetUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

      const targetLine = Math.max(0, line - 1);
      const targetCol = Math.max(0, (column || 1) - 1);
      const pos = new vscode.Position(targetLine, targetCol);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

      const targetDiag: BugifyDiagnostic = {
        severity: 'error',
        message: messageText || 'Diagnostic error',
        source: source || 'compiler',
        code,
        startLine: line,
        startColumn: column || 1,
        endLine: line,
        endColumn: (column || 1) + 10,
        filePath,
        uri: targetUri.toString(),
      };

      this.state.viewMode = 'current_file';
      this.state.activeFilePath = filePath;
      this.state.issues = [targetDiag];
      this.state.selectedIssueIndex = 0;
      this.state.empty = false;
      this.state.analysis = buildLocalAnalysis(targetDiag, filePath);

      // Collect bounded document context from the target file (even if closed!)
      const config = vscode.workspace.getConfiguration('bugify');
      const contextLines = config.get<number>('contextLines', 25);
      const contextResult = await collectDocumentContext(doc, {
        mode: 'analyze_error',
        detail: 'normal',
        targetDiagnostic: targetDiag,
        allFileDiagnostics: [targetDiag],
        contextLines,
        cursorLine: line,
        cursorColumn: column,
      });

      if (contextResult.payload) {
        this.lastRequestPayload = contextResult.payload;
      }

      this.render();

      // Trigger AI analysis if backend is reachable
      await this.runAiAnalysis('normal');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Bugify: Failed to analyze ${filePath}: ${err.message || err}`);
    }
  }

  /**
   * Compatibility alias for open and inspect location.
   */
  public async openAndInspectLocation(
    filePath: string,
    line: number,
    column?: number,
    uriString?: string
  ): Promise<void> {
    await this.viewIssue(filePath, line, column, uriString);
  }

  /**
   * Immediately displays local diagnostic in the panel and prepares for AI analysis.
   */
  public async analyzeEditor(
    editor: vscode.TextEditor,
    mode: 'analyze_error' | 'analyze_code',
    specificDiagnostic?: BugifyDiagnostic
  ): Promise<void> {
    this.refreshWorkspaceData();
    const rawDiagnostics = vscode.languages.getDiagnostics(editor.document.uri);
    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');

    const fileDiagnostics: BugifyDiagnostic[] = rawDiagnostics.map((d) => ({
      severity: d.severity === 0 ? 'error' : d.severity === 1 ? 'warning' : 'information',
      message: d.message,
      source: d.source || 'compiler',
      code: typeof d.code === 'object' ? String(d.code?.value) : d.code !== undefined ? String(d.code) : undefined,
      startLine: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      filePath: relativePath,
      uri: editor.document.uri.toString(),
    }));

    this.state.activeFilePath = relativePath;
    this.state.issues = fileDiagnostics;
    this.state.loading = false;
    this.state.aiError = undefined;

    if (mode === 'analyze_error' && fileDiagnostics.length === 0) {
      if (this.state.workspaceTotalCount > 0) {
        this.state.viewMode = 'workspace';
        this.state.empty = false;
      } else {
        this.state.viewMode = 'current_file';
        this.state.empty = true;
        this.state.analysis = null;
      }
      this.state.errorMessage = undefined;
      this.render();
      return;
    }

    this.state.viewMode = 'current_file';

    const target = specificDiagnostic || fileDiagnostics[0];
    if (target) {
      const idx = fileDiagnostics.findIndex(
        (d) => d.startLine === target.startLine && d.message === target.message
      );
      this.state.selectedIssueIndex = idx >= 0 ? idx : 0;
      this.state.empty = false;
      this.state.analysis = buildLocalAnalysis(target, relativePath);
    } else {
      // Analyze code without diagnostic
      this.state.selectedIssueIndex = 0;
      this.state.empty = false;
      const curLine = editor.selection.active.line + 1;
      this.state.analysis = {
        analysisSource: 'rules',
        status: 'needs_context',
        errorType: 'Code Inspection',
        title: 'Code Inspection',
        summary: `Inspecting ${relativePath} at line ${curLine}`,
        location: { file: relativePath, startLine: curLine, line: curLine },
        rootCause: 'User requested code analysis without compiler diagnostics.',
        whyItHappens: 'Reviewing code logic and types for selected code.',
        originalCode: '',
        correctedCode: null,
        changes: [],
        explanation: 'Reviewing code logic and types for selected code.',
        confidence: 0.7,
        validation: {
          status: 'needs_context',
          message: 'Click "Explain" to generate deep inspection of this snippet.',
          checkerUsed: 'local_rules',
        },
        cause: 'User requested code analysis without compiler diagnostics.',
        suggestion: 'Click "Explain" to generate in-depth inspection of this snippet.',
        severity: 'info',
      };
    }

    // Build context payload
    const config = vscode.workspace.getConfiguration('bugify');
    const contextLines = config.get<number>('contextLines', 20);

    const contextResult = await collectActiveContext(editor, {
      mode,
      detail: 'normal',
      targetDiagnostic: target,
      allFileDiagnostics: fileDiagnostics,
      contextLines,
    });

    if (contextResult.isSensitive) {
      this.state.sensitive = true;
      this.state.sensitiveReason = contextResult.sensitiveReason;
      this.state.analysis = null;
      this.render();
      return;
    }

    if (contextResult.payload) {
      this.lastRequestPayload = contextResult.payload;
    }

    // Render immediately so user sees the diagnostic instantly
    this.render();
  }

  /**
   * Switches to another diagnostic in the current file.
   */
  private async selectDiagnostic(editor: vscode.TextEditor, diagnostic: BugifyDiagnostic): Promise<void> {
    const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
    this.state.analysis = buildLocalAnalysis(diagnostic, relativePath);
    this.state.aiError = undefined;

    const config = vscode.workspace.getConfiguration('bugify');
    const contextLines = config.get<number>('contextLines', 20);

    const contextResult = await collectActiveContext(editor, {
      mode: 'analyze_error',
      detail: 'normal',
      targetDiagnostic: diagnostic,
      allFileDiagnostics: this.state.issues,
      contextLines,
    });

    if (contextResult.payload) {
      this.lastRequestPayload = contextResult.payload;
    }

    this.render();
  }

  /**
   * Triggers the backend AI explanation request.
   */
  public async runAiAnalysis(detail: 'normal' | 'deep' = 'normal', forceRefresh = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!this.lastRequestPayload && editor) {
      const config = vscode.workspace.getConfiguration('bugify');
      const contextLines = config.get<number>('contextLines', 20);
      const currentIssue = this.state.issues[this.state.selectedIssueIndex];

      const contextResult = await collectActiveContext(editor, {
        mode: currentIssue ? 'analyze_error' : 'analyze_code',
        detail,
        targetDiagnostic: currentIssue,
        allFileDiagnostics: this.state.issues,
        contextLines,
      });

      if (contextResult.payload) {
        this.lastRequestPayload = contextResult.payload;
      }
    }

    if (!this.lastRequestPayload) {
      this.state.aiError = 'Could not collect editor context to send to backend.';
      this.render();
      return;
    }

    this.lastRequestPayload.detail = detail;
    logger.log('[Bugify] Context collected');
    logger.log('[Bugify] Sending analysis request');

    this.state.aiAnalyzing = true;
    this.state.aiError = undefined;
    this.render();

    const { result, error, isBackendUnreachable } = await this.apiClient.analyze(
      this.lastRequestPayload,
      forceRefresh
    );

    this.state.aiAnalyzing = false;

    if (error) {
      logger.log(`[Bugify] Backend request failed: ${error}`);
      this.state.aiError = isBackendUnreachable
        ? 'AI analysis unavailable — backend is not connected.'
        : `Backend error: ${error}`;
      this.state.canRetry = true;
    } else if (result) {
      logger.log('[Bugify] Analysis received');
      this.state.analysis = result;
      this.state.aiError = undefined;
    }

    this.render();
  }

  /**
   * Reveals file and line in the editor.
   */
  private async revealLocation(file: string, line: number): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let targetUri: vscode.Uri | undefined;

      if (workspaceFolders && workspaceFolders.length > 0) {
        targetUri = vscode.Uri.joinPath(workspaceFolders[0].uri, file);
      } else {
        const activeDoc = vscode.window.activeTextEditor?.document;
        if (activeDoc) targetUri = activeDoc.uri;
      }

      if (!targetUri) return;

      const doc = await vscode.workspace.openTextDocument(targetUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

      const targetLine = Math.max(0, line - 1);
      const pos = new vscode.Position(targetLine, 0);
      const range = new vscode.Range(pos, pos);

      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      vscode.window.showErrorMessage(`Bugify: Could not open file ${file}`);
    }
  }

  public showWorkspaceResults(scanResult: WorkspaceScanResult): void {
    this.state.viewMode = 'workspace';
    this.state.loading = false;
    this.state.aiAnalyzing = false;
    this.state.analysis = null;
    this.state.workspaceScanResult = scanResult;
    this.state.workspaceIssues = scanResult.issues;
    this.state.workspaceTotalCount = scanResult.summary.totalIssues;
    this.state.empty = scanResult.summary.totalIssues === 0;
    this.render();
  }

  public showCleanState(): void {
    this.state.loading = false;
    this.state.aiAnalyzing = false;
    this.state.analysis = null;
    this.state.errorMessage = undefined;
    this.state.aiError = undefined;

    // Check if workspace scanner has results
    const lastScan = this.workspaceScanner?.getLastResult();
    if (lastScan && lastScan.issues.length > 0) {
      this.showWorkspaceResults(lastScan);
      return;
    }

    if (this.state.workspaceIssues && this.state.workspaceIssues.length > 0) {
      this.state.viewMode = 'workspace';
      this.state.empty = false;
      this.render();
      return;
    }

    this.refreshWorkspaceData();

    if (this.state.workspaceTotalCount > 0) {
      this.state.viewMode = 'workspace';
      this.state.empty = false;
    } else {
      this.state.empty = true;
      this.state.viewMode = 'workspace';
    }
    this.render();
  }

  public render(): void {
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatFilePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) {
      return `<span class="path-file">${this.escapeHtml(normalized)}</span>`;
    }
    const dir = normalized.substring(0, lastSlash + 1);
    const file = normalized.substring(lastSlash + 1);
    return `<span class="path-dir">${this.escapeHtml(dir)}</span><span class="path-file">${this.escapeHtml(file)}</span>`;
  }

  private getHtmlForWebview(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const stylesheetUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'bugify.css')
    );

    const {
      viewMode,
      loading,
      aiAnalyzing,
      sensitive,
      sensitiveReason,
      errorMessage,
      aiError,
      canRetry,
      issues,
      selectedIssueIndex,
      analysis,
      workspaceTotalCount,
      isScanningWorkspace,
      scanProgressList,
      workspaceScanResult,
      workspaceIssues,
    } = this.state;

    const activeCount = issues ? issues.length : 0;
    const activeFileName = this.state.activeFilePath
      ? this.state.activeFilePath.split(/[\/\\]/).pop() || 'Active File'
      : 'Active File';

    // Collect issues to display in workspace mode
    const issuesToDisplay =
      workspaceIssues && workspaceIssues.length > 0
        ? workspaceIssues
        : workspaceScanResult && workspaceScanResult.issues && workspaceScanResult.issues.length > 0
        ? workspaceScanResult.issues
        : [];

    const totalIssuesCount = viewMode === 'workspace' ? issuesToDisplay.length : activeCount;
    const errorCount =
      viewMode === 'workspace'
        ? issuesToDisplay.filter((i) => i.severity === 'error').length
        : issues ? issues.filter((i) => i.severity === 'error').length : 0;
    const warningCount =
      viewMode === 'workspace'
        ? issuesToDisplay.filter((i) => i.severity === 'warning').length
        : issues ? issues.filter((i) => i.severity === 'warning').length : 0;

    // Determine current focal issue for the Island HUD component
    let islandCode = '';
    let islandLocation = '';
    let islandMessage = '';
    let islandFile = '';
    let islandLine = 1;
    let islandCol = 1;
    let islandUri = '';
    let islandSource = '';

    if (viewMode === 'workspace' && issuesToDisplay.length > 0) {
      const topIssue = issuesToDisplay[0];
      islandCode = topIssue.code || topIssue.source.toUpperCase();
      islandLocation = `${topIssue.filePath}:${topIssue.line}`;
      islandMessage = topIssue.message;
      islandFile = topIssue.filePath;
      islandLine = topIssue.line;
      islandCol = topIssue.column;
      islandUri = topIssue.uri || '';
      islandSource = topIssue.source;
    } else if (viewMode === 'current_file' && issues && issues.length > 0) {
      const currentIssue = issues[selectedIssueIndex] || issues[0];
      islandCode = currentIssue.code || (currentIssue.source ? currentIssue.source.toUpperCase() : 'DIAGNOSTIC');
      islandLocation = `${activeFileName}:${currentIssue.startLine}`;
      islandMessage = currentIssue.message;
      islandFile = this.state.activeFilePath || activeFileName;
      islandLine = currentIssue.startLine;
      islandCol = currentIssue.startColumn;
      islandUri = currentIssue.uri || '';
      islandSource = currentIssue.source || '';
    } else if (analysis) {
      islandCode = analysis.errorType || 'DIAGNOSTIC';
      const line = analysis.location?.startLine || analysis.location?.line || 1;
      const file = analysis.location?.file || activeFileName;
      islandLocation = `${file.split(/[\/\\]/).pop()}:${line}`;
      islandMessage = analysis.summary || analysis.explanation || 'Active diagnostic analysis';
      islandFile = file;
      islandLine = line;
      islandCol = analysis.location?.startColumn || 1;
    }

    // 1. Island Component Markup
    let islandMarkup = '';
    if (totalIssuesCount > 0 || analysis) {
      islandMarkup = `
        <section class="island-instrument" id="bugifyIsland" aria-expanded="false" aria-label="Active Diagnostic Island">
          <button type="button" class="island-summary" id="islandToggleBtn" aria-expanded="false" aria-controls="islandBody">
            <div class="island-summary-left">
              <span class="island-pulse-dot" aria-hidden="true"></span>
              <span class="island-lead-tag">BUGIFY</span>
              <span class="island-badge">${totalIssuesCount}</span>
              <span class="island-preview-text">${this.escapeHtml(islandCode ? `${islandCode} — ${islandMessage}` : 'Diagnostics monitored')}</span>
            </div>
            <span class="island-toggle-indicator" aria-hidden="true">▼</span>
          </button>
          <div class="island-expansion-wrap" id="islandBody">
            <div class="island-expanded-content">
              <div class="island-inner-padding">
                <div class="island-target-row">
                  <span class="sev-indicator error"><span class="sev-glyph">■</span><span>ERROR</span></span>
                  <span class="island-code">${this.escapeHtml(islandCode)}</span>
                  <span class="island-location">${this.escapeHtml(islandLocation)}</span>
                </div>
                <div class="island-detail-msg">${this.escapeHtml(islandMessage)}</div>
                <div class="island-actions">
                  <button type="button" class="btn btn-secondary btn-xs btn-view" data-file="${this.escapeHtml(islandFile)}" data-line="${islandLine}" data-col="${islandCol}" data-uri="${this.escapeHtml(islandUri)}">
                    VIEW
                  </button>
                  <button type="button" class="btn btn-primary btn-xs btn-explain" data-file="${this.escapeHtml(islandFile)}" data-line="${islandLine}" data-col="${islandCol}" data-uri="${this.escapeHtml(islandUri)}" data-code="${this.escapeHtml(islandCode)}" data-msg="${this.escapeHtml(islandMessage)}" data-source="${this.escapeHtml(islandSource)}">
                    EXPLAIN
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    // 2. Main Content Area Markup
    let mainContentMarkup = '';

    if (loading) {
      mainContentMarkup = `
        <div class="skeleton-wrap" aria-label="Loading diagnostic analysis" role="status" aria-live="polite">
          <div class="skeleton-line sk-w-40"></div>
          <div class="skeleton-line sk-w-70"></div>
          <div class="skeleton-line sk-w-100"></div>
          <div class="skeleton-line sk-w-85"></div>
          <div class="skeleton-line sk-box"></div>
        </div>
      `;
    } else if (sensitive) {
      mainContentMarkup = `
        <div class="state-box" role="alert">
          <div class="state-title">SENSITIVE FILE PROTECTED</div>
          <div class="state-desc">${this.escapeHtml(sensitiveReason || 'Analysis suspended because file contains sensitive tokens.')}</div>
        </div>
      `;
    } else if (errorMessage) {
      mainContentMarkup = `
        <div class="state-box state-error" role="alert">
          <div class="state-title">CONNECTION ERROR</div>
          <div class="state-desc">${this.escapeHtml(errorMessage || 'Unable to reach Bugify analysis service.')}</div>
          <button type="button" class="btn btn-secondary btn-sm" id="retryBtn">RETRY</button>
        </div>
      `;
    } else if (viewMode === 'workspace') {
      if (isScanningWorkspace) {
        mainContentMarkup = `
          <div class="scan-card" role="status" aria-live="polite">
            <div class="scan-card-header">
              <span class="status-dot pulse" aria-hidden="true"></span>
              <span class="scan-label">SCANNING WORKSPACE</span>
              <button type="button" class="btn btn-secondary btn-xs" id="cancelScanBtn" style="margin-left: auto;">CANCEL</button>
            </div>
            <div class="scan-line-container">
              <div class="scan-travelling-line"></div>
            </div>
            <div class="scan-subtitle">Running workspace static analyzers across project files...</div>
            <div class="analyzer-table">
              ${(scanProgressList || [])
                .map((p) => {
                  let glyph = '○';
                  let statusClass = 'status-pending';
                  if (p.status === 'completed') {
                    glyph = '●';
                    statusClass = 'status-completed';
                  } else if (p.status === 'running') {
                    glyph = '●';
                    statusClass = 'status-running';
                  } else if (p.status === 'timed_out' || p.status === 'failed') {
                    glyph = '■';
                    statusClass = 'status-failed';
                  }
                  return `
                    <div class="analyzer-row ${statusClass}">
                      <span class="analyzer-glyph">${glyph}</span>
                      <span class="analyzer-name">${this.escapeHtml(p.name)}</span>
                      <span class="analyzer-msg">${this.escapeHtml(p.message || p.status.toUpperCase())}</span>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;
      } else if (issuesToDisplay.length > 0) {
        mainContentMarkup = `
          <div class="workspace-issues-view">
            <div class="filter-tablist" role="tablist" aria-label="Severity filter">
              <button type="button" role="tab" class="filter-btn active" data-filter="all" aria-selected="true">
                ALL <span class="filter-count">(${issuesToDisplay.length})</span>
              </button>
              <button type="button" role="tab" class="filter-btn" data-filter="error" aria-selected="false">
                ERRORS <span class="filter-count">(${errorCount})</span>
              </button>
              <button type="button" role="tab" class="filter-btn" data-filter="warning" aria-selected="false">
                WARNINGS <span class="filter-count">(${warningCount})</span>
              </button>
              <button type="button" class="btn btn-secondary btn-xs" id="rescanWorkspaceBtn" style="margin-left: auto;">
                RESCAN
              </button>
            </div>

            <div class="issue-rows-list" id="workspaceIssueList" role="list">
              ${issuesToDisplay
                .map((issue) => {
                  const isError = issue.severity === 'error';
                  const rowClass = isError ? 'row-error' : 'row-warning';
                  const sevClass = isError ? 'error' : 'warning';
                  const glyph = isError ? '■' : '△';
                  const label = isError ? 'ERROR' : 'WARNING';
                  const codeTag = issue.code || issue.source.toUpperCase();

                  return `
                    <div class="issue-row ${rowClass}" data-severity="${this.escapeHtml(issue.severity)}" role="listitem">
                      <div class="issue-row-top">
                        <div class="issue-label-group">
                          <span class="sev-indicator ${sevClass}">
                            <span class="sev-glyph" aria-hidden="true">${glyph}</span>
                            <span>${label}</span>
                          </span>
                          <span class="issue-code-badge">${this.escapeHtml(codeTag)}</span>
                          <span class="issue-analyzer-tag">[ ${this.escapeHtml(issue.analyzer)} ]</span>
                        </div>
                      </div>
                      <div class="issue-file-location">
                        <button type="button" class="loc-btn btn-view" data-file="${this.escapeHtml(issue.filePath)}" data-line="${issue.line}" data-col="${issue.column}" data-endline="${issue.endLine || ''}" data-endcol="${issue.endColumn || ''}" data-uri="${this.escapeHtml(issue.uri || '')}">
                          ${this.formatFilePath(issue.filePath)}<span class="loc-pos">:${issue.line}:${issue.column}</span>
                        </button>
                      </div>
                      <div class="issue-row-msg">${this.escapeHtml(issue.message)}</div>
                      <div class="issue-row-actions">
                        <button type="button" class="btn btn-secondary btn-xs btn-view" data-file="${this.escapeHtml(issue.filePath)}" data-line="${issue.line}" data-col="${issue.column}" data-endline="${issue.endLine || ''}" data-endcol="${issue.endColumn || ''}" data-uri="${this.escapeHtml(issue.uri || '')}">
                          VIEW
                        </button>
                        <button type="button" class="btn btn-primary btn-xs btn-explain" data-file="${this.escapeHtml(issue.filePath)}" data-line="${issue.line}" data-col="${issue.column}" data-uri="${this.escapeHtml(issue.uri || '')}" data-code="${this.escapeHtml(issue.code || '')}" data-msg="${this.escapeHtml(issue.message)}" data-source="${this.escapeHtml(issue.source)}">
                          EXPLAIN
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;
      } else {
        mainContentMarkup = `
          <div class="state-box" role="region" aria-label="Clean Diagnostics State">
            <div class="state-title">NO CURRENT DIAGNOSTICS</div>
            <div class="state-desc">The workspace has no diagnostics reported by the available analyzers.</div>
            <button type="button" class="btn btn-secondary btn-sm" id="rescanWorkspaceBtn">SCAN WORKSPACE</button>
          </div>
        `;
      }
    } else if (analysis) {
      const isAi = analysis.analysisSource === 'ai';
      const line = analysis.location?.startLine || analysis.location?.line || 1;
      const file = analysis.location?.file || this.state.activeFilePath || 'file';

      const hasFix = !!analysis.correctedCode && analysis.status === 'fixed';
      const isNeedsContext = analysis.status === 'needs_context';
      const validationStatus = analysis.validation?.status || (hasFix ? 'generated' : 'needs_context');

      let validationStepIcon = '○';
      let validationStepClass = 'step-pending';
      let validationStepLabel = 'VALIDATION PENDING';
      let validationTitle = 'VALIDATION UNAVAILABLE';
      let validationMsg = analysis.validation?.message || 'Code validation was not performed.';

      if (validationStatus === 'validated') {
        validationStepIcon = '●';
        validationStepClass = 'step-done';
        validationStepLabel = 'FIX VALIDATED';
        validationTitle = `FIX VALIDATED (${(analysis.validation?.checkerUsed || 'AST').toUpperCase()} SYNTAX & TYPES SAFE)`;
        validationMsg = analysis.validation?.message || 'Fix is consistent with diagnostic and passes syntax AST validation.';
      } else if (validationStatus === 'generated') {
        validationStepIcon = '●';
        validationStepClass = 'step-active';
        validationStepLabel = 'FIX GENERATED';
        validationTitle = 'FIX GENERATED — NOT VERIFIED';
        validationMsg = analysis.validation?.message || 'Syntactic validation checker unavailable for this language environment.';
      } else if (validationStatus === 'needs_context') {
        validationStepIcon = '△';
        validationStepClass = 'step-pending';
        validationStepLabel = 'NEEDS CONTEXT';
        validationTitle = 'ADDITIONAL CONTEXT REQUIRED';
        validationMsg = analysis.validation?.message || 'Bugify requires additional code context to safely propose a fix.';
      } else if (validationStatus === 'validation_failed') {
        validationStepIcon = '■';
        validationStepClass = 'step-pending';
        validationStepLabel = 'VALIDATION FAILED';
        validationTitle = 'FIX VALIDATION FAILED';
        validationMsg = analysis.validation?.message || 'Fix produced syntax errors or introduced anti-patterns.';
      }

      // Diff Block Markup
      const diffMarkup = hasFix
        ? `
          <div class="report-section">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span class="section-label">SUGGESTED FIX</span>
              <button type="button" class="btn btn-secondary btn-xs" id="copyFixBtn" data-code="${this.escapeHtml(analysis.correctedCode)}">
                COPY FIX
              </button>
            </div>
            <div class="diff-container">
              <div class="diff-pane diff-pane-del">
                <div class="diff-pane-header">
                  <span>CURRENT</span>
                  <span>-${line}</span>
                </div>
                <pre class="diff-pre"><code class="diff-line-del">- ${this.escapeHtml(analysis.originalCode || '')}</code></pre>
              </div>
              <div class="diff-pane diff-pane-add">
                <div class="diff-pane-header">
                  <span>FIX</span>
                  <span>+${line}</span>
                </div>
                <pre class="diff-pre"><code class="diff-line-add">+ ${this.escapeHtml(analysis.correctedCode || '')}</code></pre>
              </div>
            </div>
          </div>
        `
        : `
          <div class="report-section">
            <div class="section-label">SUGGESTED FIX</div>
            <div class="state-box" style="padding: 12px; text-align: left; align-items: flex-start;">
              <div class="state-title" style="color: var(--sev-warning);">AUTOMATED FIX WITHHELD</div>
              <div class="state-desc" style="margin-bottom: 0;">${this.escapeHtml(
                analysis.explanation ||
                  'Bugify requires additional code context to safely generate a fix without guessing.'
              )}</div>
            </div>
          </div>
        `;

      const aiNotice = aiError
        ? `
          <div class="state-box state-error" role="alert" style="margin-bottom: 8px;">
            <div class="state-title">ANALYSIS SERVICE NOTICE</div>
            <div class="state-desc">${this.escapeHtml(aiError)}</div>
            ${canRetry ? '<button type="button" class="btn btn-secondary btn-xs" id="retryBtn">RETRY</button>' : ''}
          </div>
        `
        : '';

      const aiButtonLabel = aiAnalyzing
        ? 'ANALYZING...'
        : isAi
        ? 'EXPLAIN MORE'
        : 'EXPLAIN';

      const aiButtonId = isAi ? 'explainMoreBtn' : 'analyzeAiBtn';

      mainContentMarkup = `
        <article class="report-panel">
          <div class="report-breadcrumb">
            <span class="breadcrumb-path">BUGIFY / ANALYSIS</span>
            <span class="source-tag">SOURCE ${isAi ? 'MODEL' : 'RULES'}</span>
          </div>

          <div class="analysis-target-header">
            <div class="analysis-headline">
              <span class="sev-indicator error">
                <span class="sev-glyph" aria-hidden="true">■</span>
                <span>${this.escapeHtml(analysis.errorType)}</span>
              </span>
              <button type="button" class="loc-btn" id="revealLocationBtn" data-file="${this.escapeHtml(file)}" data-line="${line}">
                ${this.formatFilePath(file)}<span class="loc-pos">:${line}</span>
              </button>
            </div>
          </div>

          ${aiNotice}

          <!-- Pipeline Tracker -->
          <div class="pipeline-tracker" aria-label="Analysis pipeline status">
            <div class="pipeline-step step-done">
              <span class="pipeline-step-glyph">●</span>
              <span>DETECTED</span>
            </div>
            <div class="pipeline-step ${analysis.rootCause ? 'step-done' : ''}">
              <span class="pipeline-step-glyph">${analysis.rootCause ? '●' : '○'}</span>
              <span>ROOT CAUSE</span>
            </div>
            <div class="pipeline-step ${hasFix ? 'step-done' : (isNeedsContext ? 'step-active' : '')}">
              <span class="pipeline-step-glyph">${hasFix ? '●' : (isNeedsContext ? '△' : '○')}</span>
              <span>${hasFix ? 'FIX GENERATED' : (isNeedsContext ? 'NEEDS CONTEXT' : 'PENDING')}</span>
            </div>
            <div class="pipeline-step ${validationStepClass}">
              <span class="pipeline-step-glyph">${validationStepIcon}</span>
              <span>${validationStepLabel}</span>
            </div>
          </div>

          <!-- Root cause section -->
          <div class="report-section">
            <div class="section-label">ROOT CAUSE</div>
            <div class="section-prose" style="font-family: var(--font-mono); font-size: 12px; color: var(--text);">${this.escapeHtml(analysis.rootCause || analysis.cause || analysis.summary || 'Diagnostic root cause under investigation.')}</div>
          </div>

          <!-- Diff / Fix Block -->
          ${diffMarkup}

          <!-- Why section -->
          <div class="report-section">
            <div class="section-label">WHY</div>
            <div class="section-prose">${this.escapeHtml(analysis.whyItHappens || analysis.explanation || 'Fix restores semantic compatibility and resolves diagnostic invariant.')}</div>
          </div>

          <!-- Validation Section -->
          <div class="report-section">
            <div class="section-label">VALIDATION</div>
            <div class="validation-card">
              <div class="validation-header">
                <span>${validationStepIcon}</span>
                <span>${this.escapeHtml(validationTitle)}</span>
              </div>
              <div class="validation-msg">${this.escapeHtml(validationMsg)}</div>
            </div>
          </div>

          <!-- Actions Footer -->
          <div class="report-footer">
            <button type="button" class="btn btn-secondary btn-sm" id="viewCodeBtn" data-file="${this.escapeHtml(file)}" data-line="${line}">
              VIEW CODE
            </button>
            ${
              hasFix
                ? `
              <button type="button" class="btn btn-secondary btn-sm" id="copyFixFooterBtn" data-code="${this.escapeHtml(analysis.correctedCode)}">
                COPY FIX
              </button>
              <button type="button" class="btn btn-primary btn-sm" id="applyFixBtn" data-file="${this.escapeHtml(file)}" data-line="${line}">
                APPLY FIX
              </button>
            `
                : ''
            }
            <button type="button" class="btn btn-secondary btn-sm" id="${aiButtonId}" ${aiAnalyzing ? 'disabled' : ''}>
              ${aiButtonLabel}
            </button>
          </div>
        </article>
      `;
    } else {
      if (issues && issues.length > 0) {
        mainContentMarkup = `
          <div class="current-file-issues-view">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span class="section-label">DIAGNOSTICS IN ${this.escapeHtml(activeFileName)}</span>
              <span class="badge-count">${issues.length}</span>
            </div>
            <div class="issue-rows-list" id="issueList" role="list">
              ${issues
                .map((issue, idx) => {
                  const isSelected = idx === selectedIssueIndex;
                  const isError = issue.severity === 'error';
                  const rowClass = isError ? 'row-error' : 'row-warning';
                  const sevClass = isError ? 'error' : 'warning';
                  const glyph = isError ? '■' : '△';
                  const label = isError ? 'ERROR' : 'WARNING';
                  const codeTag = issue.code || (issue.source ? issue.source.toUpperCase() : 'DIAGNOSTIC');

                  return `
                    <div class="issue-row ${rowClass} ${isSelected ? 'row-selected' : ''}" data-index="${idx}" role="listitem">
                      <div class="issue-row-top">
                        <div class="issue-label-group">
                          <span class="sev-indicator ${sevClass}">
                            <span class="sev-glyph" aria-hidden="true">${glyph}</span>
                            <span>${label}</span>
                          </span>
                          <span class="issue-code-badge">${this.escapeHtml(codeTag)}</span>
                        </div>
                      </div>
                      <div class="issue-file-location">
                        <button type="button" class="loc-btn btn-view" data-file="${this.escapeHtml(this.state.activeFilePath || activeFileName)}" data-line="${issue.startLine}" data-col="${issue.startColumn}" data-uri="${this.escapeHtml(issue.uri || '')}">
                          ${this.formatFilePath(activeFileName)}<span class="loc-pos">:${issue.startLine}</span>
                        </button>
                      </div>
                      <div class="issue-row-msg">${this.escapeHtml(issue.message)}</div>
                      <div class="issue-row-actions">
                        <button type="button" class="btn btn-secondary btn-xs btn-view" data-file="${this.escapeHtml(this.state.activeFilePath || activeFileName)}" data-line="${issue.startLine}" data-col="${issue.startColumn}" data-uri="${this.escapeHtml(issue.uri || '')}">
                          VIEW
                        </button>
                        <button type="button" class="btn btn-primary btn-xs btn-explain" data-file="${this.escapeHtml(this.state.activeFilePath || activeFileName)}" data-line="${issue.startLine}" data-col="${issue.startColumn}" data-uri="${this.escapeHtml(issue.uri || '')}" data-code="${this.escapeHtml(issue.code || '')}" data-msg="${this.escapeHtml(issue.message)}" data-source="${this.escapeHtml(issue.source)}">
                          EXPLAIN
                        </button>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;
      } else if (workspaceTotalCount > 0) {
        mainContentMarkup = `
          <div class="state-box" role="region">
            <div class="state-title">NO DIAGNOSTICS IN ACTIVE FILE</div>
            <div class="state-desc">The open file has no compiler diagnostics. Bugify detected ${workspaceTotalCount} diagnostic${workspaceTotalCount === 1 ? '' : 's'} across other workspace files.</div>
            <button type="button" class="btn btn-primary btn-sm" id="gotoWorkspaceBtn">
              VIEW WORKSPACE ISSUES (${workspaceTotalCount})
            </button>
          </div>
        `;
      } else {
        mainContentMarkup = `
          <div class="state-box" role="region">
            <div class="state-title">NO CURRENT DIAGNOSTICS</div>
            <div class="state-desc">The workspace has no diagnostics reported by the available analyzers.</div>
            <button type="button" class="btn btn-secondary btn-sm" id="rescanWorkspaceBtn">SCAN WORKSPACE</button>
          </div>
        `;
      }
    }

    const headerIssueCountLabel = `${totalIssuesCount} ISSUE${totalIssuesCount === 1 ? '' : 'S'}`;
    const headerStatusLabel = isScanningWorkspace ? 'SCANNING' : (aiAnalyzing ? 'ANALYZING' : 'SYSTEM READY');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; font-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bugify</title>
  <link rel="stylesheet" href="${stylesheetUri}">
</head>
<body class="bugify-instrument-surface">
  <!-- Header Bar -->
  <header class="header-bar ${isScanningWorkspace ? 'is-scanning' : ''}">
    <div class="brand-group">
      <svg class="brand-mark" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 4H9V6H5V18H9V20H3V4ZM21 4H15V6H19V18H15V20H21V4ZM10 10H14V14H10V10Z"/>
      </svg>
      <div class="brand-meta">
        <span class="brand-wordmark">BUGIFY</span>
        <span class="brand-subtitle">Workspace Intelligence &bull; DEBUG INTELLIGENCE</span>
      </div>
    </div>
    <div class="header-status-group">
      <div class="system-status" title="Bugify Instrument State">
        <span class="status-dot ${isScanningWorkspace || aiAnalyzing ? 'pulse' : 'clean'}" aria-hidden="true"></span>
        <span>${headerStatusLabel}</span>
      </div>
      <span class="badge-count ${totalIssuesCount > 0 ? 'has-issues' : ''}">${headerIssueCountLabel}</span>
    </div>
    <div class="header-scan-track" aria-hidden="true">
      <div class="header-scan-pulse"></div>
    </div>
  </header>

  <!-- Island HUD Component -->
  ${islandMarkup}

  <!-- Navigation Mode Bar -->
  <nav class="mode-bar" aria-label="View mode">
    <div class="mode-tablist" role="tablist">
      <button type="button" role="tab" aria-selected="${viewMode === 'workspace'}" class="mode-tab-btn ${viewMode === 'workspace' ? 'active' : ''}" id="tabWorkspace">
        WORKSPACE
        <span class="tab-pill-count">${workspaceTotalCount}</span>
      </button>
      <button type="button" role="tab" aria-selected="${viewMode === 'current_file'}" class="mode-tab-btn ${viewMode === 'current_file' ? 'active' : ''}" id="tabCurrentFile">
        ACTIVE FILE
        <span class="tab-pill-count">${activeCount}</span>
      </button>
    </div>
    <div class="mode-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="actionScanWorkspace">
        SCAN WORKSPACE
      </button>
      <button type="button" class="btn btn-secondary btn-sm" id="actionAnalyzeCurrent">
        ANALYZE ACTIVE
      </button>
    </div>
  </nav>

  <!-- Main Container -->
  <main id="mainContainer">
    ${mainContentMarkup}
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Mode tabs
    const tabWorkspace = document.getElementById('tabWorkspace');
    if (tabWorkspace) {
      tabWorkspace.addEventListener('click', () => {
        vscode.postMessage({ command: 'switch-mode', mode: 'workspace' });
      });
    }

    const tabCurrentFile = document.getElementById('tabCurrentFile');
    if (tabCurrentFile) {
      tabCurrentFile.addEventListener('click', () => {
        vscode.postMessage({ command: 'switch-mode', mode: 'current_file' });
      });
    }

    // Action buttons in mode bar
    const actionScanWorkspace = document.getElementById('actionScanWorkspace');
    if (actionScanWorkspace) {
      actionScanWorkspace.addEventListener('click', () => {
        vscode.postMessage({ command: 'scan-workspace' });
      });
    }

    const rescanWorkspaceBtn = document.getElementById('rescanWorkspaceBtn');
    if (rescanWorkspaceBtn) {
      rescanWorkspaceBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'scan-workspace' });
      });
    }

    const actionAnalyzeCurrent = document.getElementById('actionAnalyzeCurrent');
    if (actionAnalyzeCurrent) {
      actionAnalyzeCurrent.addEventListener('click', () => {
        vscode.postMessage({ command: 'analyze-ai' });
      });
    }

    const gotoWorkspaceBtn = document.getElementById('gotoWorkspaceBtn');
    if (gotoWorkspaceBtn) {
      gotoWorkspaceBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'switch-mode', mode: 'workspace' });
      });
    }

    // Island Component interaction (expand, collapse, keyboard navigation)
    const island = document.getElementById('bugifyIsland');
    const islandToggleBtn = document.getElementById('islandToggleBtn');
    if (island && islandToggleBtn) {
      const toggleIsland = () => {
        const isExpanded = island.getAttribute('aria-expanded') === 'true';
        island.setAttribute('aria-expanded', String(!isExpanded));
        islandToggleBtn.setAttribute('aria-expanded', String(!isExpanded));
      };

      islandToggleBtn.addEventListener('click', toggleIsland);
      islandToggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleIsland();
        } else if (e.key === 'Escape') {
          island.setAttribute('aria-expanded', 'false');
          islandToggleBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Severity Filter Tabs (role="tablist" with arrow key support)
    const filterTabs = Array.from(document.querySelectorAll('.filter-btn'));
    filterTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        const filter = tab.getAttribute('data-filter');
        const rows = document.querySelectorAll('.issue-row');
        rows.forEach(row => {
          const sev = row.getAttribute('data-severity');
          if (filter === 'all' || sev === filter) {
            row.style.display = '';
          } else {
            row.style.display = 'none';
          }
        });
      });

      tab.addEventListener('keydown', (e) => {
        let newIndex = index;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          newIndex = (index + 1) % filterTabs.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          newIndex = (index - 1 + filterTabs.length) % filterTabs.length;
        }
        if (newIndex !== index) {
          e.preventDefault();
          filterTabs[newIndex].focus();
          filterTabs[newIndex].click();
        }
      });
    });

    // Copy Fix with 1.5s visual feedback
    function handleCopy(button, text) {
      if (!button || !text) return;
      vscode.postMessage({ command: 'copy-code', code: text });
      const origText = button.textContent;
      button.textContent = 'COPIED';
      button.classList.add('btn-copied');
      setTimeout(() => {
        button.textContent = origText;
        button.classList.remove('btn-copied');
      }, 1500);
    }

    const copyFixBtn = document.getElementById('copyFixBtn');
    if (copyFixBtn) {
      copyFixBtn.addEventListener('click', () => {
        handleCopy(copyFixBtn, copyFixBtn.getAttribute('data-code'));
      });
    }

    const copyFixFooterBtn = document.getElementById('copyFixFooterBtn');
    if (copyFixFooterBtn) {
      copyFixFooterBtn.addEventListener('click', () => {
        handleCopy(copyFixFooterBtn, copyFixFooterBtn.getAttribute('data-code'));
      });
    }

    // Action buttons & Issue row event delegation
    document.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('.btn-view');
      if (viewBtn) {
        const file = viewBtn.getAttribute('data-file');
        const line = parseInt(viewBtn.getAttribute('data-line') || '1', 10);
        const column = parseInt(viewBtn.getAttribute('data-col') || '1', 10);
        const endLine = parseInt(viewBtn.getAttribute('data-endline') || '0', 10) || undefined;
        const endColumn = parseInt(viewBtn.getAttribute('data-endcol') || '0', 10) || undefined;
        const uri = viewBtn.getAttribute('data-uri');
        vscode.postMessage({ command: 'view-issue', file, line, column, endLine, endColumn, uri });
        return;
      }

      const explainBtn = e.target.closest('.btn-explain');
      if (explainBtn) {
        const file = explainBtn.getAttribute('data-file');
        const line = parseInt(explainBtn.getAttribute('data-line') || '1', 10);
        const column = parseInt(explainBtn.getAttribute('data-col') || '1', 10);
        const uri = explainBtn.getAttribute('data-uri');
        const code = explainBtn.getAttribute('data-code');
        const message = explainBtn.getAttribute('data-msg');
        const source = explainBtn.getAttribute('data-source');
        vscode.postMessage({
          command: 'explain-issue',
          file,
          line,
          column,
          uri,
          code,
          message,
          source
        });
        return;
      }

      const cancelScanBtn = e.target.closest('#cancelScanBtn');
      if (cancelScanBtn) {
        vscode.postMessage({ command: 'cancel-scan' });
        return;
      }

      const rowTarget = e.target.closest('.issue-row[data-index]');
      if (rowTarget && !e.target.closest('button')) {
        const index = parseInt(rowTarget.getAttribute('data-index') || '0', 10);
        vscode.postMessage({ command: 'select-issue', index });
      }
    });

    // AI Analysis triggers
    const analyzeAiBtn = document.getElementById('analyzeAiBtn');
    if (analyzeAiBtn) {
      analyzeAiBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'analyze-ai' });
      });
    }

    const explainMoreBtn = document.getElementById('explainMoreBtn');
    if (explainMoreBtn) {
      explainMoreBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'explain-more' });
      });
    }

    // Apply fix
    const applyFixBtn = document.getElementById('applyFixBtn');
    if (applyFixBtn) {
      applyFixBtn.addEventListener('click', () => {
        const file = applyFixBtn.getAttribute('data-file');
        const line = parseInt(applyFixBtn.getAttribute('data-line') || '1', 10);
        const code = copyFixBtn ? copyFixBtn.getAttribute('data-code') : undefined;
        vscode.postMessage({ command: 'apply-fix', file, line, code });
      });
    }

    // View Code / Reveal location links
    const viewCodeBtn = document.getElementById('viewCodeBtn');
    if (viewCodeBtn) {
      viewCodeBtn.addEventListener('click', () => {
        const file = viewCodeBtn.getAttribute('data-file');
        const line = parseInt(viewCodeBtn.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'reveal-line', file, line });
      });
    }

    const revealLocationBtn = document.getElementById('revealLocationBtn');
    if (revealLocationBtn) {
      revealLocationBtn.addEventListener('click', () => {
        const file = revealLocationBtn.getAttribute('data-file');
        const line = parseInt(revealLocationBtn.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'reveal-line', file, line });
      });
    }

    // Retry button
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'retry' });
      });
    }
  </script>
</body>
</html>`;
  }
  public dispose(): void {
    BugifyPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}
