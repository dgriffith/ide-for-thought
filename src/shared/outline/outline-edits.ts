/**
 * Editing a note through its outline (#2963): every operation a mindmap (and
 * the editor's section commands) can make, planned as plain text changes to
 * the note — non-overlapping `{ from, to, insert }` against the text the
 * outline was parsed from, which is what CodeMirror dispatches, so ⌘Z in the
 * editor undoes them like any edit.
 *
 * Round-trip safety, which the property tests hold:
 * - nothing outside the node's subtree and the place it lands changes;
 * - a move cuts a subtree exactly — its own blank lines go with it, and none
 *   are added — so moving it back gives the original text.
 *
 * **Promote and demote are tree operations**, not just a level change.
 * Promote makes a node its parent's next sibling; demote makes it the last
 * child of the sibling before it. Bumping a heading's `#`s in place would
 * quietly re-parent the siblings after it.
 *
 * **Headings and list items don't cross** (decision, #2963): a list item
 * can't be promoted to a heading, a heading can't go into a list, and a
 * heading can't go past level 6. Those edits are refused with a reason, not
 * approximated: turning one into the other rewrites markup the user didn't
 * touch, which is where round-tripping stops being safe.
 */
import { columns, isWithin, type Outline, type OutlineNode } from './outline';

export interface TextChange { from: number; to: number; insert: string }

/** Changes to make, or why the edit can't be made. */
export type OutlineEdit = { changes: TextChange[] } | { refused: string };

const refuse = (why: string): OutlineEdit => ({ refused: why });

/** Apply non-overlapping changes, given against the same text, to it. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from));
  let out = '';
  let at = 0;
  for (const c of sorted) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** A node's subtree as text, ending in a newline. */
function block(o: Outline, n: OutlineNode): string {
  const t = o.text.slice(n.subtree.start, n.subtree.end);
  return t.endsWith('\n') ? t : `${t}\n`;
}

/** Where a node of `kind` goes as child `index` of `parent` (items come before sub-headings), ignoring `moving`. */
function insertionPoint(parent: OutlineNode, kind: 'heading' | 'item', index: number, moving?: OutlineNode): number {
  const kids = parent.children.filter((c) => c !== moving);
  const items = kids.filter((c) => c.kind === 'item');
  const heads = kids.filter((c) => c.kind === 'heading');
  const same = kind === 'item' ? items : heads;
  const i = Math.max(0, Math.min(index, same.length));
  if (i < same.length) return same[i]!.subtree.start;
  if (same.length > 0) return same[same.length - 1]!.subtree.end;
  // The first of its kind: an item goes before any sub-heading; either goes at the end of the parent.
  if (kind === 'item' && heads.length > 0) return heads[0]!.subtree.start;
  return parent.subtree.end;
}

/** A newline before `insert` when it lands at the very end of a text that has none. */
function atEnd(o: Outline, at: number, insert: string): string {
  return at === o.text.length && o.text.length > 0 && !o.text.endsWith('\n') ? `\n${insert}` : insert;
}

/**
 * The level a heading takes as child `index` of `parent` (among its heading
 * children, not counting `moving`); null when a heading can't go there.
 *
 * It keeps `want` (its own level) where it can, within what the place allows:
 * deeper than the parent; no deeper than the sibling before it (or it would be
 * that sibling's child); no shallower than the sibling after it (or it would
 * adopt it). A run of sibling headings never gets deeper, so the range is never
 * empty — and a heading moved and moved back gets its own level back.
 */
function headingLevelAt(parent: OutlineNode, index: number, want: number, moving?: OutlineNode): number | null {
  if (parent.kind === 'item') return null;
  const heads = parent.children.filter((c) => c.kind === 'heading' && c !== moving);
  const i = Math.max(0, Math.min(index, heads.length));
  const low = Math.max(parent.kind === 'heading' ? parent.level + 1 : 1, heads[i]?.level ?? 1);
  const high = heads[i - 1]?.level ?? 6;
  return Math.min(Math.max(want, low), high);
}

