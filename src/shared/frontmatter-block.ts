/**
 * The frontmatter BOUNDARY, and the line-ending discipline for rewriting a
 * note (#2690).
 *
 * `findFrontmatter` is the one place that decides where a note's leading
 * `---` YAML block starts and ends. Every reader goes through it — the graph
 * and search (`parseFrontmatter`), the preview and exports
 * (`stripFrontmatter`), the publish pipeline, the Properties panel, the type
 * and skill loaders — so they can't disagree about whether a note HAS
 * frontmatter. They used to: the graph's parse was LF-only, so a note saved
 * with Windows line endings had its `type:`, `tags:`, `title:` and properties
 * missing from the graph and search while the preview and publish read them.
 *
 * What counts as a block:
 *   - `---`, a line break, the YAML, a line break, `---` — the closing fence
 *     followed by its own line break when there is one. The closing fence is
 *     not required to end its line (`---more` closes the block and leaves
 *     `more` as body), which is what the graph, `stripFrontmatter` and the
 *     preview have always done;
 *   - a line break is `\n` or `\r\n`, independently on each line, so a note
 *     with mixed endings still parses;
 *   - a lone `\r` (classic Mac OS) is NOT a line break. Nothing current writes
 *     it, the preview's `stripFrontmatter` never accepted it, and a third
 *     line-ending style for every writer to preserve isn't worth that;
 *   - one UTF-8 byte-order mark (U+FEFF) before the opening fence is allowed.
 *     Node's `readFile(…, 'utf-8')` keeps it, and older Windows editors
 *     (Notepad before 2019) wrote it by default. The block then starts at
 *     offset 1, and writers keep the mark where it was.
 *
 * The YAML handed back has every `\r\n` folded to `\n`, so a parsed value
 * never ends in a stray `\r`.
 *
 * `editNote` / `editNoteText` are the writer half. A writer works on LF text
 * with no BOM, as every writer here always assumed, and the result is mapped
 * back onto the note's own encoding: the BOM stays, the text the writer left
 * alone stays byte-identical, and the text it wrote takes the note's line
 * ending (that of its first line). A CRLF note stays CRLF; nothing mixes `\n`
 * into it.
 *
 * Pure: string work only, no Node builtins (`src/shared` is lint-enforced
 * pure), so main, renderer and CLI share it.
 */

export type LineEnding = '\n' | '\r\n';

/** Optional BOM, opening fence, YAML, closing fence, its line break if any. */
const BLOCK_RE = /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;
const BOM = 0xfeff;
const DASH = 0x2d;

export interface FrontmatterBlock {
  /** The YAML between the fences, every `\r\n` folded to `\n`. */
  yaml: string;
  /** Offset of the opening fence: 1 after a byte-order mark, else 0. */
  start: number;
  /** Offset just past the closing fence and its line break, when it has one. */
  end: number;
}

/** The note's frontmatter block, or null when it doesn't open with one. */
export function findFrontmatter(content: string): FrontmatterBlock | null {
  // Most notes can be turned away on their first character.
  const first = content.charCodeAt(0);
  if (first !== DASH && first !== BOM) return null;
  const m = BLOCK_RE.exec(content);
  if (!m) return null;
  const raw = m[2]!;
  return {
    yaml: raw.includes('\r') ? raw.replace(/\r\n/g, '\n') : raw,
    start: m[1]!.length,
    end: m[0].length,
  };
}

/** The note's line ending: its first line break's, `\n` when it has none. */
export function lineEndingOf(content: string): LineEnding {
  const nl = content.indexOf('\n');
  return nl > 0 && content.charCodeAt(nl - 1) === 0x0d ? '\r\n' : '\n';
}

/**
 * `content` as writers see it: no byte-order mark, every `\r\n` folded to
 * `\n`. For a caller that only READS through a writer's LF assumptions.
 */
export function normalizeNoteText(content: string): string {
  const noBom = content.charCodeAt(0) === BOM ? content.slice(1) : content;
  return noBom.includes('\r') ? noBom.replace(/\r\n/g, '\n') : noBom;
}

/**
 * Run an LF-only text edit against a note of any encoding (see the module
 * header). `edit` gets the normalised text; its result is mapped back. A
 * `null` from `edit` (a writer refusing, e.g. on malformed YAML) passes
 * through. An edit that changes nothing returns `content` itself.
 */
export function editNoteText(content: string, edit: (text: string) => string): string;
export function editNoteText(content: string, edit: (text: string) => string | null): string | null;
export function editNoteText(content: string, edit: (text: string) => string | null): string | null {
  if (!needsNormalising(content)) return edit(content);
  const text = normalizeNoteText(content);
  const next = edit(text);
  return next === null ? null : restore(content, text, next);
}

/**
 * `editNoteText` for writers that return a result object carrying `content`
 * (plus whatever they report alongside it). Only `content` is mapped back.
 */
export function editNote<R extends { content: string }>(content: string, edit: (text: string) => R): R;
export function editNote<R extends { content: string }>(content: string, edit: (text: string) => R | null): R | null;
export function editNote<R extends { content: string }>(content: string, edit: (text: string) => R | null): R | null {
  if (!needsNormalising(content)) return edit(content);
  const text = normalizeNoteText(content);
  const result = edit(text);
  if (result === null) return null;
  return { ...result, content: restore(content, text, result.content) };
}

function needsNormalising(content: string): boolean {
  return content.charCodeAt(0) === BOM || content.includes('\r\n');
}

/**
 * Map `next` (an edit of `text`, the normalised form of `content`) back onto
 * `content`. The longest common prefix and suffix are copied from `content`
 * byte for byte, so untouched text keeps whatever endings it had, even in a
 * note with mixed endings. The changed middle takes the note's line ending.
 */
function restore(content: string, text: string, next: string): string {
  if (next === text) return content;
  const max = Math.min(text.length, next.length);
  let p = 0;
  while (p < max && text.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && text.charCodeAt(text.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;

  const eol = lineEndingOf(content);
  let middle = next.slice(p, next.length - s);
  if (eol === '\r\n') middle = middle.replace(/\r?\n/g, '\r\n');
  return content.slice(0, originalOffset(content, p)) + middle + content.slice(originalOffset(content, text.length - s));
}

/** The offset in `content` of normalised offset `i`: past the BOM, and one
 *  further for every `\r\n` folded before it. */
function originalOffset(content: string, i: number): number {
  let o = content.charCodeAt(0) === BOM ? 1 : 0;
  for (let k = 0; k < i; k++) {
    o += content.charCodeAt(o) === 0x0d && content.charCodeAt(o + 1) === 0x0a ? 2 : 1;
  }
  return o;
}
