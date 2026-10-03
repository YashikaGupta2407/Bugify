/**
 * Parser for Python analyzers (Pyright JSON, Pyright text, Mypy, Flake8).
 */

import * as path from 'path';
import { BugifyIssue } from '../types';
import { stripAnsi } from './tscParser';

interface PyrightDiagnostic {
  file: string;
  severity: 'error' | 'warning' | 'information';
  message: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  rule?: string;
}

interface PyrightResult {
  generalDiagnostics?: PyrightDiagnostic[];
}

export function parsePythonOutput(rawOutput: string, workspaceRoot: string): BugifyIssue[] {
  const clean = stripAnsi(rawOutput).trim();
  if (!clean) return [];

  // 1. Try Pyright JSON format
  try {
    const startIdx = clean.indexOf('{');
    const endIdx = clean.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      const jsonStr = clean.slice(startIdx, endIdx + 1);
      const parsed: PyrightResult = JSON.parse(jsonStr);
      if (Array.isArray(parsed.generalDiagnostics)) {
        const issues: BugifyIssue[] = [];
        for (const diag of parsed.generalDiagnostics) {
          let relPath = diag.file;
          if (path.isAbsolute(relPath) && workspaceRoot) {
            relPath = path.relative(workspaceRoot, relPath);
          }
          relPath = relPath.replace(/\\/g, '/');

          // Pyright JSON ranges are 0-based
          const startLine = (diag.range?.start.line ?? 0) + 1;
          const startCol = (diag.range?.start.character ?? 0) + 1;
          const endLine = diag.range ? diag.range.end.line + 1 : undefined;
          const endCol = diag.range ? diag.range.end.character + 1 : undefined;

          const severity: 'error' | 'warning' | 'info' =
            diag.severity === 'error' ? 'error' : diag.severity === 'warning' ? 'warning' : 'info';

          const code = diag.rule || 'pyright';

          issues.push({
            id: `pyright-${relPath}:${startLine}:${startCol}:${code}`,
            filePath: relPath,
            line: startLine,
            column: startCol,
            endLine,
            endColumn: endCol,
            severity,
            message: diag.message,
            source: 'pyright',
            code,
            analyzer: 'pyright',
          });
        }
        return issues;
      }
    }
  } catch {
    // Ignore JSON parse failure, fallback to line matching
  }

  // 2. Line parser for Pyright text / Flake8 / Mypy
  // Examples:
  // src/app.py:12:5 - error: Expected expression (reportGeneralTypeIssues)
  // src/app.py:12:5: error: Argument 1 has incompatible type [arg-type]
  // src/app.py:12:5: E999 SyntaxError: invalid syntax
  const issues: BugifyIssue[] = [];
  const lines = clean.split(/\r?\n/);

  const lineRegex1 = /^(.+?\.py):(\d+):(\d+)(?:\s*-\s*|:\s*)(error|warning|note|info):\s*(.+?)(?:\s*\[([a-zA-Z0-9_\-]+)\]|\s*\(([a-zA-Z0-9_\-]+)\))?$/i;
  const lineRegex2 = /^(.+?\.py):(\d+):(\d+):\s*([EFKW]\d+)\s+(.+)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m1 = trimmed.match(lineRegex1);
    if (m1) {
      const rawFile = m1[1].trim();
      let relPath = path.isAbsolute(rawFile) && workspaceRoot ? path.relative(workspaceRoot, rawFile) : rawFile;
      relPath = relPath.replace(/\\/g, '/');
      const lineNum = parseInt(m1[2], 10);
      const colNum = parseInt(m1[3], 10);
      const sev = m1[4].toLowerCase() === 'error' ? 'error' : m1[4].toLowerCase() === 'warning' ? 'warning' : 'info';
      const msg = m1[5].trim();
      const code = m1[6] || m1[7] || 'python';

      issues.push({
        id: `py-${relPath}:${lineNum}:${colNum}:${code}`,
        filePath: relPath,
        line: lineNum,
        column: colNum,
        severity: sev,
        message: msg,
        source: 'python',
        code,
        analyzer: 'pyright',
      });
      continue;
    }

    const m2 = trimmed.match(lineRegex2);
    if (m2) {
      const rawFile = m2[1].trim();
      let relPath = path.isAbsolute(rawFile) && workspaceRoot ? path.relative(workspaceRoot, rawFile) : rawFile;
      relPath = relPath.replace(/\\/g, '/');
      const lineNum = parseInt(m2[2], 10);
      const colNum = parseInt(m2[3], 10);
      const code = m2[4].toUpperCase();
      const msg = m2[5].trim();
      const sev = code.startsWith('E') || code.startsWith('F') ? 'error' : 'warning';

      issues.push({
        id: `flake8-${relPath}:${lineNum}:${colNum}:${code}`,
        filePath: relPath,
        line: lineNum,
        column: colNum,
        severity: sev,
        message: msg,
        source: 'flake8',
        code,
        analyzer: 'pyright',
      });
    }
  }

  return issues;
}
