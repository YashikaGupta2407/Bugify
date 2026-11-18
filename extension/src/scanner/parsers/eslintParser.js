"use strict";

/**
 * @typedef {Object} EslintMessage
 * @property {string | null} ruleId
 * @property {number} severity
 * @property {string} message
 * @property {number} line
 * @property {number} column
 * @property {number} [endLine]
 * @property {number} [endColumn]
 */

/**
 * @typedef {Object} EslintFileResult
 * @property {string} filePath
 * @property {EslintMessage[]} messages
 * @property {number} errorCount
 * @property {number} warningCount
 */
/**
 * Parser for ESLint output.
 * Prefers JSON formatted output (`--format json`), falls back to standard text output.
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
exports.parseEslintOutput = parseEslintOutput;
const path = __importStar(require("path"));
const tscParser_1 = require("./tscParser");
function parseEslintOutput(rawOutput, workspaceRoot) {
    const clean = (0, tscParser_1.stripAnsi)(rawOutput).trim();
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
            const parsed = JSON.parse(jsonStr);
            const issues = [];
            for (const fileResult of parsed) {
                let relPath = fileResult.filePath;
                if (path.isAbsolute(relPath) && workspaceRoot) {
                    relPath = path.relative(workspaceRoot, relPath);
                }
                relPath = relPath.replace(/\\/g, '/');
                for (const msg of fileResult.messages) {
                    const severity = msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info';
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
    }
    catch {
        // Not valid JSON, fall back to line parser
    }
    // Text parser fallback
    // e.g.: /path/to/file.js: line 3, col 13, Error - 'username' is not defined. (no-undef)
    // or:   /path/to/file.js:3:13: error: 'username' is not defined. [no-undef]
    const issues = [];
    const lines = clean.split(/\r?\n/);
    let currentFile = '';
    const fileHeaderRegex = /^([^\s].+?\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte))$/i;
    const lineIssueRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+([a-zA-Z0-9_\-/@]+))?$/i;
    const compactRegex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+?)(?:\s*\[([a-zA-Z0-9_\-/@]+)\])?$/i;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
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
