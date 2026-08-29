/**
 * Note & block transclusion (#906) — the pure parsing + slicing layer.
 *
 * An `![[target]]` embeds another note's content inline. The target can name the
 * whole note, a heading section, or a single block:
 *
 *   ![[note]]            whole note body
 *   ![[note#Heading]]    that heading's section (down to the next same/higher heading)
 *   ![[note^blockid]]    the block carrying the `^blockid` anchor
 *
 * Everything here is string-only + side-effect-free so the slicing is trivially
 * testable; the renderer (Preview) and the exporter both drive it.
 */

import { slugify } from './slug';
import { stripFrontmatter } from './frontmatter-strip';

export interface TransclusionTarget {
  /** The note name / path (no `#heading` or `^blockid`, no `.md`). */
  path: string;
  heading?: string;
  blockId?: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const BLOCK_ID_RE = /^(.*?)\s*\^([\w-]+)\s*$/;

/** Parse the inside of `![[ … ]]` into a target. A `|display` suffix (Obsidian
 *  alias) is ignored for embeds — there's no display text for a transclusion. */
export function parseTransclusionTarget(inner: string): TransclusionTarget {
  const noPipe = inner.split('|')[0]!.trim();
  const hashIdx = noPipe.indexOf('#');
  if (hashIdx >= 0) {
    const path = noPipe.slice(0, hashIdx).trim();
    const frag = noPipe.slice(hashIdx + 1).trim();
    // `#^block` is Obsidian's canonical block-ref; `#Heading` is a section.
    if (frag.startsWith('^')) return { path, blockId: frag.slice(1).trim() };
    return { path, heading: frag };
  }
  const caretIdx = noPipe.indexOf('^');
  if (caretIdx >= 0) {
    return { path: noPipe.slice(0, caretIdx).trim(), blockId: noPipe.slice(caretIdx + 1).trim() };
  }
  return { path: noPipe };
}

export interface SliceResult {
  ok: boolean;
  text: string;
  /** Why the slice failed (missing heading/block) — surfaced as an inline notice. */
  reason?: string;
}

/** Slice the requested section/block out of a target note's full content. */
export function sliceTransclusion(content: string, target: TransclusionTarget): SliceResult {
  const body = stripFrontmatter(content);
  if (target.heading) return sliceHeading(body, target.heading);
  if (target.blockId) return sliceBlock(body, target.blockId);
  const text = body.trim();
  return text.length > 0 ? { ok: true, text } : { ok: false, text: '', reason: 'note is empty' };
}

/** Lines of a heading's section: the heading itself down to (not including) the
 *  next heading of equal-or-higher level. Code fences are respected. */
function sliceHeading(body: string, heading: string): SliceResult {
  const wanted = slugify(heading);
  const lines = body.split('\n');
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i]!)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i]!.match(HEADING_RE);
    if (!m) continue;
    if (start < 0) {
      if (slugify(m[2]!.trim()) === wanted) { start = i; level = m[1]!.length; }
    } else if (m[1]!.length <= level) {
      return { ok: true, text: lines.slice(start, i).join('\n').trim() };
    }
  }
  if (start < 0) return { ok: false, text: '', reason: `heading "${heading}" not found` };
  return { ok: true, text: lines.slice(start).join('\n').trim() };
}

/** The block (paragraph) carrying a `^blockid` anchor. The id can sit at the end
 *  of the block's last line or on its own line right after the block. */
function sliceBlock(body: string, blockId: string): SliceResult {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(BLOCK_ID_RE);
    if (!m || m[2] !== blockId) continue;

    if (m[1]!.trim().length === 0) {
      // Standalone `^id` line → the block is the paragraph immediately above it.
      let end = i - 1;
      while (end >= 0 && lines[end]!.trim() === '') end--;
      let start = end;
      while (start > 0 && lines[start - 1]!.trim() !== '') start--;
      if (end < 0) return { ok: false, text: '', reason: `block "^${blockId}" has no content` };
      return { ok: true, text: lines.slice(start, end + 1).join('\n').trim() };
    }

    // `^id` trails the block's last line → the contiguous paragraph ending here,
    // with the id stripped off.
    let start = i;
    while (start > 0 && lines[start - 1]!.trim() !== '') start--;
    const block = [...lines.slice(start, i), m[1]!.replace(/\s+$/, '')];
    return { ok: true, text: block.join('\n').trim() };
  }
  return { ok: false, text: '', reason: `block "^${blockId}" not found` };
}

