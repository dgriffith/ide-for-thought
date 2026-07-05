/**
 * Section chunking for embeddings (#835).
 *
 * A note is split into section chunks — one per ATX heading, plus any preamble
 * before the first heading — so semantic search can point at the *part* of a
 * note that's relevant, not just the note. Each chunk carries a heading
 * breadcrumb (`Parent > Child`) for display. Code fences are respected so a `#`
 * inside ```…``` never starts a section (matches the graph heading extractor).
 *
 * A section longer than `maxChars` is sub-split on paragraph boundaries so its
 * tail isn't lost to the model's token cap — each sub-chunk keeps the same
 * breadcrumb and gets its own index. Pure + dependency-light (just a hash) so
 * it's fast to test.
 */

import { createHash } from 'node:crypto';

export interface Chunk {
  /** 0-based position of this chunk within the note (stable ordering). */
  index: number;
  /** Heading breadcrumb for display, e.g. `Background > Prior work`. Empty for
   *  the pre-heading preamble. */
  heading: string;
  /** The chunk's markdown (heading line + body, or a paragraph group). */
  text: string;
  /** sha256 of the text — the incremental-reindex key (#835). */
  hash: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const DEFAULT_MAX_CHARS = 1000;

interface RawSection {
  /** Heading stack at this section (ancestors + self), texts only. Empty for preamble. */
  breadcrumb: string[];
  lines: string[];
}

/**
 * Split note `content` into section chunks. Frontmatter is stripped first.
 * Returns `[]` for empty/whitespace-only notes.
 */
export function chunkMarkdown(content: string, opts: { maxChars?: number } = {}): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const sections = splitIntoSections(stripFrontmatter(content));

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const heading = section.breadcrumb.join(' > ');
    const text = section.lines.join('\n').trim();
    if (text.length === 0) continue;

    for (const piece of text.length > maxChars ? splitLong(text, maxChars) : [text]) {
      const body = piece.trim();
      if (body.length === 0) continue;
      chunks.push({ index: chunks.length, heading, text: body, hash: sha256(body) });
    }
  }
  return chunks;
}

/** Walk lines, tracking the heading stack + fenced-code state, emitting one
 *  section per heading (and a leading preamble section). */
function splitIntoSections(content: string): RawSection[] {
  const sections: RawSection[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: RawSection = { breadcrumb: [], lines: [] };
  let inFence = false;

  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      current.lines.push(line);
      continue;
    }
    const m = inFence ? null : line.match(HEADING_RE);
    if (m) {
      // Close the running section, open a new one under the updated stack.
      sections.push(current);
      const level = m[1]!.length;
      const text = m[2]!.trim();
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, text });
      current = { breadcrumb: stack.map((s) => s.text), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

/** Sub-split an over-long section on blank-line (paragraph) boundaries, packing
 *  paragraphs up to `maxChars`. A single huge paragraph is hard-sliced. */
function splitLong(text: string, maxChars: number): string[] {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let buf = '';
  for (const para of paras) {
    if (para.length > maxChars) {
      if (buf) { out.push(buf); buf = ''; }
      for (let i = 0; i < para.length; i += maxChars) out.push(para.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + para.length + 2 > maxChars) { out.push(buf); buf = ''; }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf) out.push(buf);
  return out;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
