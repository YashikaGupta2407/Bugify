/**
 * Parser for TypeScript Compiler (tsc) output.
 * Handles both standard:
 *   src/file.ts:3:5 - error TS2322: Message
 * and parenthesized:
 *   src/file.ts(3,5): error TS2322: Message
 */

import * as path from 'path';
import { BugifyIssue } from '../types';

const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export function parseTscOutput(rawOutput: string, workspaceRoot: string): BugifyIssue[] {
  const cleanOutput = stripAnsi(rawOutput);
  const lines = cleanOutput.split(/\r?\n/);
  const issues: BugifyIssue[] = [];

  // Regex 1: path/file.ts:line:col - (error|warning|info) TSxxxx: message
  const colonRegex = /^(.+?):(\d+):(\d+)\s*-\s*(error|warning|info)\s+(TS\d+):\s*(.+)$/i;

  // Regex 2: path/file.ts(line,col): (error|warning|info) TSxxxx: message
  const parenRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s+(TS\d+):\s*(.+)$/i;

  let currentIssue: BugifyIssue | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const colonMatch = trimmed.match(colonRegex);
    const parenMatch = trimmed.match(parenRegex);
    const match = colonMatch || parenMatch;

    if (match) {
      if (currentIssue) {
        issues.push(currentIssue);
        currentIssue = null;
      }

      const rawFile = match[1].trim();
      const lineNum = parseInt(match[2], 10);
      const colNum = parseInt(match[3], 10);
      const rawSev = match[4].toLowerCase();
      const code = match[5].toUpperCase();
      const message = match[6].trim();

      // Normalize path relative to workspaceRoot
      let relPath = rawFile;
      if (path.isAbsolute(rawFile) && workspaceRoot) {
        relPath = path.relative(workspaceRoot, rawFile);
      }
      relPath = relPath.replace(/\\/g, '/');

      const severity: 'error' | 'warning' | 'info' =
        rawSev === 'error' ? 'error' : rawSev === 'warning' ? 'warning' : 'info';

      currentIssue = {
        id: `tsc-${relPath}:${lineNum}:${colNum}:${code}`,
        filePath: relPath,
        line: lineNum,
        column: colNum,
        severity,
        message,
        source: 'typescript',
        code,
        analyzer: 'tsc',
        rawOutput: trimmed,
      };
    } else if (currentIssue) {
      // Check if line is a continuation message or code snippet line
      // Ignore lines like "Found 1 error." or underline markers "~~~~~"
      if (/^Found \d+ error/i.test(trimmed) || /^Errors\s+Files/i.test(trimmed)) {
        issues.push(currentIssue);
        currentIssue = null;
      } else if (!/^[~^]+$/.test(trimmed) && !/^\d+\s+/.test(trimmed)) {
        // Append additional explanation line to message
        currentIssue.message += ` ${trimmed}`;
      }
    }
  }

  if (currentIssue) {
    issues.push(currentIssue);
  }

  return issues;
}
