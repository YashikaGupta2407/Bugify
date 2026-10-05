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
import {
  mapDiagnosticSeverity,
  isActionableSeverity,
  getSeverityMetadata,
  normalizeDiagnosticCode,
} from '../diagnostics/diagnosticUtils';
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
                message.source,
                message.severity
              );
            }
            break;

          case 'open-issue':
            if (message.file && message.line) {
              await this.explainIssue(
                message.file,
                message.line,
                message.column,
                message.uri,
                message.code,
                message.message,
                message.source,
                message.severity
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
    source?: string,
    severity?: 'error' | 'warning' | 'information' | 'hint' | string
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

      const normSeverity = mapDiagnosticSeverity(severity);
      const targetDiag: BugifyDiagnostic = {
        severity: normSeverity,
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
      const targetDocLine = doc.lineCount > targetLine ? doc.lineAt(targetLine).text : undefined;
      const fullDocText = doc.getText();
      this.state.analysis = buildLocalAnalysis(targetDiag, filePath, targetDocLine, fullDocText);

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

    const allFileDiagnostics: BugifyDiagnostic[] = rawDiagnostics.map((d) => ({
      severity: mapDiagnosticSeverity(d.severity),
      message: d.message,
      source: d.source || 'compiler',
      code: normalizeDiagnosticCode(d.code),
      startLine: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      filePath: relativePath,
      uri: editor.document.uri.toString(),
    }));

    // Actionable diagnostics: Errors and Warnings only.
    // Information and Hint diagnostics are excluded from the default actionable issue list.
    const actionableDiagnostics = allFileDiagnostics.filter((d) => isActionableSeverity(d.severity));

    this.state.activeFilePath = relativePath;
    this.state.loading = false;
    this.state.aiError = undefined;

    // Default target diagnostic: explicitly requested diagnostic or top actionable diagnostic
    const target = specificDiagnostic || actionableDiagnostics[0];

    // Populate issue list: only actionable issues by default; if non-actionable specifically requested, include it
    if (specificDiagnostic && !isActionableSeverity(specificDiagnostic.severity)) {
      this.state.issues = [specificDiagnostic, ...actionableDiagnostics];
    } else {
      this.state.issues = actionableDiagnostics;
    }

    if (mode === 'analyze_error' && !target) {
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

    if (target) {
      const idx = this.state.issues.findIndex(
        (d) => d.startLine === target.startLine && d.message === target.message
      );
      this.state.selectedIssueIndex = idx >= 0 ? idx : 0;
      this.state.empty = false;
      const targetLineIdx = Math.max(0, target.startLine - 1);
      const docLineText = editor.document.lineCount > targetLineIdx ? editor.document.lineAt(targetLineIdx).text : undefined;
      const fullDocText = editor.document.getText();
      this.state.analysis = buildLocalAnalysis(target, relativePath, docLineText, fullDocText);
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
      allFileDiagnostics,
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
    const targetLineIdx = Math.max(0, diagnostic.startLine - 1);
    const docLineText = editor.document.lineCount > targetLineIdx ? editor.document.lineAt(targetLineIdx).text : undefined;
    const fullDocText = editor.document.getText();
    this.state.analysis = buildLocalAnalysis(diagnostic, relativePath, docLineText, fullDocText);
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

    this.refreshWorkspaceData();
    this.state.viewMode = 'workspace';
    this.state.empty = this.state.workspaceTotalCount === 0;
    this.render();
  }

  public openWorkspaceView(): void {
    this.state.viewMode = 'workspace';
    this.refreshWorkspaceData();
    const lastScan = this.workspaceScanner?.getLastResult();
    if (lastScan && lastScan.issues.length > 0) {
      this.state.workspaceScanResult = lastScan;
      this.state.workspaceIssues = lastScan.issues;
      this.state.workspaceTotalCount = lastScan.summary.totalIssues;
      this.state.empty = false;
    } else {
      const summary = this.diagnosticCollector.getGlobalSummary();
      this.state.workspaceTotalCount = summary.totalCount;
      this.state.empty = summary.totalCount === 0;
    }
    this.render();
  }

  public async openCurrentFileView(editor?: vscode.TextEditor): Promise<void> {
    const targetEditor = editor || vscode.window.activeTextEditor;
    if (targetEditor) {
      await this.analyzeEditor(targetEditor, 'analyze_error');
    } else {
      this.state.viewMode = 'current_file';
      this.render();
    }
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
    const logoUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.png')
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

    // Collect actionable issues to display in workspace mode
    let issuesToDisplay: Array<{
      filePath: string;
      line: number;
      column: number;
      endLine?: number;
      endColumn?: number;
      severity: 'error' | 'warning' | 'information' | 'hint' | string;
      message: string;
      source: string;
      code?: string;
      analyzer?: string;
      uri?: string;
    }> = [];

    if (workspaceIssues && workspaceIssues.length > 0) {
      issuesToDisplay = workspaceIssues;
    } else if (workspaceScanResult && workspaceScanResult.issues && workspaceScanResult.issues.length > 0) {
      issuesToDisplay = workspaceScanResult.issues;
    } else {
      const collected = this.diagnosticCollector?.getWorkspaceDiagnostics(true) || [];
      issuesToDisplay = collected.map((d) => ({
        filePath: d.filePath || '',
        line: d.startLine,
        column: d.startColumn,
        endLine: d.endLine,
        endColumn: d.endColumn,
        severity: d.severity,
        message: d.message,
        source: d.source || 'vscode',
        code: d.code,
        analyzer: d.source || 'vscode',
        uri: d.uri,
      }));
    }

    // Filter to actionable issues only (Errors and Warnings)
    const actionableIssues = issuesToDisplay.filter((i) => isActionableSeverity(i.severity));
    const totalWorkspaceActionable = actionableIssues.length;
    const errorCount = actionableIssues.filter((i) => i.severity === 'error').length;
    const warningCount = actionableIssues.filter((i) => i.severity === 'warning').length;

    // Header count & status indicators
    const currentModeTotal = viewMode === 'workspace' ? totalWorkspaceActionable : activeCount;
    const paddedTotal = currentModeTotal < 10 ? `0${currentModeTotal}` : `${currentModeTotal}`;
    const headerBadgeLabel = `${paddedTotal} ${currentModeTotal === 1 ? 'ISSUE' : 'ISSUES'}`;
    const headerStatusLabel = isScanningWorkspace ? 'SCANNING' : (aiAnalyzing ? 'ANALYZING' : 'READY');

    // -------------------------------------------------------------
    // MAIN CONTENT COMPILATION
    // -------------------------------------------------------------
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
      // -----------------------------------------------------------
      // MODE A: WORKSPACE / CURRENT FOLDER MODE
      // -----------------------------------------------------------
      if (isScanningWorkspace) {
        // Section 19: Scanning Experience with Metrics & Progress
        const filesScanned = workspaceScanResult?.summary.fileCount ?? 0;
        const filesWithIssues = workspaceScanResult ? new Set(workspaceScanResult.issues.map(i => i.filePath)).size : 0;
        const issuesFound = workspaceScanResult?.summary.totalIssues ?? 0;

        mainContentMarkup = `
          <div class="scan-card" role="status" aria-live="polite">
            <div class="scan-header">
              <div class="scan-brand-title">BUGIFY</div>
              <div class="scan-action-title">SCANNING WORKSPACE</div>
            </div>
            <div class="scan-line-container">
              <div class="scan-travelling-line"></div>
            </div>
            <div class="scan-metrics-grid">
              <div class="scan-metric-row">
                <span class="metric-label">Files scanned</span>
                <span class="metric-value">${filesScanned}</span>
              </div>
              <div class="scan-metric-row">
                <span class="metric-label">Files with issues</span>
                <span class="metric-value">${filesWithIssues}</span>
              </div>
              <div class="scan-metric-row">
                <span class="metric-label">Issues found</span>
                <span class="metric-value highlight-orange">${issuesFound}</span>
              </div>
            </div>
            <div class="analyzer-table">
              ${(scanProgressList || [])
                .map((p) => {
                  let glyph = '○';
                  let statusClass = 'pending';
                  if (p.status === 'completed') {
                    glyph = '●';
                    statusClass = 'completed';
                  } else if (p.status === 'running') {
                    glyph = '●';
                    statusClass = 'running';
                  } else if (p.status === 'timed_out' || p.status === 'failed') {
                    glyph = '■';
                    statusClass = 'failed';
                  }
                  return `
                    <div class="analyzer-row ${statusClass}">
                      <span class="analyzer-cell-name"><span class="sev-glyph">${glyph}</span> ${this.escapeHtml(p.name)}</span>
                      <span class="analyzer-cell-status">${this.escapeHtml(p.message || p.status.toUpperCase())}</span>
                    </div>
                  `;
                })
                .join('')}
            </div>
            <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary btn-xs" id="cancelScanBtn">CANCEL</button>
            </div>
          </div>
        `;
      } else if (totalWorkspaceActionable > 0) {
        // Section 2 & 17: Workspace Issues List
        const paddedCount = totalWorkspaceActionable < 10 ? `0${totalWorkspaceActionable}` : `${totalWorkspaceActionable}`;

        mainContentMarkup = `
          <div class="workspace-view">
            <div class="workspace-section-header">
              <div class="context-label">WORKSPACE</div>
              <div class="context-issue-count">${paddedCount} ACTIONABLE ${totalWorkspaceActionable === 1 ? 'ISSUE' : 'ISSUES'}</div>
              <div class="divider-line"></div>
              <div class="filter-tablist" role="tablist" aria-label="Severity filter">
                <button type="button" role="tab" class="filter-btn active" data-filter="all" aria-selected="true">
                  ALL <span class="filter-count">(${totalWorkspaceActionable})</span>
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
            </div>

            <div class="workspace-issue-list" id="workspaceIssueList" role="list">
              ${actionableIssues
                .map((issue, idx) => {
                  const idxPadded = (idx + 1) < 10 ? `0${idx + 1}` : `${idx + 1}`;
                  const sevMeta = getSeverityMetadata(issue.severity);
                  const codeTag = issue.code || (issue.source ? issue.source.toUpperCase() : 'ISSUE');

                  return `
                    <div class="workspace-issue-item ${sevMeta.rowClass}" data-severity="${this.escapeHtml(issue.severity)}" data-file="${this.escapeHtml(issue.filePath)}" data-line="${issue.line}" data-col="${issue.column}" role="listitem">
                      <div class="issue-item-index">${idxPadded}</div>
                      <div class="issue-item-body">
                        <div class="issue-item-meta">
                          <span class="sev-indicator ${sevMeta.cssClass}">
                            <span class="sev-glyph" aria-hidden="true">${sevMeta.glyph}</span>
                            <span>${sevMeta.label}</span>
                          </span>
                          <span class="issue-code-badge">${this.escapeHtml(codeTag)}</span>
                        </div>
                        <div class="issue-item-message">${this.escapeHtml(issue.message)}</div>
                        <div class="issue-item-location">
                          <span class="loc-path">${this.escapeHtml(issue.filePath)}</span>
                          <span class="loc-coords">: L${issue.line}:C${issue.column}</span>
                        </div>
                      </div>
                      <div class="issue-item-actions">
                        <button type="button" class="btn btn-secondary btn-xs btn-open"
                          data-file="${this.escapeHtml(issue.filePath)}"
                          data-line="${issue.line}"
                          data-col="${issue.column}"
                          data-endline="${issue.endLine || ''}"
                          data-endcol="${issue.endColumn || ''}"
                          data-uri="${this.escapeHtml(issue.uri || '')}"
                          data-code="${this.escapeHtml(issue.code || '')}"
                          data-msg="${this.escapeHtml(issue.message)}"
                          data-source="${this.escapeHtml(issue.source)}"
                          data-severity="${this.escapeHtml(issue.severity)}">
                          OPEN
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
        // Section 20: Clean Empty State
        mainContentMarkup = `
          <div class="state-box" role="region" aria-label="No Actionable Issues">
            <div class="state-brand">BUGIFY</div>
            <div class="state-title">NO ACTIONABLE ISSUES</div>
            <div class="state-desc">Your workspace currently has no actionable errors or warnings.</div>
            <button type="button" class="btn btn-secondary btn-sm" id="rescanWorkspaceBtn">SCAN WORKSPACE</button>
          </div>
        `;
      }
    } else {
      // -----------------------------------------------------------
      // MODE B: CURRENT FILE MODE
      // -----------------------------------------------------------
      if (!issues || issues.length === 0) {
        // Section 18: Empty State when Active File has no issues
        mainContentMarkup = `
          <div class="current-file-empty-card" role="region">
            <div class="context-label">CURRENT FILE</div>
            <div class="current-file-name">${this.escapeHtml(activeFileName)}</div>
            <div class="state-title" style="margin-top: 14px;">NO ACTIONABLE ISSUES</div>
            <div class="state-desc" style="margin-top: 4px;">
              ${totalWorkspaceActionable > 0
                ? `Workspace contains ${totalWorkspaceActionable} other actionable issue${totalWorkspaceActionable === 1 ? '' : 's'}.`
                : `Your workspace currently has no actionable errors or warnings.`}
            </div>
            ${totalWorkspaceActionable > 0 ? `
              <button type="button" class="btn btn-primary btn-sm" id="gotoWorkspaceBtn" style="margin-top: 14px;">
                VIEW WORKSPACE (${totalWorkspaceActionable})
              </button>
            ` : `
              <button type="button" class="btn btn-secondary btn-sm" id="actionScanWorkspaceEmpty" style="margin-top: 14px;">
                SCAN WORKSPACE
              </button>
            `}
          </div>
        `;
      } else {
        // Section 2, 6, 7 & 18: Focused Debugging Intelligence View
        const currentIssue = issues[selectedIssueIndex] || issues[0];
        const selectedLine = currentIssue.startLine;
        const selectedCol = currentIssue.startColumn;
        const selectedFile = this.state.activeFilePath || activeFileName;
        const selectedMessage = currentIssue.message;
        const selectedCode = currentIssue.code || (currentIssue.source ? currentIssue.source.toUpperCase() : 'DIAGNOSTIC');
        const selectedSevMeta = getSeverityMetadata(currentIssue.severity);
        const activeCountPadded = activeCount < 10 ? `0${activeCount}` : `${activeCount}`;

        // Intelligence fields (backed by local analysis or model analysis)
        const whatHappened = analysis?.summary || analysis?.explanation || selectedMessage;
        const rootCause = analysis?.rootCause || analysis?.cause || 'The symbol or expression violates lexical, syntactic, or typing rules.';
        const whyItHappened = analysis?.whyItHappens || analysis?.explanation || 'Compilation or runtime failed to satisfy safety invariants.';
        const hasSafeFix = !!analysis?.correctedCode && analysis?.status === 'fixed';
        const recommendedActionText = hasSafeFix
          ? (analysis?.explanation || 'Apply the corrected code fix to resolve the diagnostic.')
          : (analysis?.suggestion || analysis?.explanation || 'Inspect the referenced line and update declarations or imports.');

        // Verification & Confidence (Strict: Only VERIFIED if genuinely validated)
        const isVerified = analysis?.verificationStatus === 'VERIFIED' || analysis?.validation?.status === 'validated';
        const verificationText = isVerified
          ? 'FIX VERIFIED'
          : hasSafeFix
          ? 'FIX GENERATED — NOT VERIFIED'
          : 'NOT VERIFIED';
        const verificationClass = isVerified ? 'verified' : 'unverified';
        const verificationGlyph = isVerified ? '●' : '○';

        const conf = analysis?.confidence || 0.8;
        const confidenceText = analysis?.confidenceLevel || (conf >= 0.85 ? 'HIGH' : (conf >= 0.65 ? 'MEDIUM' : 'LOW'));
        const confidenceClass = confidenceText.toLowerCase();

        const aiNotice = aiError
          ? `
            <div class="state-box state-error" role="alert" style="margin-bottom: 8px;">
              <div class="state-title">ANALYSIS SERVICE NOTICE</div>
              <div class="state-desc">${this.escapeHtml(aiError)}</div>
              ${canRetry ? '<button type="button" class="btn btn-secondary btn-xs" id="retryBtn">RETRY</button>' : ''}
            </div>
          `
          : '';

        mainContentMarkup = `
          <div class="current-file-view">
            <div class="current-file-header">
              <div class="context-label">CURRENT FILE</div>
              <div class="current-file-name">${this.escapeHtml(activeFileName)}</div>
              <div class="current-file-issue-count">${activeCountPadded} ${activeCount === 1 ? 'ISSUE' : 'ISSUES'}</div>
            </div>

            ${activeCount > 1 ? `
              <div class="file-issue-tabs" role="tablist" aria-label="Issues in active file">
                ${issues
                  .map((iss, i) => {
                    const isSelected = i === selectedIssueIndex;
                    const sm = getSeverityMetadata(iss.severity);
                    const idxPadded = (i + 1) < 10 ? `0${i + 1}` : `${i + 1}`;
                    return `
                      <button type="button" role="tab" class="file-issue-tab ${isSelected ? 'active' : ''}" data-index="${i}" aria-selected="${isSelected}">
                        <span class="sev-glyph ${sm.cssClass}">${sm.glyph}</span>
                        <span>${idxPadded} ${sm.label} (L${iss.startLine})</span>
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            ` : ''}

            <article class="debugging-card">
              <div class="debugging-card-top">
                <div class="issue-headline">
                  <span class="sev-indicator ${selectedSevMeta.cssClass}">
                    <span class="sev-glyph" aria-hidden="true">${selectedSevMeta.glyph}</span>
                    <span>${selectedSevMeta.label}</span>
                  </span>
                  <span class="issue-code-badge">${this.escapeHtml(selectedCode)}</span>
                </div>
                <button type="button" class="btn btn-secondary btn-xs btn-open-line" data-file="${this.escapeHtml(selectedFile)}" data-line="${selectedLine}" data-col="${selectedCol}">
                  OPEN AT LINE
                </button>
              </div>

              <div class="debugging-card-msg">${this.escapeHtml(selectedMessage)}</div>
              <div class="debugging-card-loc">
                <span class="loc-path">${this.escapeHtml(selectedFile)}</span>
                <span class="loc-coords"> : Line ${selectedLine}, Column ${selectedCol}</span>
              </div>

              ${aiNotice}

              <div class="card-divider"></div>

              <!-- WHAT HAPPENED -->
              <section class="intel-section">
                <div class="intel-section-title">WHAT HAPPENED</div>
                <div class="intel-section-prose">${this.escapeHtml(whatHappened)}</div>
              </section>

              <div class="card-divider"></div>

              <!-- ROOT CAUSE -->
              <section class="intel-section">
                <div class="intel-section-title">ROOT CAUSE</div>
                <div class="intel-section-prose">${this.escapeHtml(rootCause)}</div>
              </section>

              <div class="card-divider"></div>

              <!-- WHY IT HAPPENED -->
              <section class="intel-section">
                <div class="intel-section-title">WHY IT HAPPENED</div>
                <div class="intel-section-prose">${this.escapeHtml(whyItHappened)}</div>
              </section>

              <div class="card-divider"></div>

              <!-- RECOMMENDED FIX or RECOMMENDED ACTION -->
              <section class="intel-section">
                <div class="intel-fix-header">
                  <div class="intel-section-title">${hasSafeFix ? 'RECOMMENDED FIX' : 'RECOMMENDED ACTION'}</div>
                  ${hasSafeFix ? `
                    <div class="intel-fix-actions">
                      <button type="button" class="btn btn-secondary btn-xs" id="copyFixBtn" data-code="${this.escapeHtml(analysis?.correctedCode || '')}">
                        COPY FIX
                      </button>
                      <button type="button" class="btn btn-primary btn-xs" id="applyFixBtn" data-file="${this.escapeHtml(selectedFile)}" data-line="${selectedLine}" data-code="${this.escapeHtml(analysis?.correctedCode || '')}">
                        APPLY FIX
                      </button>
                    </div>
                  ` : ''}
                </div>
                <div class="intel-section-prose">${this.escapeHtml(recommendedActionText)}</div>

                ${hasSafeFix ? `
                  <div class="diff-container" style="margin-top: 8px;">
                    <div class="diff-pane diff-pane-del">
                      <div class="diff-pane-header">
                        <span>CURRENT</span>
                        <span>-${selectedLine}</span>
                      </div>
                      <pre class="diff-pre"><code class="diff-line-del">- ${this.escapeHtml(analysis?.originalCode || '')}</code></pre>
                    </div>
                    <div class="diff-pane diff-pane-add">
                      <div class="diff-pane-header">
                        <span>FIX</span>
                        <span>+${selectedLine}</span>
                      </div>
                      <pre class="diff-pre"><code class="diff-line-add">+ ${this.escapeHtml(analysis?.correctedCode || '')}</code></pre>
                    </div>
                  </div>
                ` : ''}
              </section>

              <div class="card-divider"></div>

              <!-- CONFIDENCE & VERIFICATION -->
              <section class="intel-section-grid">
                <div class="grid-cell">
                  <span class="grid-cell-label">CONFIDENCE</span>
                  <span class="grid-cell-value confidence-${confidenceClass}">${confidenceText}</span>
                </div>
                <div class="grid-cell">
                  <span class="grid-cell-label">VERIFICATION</span>
                  <span class="grid-cell-value verification-${verificationClass}">
                    <span class="verification-glyph">${verificationGlyph}</span>
                    <span>${verificationText}</span>
                  </span>
                </div>
              </section>

              <!-- Card Action Footer -->
              <div class="debugging-card-footer">
                <button type="button" class="btn btn-secondary btn-sm btn-open-line" data-file="${this.escapeHtml(selectedFile)}" data-line="${selectedLine}" data-col="${selectedCol}">
                  OPEN AT LINE
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="explainMoreBtn" ${aiAnalyzing ? 'disabled' : ''}>
                  ${aiAnalyzing ? 'ANALYZING...' : 'EXPLAIN MORE'}
                </button>
              </div>
            </article>
          </div>
        `;
      }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; font-src ${this.panel.webview.cspSource}; img-src ${this.panel.webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bugify</title>
  <link rel="stylesheet" href="${stylesheetUri}">
</head>
<body class="bugify-instrument-surface">
  <!-- Brand Header Bar -->
  <header class="header-bar ${isScanningWorkspace ? 'is-scanning' : ''}">
    <div class="brand-group">
      <img src="${logoUri}" alt="Bugify" class="brand-logo-img" width="22" height="22" />
      <div class="brand-meta">
        <span class="brand-wordmark">BUGIFY</span>
        <span class="brand-subtitle">DEBUG INTELLIGENCE</span>
      </div>
    </div>
    <div class="header-status-group">
      <div class="system-status" title="Bugify Instrument State">
        <span class="status-dot ${isScanningWorkspace || aiAnalyzing ? 'pulse' : 'clean'}" aria-hidden="true"></span>
        <span>${headerStatusLabel}</span>
      </div>
      <span class="badge-count ${currentModeTotal > 0 ? 'has-issues' : ''}">${headerBadgeLabel}</span>
    </div>
    <div class="header-scan-track" aria-hidden="true">
      <div class="header-scan-pulse"></div>
    </div>
  </header>

  <!-- Context Navigation Mode Bar -->
  <nav class="mode-bar" aria-label="View mode">
    <div class="mode-tablist" role="tablist">
      <button type="button" role="tab" aria-selected="${viewMode === 'workspace'}" class="mode-tab-btn ${viewMode === 'workspace' ? 'active' : ''}" id="tabWorkspace">
        WORKSPACE
        <span class="tab-pill-count">${totalWorkspaceActionable < 10 ? `0${totalWorkspaceActionable}` : totalWorkspaceActionable}</span>
      </button>
      <button type="button" role="tab" aria-selected="${viewMode === 'current_file'}" class="mode-tab-btn ${viewMode === 'current_file' ? 'active' : ''}" id="tabCurrentFile">
        CURRENT FILE
        <span class="tab-pill-count">${activeCount < 10 ? `0${activeCount}` : activeCount}</span>
      </button>
    </div>
    <div class="mode-actions">
      <button type="button" class="btn btn-secondary btn-xs" id="actionScanWorkspace">
        ${isScanningWorkspace ? 'SCANNING...' : 'SCAN WORKSPACE'}
      </button>
    </div>
  </nav>

  <!-- Main Container -->
  <main id="mainContainer">
    ${mainContentMarkup}
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Mode tab switching
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

    // Scan workspace triggers
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

    const actionScanWorkspaceEmpty = document.getElementById('actionScanWorkspaceEmpty');
    if (actionScanWorkspaceEmpty) {
      actionScanWorkspaceEmpty.addEventListener('click', () => {
        vscode.postMessage({ command: 'scan-workspace' });
      });
    }

    const cancelScanBtn = document.getElementById('cancelScanBtn');
    if (cancelScanBtn) {
      cancelScanBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'cancel-scan' });
      });
    }

    const gotoWorkspaceBtn = document.getElementById('gotoWorkspaceBtn');
    if (gotoWorkspaceBtn) {
      gotoWorkspaceBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'switch-mode', mode: 'workspace' });
      });
    }

    // Filter tabs in Workspace View
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
        const rows = document.querySelectorAll('.workspace-issue-item');
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

    // File issue tabs in Current File View
    const issueTabs = document.querySelectorAll('.file-issue-tab');
    issueTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const index = parseInt(tab.getAttribute('data-index') || '0', 10);
        vscode.postMessage({ command: 'select-issue', index });
      });
    });

    // Copy Fix with feedback
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

    // Apply Fix
    const applyFixBtn = document.getElementById('applyFixBtn');
    if (applyFixBtn) {
      applyFixBtn.addEventListener('click', () => {
        const file = applyFixBtn.getAttribute('data-file');
        const line = parseInt(applyFixBtn.getAttribute('data-line') || '1', 10);
        const code = applyFixBtn.getAttribute('data-code');
        vscode.postMessage({ command: 'apply-fix', file, line, code });
      });
    }

    // Explain More AI trigger
    const explainMoreBtn = document.getElementById('explainMoreBtn');
    if (explainMoreBtn) {
      explainMoreBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'explain-more' });
      });
    }

    // Retry Button
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'retry' });
      });
    }

    // Document click delegation for opening issues and jumping to lines
    document.addEventListener('click', (e) => {
      // 1. Click on [ OPEN ] or anywhere on workspace issue row
      const openBtn = e.target.closest('.btn-open') || e.target.closest('.workspace-issue-item');
      if (openBtn && !e.target.closest('.filter-btn')) {
        const file = openBtn.getAttribute('data-file');
        const line = parseInt(openBtn.getAttribute('data-line') || '1', 10);
        const column = parseInt(openBtn.getAttribute('data-col') || '1', 10);
        const uri = openBtn.getAttribute('data-uri');
        const code = openBtn.getAttribute('data-code');
        const message = openBtn.getAttribute('data-msg');
        const source = openBtn.getAttribute('data-source');
        const severity = openBtn.getAttribute('data-severity');

        vscode.postMessage({
          command: 'open-issue',
          file,
          line,
          column,
          uri,
          code,
          message,
          source,
          severity
        });
        return;
      }

      // 2. Click on [ OPEN AT LINE ]
      const lineBtn = e.target.closest('.btn-open-line');
      if (lineBtn) {
        const file = lineBtn.getAttribute('data-file');
        const line = parseInt(lineBtn.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'reveal-line', file, line });
        return;
      }
    });
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

