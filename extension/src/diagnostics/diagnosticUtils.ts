/**
 * Pure functions for diagnostic code normalization, severity mapping, and 1-based conversions.
 * No VS Code dependencies - safe to test in standard Node.js test runner.
 */

import { BugifyDiagnostic } from '../types/bugify';

/**
 * Normalizes a VS Code diagnostic code into a clean string.
 * VS Code diagnostic.code can be a number, string, or { value: string | number, target: Uri }.
 */
export function normalizeDiagnosticCode(rawCode: unknown): string | undefined {
  if (rawCode === undefined || rawCode === null) {
    return undefined;
  }
  if (typeof rawCode === 'string' || typeof rawCode === 'number') {
    return String(rawCode).trim();
  }
  if (typeof rawCode === 'object' && rawCode !== null && 'value' in rawCode) {
    const val = (rawCode as { value: unknown }).value;
    return val !== undefined && val !== null ? String(val).trim() : undefined;
  }
  return undefined;
}

/**
 * Maps a numeric or string VS Code severity to standard Bugify severity.
 * In VS Code: 0 = Error, 1 = Warning, 2 = Information, 3 = Hint
 */
export function mapDiagnosticSeverity(
  severity: number | string | undefined
): 'error' | 'warning' | 'information' | 'hint' {
  if (typeof severity === 'number') {
    switch (severity) {
      case 0:
        return 'error';
      case 1:
        return 'warning';
      case 2:
        return 'information';
      case 3:
        return 'hint';
      default:
        return 'error';
    }
  }

  if (typeof severity === 'string') {
    const lower = severity.toLowerCase();
    if (lower === 'warning' || lower === 'warn') return 'warning';
    if (lower === 'information' || lower === 'info') return 'information';
    if (lower === 'hint') return 'hint';
    return 'error';
  }

  return 'error';
}

/**
 * Converts 0-based VS Code line and column (character) into 1-based positions.
 * VS Code uses 0-indexed line and character offsets.
 * Bugify API contracts and UI display use 1-indexed line and column numbers.
 */
export function convertTo1Based(
  zeroBasedLine: number,
  zeroBasedColumn: number
): { line: number; column: number } {
  return {
    line: Math.max(1, (zeroBasedLine ?? 0) + 1),
    column: Math.max(1, (zeroBasedColumn ?? 0) + 1),
  };
}

/**
 * Finds the diagnostic matching or containing the given 1-based cursor position.
 */
export function findDiagnosticAtCursor(
  diagnostics: BugifyDiagnostic[],
  cursorLine: number,
  cursorColumn: number
): BugifyDiagnostic | undefined {
  if (!diagnostics || diagnostics.length === 0) return undefined;

  // 1. Direct range match
  const directMatch = diagnostics.find(
    (d) =>
      cursorLine >= d.startLine &&
      cursorLine <= d.endLine &&
      (cursorLine !== d.startLine || cursorColumn >= d.startColumn) &&
      (cursorLine !== d.endLine || cursorColumn <= d.endColumn)
  );

  if (directMatch) return directMatch;

  // 2. Line match
  const lineMatch = diagnostics.find((d) => d.startLine === cursorLine || d.endLine === cursorLine);
  if (lineMatch) return lineMatch;

  return undefined;
}

/**
 * Finds the nearest error or diagnostic in the active file closest to the cursor line.
 */
export function findNearestDiagnostic(
  diagnostics: BugifyDiagnostic[],
  cursorLine: number
): BugifyDiagnostic | undefined {
  if (!diagnostics || diagnostics.length === 0) return undefined;

  // Prioritize errors first
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const pool = errors.length > 0 ? errors : diagnostics;

  let nearest = pool[0];
  let minDistance = Math.abs(pool[0].startLine - cursorLine);

  for (let i = 1; i < pool.length; i++) {
    const distance = Math.abs(pool[i].startLine - cursorLine);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = pool[i];
    }
  }

  return nearest;
}

/**
 * Checks if a file path is relevant to workspace diagnostics (not in node_modules, build output, or sensitive).
 */
export function isWorkspaceRelevantPath(
  fsPath: string,
  relPath?: string,
  workspaceRoots?: string[]
): boolean {
  if (!fsPath) return false;
  const normalizedFs = fsPath.replace(/\\/g, '/');

  // Verify file resides in workspace roots if provided
  if (workspaceRoots && workspaceRoots.length > 0) {
    const isInside = workspaceRoots.some((root) => {
      const normRoot = root.replace(/\\/g, '/');
      return normalizedFs.startsWith(normRoot + '/') || normalizedFs === normRoot;
    });
    if (!isInside) return false;
  }

  // Exclude non-project build / dependency / cache directories
  if (
    normalizedFs.includes('/node_modules/') ||
    normalizedFs.includes('/.git/') ||
    normalizedFs.includes('/.vscode/') ||
    normalizedFs.includes('/.venv/') ||
    normalizedFs.includes('/venv/') ||
    normalizedFs.includes('/dist/') ||
    normalizedFs.includes('/build/') ||
    normalizedFs.includes('/out/') ||
    normalizedFs.includes('/.next/') ||
    normalizedFs.includes('/.turbo/') ||
    normalizedFs.includes('/target/')
  ) {
    return false;
  }

  const checkRel = relPath || normalizedFs;
  return true;
}

/**
 * Groups an array of BugifyDiagnostics by file path and calculates error and warning counts.
 */
export function groupDiagnosticsByFile(diagnostics: BugifyDiagnostic[]): {
  filePath: string;
  uri: string;
  errorCount: number;
  warningCount: number;
  diagnostics: BugifyDiagnostic[];
}[] {
  const fileMap = new Map<string, { uri: string; diags: BugifyDiagnostic[] }>();

  for (const d of diagnostics) {
    const key = d.filePath || 'unknown';
    if (!fileMap.has(key)) {
      fileMap.set(key, { uri: d.uri || '', diags: [] });
    }
    fileMap.get(key)!.diags.push(d);
  }

  const result: {
    filePath: string;
    uri: string;
    errorCount: number;
    warningCount: number;
    diagnostics: BugifyDiagnostic[];
  }[] = [];

  for (const [filePath, { uri, diags }] of fileMap.entries()) {
    let errorCount = 0;
    let warningCount = 0;

    for (const d of diags) {
      if (d.severity === 'error') errorCount++;
      else if (d.severity === 'warning') warningCount++;
    }

    result.push({
      filePath,
      uri,
      errorCount,
      warningCount,
      diagnostics: diags.sort((a, b) => a.startLine - b.startLine),
    });
  }

  // Sort files: errors first, then most issues, then alphabetical
  return result.sort((a, b) => {
    if (a.errorCount > 0 && b.errorCount === 0) return -1;
    if (a.errorCount === 0 && b.errorCount > 0) return 1;
    const totalA = a.errorCount + a.warningCount;
    const totalB = b.errorCount + b.warningCount;
    if (totalA !== totalB) return totalB - totalA;
    return a.filePath.localeCompare(b.filePath);
  });
}
