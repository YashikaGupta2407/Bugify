"use strict";
/**
 * Bugify Development Logger
 * Logs to standard console and the dedicated "Bugify" VS Code Output Channel.
 * Gracefully degrades when run outside the VS Code extension host (e.g. in unit/integration tests).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
let vscodeModule = null;
try {
    vscodeModule = require('vscode');
}
catch {
    // Running in pure node or test environment
}
class BugifyLogger {
    channel = null;
    init() {
        if (!this.channel && vscodeModule?.window?.createOutputChannel) {
            this.channel = vscodeModule.window.createOutputChannel('Bugify');
        }
    }
    log(message) {
        const formatted = message.startsWith('[Bugify]') ? message : `[Bugify] ${message}`;
        console.log(formatted);
        if (this.channel?.appendLine) {
            this.channel.appendLine(formatted);
        }
    }
    show() {
        if (this.channel?.show) {
            this.channel.show(true);
        }
    }
    dispose() {
        if (this.channel?.dispose) {
            this.channel.dispose();
            this.channel = null;
        }
    }
}
exports.logger = new BugifyLogger();
