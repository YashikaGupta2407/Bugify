/**
 * Pure functions for diagnostic code normalization, severity mapping, and 1-based conversions.
 * No VS Code dependencies - safe to test in standard Node.js test runner.
 */

import { BugifyDiagnostic, ErrorCategory } from '../types/bugify';

/**
 * Normalizes common errors into useful categories adhering to Phase 12.
 * Returns UNKNOWN if confidence is low.
 */
export function classifyErrorCategory(
  diagnostic: {
    message?: string;
    code?: string | number;
    source?: string;
  },
  language?: string
): ErrorCategory {
  const msg = (diagnostic.message || '').toLowerCase();
  const code = String(diagnostic.code || '').toUpperCase();
  const source = (diagnostic.source || '').toLowerCase();
  const lang = (language || '').toLowerCase();

  // 1. NULL / UNDEFINED
  if (
    code === '2532' ||
    code === 'TS2532' ||
    code === '2531' ||
    code === 'TS2531' ||
    code === '2533' ||
    code === 'TS2533' ||
    code === '18048' ||
    code === 'TS18048' ||
    code === '18047' ||
    code === 'TS18047' ||
    msg.includes("possibly 'undefined'") ||
    msg.includes("possibly 'null'") ||
    msg.includes("is possibly 'null' or 'undefined'") ||
    msg.includes('cannot read property') ||
    msg.includes('cannot read properties of undefined') ||
    msg.includes('cannot read properties of null') ||
    msg.includes("'nonetype' object has no attribute")
  ) {
    return 'NULL / UNDEFINED';
  }

  // 2. REFERENCE
  if (
    code === '2304' ||
    code === 'TS2304' ||
    code === '2552' ||
    code === 'TS2552' ||
    code === 'NO-UNDEF' ||
    code === 'REPORTUNDEFINEDVARIABLE' ||
    code === 'F821' ||
    msg.includes('cannot find name') ||
    msg.includes('is not defined') ||
    msg.includes('nameerror') ||
    msg.includes('referenceerror')
  ) {
    return 'REFERENCE';
  }

  // 3. TYPE
  if (
    code === '2322' ||
    code === 'TS2322' ||
    code === '2345' ||
    code === 'TS2345' ||
    code === '2365' ||
    code === 'TS2365' ||
    code === '2367' ||
    code === 'TS2367' ||
    code === '2741' ||
    code === 'TS2741' ||
    code === '2769' ||
    code === 'TS2769' ||
    code === '2352' ||
    code === 'TS2352' ||
    code === 'REPORTGENERALTYPEISSUES' ||
    msg.includes('not assignable to type') ||
    msg.includes('typeerror') ||
    msg.includes('incompatible types')
  ) {
    return 'TYPE';
  }

  // 4. IMPORT
  if (
    code === '2307' ||
    code === 'TS2307' ||
    code === '2306' ||
    code === 'TS2306' ||
    code === '2792' ||
    code === 'TS2792' ||
    code === 'IMPORT/NO-UNRESOLVED' ||
    msg.includes('cannot find module') ||
    msg.includes('is not exported from') ||
    msg.includes('modulenotfounderror') ||
    msg.includes('importerror')
  ) {
    return 'IMPORT';
  }

  // 5. SYNTAX
  if (
    code.startsWith('10') ||
    code.startsWith('TS10') ||
    code.startsWith('11') ||
    code.startsWith('TS11') ||
    code === '1434' ||
    code === 'TS1434' ||
    code === 'SYNTAXERROR' ||
    msg.includes('declaration or statement expected') ||
    msg.includes('unexpected token') ||
    msg.includes("';' expected") ||
    msg.includes("expected ':'") ||
    msg.includes('invalid syntax') ||
    msg.includes('indentationerror') ||
    msg.includes('syntax error') ||
    msg.includes('syntaxerror')
  ) {
    return 'SYNTAX';
  }

  // 6. CONFIGURATION
  if (
    code === '80001' ||
    code === 'TS80001' ||
    code === '18003' ||
    code === 'TS18003' ||
    code === '5023' ||
    code === 'TS5023' ||
    msg.includes('file is a commonjs module') ||
    msg.includes('tsconfig') ||
    msg.includes('jsconfig')
  ) {
    return 'CONFIGURATION';
  }

  // 7. LINT
  if (
    source === 'eslint' ||
    code === '6133' ||
    code === 'TS6133' ||
    msg.includes('declared but its value is never read') ||
    msg.includes('declared but never used') ||
    code.includes('NO-UNUSED') ||
    code.includes('EQEQEQ')
  ) {
    return 'LINT';
  }

  // 8. ASYNC
  if (
    msg.includes('promise') ||
    msg.includes('await') ||
    msg.includes('async') ||
    msg.includes('unhandledpromiserejection')
  ) {
    return 'ASYNC';
  }

  // 9. API
  if (
    msg.includes('econnrefused') ||
    msg.includes('fetch') ||
    msg.includes('axios') ||
    msg.includes('status code 4') ||
    msg.includes('status code 5')
  ) {
    return 'API';
  }

  // 10. DATABASE
  if (
    msg.includes('prisma') ||
    msg.includes('sql') ||
    msg.includes('postgres') ||
    msg.includes('mongodb') ||
    msg.includes('database') ||
    msg.includes('relation does not exist')
  ) {
    return 'DATABASE';
  }

  // 11. SECURITY
  if (
    msg.includes('vulnerability') ||
    msg.includes('cve-') ||
    msg.includes('insecure') ||
    msg.includes('eval')
  ) {
    return 'SECURITY';
  }

  // 12. RUNTIME
  if (
    msg.includes('runtimeerror') ||
    msg.includes('zerodivisionerror') ||
    msg.includes('recursionerror')
  ) {
    return 'RUNTIME';
  }

  return 'UNKNOWN';
}

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
 * Determines whether a diagnostic is actionable (Error or Warning).
 * Information and Hint diagnostics are non-actionable suggestions and are excluded
 * from default actionable issue lists.
 */
export function isActionableSeverity(
  severity: number | string | undefined
): boolean {
  const norm = mapDiagnosticSeverity(severity);
  return norm === 'error' || norm === 'warning';
}

export interface SeverityMetadata {
  severity: 'error' | 'warning' | 'information' | 'hint';
  label: 'ERROR' | 'WARNING' | 'INFORMATION' | 'HINT';
  cssClass: 'error' | 'warning' | 'info';
  rowClass: 'row-error' | 'row-warning' | 'row-info';
  glyph: '■' | '△' | '○';
  isActionable: boolean;
}

/**
 * Returns UI metadata (label, CSS classes, glyph, actionable state) for a given severity.
 */
export function getSeverityMetadata(
  rawSeverity: number | string | undefined
): SeverityMetadata {
  const norm = mapDiagnosticSeverity(rawSeverity);
  switch (norm) {
    case 'error':
      return {
        severity: 'error',
        label: 'ERROR',
        cssClass: 'error',
        rowClass: 'row-error',
        glyph: '■',
        isActionable: true,
      };
    case 'warning':
      return {
        severity: 'warning',
        label: 'WARNING',
        cssClass: 'warning',
        rowClass: 'row-warning',
        glyph: '△',
        isActionable: true,
      };
    case 'information':
      return {
        severity: 'information',
        label: 'INFORMATION',
        cssClass: 'info',
        rowClass: 'row-info',
        glyph: '○',
        isActionable: false,
      };
    case 'hint':
      return {
        severity: 'hint',
        label: 'HINT',
        cssClass: 'info',
        rowClass: 'row-info',
        glyph: '○',
        isActionable: false,
      };
  }
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
