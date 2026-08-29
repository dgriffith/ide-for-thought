/**
 * Shared async note-preview fetcher for wiki-link hover popovers (#1131 editor,
 * #1132 Preview pane). Given a wiki-link target it resolves the note, reads it
 * (behind a short per-path TTL cache so rapid re-hovers don't re-hit IPC), and
 * returns a title + a truncated opening/section snippet. Returns null when the
 * target doesn't resolve — callers show a quiet "not found", never an error.
 *
 * Pure of any surface: the editor extension and the Preview tooltip both drive
 * it with the same three dependencies.
 */
import { resolveWikiLinkTarget } from '../../../shared/wiki-link-resolver';
import { parseTransclusionTarget, sliceTransclusion } from '../../../shared/transclusion';
import { stripFrontmatter } from '../../../shared/frontmatter-strip';

export interface NotePreview {
  /** Resolved relativePath of the target note. */
  path: string;
  /** Display title — frontmatter `title`, else the first H1, else the stem. */
  title: string;
  /** Truncated opening (or the referenced `#heading` / `^block` section). */
  snippet: string;
}

export interface NotePreviewDeps {
  /** Live list of note relativePaths (for target resolution). */
  getNotePaths: () => string[];
  /** Live frontmatter alias entries, so `[[alias]]` resolves like navigation. */
  getAliases?: () => readonly { alias: string; relativePath: string }[];
  readNote: (path: string) => Promise<string>;
}

const CACHE_TTL_MS = 5000;
const MAX_LINES = 8;
const MAX_CHARS = 260;

export function makeNotePreviewFetcher(deps: NotePreviewDeps) {
  const cache = new Map<string, Promise<string>>();
  function readCached(path: string): Promise<string> {
    let p = cache.get(path);
    if (!p) {
      p = deps.readNote(path);
      cache.set(path, p);
      // Evict a rejected read at once (transient failure can retry) and any
      // read after the TTL (the file may have changed).
      p.catch(() => cache.delete(path));
      setTimeout(() => cache.delete(path), CACHE_TTL_MS);
    }
    return p;
  }

  return async function fetchPreview(target: string): Promise<NotePreview | null> {
    const parsed = parseTransclusionTarget(target); // { path, heading?, blockId? }
    const files = deps.getNotePaths().map((relativePath) => ({ relativePath, isDirectory: false }));
    const aliases = Object.fromEntries(
      (deps.getAliases?.() ?? []).map((a) => [a.alias.toLowerCase(), a.relativePath]),
    );
    const resolved = resolveWikiLinkTarget(parsed.path, files, aliases);
    if (!resolved) return null;

    let content: string;
    try {
      content = await readCached(resolved);
    } catch {
      return null;
    }

    let slice = sliceTransclusion(content, parsed);
    // A missing heading/block falls back to the note's opening rather than a
    // terse "not found" — the opening is the more useful preview.
    if (!slice.ok && (parsed.heading || parsed.blockId)) {
      slice = sliceTransclusion(content, { path: parsed.path });
    }
    const title = noteTitle(content, resolved);
    return { path: resolved, title, snippet: truncate(dropLeadingH1(slice.text, title)) };
  };
}

function noteTitle(content: string, path: string): string {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const t = fm[1]!.match(/^title:\s*(.+)$/m);
    if (t) return t[1]!.trim().replace(/^["']|["']$/g, '');
  }
  const body = stripFrontmatter(content);
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1]!.trim();
  return path.split('/').pop()!.replace(/\.md$/i, '');
}

/** Drop a leading `# Title` line when it just repeats the title shown above. */
function dropLeadingH1(text: string, title: string): string {
  const lines = text.split('\n');
  if (lines[0] && /^#\s+/.test(lines[0]) && lines[0].replace(/^#\s+/, '').trim() === title) {
    return lines.slice(1).join('\n').trim();
  }
  return text;
}

function truncate(text: string): string {
  const allLines = text.split('\n');
  let out = allLines.slice(0, MAX_LINES).join('\n').trim();
  let clipped = allLines.length > MAX_LINES;
  if (out.length > MAX_CHARS) {
    out = out.slice(0, MAX_CHARS).replace(/\s+\S*$/, '');
    clipped = true;
  }
  return clipped ? `${out}…` : out;
}

