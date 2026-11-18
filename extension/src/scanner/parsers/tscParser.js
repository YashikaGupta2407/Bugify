"use strict";
/**
 * Parser for TypeScript Compiler (tsc) output.
 * Handles both standard:
 *   src/file.ts:3:5 - error TS2322: Message
 * and parenthesized:
 *   src/file.ts(3,5): error TS2322: Message
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
exports.stripAnsi = stripAnsi;
exports.parseTscOutput = parseTscOutput;
const path = __importStar(require("path"));
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(text) {
    return text.replace(ANSI_REGEX, '');
}
function parseTscOutput(rawOutput, workspaceRoot) {
    const cleanOutput = stripAnsi(rawOutput);
    const lines = cleanOutput.split(/\r?\n/);
    const issues = [];
    // Regex 1: path/file.ts:line:col - (error|warning|info) TSxxxx: message
    const colonRegex = /^(.+?):(\d+):(\d+)\s*-\s*(error|warning|info)\s+(TS\d+):\s*(.+)$/i;
    // Regex 2: path/file.ts(line,col): (error|warning|info) TSxxxx: message
    const parenRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s+(TS\d+):\s*(.+)$/i;
    let currentIssue = null;
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
            let severity = rawSev === 'error' ? 'error' : rawSev === 'warning' ? 'warning' : 'info';
            // Informational suggestions or migration hints must not be flagged as fatal errors
            if (code === 'TS80001' || code === '80001') {
                severity = 'info';
            }
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
        }
        else if (currentIssue) {
            // Check if line is a continuation message or code snippet line
            // Ignore lines like "Found 1 error." or underline markers "~~~~~"
            if (/^Found \d+ error/i.test(trimmed) || /^Errors\s+Files/i.test(trimmed)) {
                issues.push(currentIssue);
                currentIssue = null;
            }
            else if (!/^[~^]+$/.test(trimmed) && !/^\d+\s+/.test(trimmed)) {
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
