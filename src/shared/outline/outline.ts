/**
 * A note's outline as a tree (#2963): its ATX headings by level, and the
 * nested list items under each heading by indentation — what a mindmap of
 * the note draws (#2962), and what its edits change.
 *
 * The note is the source of truth. The tree is computed from the text every
 * time, and every edit (`outline-edits.ts`) is a text change to it.
 *
 * - **Headings** nest by level: a heading's parent is the nearest earlier
 *   heading of a lower level, as the Heading Map's does (`heading-graph.ts`).
 * - **List items** nest by indentation under the heading they sit in (or the
 *   note itself, before the first heading). An item's parent is the nearest
 *   earlier item, in the same list, indented less. Task items keep their box.
 * - **Opaque:** frontmatter, fenced code and `:::` directives. A `#` or `-` at
 *   the start of a line inside one is never a node, and nothing splits one.
 *   A fence or directive inside a list item, indented, is part of that item.
 * - Not nodes: setext headings (underlined with `===` / `---`), and anything
 *   else (paragraphs, tables, quotes). They are part of the body of the node
 *   they follow.
 *
 * Every node carries the text ranges an edit needs: its own line, its text,
 * and its subtree — everything beneath it, up to where the next node at its
 * level or above begins. Subtrees nest and tile the note exactly, so a
 * section can be cut out and put back byte for byte.
 */

export type OutlineKind = 'root' | 'heading' | 'item';

export interface TextRange { start: number; end: number }

export interface OutlineNode {
  /** Stable within one parse: the kind and the line it starts on. */
  id: string;
  kind: OutlineKind;
  /** The heading's or item's text, as written (no `#`s, marker or box). */
  text: string;
  /** A heading's level (1-6); an item's indentation in columns; 0 for the root. */
  level: number;
  /** A task item's box. */
  task?: { checked: boolean } | undefined;
  /** The line it starts on (0-based). */
  line: number;
  /** Its own first line, newline included. */
  head: TextRange;
  /** Where its text sits in that line — what a rename replaces. */
  textRange: TextRange;
  /** It and everything beneath it. */
  subtree: TextRange;
  /** An item's indentation and marker (`-`, `*`, `+`, `1.`, `1)`), and the column its content starts at. */
  indent?: string;
  marker?: string;
  contentColumn?: number;
  children: OutlineNode[];
  parent: OutlineNode | null;
}

export interface Outline {
  text: string;
  root: OutlineNode;
  /** Every node but the root, in document order. */
  nodes: OutlineNode[];
  /** Frontmatter, if any: never part of a node. */
  frontmatter: TextRange | null;
}

interface Line { start: number; end: number; text: string }

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl + 1;
    lines.push({ start, end, text: text.slice(start, nl === -1 ? text.length : nl).replace(/\r$/, '') });
    start = end;
  }
  return lines;
}

