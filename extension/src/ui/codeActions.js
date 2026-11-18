"use strict";
/**
 * CodeActionProvider for Bugify
 * Adds a "Debug with Bugify" Quick Fix action to the lightbulb / Ctrl+. / Cmd+. menu
 * whenever the user's cursor is on a diagnostic.
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
exports.BugifyCodeActionProvider = void 0;
const vscode = __importStar(require("vscode"));
class BugifyCodeActionProvider {
    static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
    provideCodeActions(document, range, context) {
        if (!context.diagnostics || context.diagnostics.length === 0) {
            return [];
        }
        const actions = [];
        // For the primary diagnostic under the cursor
        const diagnostic = context.diagnostics[0];
        const action = new vscode.CodeAction('Debug with Bugify', vscode.CodeActionKind.QuickFix);
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
exports.BugifyCodeActionProvider = BugifyCodeActionProvider;
