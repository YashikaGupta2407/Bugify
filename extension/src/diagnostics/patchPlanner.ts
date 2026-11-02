/**
 * Pure patch planning for applying AI-proposed fixes.
 * Converts line-based changes into exact [startOffset, endOffset) replacements
 * against the current document text, refusing missing, ambiguous, or overlapping
 * matches. No VS Code dependency so it can be unit tested directly.
 */

import { CodeChange } from '../types/bugify';

export interface PlannedPatch {
  startOffset: number;
  endOffset: number;
  before: string;
  after: string;
  line: number;
}

export type PatchPlanResult =
  | { ok: true; patches: PlannedPatch[] }
  | { ok: false; reason: string };

export interface PatchPlanInput {
  text: string;
  changes?: CodeChange[];
  targetLine?: number;
  originalCode?: string;
  correctedCode?: string;
}

function lineStartOffset(text: string, oneBasedLine: number): number | null {
  if (!Number.isInteger(oneBasedLine) || oneBasedLine < 1) return null;
  let offset = 0;
  for (let line = 1; line < oneBasedLine; line++) {
    const newline = text.indexOf('\n', offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  return offset;
}

function lineTextAt(text: string, oneBasedLine: number): string | null {
  const start = lineStartOffset(text, oneBasedLine);
  if (start === null) return null;
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline;
  return text.slice(start, end).replace(/\r$/, '');
}

function indexOfAll(text: string, needle: string): number[] {
  const positions: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    positions.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return positions;
}

/**
 * Locates one change. The declared line constrains the search when possible;
 * otherwise the text must occur exactly once in the document.
 */
function locateChange(
  text: string,
  before: string,
  line?: number
): { offset: number } | { reason: string } {
  if (typeof line === 'number') {
    const lineStart = lineStartOffset(text, line);
    const lineText = lineTextAt(text, line);
    if (lineStart !== null && lineText !== null && !before.includes('\n')) {
      const inLine = lineText.indexOf(before);
      if (inLine !== -1) {
        if (lineText.indexOf(before, inLine + 1) !== -1) {
          return { reason: `line ${line} contains more than one occurrence of the change text` };
        }
        return { offset: lineStart + inLine };
      }
    }

    if (lineStart !== null && lineText !== null && before.includes('\n')) {
      const indentation = lineText.length - lineText.trimStart().length;
      for (const candidate of [lineStart, lineStart + indentation]) {
        if (text.startsWith(before, candidate)) return { offset: candidate };
      }
    }
  }

  const positions = indexOfAll(text, before);
  if (positions.length === 1) return { offset: positions[0] };
  if (positions.length === 0) return { reason: 'the original text was not found in the file' };
  return { reason: 'the original text occurs more than once in the file' };
}

function planOne(
  text: string,
  before: string | undefined,
  after: string | undefined,
  line: number | undefined
): PlannedPatch | { reason: string } {
  if (typeof before !== 'string' || before.length === 0) {
    return { reason: 'a change is missing its original text' };
  }
  if (typeof after !== 'string') {
    return { reason: 'a change is missing its replacement text' };
  }
  if (before === after) {
    return { reason: `the change on line ${line ?? '?'} does not modify anything` };
  }

  const located = locateChange(text, before, line);
  if ('reason' in located) {
    return { reason: typeof line === 'number' ? `${located.reason} (line ${line})` : located.reason };
  }

  return {
    startOffset: located.offset,
    endOffset: located.offset + before.length,
    before,
    after,
    line: typeof line === 'number' ? line : 0,
  };
}

export function planPatches(input: PatchPlanInput): PatchPlanResult {
  const { text, changes, targetLine, originalCode, correctedCode } = input;
  const candidates: Array<CodeChange> =
    Array.isArray(changes) && changes.length > 0
      ? changes
      : originalCode && correctedCode
        ? [{ line: targetLine || 0, before: originalCode, after: correctedCode, reason: '' }]
        : [];

  if (candidates.length === 0) {
    return { ok: false, reason: 'no change to apply' };
  }

  const patches: PlannedPatch[] = [];
  for (const candidate of candidates) {
    const planned = planOne(text, candidate.before, candidate.after, candidate.line);
    if ('reason' in planned) return { ok: false, reason: planned.reason };
    patches.push(planned);
  }

  patches.sort((a, b) => a.startOffset - b.startOffset);
  for (let i = 1; i < patches.length; i++) {
    if (patches[i].startOffset < patches[i - 1].endOffset) {
      return { ok: false, reason: 'two changes overlap in the file' };
    }
  }

  return { ok: true, patches };
}
