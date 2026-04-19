import { slugify } from '../../../shared/slug';

export interface HeadingAnchor {
  /** Slug used in the link target (`[[note#slug]]`). */
  slug: string;
  /** Original heading text for display in the completion list. */
  text: string;
  /** ATX level (1–6). */
  level: number;
}

export interface NoteAnchors {
  headings: HeadingAnchor[];
  blockIds: string[];
}

const HEADING_LINE_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BLOCK_ID_LINE_RE = /\s\^([\w-]+)\s*$/;

/**
 * Scan markdown for every ATX heading and every `^block-id` marker at a
 * paragraph's end. Caller uses these to populate the completion list for
 * `[[note#…]]` and `[[note#^…]]` respectively. Fenced code blocks are
 * skipped so sample YAML or code that happens to look like a heading
 * doesn't pollute the list.
 */
export function extractAnchors(content: string): NoteAnchors {
  const headings: HeadingAnchor[] = [];
  const blockIds: string[] = [];
  const seenSlugs = new Set<string>();
  const seenBlocks = new Set<string>();
  let inFence = false;

  for (const line of content.split('\n')) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const h = line.match(HEADING_LINE_RE);
    if (h) {
      const text = h[2].trim();
      const slug = slugify(text);
      if (slug && !seenSlugs.has(slug)) {
        seenSlugs.add(slug);
        headings.push({ slug, text, level: h[1].length });
      }
      continue;
    }

    const b = line.match(BLOCK_ID_LINE_RE);
    if (b) {
      const id = b[1];
      if (!seenBlocks.has(id)) {
        seenBlocks.add(id);
        blockIds.push(id);
      }
    }
  }

  return { headings, blockIds };
}
