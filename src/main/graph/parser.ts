export interface ParsedLink {
  target: string;
  type: string;       // link type name (e.g. 'supports', 'references')
  displayText?: string;
}

export interface ParsedNote {
  title: string | null;
  tags: string[];
  links: ParsedLink[];
  frontmatter: Record<string, string>;
}

// [[type::target|display]] or [[type::target]] or [[target|display]] or [[target]]
const TYPED_WIKI_LINK_RE = /\[\[(?:([a-z][\w-]*)::((?:[^\]|])+?)(?:\|((?:[^\]])+?))?\]\]|\[\[((?:[^\]|])+?)(?:\|((?:[^\]])+?))?\]\])/g;
const TAG_RE = /(?:^|\s)#([a-zA-Z][\w-/]*)/g;
const HEADING_RE = /^#\s+(.+)$/m;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;

export function parseMarkdown(content: string): ParsedNote {
  // Strip code blocks so we don't extract links/tags from them
  const stripped = content.replace(CODE_BLOCK_RE, '');

  const title = extractTitle(content);
  const tags = extractTags(stripped);
  const links = extractLinks(stripped);
  const frontmatter = extractFrontmatter(content);

  return { title, tags, links, frontmatter };
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

  // Reset regex state
  TYPED_WIKI_LINK_RE.lastIndex = 0;

  while ((match = TYPED_WIKI_LINK_RE.exec(content)) !== null) {
    if (match[1] !== undefined) {
      // Typed link: [[type::target]] or [[type::target|display]]
      const type = match[1];
      const target = match[2].trim();
      const displayText = match[3]?.trim();
      const key = `${type}::${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ target, type, displayText });
      }
    } else if (match[4] !== undefined) {
      // Plain link: [[target]] or [[target|display]]
      const target = match[4].trim();
      const displayText = match[5]?.trim();
      const key = `references::${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ target, type: 'references', displayText });
      }
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
