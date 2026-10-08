/**
 * A note's link-hover preview text — its title and a short snippet of its
 * opening, or of the `#heading` / `^block` a link names (#1131, #1132, #2710).
 *
 * The pure half of the hover: note text in, `{ title, snippet }` out. No IPC,
 * no cache, no DOM, no Node builtins, so the renderer's hover fetcher
 * (`renderer/lib/editor/note-preview.ts`) and main at export time (#2710 part
 * 2: published HTML previews) compute the same preview for the same note.
 *
 * The title is the shared `noteTitle` (#2683: frontmatter `title:`, else the
 * body's first H1), falling back to the filename stem. The snippet is the
 * transclusion slice (`sliceTransclusion`, which strips frontmatter with the
 * shared `stripFrontmatter` boundary, #2690), minus a leading `# Title` line
 * that only repeats the title, cut to `NOTE_PREVIEW_MAX_LINES` lines and
 * `NOTE_PREVIEW_MAX_CHARS` characters (on a word boundary, with `…`).
 */
import { noteTitle } from './note-title';
import { sliceTransclusion, type TransclusionTarget } from './transclusion';

export interface NotePreviewText {
  /** Display title — frontmatter `title`, else the first H1, else the stem. */
  title: string;
  /** Truncated opening (or the referenced `#heading` / `^block` section). */
  snippet: string;
}

/** The snippet keeps at most this many lines… */
export const NOTE_PREVIEW_MAX_LINES = 8;
/** …and at most this many characters. */
export const NOTE_PREVIEW_MAX_CHARS = 260;

/** The section a link names, if any (`[[note#Heading]]`, `[[note^block]]`). */
export type NotePreviewSection = Pick<TransclusionTarget, 'heading' | 'blockId'>;

/**
 * The preview of the note at `path` whose text is `content`. A `section` that
 * isn't in the note falls back to the note's opening — the more useful
 * preview than a terse "not found".
 */
export function buildNotePreview(content: string, path: string, section: NotePreviewSection = {}): NotePreviewText {
  const target: TransclusionTarget = { path, ...section };
  let slice = sliceTransclusion(content, target);
  if (!slice.ok && (section.heading || section.blockId)) {
    slice = sliceTransclusion(content, { path });
  }
  const title = notePreviewTitle(content, path);
  return { title, snippet: truncateSnippet(dropLeadingH1(slice.text, title)) };
}

/** The title a preview shows: `noteTitle`, else the filename without `.md`. */
export function notePreviewTitle(content: string, path: string): string {
  return noteTitle(content) ?? path.split('/').pop()!.replace(/\.md$/i, '');
}

/** Drop a leading `# Title` line when it just repeats the title shown above. */
function dropLeadingH1(text: string, title: string): string {
  const lines = text.split('\n');
  if (lines[0] && /^#\s+/.test(lines[0]) && lines[0].replace(/^#\s+/, '').trim() === title) {
    return lines.slice(1).join('\n').trim();
  }
  return text;
}

/** Cut to the line and character caps, ending in `…` when anything was cut. */
export function truncateSnippet(text: string): string {
  const allLines = text.split('\n');
  let out = allLines.slice(0, NOTE_PREVIEW_MAX_LINES).join('\n').trim();
  let clipped = allLines.length > NOTE_PREVIEW_MAX_LINES;
  if (out.length > NOTE_PREVIEW_MAX_CHARS) {
    out = out.slice(0, NOTE_PREVIEW_MAX_CHARS).replace(/\s+\S*$/, '');
    clipped = true;
  }
  return clipped ? `${out}…` : out;
}
