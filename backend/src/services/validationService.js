/**
 * Safe Fix Validation Service
 * 
 * Validates generated code corrections without executing arbitrary user code.
 * Uses AST parsers (TypeScript compiler API, Python AST) to verify syntax
 * and detect regressions or unsafe type-suppression anti-patterns.
 */

const { spawnSync } = require('child_process');
const path = require('path');

let ts;
try {
  ts = require('typescript');
} catch (e) {
  ts = null;
}

/**
 * Validates a generated code fix.
 * 
 * @param {Object} params
 * @param {string} params.language - 'typescript' | 'javascript' | 'python' | etc.
 * @param {string} [params.originalCode] - Problematic original code snippet
 * @param {string} [params.correctedCode] - Proposed corrected code
 * @param {string} [params.status] - 'fixed' | 'needs_context' | 'cannot_fix'
 * @param {Object} [params.diagnostic] - Diagnostic information
 * @returns {Object} Validation report: { status, message, checkerUsed }
 */
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
function validateFix({ language = 'plaintext', originalCode, correctedCode, status = 'fixed', diagnostic, filePath, fullFileContent, codeContext }) {
  const scope = typeof fullFileContent === 'string' ? 'full_file' : typeof codeContext === 'string' ? 'code_window' : 'snippet';
  const report = (status, checkStatus, message, checkerUsed = 'context-checker') => ({
    status, checkStatus, scope, message, checkerUsed,
    verificationStatus: checkStatus === 'UNVERIFIED' ? 'NOT_VERIFIED' : checkStatus,
  });
  if (String(status).toLowerCase() === 'needs_context') return report('needs_context', 'UNVERIFIED', 'More context is required to propose a repair.');
  if (status === 'cannot_fix' || !correctedCode || !correctedCode.trim()) return report('cannot_fix', 'UNVERIFIED', 'No replacement code is available.');
  if (/\/\/\s*@ts-(ignore|nocheck)|\bas\s+any\b|\/\*\s*eslint-disable/.test(correctedCode)) {
    return report('validation_failed', 'UNVERIFIED', 'Replacement uses type suppression instead of fixing the root cause.', 'quality-linter');
  }
  const lang = language.toLowerCase();
  if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(lang) && ts) {
    try {
      const fileName = filePath || (lang.startsWith('typescript') ? 'validation_target.ts' : 'validation_target.js');
      const kind = lang.startsWith('typescript') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
      const sourceFile = ts.createSourceFile(fileName, correctedCode, ts.ScriptTarget.Latest, true, kind);
      if (sourceFile.parseDiagnostics.length) return report('validation_failed', 'UNVERIFIED', 'Syntax error in replacement code.', 'typescript-parser');
      if (typeof fullFileContent === 'string') {
        return checkFullFile(ts, { filePath: fileName, fileContent: fullFileContent, originalCode, correctedCode, diagnostic });
      }
      return report('generated', 'SYNTAX_CHECKED', 'Syntax checked only; no full file was supplied.', 'typescript-parser');
    } catch (err) {
      return report('generated', 'UNVERIFIED', 'Checker unavailable: ' + err.message, 'typescript-fallback');
    }
  }
  if (lang === 'python') {
    try {
      const res = spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
        input: correctedCode, encoding: 'utf8', timeout: 2500,
      });
      if (res.error) return report('generated', 'UNVERIFIED', 'Python syntax parser unavailable.', 'python3-fallback');
      if (res.status !== 0) return report('validation_failed', 'UNVERIFIED', 'Python syntax check failed.', 'python3-ast');
      // Only the replacement was parsed: do not claim to have checked a full file.
      return { ...report('generated', 'SYNTAX_CHECKED', 'Python syntax checked only; no diagnostic checker was rerun.', 'python3-ast'), scope: 'snippet' };
    } catch {
      return report('generated', 'UNVERIFIED', 'Python syntax parser unavailable.', 'python3-fallback');
    }
  }
  return report('generated', 'UNVERIFIED', 'No checker rerun is available for this language.', 'heuristic');
}

module.exports = { validateFix };
