import { parseFrontmatter, type FrontmatterValue } from '../../shared/frontmatter-parse';
import { noteTitle } from '../../shared/note-title';
import { splitAnchor } from '../../shared/slug';
import { slugifyTableName } from '../../shared/table-name';
import { CODE_BLOCK_RE, extractInlineTags } from '../../shared/inline-tags';

// The frontmatter value types live beside the parser that produces them, in
// shared/frontmatter-parse.ts (#2683); re-exported so graph/ keeps one import.
export type { FrontmatterScalar, FrontmatterMap, FrontmatterValue } from '../../shared/frontmatter-parse';

export interface ParsedLink {
  /** Bare target path/id with any `#anchor` stripped. */
  target: string;
  /** Raw anchor text (no leading `#`), or undefined if the link had no anchor. Block-id anchors keep their `^` prefix. */
  anchor?: string;
  /** Link type name (e.g. 'supports', 'references'). */
  type: string;
  /** Display text after `|`, if any. */
  displayText?: string | undefined;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /**
   * Raw human caption from a Pandoc-style `Table: <caption>` line directly
   * above the table (#1356). Only present when such a line exists; uncaptioned
   * tables stay graph-only and are never SQL-registered.
   */
  caption?: string;
  /**
   * `caption` sanitized to a DuckDB-safe SQL identifier via `slugifyTableName`.
   * Present iff `caption` is. This is the name the table is `SELECT`-able by.
   */
  name?: string;
}

export interface ParsedNote {
  title: string | null;
  tags: string[];
  links: ParsedLink[];
  frontmatter: Record<string, FrontmatterValue>;
  turtleBlocks: string[];
  tables: ParsedTable[];
  /**
   * Alias names from frontmatter `aliases:` (#469). Strings only — array
   * scalars are flattened, non-strings are dropped. Aliases containing
   * characters that would break wiki-link parsing (`[`, `]`, `|`, `#`, `\n`)
   * are filtered out by the indexer; the parser keeps everything string-shaped
   * so callers can introspect what the user wrote.
   */
  aliases: string[];
}

// [[type::target|display]] or [[type::target]] or [[target|display]] or [[target]]
const WIKI_LINK_RE = /\[\[([^\]]+?)\]\]/g;
// A `-hidden` suffix (#2039, see shared/markdown/fence-info.ts) only changes
// human-facing rendering — a hidden turtle block is still graph-real content,
// so extraction must keep recognizing it.
const TURTLE_BLOCK_RE = /```turtle(?:-hidden)?\n([\s\S]*?)```/g;

export function parseMarkdown(content: string): ParsedNote {
  // Extract turtle blocks before stripping code blocks
  const turtleBlocks = extractTurtleBlocks(content);

  // Strip code blocks so we don't extract links/tags from them
  const stripped = content.replace(CODE_BLOCK_RE, '');

  // Parse the frontmatter ONCE and hand it to `noteTitle` (#2216). It reads
  // `title:` from frontmatter before falling back to the body's first H1, so
  // it used to run a second full `YAML.parse` of the same block on every note,
  // on every index pass — and boot makes three of those.
  const frontmatter = parseFrontmatter(content);
  const title = noteTitle(content, frontmatter);
  // Tag lexing lives in shared/inline-tags (#2430) so the tag merge rewrite
  // and this indexer share one definition of what a tag is.
  const tags = extractInlineTags(content);
  const links = extractLinks(stripped);
  const tables = extractTables(stripped);
  const aliases = extractAliases(frontmatter);

  return { title, tags, links, frontmatter, turtleBlocks, tables, aliases };
}

function extractAliases(fm: Record<string, FrontmatterValue>): string[] {
  // Accept `aliases` (canonical) and the singular `alias` for tolerance.
  const raw = fm.aliases ?? fm.alias;
  if (raw === undefined || raw === null) return [];
  const out: string[] = [];
  const visit = (v: FrontmatterValue) => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) out.push(trimmed);
    }
  };
  visit(raw);
  return out;
}

function extractTurtleBlocks(content: string): string[] {
  const blocks: string[] = [];
  let match;
  TURTLE_BLOCK_RE.lastIndex = 0;
  while ((match = TURTLE_BLOCK_RE.exec(content)) !== null) {
    const block = match[1]!.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function extractLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  let match;

  WIKI_LINK_RE.lastIndex = 0;

  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    const inner = match[1]!;

    // Check for typed link: type::rest
    const typeMatch = inner.match(/^([a-z][\w-]*)::(.+)$/);
    let type: string;
    let rest: string;

    if (typeMatch) {
      type = typeMatch[1]!;
      rest = typeMatch[2]!;
    } else {
      type = 'references';
      rest = inner;
    }

    // Split rest on | for display text
    const pipeIdx = rest.indexOf('|');
    const targetWithAnchor = (pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest).trim();
    const displayText = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : undefined;

    // Strip optional #anchor (heading) or #^block-id suffix from the target.
    const { path, anchor } = splitAnchor(targetWithAnchor);
    const target = path;

    const key = `${type}::${target}::${anchor ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ target, type, displayText, ...(anchor !== null ? { anchor } : {}) });
    }
  }

  return links;
}

/**
 * Split a table row's inner text (leading/trailing `|` already stripped) into
 * trimmed cells, honoring GFM's `\|` escape: a backslash-escaped pipe is
 * literal cell content, not a column delimiter. Escaped pipes are unescaped in
 * the result, so the value stored in the CSVW triples matches what the preview
 * renders — a cell written `a \| b` extracts as the single cell `a | b`
 * instead of splitting into misaligned columns.
 */
function splitTableCells(inner: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k]!;
    if (ch === '\\' && inner[k + 1] === '|') {
      current += '|';
      k++; // consume the escaped pipe so it isn't treated as a delimiter
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function extractTables(content: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    // Look for a header row: | col1 | col2 | ...
    const headerLine = lines[i]!.trim();
    if (!headerLine.startsWith('|') || !headerLine.endsWith('|')) { i++; continue; }

    // Next line must be the separator: |---|---|
    const sepLine = lines[i + 1]?.trim();
    if (!sepLine || !/^\|[\s:?-]+(\|[\s:?-]+)+\|$/.test(sepLine)) { i++; continue; }

    // Parse headers
    const headers = splitTableCells(headerLine.slice(1, -1));

    // Parse data rows
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length) {
      const rowLine = lines[j]!.trim();
      if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break;
      rows.push(splitTableCells(rowLine.slice(1, -1)));
      j++;
    }

    if (headers.length > 0 && rows.length > 0) {
      const caption = captionAbove(lines, i);
      if (caption) {
        tables.push({ headers, rows, caption, name: slugifyTableName(caption) });
      } else {
        tables.push({ headers, rows });
      }
    }
    i = j;
  }

  return tables;
}

// Pandoc-style `Table: <caption>` line directly above a table's header row
// (#1356). Case-insensitive; one blank line between the caption and the table
// is allowed. Returns the trimmed caption text, or null when there's no caption.
const TABLE_CAPTION_RE = /^Table:\s*(.+)$/i;

function captionAbove(lines: string[], headerIndex: number): string | null {
  let above = lines[headerIndex - 1]?.trim();
  if (above === '') above = lines[headerIndex - 2]?.trim(); // skip one blank line
  if (!above) return null;
  const m = above.match(TABLE_CAPTION_RE);
  const caption = m?.[1]?.trim();
  return caption ? caption : null;
}
