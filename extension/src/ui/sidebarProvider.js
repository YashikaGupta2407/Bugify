"use strict";
/**
 * Bugify Sidebar View Provider
 * Provides the Bugify scanning and debugging interface in the VS Code Activity Bar / Left Sidebar.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BugifySidebarViewProvider = void 0;
const bugifyPanel_1 = require("./bugifyPanel");
const logger_1 = require("../logger");
class BugifySidebarViewProvider {
    extensionUri;
    apiClient;
    diagnosticCollector;
    workspaceScanner;
    static viewType = 'bugify.sidebarView';
    static currentProvider;
    _view;
    _panel;
    constructor(extensionUri, apiClient, diagnosticCollector, workspaceScanner) {
        this.extensionUri = extensionUri;
        this.apiClient = apiClient;
        this.diagnosticCollector = diagnosticCollector;
        this.workspaceScanner = workspaceScanner;
        BugifySidebarViewProvider.currentProvider = this;
    }
    resolveWebviewView(webviewView, _context, _token) {
        try {
            logger_1.logger.log('[Bugify] Resolving Bugify sidebar WebviewView');
            this._view = webviewView;
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [this.extensionUri],
            };
            this._panel = bugifyPanel_1.BugifyPanel.createForWebviewView(webviewView, this.extensionUri, this.apiClient, this.diagnosticCollector, this.workspaceScanner);
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    this._panel?.refreshWorkspaceData();
                    this._panel?.render();
                }
            });
            webviewView.onDidDispose(() => {
                logger_1.logger.log('[Bugify] Sidebar WebviewView disposed');
                this._panel?.dispose();
                this._panel = undefined;
                this._view = undefined;
            });
        }
        catch (err) {
            logger_1.logger.log(`[Bugify] Error resolving sidebar WebviewView: ${err?.message || err}`);
            webviewView.webview.html = `<!DOCTYPE html><html><body style="padding:16px;color:#F5F5F5;background:#070707;font-family:sans-serif;"><h3>Bugify</h3><p style="color:#FF6A00;">Initialization error: ${err?.message || err}</p></body></html>`;
        }
    }
    getPanel() {
        return this._panel;
    }
    getView() {
        return this._view;
    }
}
exports.BugifySidebarViewProvider = BugifySidebarViewProvider;
