/**
 * Normalization and deterministic deduplication engine for workspace issues.
 */

import { BugifyIssue, AnalyzerStatus } from './types';
import { isSensitiveFile } from '../context/redact';

const IGNORED_PATH_SEGMENTS = [
  '/node_modules/',
  '/.git/',
  '/.vscode/',
  '/dist/',
  '/build/',
  '/out/',
  '/coverage/',
  '/.next/',
  '/.turbo/',
  '/target/',
  '/.venv/',
  '/venv/',
];

/**
 * Checks if a relative or absolute file path is relevant for Bugify workspace analysis.
 */
export function isWorkspaceRelevantPath(filePath: string): boolean {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, '/');
  const wrapped = `/${normalized.replace(/^\/+/, '')}/`;

  for (const seg of IGNORED_PATH_SEGMENTS) {
    if (wrapped.includes(seg) || normalized.startsWith(seg.slice(1))) {
      return false;
    }
  }

  // Check privacy/sensitive files
  const filename = normalized.split('/').pop() || '';
  if (isSensitiveFile(filename)) {
    return false;
  }

  return true;
}

/**
 * Cleans and normalizes relative file paths.
 */
export function normalizeFilePath(rawPath: string): string {
  let cleaned = rawPath.replace(/\\/g, '/').trim();
  if (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

/**
 * Normalizes message text for fuzzy matching.
 */
function normalizeMessage(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Merges, filters, and deduplicates issues from all analyzers and VS Code diagnostics.
 */
export function normalizeAndDeduplicateIssues(rawIssues: BugifyIssue[]): BugifyIssue[] {
  const filtered = rawIssues.filter((issue) => {
    const relPath = normalizeFilePath(issue.filePath);
    return isWorkspaceRelevantPath(relPath) && issue.line > 0;
  });

  const dedupedMap = new Map<string, BugifyIssue>();

  for (const issue of filtered) {
    const relPath = normalizeFilePath(issue.filePath);
    const line = Math.max(1, issue.line);
    const col = Math.max(1, issue.column);
    const rawCode = (issue.code || '').toUpperCase().trim();
    const normCode = rawCode.replace(/^TS/, '');
    const normMsg = normalizeMessage(issue.message);

    // Primary unique key: file + line + col + normCode
    const primaryKey = `${relPath.toLowerCase()}:${line}:${col}:${normCode}`;

    // Line-level semantic key for cross-tool collisions (e.g., VS Code vs tsc where column may vary by 1-2 chars)
    const lineKey = `${relPath.toLowerCase()}:${line}:${normCode || normMsg.slice(0, 30)}`;

    const existing = dedupedMap.get(primaryKey) || dedupedMap.get(lineKey);

    if (existing) {
      // Merge: prefer analyzer with specific error code (e.g. TS2532 over 2532) or deeper source info
      if (rawCode.startsWith('TS') || (!existing.code && rawCode)) {
        existing.code = rawCode;
      }
      if (issue.uri && !existing.uri) {
        existing.uri = issue.uri;
      }
      if (issue.endLine && !existing.endLine) {
        existing.endLine = issue.endLine;
        existing.endColumn = issue.endColumn;
      }
      // If one is tsc and the other is vscode, note that tsc verified it
      if (issue.analyzer === 'tsc' || issue.analyzer === 'eslint') {
        existing.analyzer = issue.analyzer;
      }
      dedupedMap.set(primaryKey, existing);
      dedupedMap.set(lineKey, existing);
    } else {
      const normalizedIssue: BugifyIssue = {
        ...issue,
        filePath: relPath,
        line,
        column: col,
        code: rawCode || undefined,
      };
      dedupedMap.set(primaryKey, normalizedIssue);
      dedupedMap.set(lineKey, normalizedIssue);
    }
  }

  // Extract unique values
  const uniqueIssues = Array.from(new Set(dedupedMap.values()));

  // Sort: errors first, then warnings, then alphabetical file, then line
  return uniqueIssues.sort((a, b) => {
    if (a.severity === 'error' && b.severity !== 'error') return -1;
    if (a.severity !== 'error' && b.severity === 'error') return 1;
    const fileComp = a.filePath.localeCompare(b.filePath);
    if (fileComp !== 0) return fileComp;
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
}

/**
 * Builds accurate state message adhering to requirement:
 * Never say "Your workspace is clean" - report verified static analyzer status.
 */
export function buildStateMessage(totalCount: number, analyzers: AnalyzerStatus[]): string {
  if (totalCount > 0) {
    return `${totalCount} issue${totalCount === 1 ? '' : 's'} found`;
  }

  const anyCompleted = analyzers.some((a) => a.status === 'completed');

  if (anyCompleted) {
    return '✓ No diagnostics found by available analyzers.';
  }

  return '⚠ No supported workspace analyzer detected.';
}
