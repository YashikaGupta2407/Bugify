"use strict";
/**
 * Bugify Backend API Client
 * Uses native fetch with AbortController for timeouts,
 * in-memory caching to prevent duplicate API requests, and comprehensive error categorization.
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
exports.BugifyApiClient = void 0;
const vscode = __importStar(require("vscode"));
class BugifyApiClient {
    cache = new Map();
    getBackendUrl() {
        const config = vscode.workspace.getConfiguration('bugify');
        const url = config.get('backendUrl', 'http://localhost:5000');
        return url.replace(/\/+$/, '');
    }
    getTimeoutMs() {
        const config = vscode.workspace.getConfiguration('bugify');
        return config.get('requestTimeoutMs', 15000);
    }
    /**
     * Generates a deterministic cache key for identical requests.
     */
    generateCacheKey(payload) {
        const diag = payload.diagnostics?.[0];
        const diagKey = diag ? `${diag.code || ''}:${diag.message}:${diag.startLine}` : 'none';
        const contextSample = payload.codeContext.slice(0, 100);
        return `${payload.mode}:${payload.detail}:${payload.file.path}:${payload.cursor?.line || 0}:${diagKey}:${contextSample}`;
    }
    /**
     * Clears the in-memory analysis cache.
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * Calls POST /api/extension/analyze with timeout and caching.
     */
    async analyze(payload, forceRefresh = false) {
        const cacheKey = this.generateCacheKey(payload);
        if (!forceRefresh && this.cache.has(cacheKey)) {
            return { result: this.cache.get(cacheKey) };
        }
        const backendUrl = this.getBackendUrl();
        const timeoutMs = this.getTimeoutMs();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${backendUrl}/api/extension/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!response.ok) {
                let errorMsg = `Server returned status ${response.status}`;
                try {
                    const errJson = (await response.json());
                    if (errJson && errJson.error) {
                        errorMsg = errJson.error;
                    }
                }
                catch {
                    // Response body was not JSON
                }
                return { error: errorMsg };
            }
            const data = (await response.json());
            // Validate required contract fields
            if (!data || !data.summary || !data.errorType) {
                return { error: 'Received malformed response payload from Bugify server.' };
            }
            // Store in session cache
            this.cache.set(cacheKey, data);
            return { result: data };
        }
        catch (err) {
            clearTimeout(timer);
            if (err instanceof Error) {
                if (err.name === 'AbortError') {
                    return { error: `Request timed out after ${timeoutMs}ms. Bugify server took too long to respond.` };
                }
                // Connection refused / network failure
                const isNetworkErr = err.message.includes('ECONNREFUSED') ||
                    err.message.includes('fetch failed') ||
                    err.message.includes('Failed to fetch');
                if (isNetworkErr) {
                    return {
                        error: 'Backend unavailable. Make sure the Bugify server is running.',
                        isBackendUnreachable: true,
                    };
                }
                return { error: `Bugify error: ${err.message}` };
            }
            return { error: 'An unexpected network error occurred while contacting Bugify.' };
        }
    }
}
exports.BugifyApiClient = BugifyApiClient;
