"use strict";

/**
 * @typedef {Object} CodeWindowOptions
 * @property {string} content
 * @property {number} targetLine
 * @property {number} [contextLines]
 * @property {string} [selectionText]
 * @property {number} [maxChars]
 */

/**
 * @typedef {Object} CodeWindowResult
 * @property {string} codeContext
 * @property {number} startLine
 * @property {number} endLine
 * @property {boolean} truncated
 */
/**
 * Pure functions for code windowing, selection slicing, and payload size capping.
 * No VS Code dependencies - fully testable with standard Node.js.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCodeWindow = extractCodeWindow;
exports.capSelection = capSelection;
/**
 * Extracts a bounded window of code lines around a target line or selection.
 */
function extractCodeWindow(options) {
    const { content = '', targetLine = 1, contextLines = 20, selectionText = '', maxChars = 64000, } = options;
    if (!content) {
        return {
            codeContext: '',
            startLine: 1,
            endLine: 1,
            truncated: false,
        };
    }
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    // Clamp targetLine to [1, totalLines]
    const clampedTarget = Math.max(1, Math.min(targetLine, totalLines));
    // Determine line range
    let startLine;
    let endLine;
    if (selectionText && selectionText.trim().length > 0) {
        // If a selection exists, use a tighter cushion around the target
        const cushion = Math.min(contextLines, 5);
        startLine = Math.max(1, clampedTarget - cushion);
        endLine = Math.min(totalLines, clampedTarget + cushion);
    }
    else {
        // Standard window: targetLine - contextLines to targetLine + contextLines
        startLine = Math.max(1, clampedTarget - contextLines);
        endLine = Math.min(totalLines, clampedTarget + contextLines);
    }
    // 0-indexed slice: startLine - 1 to endLine
    const windowLines = lines.slice(startLine - 1, endLine);
    let codeContext = windowLines.join('\n');
    let truncated = false;
    // Cap total characters if it exceeds maxChars
    if (codeContext.length > maxChars) {
        codeContext = codeContext.slice(0, maxChars) + '\n// [TRUNCATED DUE TO SIZE LIMIT]';
        truncated = true;
    }
    return {
        codeContext,
        startLine,
        endLine,
        truncated,
    };
}
/**
 * Caps selection text if it exceeds maximum allowed length.
 */
function capSelection(selection, maxChars = 16000) {
    if (!selection)
        return '';
    if (selection.length <= maxChars)
        return selection;
    return selection.slice(0, maxChars) + '\n// [SELECTION TRUNCATED]';
}
