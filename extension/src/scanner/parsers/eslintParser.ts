/**
 * Parser for ESLint output.
 * Prefers JSON formatted output (`--format json`), falls back to standard text output.
 */

import * as path from 'path';
import { BugifyIssue } from '../types';
import { stripAnsi } from './tscParser';

interface EslintMessage {
  ruleId: string | null;
  severity: number; // 1 = warning, 2 = error
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
  errorCount: number;
  warningCount: number;
}

export function parseEslintOutput(rawOutput: string, workspaceRoot: string): BugifyIssue[] {
  const clean = stripAnsi(rawOutput).trim();
  if (!clean) {
    return [];
  }

  // Try parsing JSON format first
  try {
    // Find the JSON array boundary in case there's preceding or trailing text
    const startIdx = clean.indexOf('[');
    const endIdx = clean.lastIndexOf(']');
    if (startIdx >= 0 && endIdx > startIdx) {
      const jsonStr = clean.slice(startIdx, endIdx + 1);
      const parsed: EslintFileResult[] = JSON.parse(jsonStr);
      const issues: BugifyIssue[] = [];

      for (const fileResult of parsed) {
        let relPath = fileResult.filePath;
        if (path.isAbsolute(relPath) && workspaceRoot) {
          relPath = path.relative(workspaceRoot, relPath);
        }
        relPath = relPath.replace(/\\/g, '/');

        for (const msg of fileResult.messages) {
          const severity: 'error' | 'warning' | 'info' =
            msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info';

          const code = msg.ruleId || 'eslint';
          issues.push({
            id: `eslint-${relPath}:${msg.line}:${msg.column}:${code}`,
            filePath: relPath,
            line: msg.line,
            column: msg.column,
            endLine: msg.endLine,
            endColumn: msg.endColumn,
            severity,
            message: msg.message,
            source: 'eslint',
            code,
            analyzer: 'eslint',
          });
        }
      }
      return issues;
    }
  } catch {
    // Not valid JSON, fall back to line parser
  }

  // Text parser fallback
  // e.g.: /path/to/file.js: line 3, col 13, Error - 'username' is not defined. (no-undef)
  // or:   /path/to/file.js:3:13: error: 'username' is not defined. [no-undef]
  const issues: BugifyIssue[] = [];
  const lines = clean.split(/\r?\n/);
  let currentFile = '';

  const fileHeaderRegex = /^([^\s].+?\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte))$/i;
  const lineIssueRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+([a-zA-Z0-9_\-/@]+))?$/i;
  const compactRegex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+?)(?:\s*\[([a-zA-Z0-9_\-/@]+)\])?$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const compactMatch = trimmed.match(compactRegex);
    if (compactMatch) {
      const rawFile = compactMatch[1].trim();
      let relPath = path.isAbsolute(rawFile) && workspaceRoot ? path.relative(workspaceRoot, rawFile) : rawFile;
      relPath = relPath.replace(/\\/g, '/');
      const lineNum = parseInt(compactMatch[2], 10);
      const colNum = parseInt(compactMatch[3], 10);
      const sev = compactMatch[4].toLowerCase() === 'error' ? 'error' : 'warning';
      const msg = compactMatch[5].trim();
      const code = compactMatch[6] || 'eslint';

      issues.push({
        id: `eslint-${relPath}:${lineNum}:${colNum}:${code}`,
        filePath: relPath,
        line: lineNum,
        column: colNum,
        severity: sev,
        message: msg,
        source: 'eslint',
        code,
        analyzer: 'eslint',
      });
      continue;
    }

    const headerMatch = line.match(fileHeaderRegex);
    if (headerMatch) {
      currentFile = headerMatch[1].trim();
      continue;
    }

    const issueMatch = line.match(lineIssueRegex);
    if (issueMatch && currentFile) {
      let relPath = path.isAbsolute(currentFile) && workspaceRoot ? path.relative(workspaceRoot, currentFile) : currentFile;
      relPath = relPath.replace(/\\/g, '/');
      const lineNum = parseInt(issueMatch[1], 10);
      const colNum = parseInt(issueMatch[2], 10);
      const sev = issueMatch[3].toLowerCase() === 'error' ? 'error' : 'warning';
      const msg = issueMatch[4].trim();
      const code = issueMatch[5] || 'eslint';

      issues.push({
        id: `eslint-${relPath}:${lineNum}:${colNum}:${code}`,
        filePath: relPath,
        line: lineNum,
        column: colNum,
        severity: sev,
        message: msg,
        source: 'eslint',
        code,
        analyzer: 'eslint',
      });
    }
  }

  return issues;
}
