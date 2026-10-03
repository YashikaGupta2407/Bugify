/**
 * Bugify Development Logger
 * Logs to standard console and the dedicated "Bugify" VS Code Output Channel.
 * Gracefully degrades when run outside the VS Code extension host (e.g. in unit/integration tests).
 */

let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Running in pure node or test environment
}

class BugifyLogger {
  private channel: any = null;

  public init(): void {
    if (!this.channel && vscodeModule?.window?.createOutputChannel) {
      this.channel = vscodeModule.window.createOutputChannel('Bugify');
    }
  }

  public log(message: string): void {
    const formatted = message.startsWith('[Bugify]') ? message : `[Bugify] ${message}`;
    console.log(formatted);
    if (this.channel?.appendLine) {
      this.channel.appendLine(formatted);
    }
  }

  public show(): void {
    if (this.channel?.show) {
      this.channel.show(true);
    }
  }

  public dispose(): void {
    if (this.channel?.dispose) {
      this.channel.dispose();
      this.channel = null;
    }
  }
}

export const logger = new BugifyLogger();