const HEADING = /^( {0,3})(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const DIRECTIVE = /^[ \t]*(:{3,})/;

/** Columns of leading whitespace (a tab to the next multiple of 4). */
export function columns(ws: string): number {
  let c = 0;
  for (const ch of ws) c = ch === '\t' ? c + 4 - (c % 4) : c + 1;
  return c;
}

export function parseOutline(text: string): Outline {
  const lines = splitLines(text);
  const root: OutlineNode = {
    id: 'root', kind: 'root', text: '', level: 0, line: 0,
    head: { start: 0, end: 0 }, textRange: { start: 0, end: 0 }, subtree: { start: 0, end: text.length },
    children: [], parent: null,
  };
  const nodes: OutlineNode[] = [];

  // Frontmatter: a `---` first line closed by `---` or `...`.
  let first = 0;
  let frontmatter: TextRange | null = null;
  if (lines[0]?.text === '---') {
    const close = lines.findIndex((l, i) => i > 0 && (l.text === '---' || l.text === '...'));
    if (close !== -1) {
      frontmatter = { start: 0, end: lines[close]!.end };
      first = close + 1;
    }
  }
  root.subtree = { start: frontmatter?.end ?? 0, end: text.length };
  root.head = { start: root.subtree.start, end: root.subtree.start };
  root.textRange = { ...root.head };

  // Headings open on a stack by level; items on a stack by indentation, closed by any heading.
  const headings: OutlineNode[] = [];
  const items: OutlineNode[] = [];
  let fence: { char: string; len: number } | null = null;
  let directive = 0;
  /** The previous line was blank: a line after one continues an item only if indented to its content. */
  let blankRun = false;

  const sectionParent = () => headings[headings.length - 1] ?? root;
  const closeItems = (at: number, keep: (it: OutlineNode) => boolean) => {
    while (items.length > 0 && !keep(items[items.length - 1]!)) items.pop()!.subtree.end = at;
  };
  /** The fence a line opens, if it opens one. */
  const opensFence = (rest: string): { char: string; len: number } | null => {
    const f = FENCE.exec(rest);
    return f ? { char: f[1]![0]!, len: f[1]!.length } : null;
  };

  for (let i = first; i < lines.length; i++) {
    const ln = lines[i]!;
    // Inside fenced code or a directive: opaque, whatever the line says.
    if (fence) {
      const m = FENCE.exec(ln.text);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len && ln.text.trim() === m[1]) fence = null;
      continue;
    }
    if (directive > 0) {
      const m = DIRECTIVE.exec(ln.text);
      if (m && ln.text.trim() === m[1]) directive--;
      else if (m) directive++;
      continue;
    }
    if (ln.text.trim() === '') { blankRun = true; continue; }
    const indent = columns(/^[ \t]*/.exec(ln.text)![0]);
    const top = items[items.length - 1];

    // A heading — unless it's indented into an open item's content, where it's that item's.
    const h = !top || indent < top.contentColumn! ? HEADING.exec(ln.text) : null;
    if (h) {
      closeItems(ln.start, () => false);
      const level = h[2]!.length;
      while (headings.length > 0 && headings[headings.length - 1]!.level >= level) headings.pop()!.subtree.end = ln.start;
      const parent = sectionParent();
      const raw = h[3] ?? '';
      const textStart = raw === '' ? ln.start + ln.text.length : ln.start + ln.text.indexOf(raw, h[1]!.length + h[2]!.length);
      const node: OutlineNode = {
        id: `h${i}`, kind: 'heading', text: raw, level, line: i,
        head: { start: ln.start, end: ln.end }, textRange: { start: textStart, end: textStart + raw.length },
        subtree: { start: ln.start, end: Infinity }, children: [], parent,
      };
      parent.children.push(node);
      nodes.push(node);
      headings.push(node);
      blankRun = false;
      continue;
    }

    const it = ITEM.exec(ln.text);
    if (it) {
      const indentCols = columns(it[1]!);
      // Its parent is the nearest open item indented less; the rest (siblings, deeper ones) are done.
      closeItems(ln.start, (o) => columns(o.indent!) < indentCols);
      const parent = items[items.length - 1] ?? sectionParent();
      const box = it[4];
      const raw = it[5]!;
      const prefixLen = it[1]!.length + it[2]!.length + it[3]!.length + (box?.length ?? 0);
      const node: OutlineNode = {
        id: `i${i}`, kind: 'item', text: raw, level: indentCols, line: i,
        head: { start: ln.start, end: ln.end }, textRange: { start: ln.start + prefixLen, end: ln.start + prefixLen + raw.length },
        subtree: { start: ln.start, end: Infinity },
        ...(box ? { task: { checked: /\[[xX]\]/.test(box) } } : {}),
        indent: it[1]!, marker: it[2]!, contentColumn: indentCols + it[2]!.length + columns(it[3]!),
        children: [], parent,
      };
      parent.children.push(node);
      nodes.push(node);
      items.push(node);
      blankRun = false;
      fence = opensFence(raw); // `- ```js` opens a fence inside the item
      continue;
    }

    // Any other line continues the open item it's indented to — or, with no blank line
    // before it, the deepest one (a lazy continuation). Otherwise it ends the items it's outside.
    if (top && blankRun && indent < top.contentColumn!) closeItems(ln.start, (o) => o.contentColumn! <= indent);
    blankRun = false;
    fence = opensFence(ln.text);
    if (fence) continue;
    const d = DIRECTIVE.exec(ln.text);
    if (d && ln.text.trim().length > d[1]!.length) directive++;
  }

  // Everything still open runs to the end; an item ends at its last non-blank line's end.
  for (const it of items) if (it.subtree.end === Infinity) it.subtree.end = text.length;
  for (const h of headings) h.subtree.end = text.length;
  for (const n of nodes) if (n.subtree.end === Infinity) n.subtree.end = text.length;
  // The last item of a list stops before the blank lines after it: they separate the list from
  // what follows (another list of the same parent, too). Any other item keeps the blank lines
  // before its next sibling (a loose list's),
  // so it can be cut out and put back byte for byte.
  // An item is the last of its list unless the next item of its parent starts right where it ends.
  for (const n of nodes) {
    if (n.kind !== 'item') continue;
    const sibs = n.parent!.children.filter((c) => c.kind === 'item');
    const next = sibs[sibs.indexOf(n) + 1];
    if (next && next.subtree.start === n.subtree.end) continue;
    n.subtree.end = trimTrailingBlankLines(text, n.subtree.start, n.subtree.end, n.head.end);
  }
  return { text, root, nodes, frontmatter };
}

/** The end of [start, end) less any whole blank lines at its end, never before `min`. */
function trimTrailingBlankLines(text: string, start: number, end: number, min: number): number {
  let e = end;
  while (e > min) {
    const prevNl = text.lastIndexOf('\n', e - 2);
    const lineStart = prevNl === -1 ? start : prevNl + 1;
    if (lineStart < min || text.slice(lineStart, e).trim() !== '') break;
    e = lineStart;
  }
  return e;
}

/** The node whose head line contains `offset`, or the innermost one whose subtree does. */
export function nodeAt(outline: Outline, offset: number): OutlineNode | null {
  let found: OutlineNode | null = null;
  for (const n of outline.nodes) {
    if (offset >= n.subtree.start && (offset < n.subtree.end || (offset === n.subtree.end && n.subtree.end === outline.text.length))) found = n;
  }
  return found;
}

/** Is `a` inside `b`'s subtree (or `b` itself)? */
export function isWithin(a: OutlineNode, b: OutlineNode): boolean {
  for (let n: OutlineNode | null = a; n; n = n.parent) if (n === b) return true;
  return false;
}
