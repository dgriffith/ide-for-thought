import { EditorView } from '@codemirror/view';
import { LINK_TYPES, type LinkType } from '../../../shared/link-types';
import {
  HIGHLIGHT_PALETTE,
  scanHighlights,
  type HighlightColor,
} from '../../../shared/markdown/highlight-plugin';
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

// ── Highlight cycle (#468) ─────────────────────────────────────────────────

/**
 * Result of `computeToggleHighlight`. Exposed for unit testing; the
 * Command wrapper turns this into a CodeMirror dispatch.
 */
export interface HighlightToggleResult {
  /** Document range to replace. */
  from: number;
  to: number;
  /** Replacement text. */
  insert: string;
  /** Where the body of the new (or unwrapped) text starts/ends. The
   *  Command selects this so a follow-up press cycles the same body. */
  selFrom: number;
  selTo: number;
}

/**
 * Next color in the cycle. `yellow → green → blue → pink → orange →
 * null (unwrap)`. The uncolored `==text==` form also unwraps —
 * the user explicitly typed "no color" so we don't override it with
 * yellow on a press.
 */
function nextHighlightColor(current: HighlightColor | null): HighlightColor | null {
  if (current === null) return null;
  const idx = HIGHLIGHT_PALETTE.indexOf(current);
  if (idx < 0 || idx === HIGHLIGHT_PALETTE.length - 1) return null;
  return HIGHLIGHT_PALETTE[idx + 1];
}

/**
 * Pure computation for the ⌘⇧H shortcut. Given a line of text + the
 * editor selection within that line, returns the dispatch to apply
 * (or null if the keystroke should fall through — multi-line
 * selections, etc.).
 *
 * Cases:
 *   - Selection is fully inside an existing highlight → re-wrap with
 *     the next color, or unwrap when at the end of the cycle.
 *   - Selection is outside any highlight → wrap with `==yellow:body==`.
 *   - Empty selection outside any highlight → insert `==yellow:==` and
 *     park the cursor between `:` and the closing `==` so the user can
 *     start typing into a fresh highlight (matches the empty-Bold
 *     convention in this codebase).
 *
 * The post-change selection is always the body text, so repeating the
 * shortcut keeps cycling the same content.
 */
export function computeToggleHighlight(
  lineText: string,
  lineFrom: number,
  selFrom: number,
  selTo: number,
): HighlightToggleResult | null {
  const matches = scanHighlights(lineText, lineFrom);
  const containing = matches.find((m) => m.from <= selFrom && selTo <= m.to);

  if (containing) {
    const prefixLen = containing.color ? `==${containing.color}:`.length : 2;
    const bodyStart = containing.from + prefixLen;
    const bodyEnd = containing.to - 2;
    const body = lineText.slice(bodyStart - lineFrom, bodyEnd - lineFrom);
    const next = nextHighlightColor(containing.color);
    if (next === null) {
      // Unwrap — selection lands on the now-plain body.
      return {
        from: containing.from,
        to: containing.to,
        insert: body,
        selFrom: containing.from,
        selTo: containing.from + body.length,
      };
    }
    const newPrefix = `==${next}:`;
    const insert = `${newPrefix}${body}==`;
    return {
      from: containing.from,
      to: containing.to,
      insert,
      selFrom: containing.from + newPrefix.length,
      selTo: containing.from + newPrefix.length + body.length,
    };
  }

  // Not inside a highlight: wrap with the default color.
  const body = lineText.slice(selFrom - lineFrom, selTo - lineFrom);
  const newPrefix = '==yellow:';
  const insert = `${newPrefix}${body}==`;
  return {
    from: selFrom,
    to: selTo,
    insert,
    selFrom: selFrom + newPrefix.length,
    selTo: selFrom + newPrefix.length + body.length,
  };
}

/**
 * ⌘⇧H — wrap selection with `==yellow:…==` on first press, cycle
 * through the palette on repeats (yellow → green → blue → pink →
 * orange → unwrap). The post-change selection is always the body
 * text, so successive presses cycle the same content.
 */
export const toggleHighlight: Command = (view: EditorView) => {
  const { state } = view;
  const sel = state.selection.main;
  // Highlights are inline-only — bail on multi-line selections rather
  // than producing broken syntax that spans newlines.
  const startLine = state.doc.lineAt(sel.from);
  if (sel.to > startLine.to) return false;
  const result = computeToggleHighlight(startLine.text, startLine.from, sel.from, sel.to);
  if (!result) return false;
  view.dispatch({
    changes: { from: result.from, to: result.to, insert: result.insert },
    selection: EditorSelection.range(result.selFrom, result.selTo),
  });
  return true;
};

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

// ── Fenced block + diagram inserts ─────────────────────────────────────────

/** Insert a fenced block in `lang` with the cursor on its empty body line.
 *  Adds a leading newline when not already at the start of a line. */
