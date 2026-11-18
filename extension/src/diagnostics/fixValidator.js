"use strict";

/**
 * @typedef {Object} FixValidationOutput
 * @property {'validated' | 'generated' | 'needs_context' | 'validation_failed' | 'cannot_fix'} status
 * @property {'VERIFIED' | 'SYNTAX_CHECKED' | 'NOT_VERIFIED'} verificationStatus
 * @property {'VERIFIED' | 'SYNTAX_CHECKED' | 'UNVERIFIED'} checkStatus
 * @property {'full_file' | 'code_window' | 'snippet'} scope
 * @property {string} message
 * @property {string} checkerUsed
 */
/**
 * Safe Static Fix Validator (Phase 7 & Phase 8)
 * Statically validates candidate code fixes using TypeScript AST analysis.
 * NEVER executes arbitrary user code, never uses eval(), never runs unsafe child processes.
 * Ensures fixes are honest: only marks VERIFIED if genuine static verification succeeds.
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
exports.validateProposedFix = validateProposedFix;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
let tsModule = null;
function getTs() {
    if (tsModule)
        return tsModule;
    try {
        tsModule = require('typescript');
        return tsModule;
    }
    catch {
        const candidates = [
            path.resolve(__dirname, '../../vendor/typescript/lib/typescript.js'),
            path.resolve(__dirname, '../../../vendor/typescript/lib/typescript.js'),
            path.resolve(__dirname, '../../node_modules/typescript/lib/typescript.js'),
        ];
        for (const cand of candidates) {
            if (fs.existsSync(cand)) {
                try {
                    tsModule = require(cand);
                    return tsModule;
                }
                catch {
                    // ignore
                }
            }
        }
    }
    return null;
}
/**
 * Recheck a supplied full file without executing it. Diagnostic coordinates are
 * 1-based; the end position is exclusive. Compiler character offsets are 0-based.
 * This establishes full_file evidence, not a project-wide or runtime guarantee.
 */
function checkFullFile(ts, { filePath, fileContent, originalCode, correctedCode, diagnostic }) {
    const report = (status, checkStatus, message) => ({
        status, checkStatus, scope: 'full_file',
        verificationStatus: checkStatus === 'UNVERIFIED' ? 'NOT_VERIFIED' : checkStatus,
        message, checkerUsed: 'typescript-checker',
    });
    const line = diagnostic?.startLine;
    const column = diagnostic?.startColumn;
    const code = Number(String(diagnostic?.code || '').replace(/^TS/i, ''));
    if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1 || !code || !originalCode) {
        return report('generated', 'SYNTAX_CHECKED', 'Syntax checked; original diagnostic coordinates are unavailable.');
    }
    const fileName = path.resolve(filePath);
    const source = ts.createSourceFile(fileName, fileContent, ts.ScriptTarget.Latest, true);
    const starts = source.getLineStarts();
    if (line > starts.length) {
        return report('needs_context', 'UNVERIFIED', 'Original diagnostic is outside the supplied full file.');
    }
    const lineStart = starts[line - 1];
    const lineEnd = starts[line] ?? fileContent.length;
    const targetStart = lineStart + column - 1;
    if (targetStart > lineEnd) return report('needs_context', 'UNVERIFIED', 'Original diagnostic column is outside the file line.');
    const endLine = diagnostic.endLine ?? line;
    const endColumn = diagnostic.endColumn ?? column + 1;
    if (!Number.isInteger(endLine) || endLine < line || endLine > starts.length || !Number.isInteger(endColumn) || endColumn < 1) {
        return report('needs_context', 'UNVERIFIED', 'Original diagnostic end position is invalid.');
    }
    const targetEnd = starts[endLine - 1] + endColumn - 1;
    let patchStart = fileContent.indexOf(originalCode);
    while (patchStart >= 0 && !(patchStart <= targetStart && targetStart < patchStart + originalCode.length)) {
        patchStart = fileContent.indexOf(originalCode, patchStart + 1);
    }
    if (patchStart < 0) return report('needs_context', 'UNVERIFIED', 'Original code does not match the diagnostic location in the full file.');
    const patchedContent = fileContent.slice(0, patchStart) + correctedCode + fileContent.slice(patchStart + originalCode.length);
    const options = {
        noEmit: true, strict: true, allowJs: true, checkJs: true,
        skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
    };
    function errors(content) {
        const host = ts.createCompilerHost(options);
        const readFile = host.readFile.bind(host);
        const fileExists = host.fileExists.bind(host);
        host.readFile = name => path.resolve(name) === fileName ? content : readFile(name);
        host.fileExists = name => path.resolve(name) === fileName || fileExists(name);
        const program = ts.createProgram([fileName], options, host);
        return ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
    }
    const before = errors(fileContent);
    const atTarget = d => d.code === code && d.file && path.resolve(d.file.fileName) === fileName &&
        d.start >= targetStart && d.start < Math.max(targetStart + 1, targetEnd);
    if (!before.some(atTarget)) {
        return report('generated', 'SYNTAX_CHECKED', 'Syntax checked; the supplied original diagnostic could not be reproduced at its location.');
    }
    const after = errors(patchedContent);
    if (after.some(atTarget)) return report('validation_failed', 'UNVERIFIED', 'The original diagnostic remains after checking the patched full file.');
    const delta = correctedCode.length - originalCode.length;
    const fingerprint = (d, patched) => {
        let start = d.start;
        if (patched && d.file && path.resolve(d.file.fileName) === fileName && start >= patchStart + correctedCode.length) start -= delta;
        return JSON.stringify([d.file?.fileName, d.code, start, ts.flattenDiagnosticMessageText(d.messageText, '\n')]);
    };
    const remaining = new Map();
    for (const d of before) { const key = fingerprint(d, false); remaining.set(key, (remaining.get(key) || 0) + 1); }
    for (const d of after) {
        const key = fingerprint(d, true);
        if (!remaining.get(key)) return report('validation_failed', 'UNVERIFIED', 'The patched full file introduces a new checker error.');
        remaining.set(key, remaining.get(key) - 1);
    }
    return report('validated', 'VERIFIED', 'Full file checker rerun: the original diagnostic is gone and no new errors were introduced.');
}

