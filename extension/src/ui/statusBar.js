"use strict";
/**
 * Status Bar Item for Bugify
 * Displays clean state: "BUGIFY"
 * Or issue state: "BUGIFY N" with accent text color.
 * Clicking opens the Bugify debugging panel via command: bugify.openPanel.
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
exports.BugifyStatusBar = void 0;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../logger");
class BugifyStatusBar {
    context;
    collector;
    scanner;
    item;
    lastScanCount = null;
    lastScanErrorCount = 0;
    lastScanWarningCount = 0;
    constructor(context, collector, scanner) {
        this.context = context;
        this.collector = collector;
        this.scanner = scanner;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'bugify.openWorkspace';
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
        logger_1.logger.log('[Bugify] Status bar initialized');
    }
    update() {
        // If a workspace scan has been performed, use the workspace scan count as ground truth
        // Otherwise fallback to currently published VS Code diagnostics
        let count;
        let errorCount;
        let warningCount;
        if (this.lastScanCount !== null) {
            count = this.lastScanCount;
            errorCount = this.lastScanErrorCount;
            warningCount = this.lastScanWarningCount;
        }
        else {
            const summary = this.collector.getGlobalSummary();
            count = summary.totalCount;
            errorCount = summary.errorCount;
            warningCount = summary.warningCount;
        }
        if (count > 0) {
            const formatted = count < 10 ? `0${count}` : `${count}`;
            this.item.text = `BUGIFY  ${formatted}`;
            this.item.tooltip = `Bugify: ${count} actionable workspace issue${count === 1 ? '' : 's'} (${errorCount} error${errorCount === 1 ? '' : 's'}, ${warningCount} warning${warningCount === 1 ? '' : 's'}). Click to open Bugify.`;
            this.item.color = '#FF6A00';
            this.item.backgroundColor = undefined;
        }
        else {
            this.item.text = `BUGIFY`;
            this.item.tooltip = 'Bugify: Workspace analyzed. Click to open Bugify.';
            this.item.color = undefined;
            this.item.backgroundColor = undefined;
        }
    }
    setScanCount(count, errorCount, warningCount) {
        this.lastScanCount = count;
        this.lastScanErrorCount = errorCount;
        this.lastScanWarningCount = warningCount;
        this.update();
    }
    dispose() {
        this.item.dispose();
    }
}
exports.BugifyStatusBar = BugifyStatusBar;