function makeInsertFence(lang: string): Command {
  return (view: EditorView) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const prefix = pos === line.from ? '' : '\n';
    const open = `${prefix}\`\`\`${lang}\n`;
    view.dispatch({
      changes: { from: pos, insert: `${open}\n\`\`\`\n` },
      selection: { anchor: pos + open.length }, // empty line inside the fence
    });
    return true;
  };
}

export const insertSparqlQuery: Command = makeInsertFence('sparql');
export const insertSqlQuery: Command = makeInsertFence('sql');
export const insertPythonScript: Command = makeInsertFence('python');
export const insertMermaidDiagram: Command = makeInsertFence('mermaid');

// ── Vega-Lite chart scaffolds (#830) ───────────────────────────────────────
//
// Vega-Lite is intimidating JSON, so a bare empty fence is a poor starting
// point. Each scaffold is a complete, valid, inline-data spec that renders
// immediately; the cursor lands in the data array (marked by CURSOR) so the
// first edit is "replace my data". A bare empty-block option remains for power
// users (`insertVegaLiteDiagram`).

/** Private-use sentinel marking where the cursor should land inside a template
 *  body. Stripped before insertion; can't collide with real spec text. */
const CURSOR = '';

/** Insert a ```lang fenced block wrapping a complete `body`, placing the cursor
 *  at the `CURSOR` sentinel (or the body start if absent). */
function makeInsertTemplate(lang: string, bodyWithCursor: string): Command {
  return (view: EditorView) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const prefix = pos === line.from ? '' : '\n';
    const cursorInBody = bodyWithCursor.indexOf(CURSOR);
    const body = bodyWithCursor.replace(CURSOR, '');
    const open = `${prefix}\`\`\`${lang}\n`;
    const anchor = pos + open.length + (cursorInBody >= 0 ? cursorInBody : 0);
    view.dispatch({
      changes: { from: pos, insert: `${open}${body}\n\`\`\`\n` },
      selection: { anchor },
    });
    return true;
  };
}

const SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json';

const BAR_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Bar chart",
  "data": {
    "values": [
      { "category": "${CURSOR}A", "value": 28 },
      { "category": "B", "value": 55 },
      { "category": "C", "value": 43 },
      { "category": "D", "value": 91 }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}`;

const LINE_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Line chart",
  "data": {
    "values": [
      { "x": ${CURSOR}1, "y": 4 },
      { "x": 2, "y": 7 },
      { "x": 3, "y": 5 },
      { "x": 4, "y": 9 }
    ]
  },
  "mark": { "type": "line", "point": true },
  "encoding": {
    "x": { "field": "x", "type": "quantitative" },
    "y": { "field": "y", "type": "quantitative" }
  }
}`;

const AREA_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Area chart",
  "data": {
    "values": [
      { "x": ${CURSOR}1, "y": 4 },
      { "x": 2, "y": 7 },
      { "x": 3, "y": 5 },
      { "x": 4, "y": 9 }
    ]
  },
  "mark": "area",
  "encoding": {
    "x": { "field": "x", "type": "quantitative" },
    "y": { "field": "y", "type": "quantitative" }
  }
}`;

const SCATTER_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Scatter plot",
  "data": {
    "values": [
      { "x": ${CURSOR}1.2, "y": 3.4 },
      { "x": 2.5, "y": 1.8 },
      { "x": 3.1, "y": 4.6 },
      { "x": 4.7, "y": 2.9 }
    ]
  },
  "mark": "point",
  "encoding": {
    "x": { "field": "x", "type": "quantitative" },
    "y": { "field": "y", "type": "quantitative" }
  }
}`;

const TIME_SERIES_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Time series",
  "data": {
    "values": [
      { "date": "${CURSOR}2024-01-01", "value": 120 },
      { "date": "2024-02-01", "value": 145 },
      { "date": "2024-03-01", "value": 138 },
      { "date": "2024-04-01", "value": 172 }
    ]
  },
  "mark": { "type": "line", "point": true },
  "encoding": {
    "x": { "field": "date", "type": "temporal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}`;

const PIE_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Pie chart",
  "data": {
    "values": [
      { "category": "${CURSOR}A", "value": 30 },
      { "category": "B", "value": 25 },
      { "category": "C", "value": 20 },
      { "category": "D", "value": 25 }
    ]
  },
  "mark": "arc",
  "encoding": {
    "theta": { "field": "value", "type": "quantitative" },
    "color": { "field": "category", "type": "nominal" }
  }
}`;

// Bound-data scaffolds (#886) — charts that draw from Minerva's own live data
// (#832) instead of inline values. Cursor lands in the query / table / cell ref
// so the first edit points it at the user's data. The SPARQL one is runnable
// as-is on a tagged project; the table / cell ones carry placeholder names.

const SPARQL_BOUND_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Bar chart from a SPARQL query",
  "data": { "sparql": "${CURSOR}SELECT ?tag (COUNT(?n) AS ?count) WHERE { ?n minerva:hasTag ?t . ?t minerva:tagName ?tag } GROUP BY ?tag" },
  "mark": "bar",
  "encoding": {
    "x": { "field": "tag", "type": "nominal" },
    "y": { "field": "count", "type": "quantitative" }
  }
}`;

const TABLE_BOUND_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Bar chart from a CSV / DuckDB table",
  "data": { "table": "${CURSOR}my_table" },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}`;

const CELL_BOUND_TEMPLATE = `{
  "$schema": "${SCHEMA}",
  "description": "Bar chart from a compute cell's output",
  "data": { "cell": "${CURSOR}cell-id" },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal" },
    "y": { "field": "value", "type": "quantitative" }
  }
}`;

/** A bare ```vega-lite block — cursor on the empty body line (power users). */
export const insertVegaLiteDiagram: Command = makeInsertFence('vega-lite');

