import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import type { Command } from '@codemirror/view';

// ── Toggle Case ─────────────────────────────────────────────────────────────

function isAllLower(s: string): boolean { return s === s.toLowerCase() && s !== s.toUpperCase(); }
function isAllUpper(s: string): boolean { return s === s.toUpperCase() && s !== s.toLowerCase(); }

function toTitleCase(s: string): string {
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
