import YAML from 'yaml';
import { splitAnchor } from '../../shared/slug';

export interface ParsedLink {
  /** Bare target path/id with any `#anchor` stripped. */
  target: string;
  /** Raw anchor text (no leading `#`), or undefined if the link had no anchor. Block-id anchors keep their `^` prefix. */
  anchor?: string;
  /** Link type name (e.g. 'supports', 'references'). */
  type: string;
  /** Display text after `|`, if any. */
  displayText?: string;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** A frontmatter value after YAML parsing — preserves type info the indexer needs. */
export type FrontmatterScalar = string | number | boolean | Date | null;
export type FrontmatterValue = FrontmatterScalar | FrontmatterValue[];

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
const TAG_RE = /(?:^|\s)#([a-zA-Z][\w-/]*)/g;
const HEADING_RE = /^#\s+(.+)$/m;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const TURTLE_BLOCK_RE = /```turtle\n([\s\S]*?)```/g;

export function parseMarkdown(content: string): ParsedNote {
  // Extract turtle blocks before stripping code blocks
  const turtleBlocks = extractTurtleBlocks(content);

  // Strip code blocks so we don't extract links/tags from them
  const stripped = content.replace(CODE_BLOCK_RE, '');

  const title = extractTitle(content);
  const tags = extractTags(stripped);
  const links = extractLinks(stripped);
  const frontmatter = extractFrontmatter(content);
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
    const block = match[1].trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function extractTitle(content: string): string | null {
  // Try frontmatter title first
  const fm = extractFrontmatter(content);
  const fmTitle = fm.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();

  // Fall back to first H1
  const match = content.match(HEADING_RE);
  return match ? match[1].trim() : null;
}

function extractTags(content: string): string[] {
  const tags = new Set<string>();
  let match;
  while ((match = TAG_RE.exec(content)) !== null) {
    tags.add(match[1]);
  }
  return [...tags];
}

function extractLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  let match;

  WIKI_LINK_RE.lastIndex = 0;

  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    const inner = match[1];

    // Check for typed link: type::rest
    const typeMatch = inner.match(/^([a-z][\w-]*)::(.+)$/);
    let type: string;
    let rest: string;

    if (typeMatch) {
      type = typeMatch[1];
      rest = typeMatch[2];
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

function extractFrontmatter(content: string): Record<string, FrontmatterValue> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};

  let raw: unknown;
  try {
    raw = YAML.parse(match[1]);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const result: Record<string, FrontmatterValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const sanitized = sanitizeFrontmatterValue(value);
    if (sanitized !== undefined && key.trim()) {
      result[key.trim()] = sanitized;
    }
  }
  return result;
}

function sanitizeFrontmatterValue(value: unknown): FrontmatterValue | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    const items: FrontmatterValue[] = [];
    for (const item of value) {
      const s = sanitizeFrontmatterValue(item);
      if (s !== undefined && s !== null) items.push(s);
    }
    return items;
  }
  // Drop nested objects — they'd require predicate decisions we don't have.
  return undefined;
}

function extractTables(content: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const lines = content.split('\n');

  let i = 0;
  while (i < lines.length) {
    // Look for a header row: | col1 | col2 | ...
    const headerLine = lines[i].trim();
    if (!headerLine.startsWith('|') || !headerLine.endsWith('|')) { i++; continue; }

    // Next line must be the separator: |---|---|
    const sepLine = lines[i + 1]?.trim();
    if (!sepLine || !/^\|[\s:?-]+(\|[\s:?-]+)+\|$/.test(sepLine)) { i++; continue; }

    // Parse headers
    const headers = headerLine
      .slice(1, -1)
      .split('|')
      .map(h => h.trim());

    // Parse data rows
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length) {
      const rowLine = lines[j].trim();
      if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break;
      const cells = rowLine
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());
      rows.push(cells);
      j++;
    }

    if (headers.length > 0 && rows.length > 0) {
      tables.push({ headers, rows });
    }
    i = j;
  }

  return tables;
}
