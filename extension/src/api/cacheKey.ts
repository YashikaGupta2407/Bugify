/**
 * Cache key for analyze requests.
 * Includes the full code window, its position, and the document version so
 * editing the target file invalidates any previously cached fix.
 */

import * as crypto from 'crypto';
import { AnalyzeRequest } from '../types/bugify';

export function buildAnalyzeCacheKey(payload: AnalyzeRequest): string {
  const diag = payload.diagnostics?.[0];
  const diagKey = diag ? `${diag.code || ''}:${diag.message}:${diag.startLine}` : 'none';
  const contextHash = crypto.createHash('sha256').update(payload.codeContext).digest('hex');

  return [
    payload.mode,
    payload.detail,
    payload.file.path,
    payload.documentVersion ?? 0,
    payload.contextStartLine ?? 0,
    payload.cursor?.line || 0,
    diagKey,
    contextHash,
  ].join(':');
}
