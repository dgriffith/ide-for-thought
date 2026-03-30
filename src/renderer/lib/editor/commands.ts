import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { EditorSelection, type Text } from '@codemirror/state';
import type { Command } from '@codemirror/view';

// ── Toggle Case ─────────────────────────────────────────────────────────────

export function isAllLower(s: string): boolean { return s === s.toLowerCase() && s !== s.toUpperCase(); }
export function isAllUpper(s: string): boolean { return s === s.toUpperCase() && s !== s.toLowerCase(); }

export function toTitleCase(s: string): string {
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export const toggleCase: Command = (view: EditorView) => {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    let from = range.from;
    let to = range.to;

    // If no selection, expand to word under cursor
    if (from === to) {
      const line = state.doc.lineAt(from);
      const text = line.text;
      const col = from - line.from;
      let wStart = col, wEnd = col;
      while (wStart > 0 && /\w/.test(text[wStart - 1])) wStart--;
      while (wEnd < text.length && /\w/.test(text[wEnd])) wEnd++;
      if (wStart === wEnd) continue;
      from = line.from + wStart;
      to = line.from + wEnd;
    }

    const text = state.sliceDoc(from, to);
    let result: string;
    if (isAllLower(text)) result = text.toUpperCase();
    else if (isAllUpper(text)) result = toTitleCase(text);
    else result = text.toLowerCase();

    changes.push({ from, to, insert: result });
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
};

// ── Join Lines ──────────────────────────────────────────────────────────────

export const joinLines: Command = (view: EditorView) => {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);

    if (fromLine.number === toLine.number) {
      // Single line: join with next
      if (fromLine.number >= state.doc.lines) continue;
      const nextLine = state.doc.line(fromLine.number + 1);
      changes.push({
        from: fromLine.to,
        to: nextLine.from + nextLine.text.search(/\S|$/),
        insert: ' ',
      });
    } else {
      // Multi-line selection: join all selected lines
      for (let n = fromLine.number; n < toLine.number; n++) {
        const line = state.doc.line(n);
        const next = state.doc.line(n + 1);
        changes.push({
          from: line.to,
          to: next.from + next.text.search(/\S|$/),
          insert: ' ',
        });
      }
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
};

// ── Duplicate Line ──────────────────────────────────────────────────────────

export const duplicateLine: Command = (view: EditorView) => {
  const { state } = view;
  const changes: { from: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);

    if (fromLine.number === toLine.number && range.from === range.to) {
      // No selection: duplicate the current line
      changes.push({
        from: fromLine.to,
        insert: '\n' + fromLine.text,
      });
    } else {
      // Has selection: duplicate the entire selected region
      const text = state.sliceDoc(fromLine.from, toLine.to);
      changes.push({
        from: toLine.to,
        insert: '\n' + text,
      });
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
};

// ── Sort Lines ──────────────────────────────────────────────────────────────

export const sortLines: Command = (view: EditorView) => {
  const { state } = view;
  const range = state.selection.main;

  let from: number, to: number;
  if (range.from === range.to) {
    // No selection: sort all lines
    from = 0;
    to = state.doc.length;
  } else {
    // Sort selected lines (expand to full lines)
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    from = fromLine.from;
    to = toLine.to;
  }

  const text = state.sliceDoc(from, to);
  const lines = text.split('\n');
  const sorted = lines.sort((a, b) => a.localeCompare(b));
  const result = sorted.join('\n');

  if (result === text) return false;
  view.dispatch({
    changes: { from, to, insert: result },
    selection: EditorSelection.range(from, from + result.length),
  });
  return true;
};

// ── Extend / Shrink Selection ───────────────────────────────────────────────

/** Stack of previous selection ranges for shrinking back */
let selectionStack: { from: number; to: number }[] = [];
let extendActive = false;

/** Reset the stack when the user manually changes the selection */
export const selectionTracker = ViewPlugin.fromClass(class {
  update(update: ViewUpdate) {
    if (!extendActive && update.selectionSet) {
      selectionStack = [];
    }
  }
});

const PAIRS: Record<string, string> = {
  '(': ')', '[': ']', '{': '}',
  '"': '"', "'": "'", '`': '`',
};

export function findEnclosingPair(doc: Text, from: number, to: number): { from: number; to: number } | null {
  const text = doc.toString();

  // Search outward for matching bracket/quote pairs
  for (let dist = 1; dist <= Math.max(from, text.length - to); dist++) {
    const left = from - dist;
    const right = to + dist - 1;
    if (left < 0 || right >= text.length) continue;

    const lChar = text[left];
    const rChar = text[right];
    if (PAIRS[lChar] === rChar) {
      return { from: left, to: right + 1 };
    }
  }

  // Also try asymmetric search for brackets only
  for (const [open, close] of Object.entries(PAIRS)) {
    if (open === close) continue; // skip quotes for asymmetric search
    let depth = 0;
    let start = -1;
    for (let i = from - 1; i >= 0; i--) {
      if (text[i] === close) depth++;
      else if (text[i] === open) {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start === -1) continue;
    depth = 0;
    for (let i = to; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        if (depth === 0) {
          const result = { from: start, to: i + 1 };
          if (result.from < from || result.to > to) return result;
          break;
        }
        depth--;
      }
    }
  }

  return null;
}

export function findWord(doc: Text, pos: number): { from: number; to: number } | null {
  const line = doc.lineAt(pos);
  const text = line.text;
  const col = pos - line.from;
  let wStart = col, wEnd = col;
  while (wStart > 0 && /\w/.test(text[wStart - 1])) wStart--;
  while (wEnd < text.length && /\w/.test(text[wEnd])) wEnd++;
  if (wStart === wEnd) return null;
  return { from: line.from + wStart, to: line.from + wEnd };
}

export function findLine(doc: Text, from: number, to: number): { from: number; to: number } {
  const fromLine = doc.lineAt(from);
  const toLine = doc.lineAt(to);
  return { from: fromLine.from, to: toLine.to };
}

export function findSentence(doc: Text, from: number, to: number): { from: number; to: number } | null {
  const text = doc.toString();
  // Sentence boundaries: start after a sentence-ending punctuation + whitespace, or start of text
  // End at sentence-ending punctuation followed by whitespace or end of text
  const sentenceEnd = /[.!?](?:\s|$)/g;

  // Find start: scan backward for sentence boundary
  let sStart = from;
  for (let i = from - 1; i >= 0; i--) {
    if (/[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      sStart = i + 1;
      // Skip whitespace after the punctuation
      while (sStart < from && /\s/.test(text[sStart])) sStart++;
      break;
    }
    if (i === 0) sStart = 0;
  }

  // Find end: scan forward for sentence boundary
  let sEnd = to;
  sentenceEnd.lastIndex = to > from ? to - 1 : from;
  const match = sentenceEnd.exec(text);
  if (match) {
    sEnd = match.index + 1; // include the punctuation
  } else {
    sEnd = text.length;
  }

  if (sStart >= sEnd) return null;
  const result = { from: sStart, to: sEnd };
  if (result.from < from || result.to > to) return result;
  return null;
}

export function findParagraph(doc: Text, from: number, to: number): { from: number; to: number } {
  const text = doc.toString();
  // Expand backward to empty line or start
  let pStart = from;
  while (pStart > 0) {
    const line = doc.lineAt(pStart - 1);
    if (line.text.trim() === '') break;
    pStart = line.from;
  }
  // Expand forward to empty line or end
  let pEnd = to;
  while (pEnd < text.length) {
    const line = doc.lineAt(pEnd);
    if (line.text.trim() === '') break;
    pEnd = line.to;
    if (pEnd < text.length) pEnd++; // skip past newline to check next line
    else break;
  }
  // Trim trailing newline
  if (pEnd > 0 && text[pEnd - 1] === '\n' && pEnd > to) pEnd--;
  const endLine = doc.lineAt(Math.min(pEnd, text.length - 1));
  return { from: pStart, to: endLine.to };
}

export function findHeadingSection(doc: Text, from: number, to: number): { from: number; to: number } | null {
  const text = doc.toString();
  // Find the heading above `from`
  let headingLine = -1;
  let headingLevel = 0;
  for (let n = doc.lineAt(from).number; n >= 1; n--) {
    const line = doc.line(n);
    const match = line.text.match(/^(#{1,6})\s/);
    if (match) {
      headingLine = n;
      headingLevel = match[1].length;
      break;
    }
  }
  if (headingLine === -1) return null;

  const sectionStart = doc.line(headingLine).from;

  // Find the end: next heading of same or higher level, or end of doc
  let sectionEnd = text.length;
  for (let n = headingLine + 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const match = line.text.match(/^(#{1,6})\s/);
    if (match && match[1].length <= headingLevel) {
      sectionEnd = doc.line(n - 1).to;
      break;
    }
  }

  const result = { from: sectionStart, to: sectionEnd };
  if (result.from < from || result.to > to) return result;
  return null;
}

export function nextExpansion(doc: Text, from: number, to: number): { from: number; to: number } | null {
  const candidates: { from: number; to: number }[] = [];

  // If cursor (no selection), start with word
  if (from === to) {
    const word = findWord(doc, from);
    if (word) return word;
  }

  // Enclosing pair (brackets, quotes)
  const pair = findEnclosingPair(doc, from, to);
  if (pair) candidates.push(pair);

  // Line
  const line = findLine(doc, from, to);
  if (line.from < from || line.to > to) candidates.push(line);

  // Sentence
  const sentence = findSentence(doc, from, to);
  if (sentence) candidates.push(sentence);

  // Paragraph
  const para = findParagraph(doc, from, to);
  if (para.from < from || para.to > to) candidates.push(para);

  // Heading section
  const section = findHeadingSection(doc, from, to);
  if (section) candidates.push(section);

  // Whole document
  if (from > 0 || to < doc.length) {
    candidates.push({ from: 0, to: doc.length });
  }

  // Pick the smallest expansion that's strictly larger than current
  const valid = candidates.filter((c) => c.from <= from && c.to >= to && (c.from < from || c.to > to));
  valid.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  return valid[0] ?? null;
}

export const extendSelection: Command = (view: EditorView) => {
  const { state } = view;
  const { from, to } = state.selection.main;

  const expanded = nextExpansion(state.doc, from, to);
  if (!expanded) return false;

  selectionStack.push({ from, to });
  extendActive = true;
  view.dispatch({
    selection: EditorSelection.range(expanded.from, expanded.to),
  });
  extendActive = false;
  return true;
};

export const shrinkSelection: Command = (view: EditorView) => {
  if (selectionStack.length === 0) return false;

  const prev = selectionStack.pop()!;
  extendActive = true;
  view.dispatch({
    selection: EditorSelection.range(prev.from, prev.to),
  });
  extendActive = false;
  return true;
};
