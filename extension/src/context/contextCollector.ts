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

import * as vscode from 'vscode';
import { AnalyzeRequest, BugifyDiagnostic } from '../types/bugify';
import { isSensitiveFile, redactSecrets } from './redact';
import { extractCodeWindow, capSelection } from './windowing';
import { extractTopImports, extractEnclosingFunction } from './codeStructure';
import { convertTo1Based } from '../diagnostics/diagnosticUtils';

export interface ContextCollectionResult {
  isSensitive: boolean;
  sensitiveReason?: string;
  payload?: AnalyzeRequest;
}

/**
 * Safely reads workspace dependencies from package.json if present.
 */
async function getWorkspaceDependencies(): Promise<Record<string, string> | undefined> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;

    const pkgUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'package.json');
    const bytes = await vscode.workspace.fs.readFile(pkgUri);
    const content = new TextDecoder().decode(bytes);
    const json = JSON.parse(content);

    const merged: Record<string, string> = {};
    if (json.dependencies) Object.assign(merged, json.dependencies);
    if (json.devDependencies) Object.assign(merged, json.devDependencies);

    return Object.keys(merged).length > 0 ? merged : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Collects context from any vscode.TextDocument (even closed files opened in background).
 */
export async function collectDocumentContext(
  document: vscode.TextDocument,
  options: {
    mode: 'analyze_error' | 'analyze_code';
    detail?: 'normal' | 'deep';
    targetDiagnostic?: BugifyDiagnostic;
    allFileDiagnostics?: BugifyDiagnostic[];
    contextLines?: number;
    cursorLine?: number;
    cursorColumn?: number;
    selection?: string;
  }
): Promise<ContextCollectionResult> {
  const rawRelativePath = vscode.workspace.asRelativePath(document.uri, false);

  // Normalize path to relative forward-slash format
  const relativePath = rawRelativePath.replace(/\\/g, '/');

  // 1. Check for sensitive files
  if (isSensitiveFile(relativePath)) {
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
  const cappedSelection = capSelection(rawSelection, 16000);
  const redactedSelection = redactSecrets(cappedSelection);

  // 4. Target line for windowing and function context
  const targetLine = options.targetDiagnostic
    ? options.targetDiagnostic.startLine
    : cursorLine;

  const fullContent = document.getText();
  const language = document.languageId || 'plaintext';

  // 5. Surrounding code window (25 lines before and after by default)
  const contextLinesCount = options.contextLines ?? 25;
  const windowResult = extractCodeWindow({
    content: fullContent,
    targetLine,
    contextLines: contextLinesCount,
    selectionText: rawSelection,
    maxChars: 64000,
  });

  const redactedCodeContext = redactSecrets(windowResult.codeContext);

  // 6. Enclosing function context
  const rawFunctionContext = extractEnclosingFunction(fullContent, targetLine, language);
  const redactedFunctionContext = rawFunctionContext ? redactSecrets(rawFunctionContext) : undefined;

  // 7. Top-of-file imports
  const rawImports = extractTopImports(fullContent, language);
  const redactedImports = rawImports ? redactSecrets(rawImports) : undefined;

  // 8. Diagnostics
  let diagnosticsToSend: BugifyDiagnostic[] = [];
  if (options.mode === 'analyze_error') {
    if (options.targetDiagnostic) {
      diagnosticsToSend = [options.targetDiagnostic];
    } else if (options.allFileDiagnostics && options.allFileDiagnostics.length > 0) {
      diagnosticsToSend = options.allFileDiagnostics;
    }
  }

  // 9. Workspace info & dependencies
  const workspaceName = vscode.workspace.name || 'workspace';
  const dependencies = await getWorkspaceDependencies();

  const payload: AnalyzeRequest = {
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
export async function collectActiveContext(
  editor: vscode.TextEditor,
  options: {
    mode: 'analyze_error' | 'analyze_code';
    detail?: 'normal' | 'deep';
    targetDiagnostic?: BugifyDiagnostic;
    allFileDiagnostics?: BugifyDiagnostic[];
    contextLines?: number;
  }
): Promise<ContextCollectionResult> {
  const cursorZero = editor.selection.active;
  const cursor = convertTo1Based(cursorZero.line, cursorZero.character);
  const rawSelection = editor.document.getText(editor.selection);

  return collectDocumentContext(editor.document, {
    ...options,
    cursorLine: cursor.line,
    cursorColumn: cursor.column,
    selection: rawSelection,
  });
}