/** The indentation an item child of `parent` takes, in columns. */
const itemIndentUnder = (parent: OutlineNode) => (parent.kind === 'item' ? parent.contentColumn! : 0);

/** The subtree's text with its headings shifted by `delta` levels; null past 1-6. */
function releveled(o: Outline, n: OutlineNode, delta: number): string | null {
  let text = block(o, n);
  if (delta === 0) return text;
  const heads = o.nodes.filter((h) => h.kind === 'heading' && isWithin(h, n));
  if (heads.some((h) => h.level + delta < 1 || h.level + delta > 6)) return null;
  // From the last, so earlier offsets hold.
  for (const h of [...heads].reverse()) {
    const at = h.head.start - n.subtree.start;
    const line = text.slice(at);
    const m = /^( {0,3})(#{1,6})/.exec(line)!;
    text = text.slice(0, at) + m[1] + '#'.repeat(h.level + delta) + line.slice(m[0].length);
  }
  return text;
}

/** The subtree's text with every line's indentation moved by `delta` columns (what it can lose, at least). */
function reindented(o: Outline, n: OutlineNode, delta: number): string {
  const text = block(o, n);
  if (delta === 0) return text;
  return text.split('\n').map((line, i, all) => {
    if (line.trim() === '' || (i === all.length - 1 && line === '')) return line;
    if (delta > 0) return ' '.repeat(delta) + line;
    const ws = /^[ \t]*/.exec(line)![0];
    const keep = Math.max(0, columns(ws) + delta);
    return ' '.repeat(keep) + line.slice(ws.length);
  }).join('\n');
}

/** `n`'s subtree, made to fit as child `index` of `parent`; or why it can't. */
function fitted(o: Outline, n: OutlineNode, parent: OutlineNode, index: number): string | { refused: string } {
  if (n.kind === 'heading') {
    const level = headingLevelAt(parent, index, n.level, n);
    if (level === null) return { refused: 'A heading can\'t go inside a list item.' };
    const text = releveled(o, n, level - n.level);
    return text ?? { refused: 'That would put a heading past level 6.' };
  }
  if (parent.kind === 'heading' || parent.kind === 'root' || parent.kind === 'item') {
    return reindented(o, n, itemIndentUnder(parent) - n.level);
  }
  return { refused: 'It can\'t go there.' };
}

// ── The operations ──────────────────────────────────────────────────────────

export function renameNode(_o: Outline, n: OutlineNode, text: string): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself has no name in its outline.');
  return { changes: [{ from: n.textRange.start, to: n.textRange.end, insert: oneLine(text) }] };
}

export function deleteNode(_o: Outline, n: OutlineNode): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself can\'t be deleted from its outline.');
  return { changes: [{ from: n.subtree.start, to: n.subtree.end, insert: '' }] };
}

/** A new list item's marker: the list's own style, numbered on from the one before. */
function markerAfter(prev: OutlineNode | undefined): string {
  const m = prev?.marker ? /^(\d+)([.)])$/.exec(prev.marker) : null;
  return m ? `${Number(m[1]) + 1}${m[2]}` : prev?.marker ?? '-';
}

function itemLine(indent: number, marker: string, text: string, task: boolean): string {
  return `${' '.repeat(indent)}${marker} ${task ? '[ ] ' : ''}${oneLine(text)}\n`;
}

