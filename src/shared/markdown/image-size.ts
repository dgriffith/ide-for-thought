/**
 * Image size in a note's markdown (#2666), in the Obsidian syntax: width only
 * is `![alt|400](pic.png)`, width and height is `![alt|400x300](pic.png)`.
 * Decided over `{width=400}` because neither markdown-it nor Obsidian reads
 * that, while most imported vaults come from Obsidian; any other markdown tool
 * just shows the suffix as part of the alt text.
 *
 * Three pieces, all pure:
 *
 * - `parseImageSizeSuffix` splits a label into alt + size. Only a trailing
 *   `|<digits>` or `|<digits>x<digits>` is a size; `![a|b](x)` keeps `a|b` as
 *   its alt, and `![a|b|400](x)` is alt `a|b` at width 400.
 * - `installImageSize` is the markdown-it core rule the preview and every HTML
 *   export install, so `<img>` carries `width` / `height` everywhere and the
 *   alt text never shows the suffix. It also stamps where each image sits in
 *   the source (`ImageSourceRef`), which is what the preview's resize handle
 *   writes back through.
 * - `applyImageSize` rewrites one image's suffix in the note's source — the
 *   edit a drag, a keyboard step or a reset makes.
 *
 * Clamping is a render concern: a stored size is drawn within
 * [IMAGE_MIN_PX, IMAGE_MAX_PX], and the page's `max-width: 100%` draws a size
 * wider than the column at column width — neither rewrites the stored value.
 */
import type { MarkdownIt, Token } from 'markdown-it';
import { editNoteText } from '../frontmatter-block';

export const IMAGE_MIN_PX = 16;
export const IMAGE_MAX_PX = 4096;

export interface ImageSize {
  width: number;
  height: number | null;
}

export interface ParsedImageLabel {
  alt: string;
  size: ImageSize | null;
}

// Greedy head, so the suffix is the text after the LAST `|`.
const SIZE_SUFFIX_RE = /^([\s\S]*)\|\s*(\d{1,6})(?:\s*x\s*(\d{1,6}))?\s*$/;

/** Clamp a stored dimension to what the page will draw. */
export function clampImageDimension(n: number): number {
  return Math.min(IMAGE_MAX_PX, Math.max(IMAGE_MIN_PX, Math.round(n)));
}

/**
 * Split an image label into its alt text and an optional size suffix. A
 * suffix that isn't a number (`|wide`) is ordinary alt text. A `\|` (the
 * escaped pipe a table cell needs) counts as the separator too.
 */
export function parseImageSizeSuffix(label: string): ParsedImageLabel {
  const m = SIZE_SUFFIX_RE.exec(label);
  if (!m) return { alt: label, size: null };
  const width = Number(m[2]);
  if (!(width > 0)) return { alt: label, size: null };
  const height = m[3] !== undefined && Number(m[3]) > 0 ? Number(m[3]) : null;
  const alt = m[1]!.endsWith('\\') ? m[1]!.slice(0, -1) : m[1]!;
  return { alt, size: { width, height } };
}

/** The suffix for a size: `|400` or `|400x300`; empty for no size. */
export function formatImageSizeSuffix(size: ImageSize | null): string {
  if (!size) return '';
  return size.height !== null ? `|${size.width}x${size.height}` : `|${size.width}`;
}

/**
 * Where an image's markdown sits in the note, so an edit can find it again:
 * the block's 1-based line range in the FULL content (frontmatter included,
 * the same numbering as a fence's `data-fence-line`), the raw label as written,
 * and which occurrence of that exact label within the block it is.
 */
export interface ImageSourceRef {
  line: number;
  endLine: number;
  label: string;
  ordinal: number;
  /** Which image of the block it is, counting every image — stable across a
   *  resize (the label changes; this doesn't), so focus can follow it. */
  index: number;
}

/** What the core rule leaves on an image token's `meta`. */
export interface ImageSizeMeta {
  imageSize?: ImageSize | null;
  imageSource?: ImageSourceRef | null;
}

/**
 * Core rule: strip a size suffix off every image's alt text and set `width`
 * (and `height`) on the token, clamped. Runs after `text_join`, so the label's
 * last text child holds the whole suffix — a suffix is plain digits, so no
 * inline rule splits it.
 */
