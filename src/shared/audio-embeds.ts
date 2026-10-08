/**
 * Audio recordings embedded in notes (#2428, #2730): how an embed and its
 * transcript are recognised in markdown. Shared because the renderer edits
 * them (`voice/recording-text.ts`) and the graph indexes them
 * (`graph/indexers/recordings.ts`), and the two must agree on what counts.
 */

import { mediaKind } from './media';

/** Thoughtbase folder recordings are saved under. Visible, not under
 *  `.minerva/`: a recording is the user's file, like a note. */
export const RECORDINGS_DIR = 'assets/recordings';

// `![alt](target)` or `![alt](target "title")`. Image embeds can't nest, so
// a flat pattern is enough; the target is everything up to whitespace or `)`.
const EMBED_RE = /!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;

export interface AudioEmbed {
  /** The embed's target exactly as written (note-relative). */
  target: string;
  /** Offset just past the embed's closing `)`. */
  end: number;
}

/** Every audio embed in `text`, in order. Offsets are relative to `text`. */
export function audioEmbedsIn(text: string): AudioEmbed[] {
  const out: AudioEmbed[] = [];
  for (const m of text.matchAll(EMBED_RE)) {
    const target = m[1]!;
    if (mediaKind(decodeTarget(target)) === 'audio') {
      out.push({ target, end: m.index + m[0].length });
    }
  }
  return out;
}

/** A link target with `%20`-style escapes undone (left as-is if malformed). */
export function decodeTarget(target: string): string {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

/** The header line every transcript callout opens with. */
export const TRANSCRIPT_HEADER = '> [!transcript]- Transcript';
const TRANSCRIPT_HEADER_RE = /^>\s*\[!transcript\]/i;

/**
 * The transcript callout belonging to the embed that ends at `embedEnd`: the
 * first non-blank line after the embed's line must open it. Returns its span
 * (`end` excludes the trailing newline), or null if the embed has none.
 */
export function transcriptAfter(doc: string, embedEnd: number): { start: number; end: number } | null {
  const nl = doc.indexOf('\n', embedEnd);
  if (nl === -1) return null;
  let start = nl + 1;
  while (start < doc.length && doc[start] === '\n') start++;
  const firstEnd = lineEnd(doc, start);
  if (!TRANSCRIPT_HEADER_RE.test(doc.slice(start, firstEnd))) return null;
  // The callout runs while lines keep their `>` prefix.
  let end = firstEnd;
  while (end < doc.length) {
    const next = end + 1;
    const nextEnd = lineEnd(doc, next);
    if (!doc.slice(next, nextEnd).startsWith('>')) break;
    end = nextEnd;
  }
  return { start, end };
}

function lineEnd(doc: string, from: number): number {
  const i = doc.indexOf('\n', from);
  return i === -1 ? doc.length : i;
}

/**
 * When a recording was started, from Minerva's own file name
 * (`2026-10-08-1432.weba`, `2026-10-08-1432-2.weba`) as a local
 * `YYYY-MM-DDTHH:MM:00` — or null for a file named some other way.
 */
export function recordingStartedAt(relativePath: string): string | null {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-\d+)?\.[a-z0-9]+$/i.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (+mo! < 1 || +mo! > 12 || +d! < 1 || +d! > 31 || +h! > 23 || +mi! > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:00`;
}