/** A new last child of `parent`: a sub-heading, or an item where the parent is an item or holds only items. */
export function addChild(o: Outline, parent: OutlineNode, text: string): OutlineEdit {
  const items = parent.children.filter((c) => c.kind === 'item');
  const heads = parent.children.filter((c) => c.kind === 'heading');
  // A new last sub-heading: the level of the one before it, or one below the parent.
  const level = headingLevelAt(parent, heads.length, heads[heads.length - 1]?.level ?? (parent.kind === 'heading' ? parent.level + 1 : 1));
  const asItem = parent.kind === 'item' || (items.length > 0 && heads.length === 0) || level === null || level > 6 || (parent.kind === 'heading' && parent.level >= 6);
  if (asItem) {
    const last = items[items.length - 1];
    const at = insertionPoint(parent, 'item', items.length);
    return { changes: [{ from: at, to: at, insert: atEnd(o, at, itemLine(itemIndentUnder(parent), markerAfter(last), text, !!last?.task)) }] };
  }
  const at = insertionPoint(parent, 'heading', heads.length);
  return { changes: [{ from: at, to: at, insert: atEnd(o, at, `${'#'.repeat(level)} ${oneLine(text)}\n`) }] };
}

/** A new node right after `n` (after everything beneath it), of its kind and level. */
export function addSibling(o: Outline, n: OutlineNode, text: string): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself has no siblings.');
  const at = n.subtree.end;
  const line = n.kind === 'heading'
    ? `${'#'.repeat(n.level)} ${oneLine(text)}\n`
    : itemLine(columns(n.indent!), markerAfter(n), text, !!n.task);
  return { changes: [{ from: at, to: at, insert: atEnd(o, at, line) }] };
}

/**
 * Move `n`, with everything beneath it, to be child `index` of `parent`
 * (counted among the parent's children of its kind, not counting `n`).
 * Headings take the level their new place gives them, items the indentation.
 */
export function moveNode(o: Outline, n: OutlineNode, parent: OutlineNode, index: number): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself can\'t be moved.');
  if (isWithin(parent, n)) return refuse('A node can\'t go inside itself.');
  // Where it already is: nothing to do (an index alone can't say where a lone list item sits among its parent's text).
  if (parent === n.parent && parent.children.filter((c) => c.kind === n.kind).indexOf(n) === Math.max(0, Math.min(index, parent.children.filter((c) => c.kind === n.kind).length - 1))) return { changes: [] };
  const text = fitted(o, n, parent, index);
  if (typeof text !== 'string') return text;
  const at = insertionPoint(parent, n.kind, index, n);
  if (at > n.subtree.start && at < n.subtree.end) return refuse('A node can\'t go inside itself.');
  return { changes: [
    { from: n.subtree.start, to: n.subtree.end, insert: '' },
    { from: at, to: at, insert: atEnd(o, at, text) },
  ] };
}

const siblingsOfKind = (n: OutlineNode) => n.parent!.children.filter((c) => c.kind === n.kind);

/** One place up or down among its siblings of the same kind. */
export function moveBy(o: Outline, n: OutlineNode, step: -1 | 1): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself can\'t be moved.');
  const sibs = siblingsOfKind(n);
  const i = sibs.indexOf(n);
  const to = i + step;
  if (to < 0 || to >= sibs.length) return refuse(step < 0 ? 'It\'s already first.' : 'It\'s already last.');
  return moveNode(o, n, n.parent!, to);
}

/** Out one level: its parent's next sibling. */
export function promote(o: Outline, n: OutlineNode): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself can\'t be promoted.');
  const parent = n.parent!;
  if (parent.kind === 'root') return refuse('It\'s already at the top.');
  if (n.kind === 'item' && parent.kind !== 'item') return refuse('A list item can\'t become a heading.');
  const grand = parent.parent!;
  const index = siblingsOfKind(parent).indexOf(parent) + 1;
  return moveNode(o, n, grand, index);
}

/** In one level: the last child of the sibling before it. */
export function demote(o: Outline, n: OutlineNode): OutlineEdit {
  if (n.kind === 'root') return refuse('The note itself can\'t be demoted.');
  const sibs = siblingsOfKind(n);
  const prev = sibs[sibs.indexOf(n) - 1];
  if (!prev) return refuse('There\'s nothing before it to go under.');
  return moveNode(o, n, prev, prev.children.filter((c) => c.kind === n.kind).length);
}
