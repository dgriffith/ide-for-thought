/**
 * A note's title, derived from its content — the ONE definition (#2683).
 *
 *   1. frontmatter `title:` (a non-blank string), else
 *   2. the first ATX H1 in the BODY, else
 *   3. `null` (callers fall back to the filename stem themselves).
 *
 * There used to be seven copies of this, and the graph's and search's ran the
 * H1 match over the whole file, frontmatter included. A YAML comment line is
 * `# ` at the start of a line, so a note with `# keep this comment` in its
 * frontmatter and no `title:` key was titled "keep this comment" everywhere
 * that reads the graph's `dc:title`.
 *
 * Body rules, matching what the preview renders as a heading:
 *   - the frontmatter block is removed first, with `stripFrontmatter` — the
 *     shared boundary (CRLF-aware) — not a regex of its own. An unterminated
 *     block is not frontmatter, so its lines are body, as in the preview;
 *   - `# ` lines inside a fenced code block (``` or ~~~) don't count;
 *   - `#tag` (no space) is not a heading; `#` must be followed by a space or
 *     tab, or end the line;
 *   - up to three spaces of indentation, and an optional closing `#` run, as
 *     CommonMark allows; four spaces is an indented code block;
 *   - an empty H1 (`#` alone) is skipped, not taken as a blank title;
 *   - Setext headings (`Title` over `===`) are NOT recognised. They never
 *     were, and Minerva writes ATX.
 *
 * Pure: no Node builtins, so main, renderer and CLI can all import it.
 */
import { parseFrontmatter } from './frontmatter-parse';
import { stripFrontmatter } from './frontmatter-strip';

/**
 * The note's title, or `null` when it has neither a frontmatter `title:` nor
 * a body H1.
 *
 * Pass `frontmatter` when you already parsed it (the graph parser does, once
 * per note — #2216); without it the block is parsed with `parseFrontmatter`,
 * exactly as the graph indexer reads it, so every caller agrees on `title:`.
 */
export function noteTitle(
  content: string,
  frontmatter?: Readonly<Record<string, unknown>>,
): string | null {
  const fm = frontmatter ?? parseFrontmatter(content);
  const fmTitle = Object.hasOwn(fm, 'title') ? fm.title : undefined;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  return firstBodyHeading(content);
}

/** Opening/closing code fence: up to 3 spaces, then 3+ backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** ATX H1: up to 3 spaces, `#`, then whitespace-led text or end of line. */
const H1_RE = /^ {0,3}#(?:[ \t]+(.*?))?[ \t]*$/;

/**
 * The text of the first ATX H1 after the frontmatter, skipping fenced code,
 * or `null`. Exported for callers that read `title:` their own way.
 */
export function firstBodyHeading(content: string): string | null {
  const body = stripFrontmatter(content);
  // Cheap exit for the common note that has no `#` at all past frontmatter.
  if (!body.includes('#')) return null;
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const f = FENCE_RE.exec(line);
    if (fence !== null) {
      // A closing fence is the same character, at least as long, nothing after.
      if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      // A backtick fence's info string may not contain a backtick (CommonMark).
      if (f[1]![0] === '`' && line.slice(line.indexOf(f[1]!) + f[1]!.length).includes('`')) continue;
      fence = f[1]!;
      continue;
    }
    const h = H1_RE.exec(line);
    if (!h) continue;
    const text = stripClosingHashes(h[1] ?? '');
    if (text) return text;
  }
  return null;
}

/** `Title ##` → `Title`; a `#` run is only a closing sequence after whitespace
 *  (`C#` keeps its hash), and a heading that is nothing but hashes is empty. */
function stripClosingHashes(text: string): string {
  const t = text.trim();
  if (/^#+$/.test(t)) return '';
  return t.replace(/[ \t]+#+$/, '').trim();
}
