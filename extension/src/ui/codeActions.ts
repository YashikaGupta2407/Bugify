/**
 * CodeActionProvider for Bugify
 * Adds a "Debug with Bugify" Quick Fix action to the lightbulb / Ctrl+. / Cmd+. menu
 * whenever the user's cursor is on a diagnostic.
 */

import * as vscode from 'vscode';

export class BugifyCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (!context.diagnostics || context.diagnostics.length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // For the primary diagnostic under the cursor
    const diagnostic = context.diagnostics[0];
    const action = new vscode.CodeAction(
      'Debug with Bugify',
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    action.command = {
      command: 'bugify.analyzeCurrentError',
      title: 'Debug with Bugify',
      arguments: [diagnostic],
    };

    actions.push(action);

    return actions;
  }
}
