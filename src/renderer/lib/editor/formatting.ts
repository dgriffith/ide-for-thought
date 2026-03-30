import { EditorView } from '@codemirror/view';
import { LINK_TYPES, type LinkType } from '../../../shared/link-types';
import { EditorSelection } from '@codemirror/state';
import type { Command } from '@codemirror/view';

// ── Inline formatting (toggle wrap) ────────────────────────────────────────

function makeInlineToggle(marker: string): Command {
  return (view: EditorView) => {
    const { state } = view;
    const changes: { from: number; to: number; insert: string }[] = [];
    const selections: { anchor: number; head: number }[] = [];
    let offset = 0;

    for (const range of state.selection.ranges) {
      const from = range.from;
      const to = range.to;
      const selected = state.sliceDoc(from, to);
      const mLen = marker.length;

      if (from === to) {
        // No selection: insert markers with cursor between
        changes.push({ from, to, insert: marker + marker });
        selections.push({ anchor: from + offset + mLen, head: from + offset + mLen });
        offset += mLen * 2;
      } else if (
        selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= mLen * 2
      ) {
        // Already wrapped: unwrap
        const inner = selected.slice(mLen, -mLen);
        changes.push({ from, to, insert: inner });
        selections.push({ anchor: from + offset, head: from + offset + inner.length });
        offset += inner.length - selected.length;
      } else if (
        from >= mLen &&
        state.sliceDoc(from - mLen, from) === marker &&
        state.sliceDoc(to, to + mLen) === marker
      ) {
        // Markers are outside the selection: remove them
        changes.push({ from: from - mLen, to: from, insert: '' });
        changes.push({ from: to, to: to + mLen, insert: '' });
        selections.push({ anchor: from + offset - mLen, head: to + offset - mLen });
        offset -= mLen * 2;
      } else {
        // Wrap selection
        changes.push({ from, to, insert: marker + selected + marker });
        selections.push({ anchor: from + offset + mLen, head: from + offset + mLen + selected.length });
        offset += mLen * 2;
      }
    }

    if (changes.length === 0) return false;
    view.dispatch({
      changes,
      selection: EditorSelection.create(selections.map((s) => EditorSelection.range(s.anchor, s.head))),
    });
    return true;
  };
}

export const toggleBold: Command = makeInlineToggle('**');
export const toggleItalic: Command = makeInlineToggle('*');
export const toggleCode: Command = makeInlineToggle('`');
export const toggleStrikethrough: Command = makeInlineToggle('~~');

// ── Paragraph styles (toggle line prefix) ──────────────────────────────────

function makeLinePrefixToggle(prefix: string, numbered = false): Command {
  return (view: EditorView) => {
    const { state } = view;
    const from = state.doc.lineAt(state.selection.main.from);
    const to = state.doc.lineAt(state.selection.main.to);

    const changes: { from: number; to: number; insert: string }[] = [];
    let allHavePrefix = true;
    const lines: { line: typeof from; num: number }[] = [];

    for (let n = from.number; n <= to.number; n++) {
      const line = state.doc.line(n);
      lines.push({ line, num: n - from.number + 1 });
      const p = numbered ? /^\d+\.\s/ : new RegExp('^' + escapeRegex(prefix));
      if (!p.test(line.text)) allHavePrefix = false;
    }

    for (const { line, num } of lines) {
      if (allHavePrefix) {
        // Remove prefix
        const p = numbered ? /^\d+\.\s/ : new RegExp('^' + escapeRegex(prefix));
        const match = line.text.match(p);
        if (match) {
          changes.push({ from: line.from, to: line.from + match[0].length, insert: '' });
        }
      } else {
        // Add prefix (remove any existing heading/list prefix first)
        const existing = line.text.match(/^(#{1,6}\s|>\s|- \[[ x]\]\s|- |\d+\.\s)/);
        const removeLen = existing ? existing[0].length : 0;
        const p = numbered ? `${num}. ` : prefix;
        changes.push({ from: line.from, to: line.from + removeLen, insert: p });
      }
    }

    if (changes.length === 0) return false;
    view.dispatch({ changes });
    return true;
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const toggleH1: Command = makeLinePrefixToggle('# ');
export const toggleH2: Command = makeLinePrefixToggle('## ');
export const toggleH3: Command = makeLinePrefixToggle('### ');
export const toggleQuote: Command = makeLinePrefixToggle('> ');
export const toggleBulletList: Command = makeLinePrefixToggle('- ');
export const toggleNumberedList: Command = makeLinePrefixToggle('', true);
export const toggleTaskList: Command = makeLinePrefixToggle('- [ ] ');

// ── Insert commands ────────────────────────────────────────────────────────

export const insertTable: Command = (view: EditorView) => {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const prefix = pos === line.from ? '' : '\n';
  const table = `${prefix}| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
|  |  |  |
`;
  view.dispatch({
    changes: { from: pos, insert: table },
    selection: { anchor: pos + prefix.length },
  });
  return true;
};

export const insertHorizontalRule: Command = (view: EditorView) => {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const prefix = pos === line.from ? '' : '\n';
  view.dispatch({
    changes: { from: pos, insert: `${prefix}---\n` },
  });
  return true;
};

export const insertFootnote: Command = (view: EditorView) => {
  const { state } = view;
  const doc = state.doc.toString();
  // Find the next available footnote number
  const existing = doc.match(/\[\^(\d+)\]/g) ?? [];
  const nums = existing.map((m) => parseInt(m.match(/\d+/)![0], 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;

  const pos = state.selection.main.head;
  const ref = `[^${next}]`;
  const def = `\n${ref}: `;

  view.dispatch({
    changes: [
      { from: pos, insert: ref },
      { from: state.doc.length, insert: def },
    ],
    selection: { anchor: state.doc.length + def.length },
  });
  return true;
};

export const insertLink: Command = (view: EditorView) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  if (selected) {
    const insert = `[${selected}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    });
  } else {
    view.dispatch({
      changes: { from, insert: '[](url)' },
      selection: { anchor: from + 1 },
    });
  }
  return true;
};

export const insertImage: Command = (view: EditorView) => {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: '![alt](url)' },
    selection: { anchor: pos + 2, head: pos + 5 },
  });
  return true;
};

// ── Typed link insert commands ─────────────────────────────────────────────

function makeInsertTypedLink(linkType: LinkType): Command {
  return (view: EditorView) => {
    const { state } = view;
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);

    if (selected) {
      // Wrap selection as the target
      const insert = `[[${linkType.name}::${selected}]]`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
    } else {
      // Insert template with cursor at target position
      const prefix = `[[${linkType.name}::`;
      view.dispatch({
        changes: { from, insert: `${prefix}]]` },
        selection: { anchor: from + prefix.length },
      });
    }
    return true;
  };
}

/** Pre-built insert commands for each link type (excluding 'references' — that's a plain [[link]]) */
export const insertTypedLinks: { linkType: LinkType; command: Command }[] =
  LINK_TYPES.filter((lt) => lt.name !== 'references').map((lt) => ({
    linkType: lt,
    command: makeInsertTypedLink(lt),
  }));

export const insertWikiLink: Command = (view: EditorView) => {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  if (selected) {
    const insert = `[[${selected}]]`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
  } else {
    view.dispatch({
      changes: { from, insert: '[[]]' },
      selection: { anchor: from + 2 },
    });
  }
  return true;
};
