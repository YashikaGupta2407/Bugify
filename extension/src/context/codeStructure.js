"use strict";
/**
 * Pure functions for extracting imports and enclosing function context.
 * Testable with standard Node.js without VS Code dependencies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTopImports = extractTopImports;
exports.extractEnclosingFunction = extractEnclosingFunction;
/**
 * Extracts top-of-file import statements.
 */
function extractTopImports(content, language = 'plaintext', maxLines = 30) {
    if (!content)
        return '';
    const lines = content.split(/\r?\n/);
    const importLines = [];
    const lang = language.toLowerCase();
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
        const line = lines[i].trim();
        if (lang === 'typescript' || lang === 'javascript') {
            if (line.startsWith('import ') ||
                line.startsWith('import(') ||
                line.includes('require(') ||
                (line.startsWith('from ') && line.includes('import'))) {
                importLines.push(lines[i]);
            }
        }
        else if (lang === 'python') {
            if (line.startsWith('import ') || line.startsWith('from ')) {
                importLines.push(lines[i]);
            }
        }
        if (importLines.length >= maxLines)
            break;
    }
    return importLines.join('\n');
}
/**
 * Attempts to find and extract the enclosing function or method surrounding targetLine (1-based).
 */
function extractEnclosingFunction(content, targetLine, language = 'plaintext', maxLines = 60) {
    if (!content || targetLine < 1)
        return undefined;
    const lines = content.split(/\r?\n/);
    if (targetLine > lines.length)
        return undefined;
    const lang = language.toLowerCase();
    const targetIdx = targetLine - 1;
    // Search backwards from target line for function declaration
    let startIdx = -1;
    const isJsTs = lang === 'typescript' || lang === 'javascript';
    const isPython = lang === 'python';
    const jsFunctionPattern = /^\s*(export\s+)?(default\s+)?(async\s+)?(function\b|\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>|\w+\s*\([^)]*\)\s*\{)/;
    const pyFunctionPattern = /^\s*(async\s+)?(def|class)\s+\w+/;
    for (let i = targetIdx; i >= 0; i--) {
        const line = lines[i];
        if (isJsTs && jsFunctionPattern.test(line)) {
            startIdx = i;
            break;
        }
        else if (isPython && pyFunctionPattern.test(line)) {
            startIdx = i;
            break;
        }
        // Limit lookback
        if (targetIdx - i > 100)
            break;
    }
    if (startIdx === -1)
        return undefined;
    // Now scan forwards to find the end of the block
    let endIdx = Math.min(lines.length - 1, startIdx + maxLines);
    if (isJsTs) {
        let braceCount = 0;
        let foundOpenBrace = false;
        for (let i = startIdx; i < lines.length && i - startIdx < maxLines; i++) {
            const line = lines[i];
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    foundOpenBrace = true;
                }
                else if (char === '}') {
                    braceCount--;
                }
            }
            if (foundOpenBrace && braceCount === 0 && i >= targetIdx) {
                endIdx = i;
                break;
            }
        }
    }
    else if (isPython) {
        const startIndentMatch = lines[startIdx].match(/^(\s*)/);
        const startIndent = startIndentMatch ? startIndentMatch[1].length : 0;
        for (let i = startIdx + 1; i < lines.length && i - startIdx < maxLines; i++) {
            const line = lines[i];
            if (line.trim().length === 0 || line.trim().startsWith('#'))
                continue;
            const currentIndentMatch = line.match(/^(\s*)/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[1].length : 0;
            if (currentIndent <= startIndent && i > targetIdx) {
                endIdx = i - 1;
                break;
            }
        }
    }
    const selected = lines.slice(startIdx, endIdx + 1);
    return selected.join('\n');
}