export function installImageSize(md: MarkdownIt): void {
  md.core.ruler.push('image_size', (state) => {
    const lineOffset = (state.env as { lineOffset?: number } | undefined)?.lineOffset ?? 0;
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const seen = new Map<string, number>();
      let index = 0;
      for (const tok of block.children) {
        if (tok.type !== 'image') continue;
        index++;
        const label = tok.content;
        const ordinal = seen.get(label) ?? 0;
        seen.set(label, ordinal + 1);
        const meta: ImageSizeMeta = {
          imageSize: stripSizeFromChildren(tok),
          // A table cell's inline token has no map (markdown-it 15), and its
          // content has had `\|` unescaped, so it can't be found in the source
          // again: it renders at its size but offers no handle.
          imageSource: block.map
            ? { line: block.map[0] + 1 + lineOffset, endLine: block.map[1] + lineOffset, label, ordinal, index: index - 1 }
            : null,
        };
        tok.meta = { ...(tok.meta as object | null), ...meta };
        if (meta.imageSize) {
          tok.attrSet('width', String(clampImageDimension(meta.imageSize.width)));
          if (meta.imageSize.height !== null) tok.attrSet('height', String(clampImageDimension(meta.imageSize.height)));
        }
      }
    }
  });
}

function stripSizeFromChildren(tok: Token): ImageSize | null {
  const kids = tok.children ?? [];
  const last = kids[kids.length - 1];
  if (!last || last.type !== 'text') return null;
  const parsed = parseImageSizeSuffix(last.content);
  if (!parsed.size) return null;
  last.content = parsed.alt;
  if (last.content === '') kids.pop();
  return parsed.size;
}

/** Read an image token's size back (for a renderer rule that builds its own tag). */
export function imageSizeOf(tok: Token): { width: number | null; height: number | null } {
  const w = tok.attrGet('width');
  const h = tok.attrGet('height');
  return { width: w ? Number(w) : null, height: h ? Number(h) : null };
}

/** One `![label](…)` / `![label][ref]` occurrence: where its label sits. */
interface LabelSpan { start: number; end: number }

/**
 * Every image label in `text`, in order — skipping code spans and escaped
 * brackets. Bracket depth is counted so `![a [b] c](x)` is one label.
 */
export function findImageLabels(text: string): LabelSpan[] {
  const out: LabelSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, i + run);
      i = close < 0 ? i + run : close + run;
      continue;
    }
    if (ch === '!' && text[i + 1] === '[') {
      const start = i + 2;
      let depth = 1;
      let j = start;
      while (j < text.length && depth > 0) {
        const c = text[j]!;
        if (c === '\\') { j += 2; continue; }
        if (c === '[') depth++;
        else if (c === ']') depth--;
        if (depth > 0) j++;
      }
      if (depth === 0 && (text[j + 1] === '(' || text[j + 1] === '[')) {
        out.push({ start, end: j });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * Rewrite one image's size suffix in `content`: `size` sets it (`|400`,
 * `|400x300`), `null` removes it (a reset). Returns the new content, or null
 * when the image isn't where `ref` says — the note changed under the gesture —
 * so the caller writes nothing rather than resizing the wrong image.
 *
 * `ref` comes from markdown-it, which reads the note as LF; the edit runs on
 * the same LF text and is mapped back, so a CRLF note stays CRLF (#2690).
 */
export function applyImageSize(content: string, ref: ImageSourceRef, size: ImageSize | null): string | null {
  return editNoteText(content, (text) => applyImageSizeToText(text, ref, size));
}

function applyImageSizeToText(content: string, ref: ImageSourceRef, size: ImageSize | null): string | null {
  const lines = content.split('\n');
  if (ref.line < 1 || ref.endLine < ref.line || ref.endLine > lines.length) return null;
  const blockStart = lines.slice(0, ref.line - 1).reduce((n, l) => n + l.length + 1, 0);
  const blockText = lines.slice(ref.line - 1, ref.endLine).join('\n');
  const matches = findImageLabels(blockText).filter((s) => blockText.slice(s.start, s.end) === ref.label);
  const hit = matches[ref.ordinal];
  if (!hit) return null;
  const { alt, size: old } = parseImageSizeSuffix(ref.label);
  // Keep a `\|` separator where the label already used one.
  const escaped = old !== null && /\\\|\s*\d+(?:\s*x\s*\d+)?\s*$/.test(ref.label);
  const suffix = formatImageSizeSuffix(size);
  const nextLabel = alt + (escaped && suffix ? `\\${suffix}` : suffix);
  const from = blockStart + hit.start;
  const to = blockStart + hit.end;
  return content.slice(0, from) + nextLabel + content.slice(to);
}