function validateProposedFix(params) {
    const { filePath = 'snippet.ts', fileContent, originalCode, correctedCode, diagnostic } = params;
    const scope = typeof fileContent === 'string' ? 'full_file' : 'snippet';
    const report = (status, checkStatus, message, checkerUsed = 'static_ast_guard') => ({
        status, checkStatus, scope, message, checkerUsed,
        verificationStatus: checkStatus === 'UNVERIFIED' ? 'NOT_VERIFIED' : checkStatus,
    });
    if (!correctedCode || !correctedCode.trim()) return report('needs_context', 'UNVERIFIED', 'No replacement code is available.');
    if (correctedCode === originalCode) return report('needs_context', 'UNVERIFIED', 'Proposed change is identical to original code.');
    if (correctedCode.includes('console?.') && !originalCode?.includes('console?.')) {
        return report('validation_failed', 'UNVERIFIED', 'Fix guarded console rather than the problematic property dereference.');
    }
    if (/\/\/\s*@ts-(ignore|nocheck)|\bas\s+any\b|\/\*\s*eslint-disable/.test(correctedCode)) {
        return report('validation_failed', 'UNVERIFIED', 'Replacement suppresses errors rather than establishing a repair.');
    }
    if (!/\.(?:[cm]?[jt]sx?)$/i.test(filePath)) return report('generated', 'UNVERIFIED', 'No checker rerun is available for this language.');
    try {
        const ts = getTs();
        if (!ts) return report('generated', 'UNVERIFIED', 'TypeScript checker unavailable.');
        const scriptKind = /\.jsx?$/i.test(filePath) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
        const parsed = ts.createSourceFile(filePath, correctedCode, ts.ScriptTarget.Latest, true, scriptKind);
        if (parsed.parseDiagnostics.length) return report('validation_failed', 'UNVERIFIED', 'Syntax error detected in proposed code snippet.', 'typescript-parser');
        if (typeof fileContent === 'string') return checkFullFile(ts, { filePath, fileContent, originalCode, correctedCode, diagnostic });
        return report('generated', 'SYNTAX_CHECKED', 'Syntax checked only; no full file was supplied.', 'typescript-parser');
    } catch (err) {
        return report('generated', 'UNVERIFIED', 'Checker unavailable: ' + err.message);
    }
}
