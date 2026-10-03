/**
 * Bugify Backend API Client
 * Uses native fetch with AbortController for timeouts,
 * in-memory caching to prevent duplicate API requests, and comprehensive error categorization.
 */

import * as vscode from 'vscode';
import { AnalyzeRequest, AnalysisResult } from '../types/bugify';

export class BugifyApiClient {
  private cache = new Map<string, AnalysisResult>();

  private getBackendUrl(): string {
    const config = vscode.workspace.getConfiguration('bugify');
    const url = config.get<string>('backendUrl', 'http://localhost:5000');
    return url.replace(/\/+$/, '');
  }

  private getTimeoutMs(): number {
    const config = vscode.workspace.getConfiguration('bugify');
    return config.get<number>('requestTimeoutMs', 15000);
  }

  /**
   * Generates a deterministic cache key for identical requests.
   */
  private generateCacheKey(payload: AnalyzeRequest): string {
    const diag = payload.diagnostics?.[0];
    const diagKey = diag ? `${diag.code || ''}:${diag.message}:${diag.startLine}` : 'none';
    const contextSample = payload.codeContext.slice(0, 100);
    return `${payload.mode}:${payload.detail}:${payload.file.path}:${payload.cursor?.line || 0}:${diagKey}:${contextSample}`;
  }

  /**
   * Clears the in-memory analysis cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Calls POST /api/extension/analyze with timeout and caching.
   */
  public async analyze(
    payload: AnalyzeRequest,
    forceRefresh = false
  ): Promise<{ result?: AnalysisResult; error?: string; isBackendUnreachable?: boolean }> {
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
          const errJson = (await response.json()) as { error?: string };
          if (errJson && errJson.error) {
            errorMsg = errJson.error;
          }
        } catch {
          // Response body was not JSON
        }
        return { error: errorMsg };
      }

      const data = (await response.json()) as AnalysisResult;

      // Validate required contract fields
      if (!data || !data.summary || !data.errorType) {
        return { error: 'Received malformed response payload from Bugify server.' };
      }

      // Store in session cache
      this.cache.set(cacheKey, data);

      return { result: data };
    } catch (err: unknown) {
      clearTimeout(timer);

      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          return { error: `Request timed out after ${timeoutMs}ms. Bugify server took too long to respond.` };
        }

        // Connection refused / network failure
        const isNetworkErr =
          err.message.includes('ECONNREFUSED') ||
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
