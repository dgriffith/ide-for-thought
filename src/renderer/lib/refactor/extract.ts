/**
 * Pure planning functions for note-refactoring commands (#120, #121).
 *
 * Each planner takes the source note's content + the user's selection /
 * cursor + a proposed title and returns everything the caller needs to
 * (a) write the new note and (b) rewrite the source note. No IO, no IPC —
 * just string transformation so every edge case gets unit tests.
 *
 * Shared conventions match `lib/tools/output.ts`:
 *   - new note lives in the same folder as the source
 *   - frontmatter carries title, created, source
 *   - source is rewritten to carry a `[[path-without-md]]` wiki-link
 */

export interface ExtractPlan {
  /** Relative path of the new note, including `.md`. */
  newNotePath: string;
  /** Full content of the new note (frontmatter + body). */
  newNoteContent: string;
  /** Full content of the source note after the extraction. */
  updatedSourceContent: string;
  /** The wiki-link that was inserted into the source (for tests / logging). */
  linkBack: string;
}

export interface PlanExtractOptions {
  sourceRelativePath: string;
  sourceContent: string;
  /** Character offsets into sourceContent. from ≤ to; both must be in range. */
  selection: { from: number; to: number };
  /** Title for the new note. Callers typically feed this through deriveProposedTitle first. */
  title: string;
  /** `YYYY-MM-DD` — allow tests to pin a deterministic value. */
  today: string;
}

export interface PlanSplitHereOptions {
  sourceRelativePath: string;
  sourceContent: string;
  /** Character offset; everything from here to EOF becomes the new note. */
  cursor: number;
  title: string;
  today: string;
}

/**
 * Look at `body` and decide what the new note should be called.
 * - If the first non-blank line is an ATX heading (`# …`), use the heading text.
 * - Else if the first non-blank line is short (≤ 60 chars), use it.
 * - Else return null — caller should prompt.
 */
export function deriveProposedTitle(body: string): string | null {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) return heading[1].trim();
    if (line.length <= 60) return line;
    return null;
  }
  return null;
}

/**
 * Sanitize a title into a safe filename stem (no extension).
 * - Strips path separators and other illegal chars
 * - Collapses whitespace into single dashes
 * - Lowercases
 * - Trims leading/trailing dashes
 *
 * Returns an empty string if nothing usable remains — callers should
 * fall back to a timestamp name in that case.
 */
export function sanitizeFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, ' ')  // illegal on some OSes
    .replace(/[^\w\s\-.]/g, ' ')    // everything else: keep word, space, hyphen, dot
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

function dirOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/');
  return idx < 0 ? '' : relativePath.slice(0, idx);
}

function yamlQuote(s: string): string {
  if (!/[:#]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(title: string, sourceRelativePath: string, today: string): string {
  return [
    '---',
    `title: ${yamlQuote(title)}`,
    `created: ${today}`,
    `source: ${sourceRelativePath}`,
    '---',
    '',
  ].join('\n');
}

/** Strip a frontmatter block from the top of content. Returns `null` if none. */
function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n?)/);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: content.slice(m[1].length) };
}

/**
 * Turn a relative-path into the wiki-link target form (no `.md`).
 * `notes/foo.md` → `notes/foo`.
 */
function wikiLinkTarget(relativePath: string): string {
  return relativePath.replace(/\.md$/, '');
}

/**
 * Plan an extract-selection operation. Returns the new note's full text and
 * the rewritten source text; the caller writes both and navigates.
 */
export function planExtract(opts: PlanExtractOptions): ExtractPlan {
  const { sourceRelativePath, sourceContent, selection, title, today } = opts;

  const selected = sourceContent.slice(selection.from, selection.to);
  const dir = dirOf(sourceRelativePath);
  const stem = sanitizeFilename(title) || `note-${Date.now()}`;
  const newNotePath = dir ? `${dir}/${stem}.md` : `${stem}.md`;

  const frontmatter = buildFrontmatter(title, sourceRelativePath, today);
  const newNoteContent = frontmatter + selected.replace(/^\s+|\s+$/g, '') + '\n';

  const linkBack = `[[${wikiLinkTarget(newNotePath)}]]`;
  const updatedSourceContent =
    sourceContent.slice(0, selection.from) +
    linkBack +
    sourceContent.slice(selection.to);

  return { newNotePath, newNoteContent, updatedSourceContent, linkBack };
}

/**
 * Plan a split-here operation: everything from `cursor` to EOF becomes the
 * new note; the source is truncated and gets a trailing link-back.
 *
 * If the cursor falls inside the frontmatter block, we treat the split as
 * "just after the frontmatter" — splitting frontmatter produces two
 * malformed notes.
 */
export function planSplitHere(opts: PlanSplitHereOptions): ExtractPlan {
  const { sourceRelativePath, sourceContent, cursor, title, today } = opts;

  const { frontmatter } = splitFrontmatter(sourceContent);
  const minOffset = frontmatter ? frontmatter.length : 0;
  // Snap to the start of the containing line so the split lands on a
  // paragraph boundary instead of mid-word.
  const lineStart = (() => {
    let i = Math.max(cursor, minOffset);
    while (i > minOffset && sourceContent[i - 1] !== '\n') i--;
    return i;
  })();

  const tail = sourceContent.slice(lineStart).replace(/^\s+/, '');
  const dir = dirOf(sourceRelativePath);
  const stem = sanitizeFilename(title) || `note-${Date.now()}`;
  const newNotePath = dir ? `${dir}/${stem}.md` : `${stem}.md`;

  const newNoteContent = buildFrontmatter(title, sourceRelativePath, today) + tail + (tail.endsWith('\n') ? '' : '\n');

  const linkBack = `[[${wikiLinkTarget(newNotePath)}]]`;
  // Keep one trailing newline before the link, none after.
  const head = sourceContent.slice(0, lineStart).replace(/\s*$/, '');
  const updatedSourceContent = head + (head ? '\n\n' : '') + linkBack + '\n';

  return { newNotePath, newNoteContent, updatedSourceContent, linkBack };
}

/** ISO `YYYY-MM-DD` for today, in the local timezone. */
export function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
