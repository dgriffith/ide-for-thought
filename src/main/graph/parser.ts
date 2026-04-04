export interface ParsedLink {
  target: string;
  type: string;       // link type name (e.g. 'supports', 'references')
  displayText?: string;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export interface ParsedNote {
  title: string | null;
  tags: string[];
  links: ParsedLink[];
  frontmatter: Record<string, string>;
  turtleBlocks: string[];
  tables: ParsedTable[];
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

  return { title, tags, links, frontmatter, turtleBlocks, tables };
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
  if (fm.title) return fm.title;

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
    const target = (pipeIdx >= 0 ? rest.slice(0, pipeIdx) : rest).trim();
    const displayText = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : undefined;

    const key = `${type}::${target}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ target, type, displayText });
    }
  }

  return links;
}

function extractFrontmatter(content: string): Record<string, string> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && value) {
        result[key] = value;
      }
    }
  }
  return result;
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
