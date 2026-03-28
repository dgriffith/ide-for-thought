export interface ParsedNote {
  title: string | null;
  tags: string[];
  links: string[];
  frontmatter: Record<string, string>;
}

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;
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

function extractLinks(content: string): string[] {
  const links = new Set<string>();
  let match;
  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    // Handle [[link|display text]] format
    const target = match[1].split('|')[0].trim();
    links.add(target);
  }
  return [...links];
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