export const insertVegaLiteBar: Command = makeInsertTemplate('vega-lite', BAR_TEMPLATE);
export const insertVegaLiteLine: Command = makeInsertTemplate('vega-lite', LINE_TEMPLATE);
export const insertVegaLiteArea: Command = makeInsertTemplate('vega-lite', AREA_TEMPLATE);
export const insertVegaLiteScatter: Command = makeInsertTemplate('vega-lite', SCATTER_TEMPLATE);
export const insertVegaLiteTimeSeries: Command = makeInsertTemplate('vega-lite', TIME_SERIES_TEMPLATE);
export const insertVegaLitePie: Command = makeInsertTemplate('vega-lite', PIE_TEMPLATE);

export const insertVegaLiteFromSparql: Command = makeInsertTemplate('vega-lite', SPARQL_BOUND_TEMPLATE);
export const insertVegaLiteFromTable: Command = makeInsertTemplate('vega-lite', TABLE_BOUND_TEMPLATE);
export const insertVegaLiteFromCell: Command = makeInsertTemplate('vega-lite', CELL_BOUND_TEMPLATE);

/** Chart-type chooser for the Insert menu, in a sensible order: inline-data
 *  scaffolds, then the live-data (#832) ones, then the empty block for users
 *  who'd rather start from scratch. */
export const vegaLiteInserts: { label: string; command: Command }[] = [
  { label: 'Bar', command: insertVegaLiteBar },
  { label: 'Line', command: insertVegaLiteLine },
  { label: 'Area', command: insertVegaLiteArea },
  { label: 'Scatter', command: insertVegaLiteScatter },
  { label: 'Time Series', command: insertVegaLiteTimeSeries },
  { label: 'Pie', command: insertVegaLitePie },
  { label: 'From SPARQL', command: insertVegaLiteFromSparql },
  { label: 'From Table', command: insertVegaLiteFromTable },
  { label: 'From Cell', command: insertVegaLiteFromCell },
  { label: 'Empty Block', command: insertVegaLiteDiagram },
];

// ── Callout inserts ────────────────────────────────────────────────────────

/** Callout types supported by the preview's callout plugin, in a sensible
 *  menu order. */
const CALLOUT_TYPES: { type: string; label: string }[] = [
  { type: 'note', label: 'Note' },
  { type: 'abstract', label: 'Abstract' },
  { type: 'info', label: 'Info' },
  { type: 'tip', label: 'Tip' },
  { type: 'success', label: 'Success' },
  { type: 'question', label: 'Question' },
  { type: 'warning', label: 'Warning' },
  { type: 'failure', label: 'Failure' },
  { type: 'danger', label: 'Danger' },
  { type: 'bug', label: 'Bug' },
  { type: 'example', label: 'Example' },
  { type: 'quote', label: 'Quote' },
  { type: 'todo', label: 'Todo' },
];

function makeInsertCallout(type: string): Command {
  return (view: EditorView) => {
    const { state } = view;
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    const line = state.doc.lineAt(from);
    const prefix = from === line.from ? '' : '\n';
    if (selected) {
      // Wrap the selection as the callout body.
      const body = selected.split('\n').map((l) => `> ${l}`).join('\n');
      const insert = `${prefix}> [!${type}]\n${body}\n`;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    } else {
      const head = `${prefix}> [!${type}]\n> `;
      view.dispatch({ changes: { from, insert: head }, selection: { anchor: from + head.length } });
    }
    return true;
  };
}

/** Pre-built insert commands per callout type, for the editor menu. */
export const insertCallouts: { type: string; label: string; command: Command }[] =
  CALLOUT_TYPES.map((c) => ({ ...c, command: makeInsertCallout(c.type) }));

/**
 * Insert a `[!card]` flashcard scaffold (#851): a callout with a front, the
 * `---` divider, and a back. The "Front" placeholder is selected so the first
 * keystroke replaces it.
 */
export const insertCardCallout: Command = (view: EditorView) => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = from === line.from ? '' : '\n';
  const head = `${prefix}> [!card] \n> `;
  const insert = `${head}Front\n> ---\n> Back\n`;
  const anchor = from + head.length;
  view.dispatch({
    changes: { from, insert },
    selection: { anchor, head: anchor + 'Front'.length },
  });
  return true;
};
