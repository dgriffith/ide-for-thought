/**
 * Shared async note-preview fetcher for link hover previews (#1131 editor,
 * #1132 Preview pane, #2710 the type views' shared `NoteHoverPreview`). Given a
 * wiki-link target it resolves the note, reads it (behind a short per-path TTL
 * cache so rapid re-hovers don't re-hit IPC), and returns a title + a
 * truncated opening/section snippet. Returns null when the target doesn't
 * resolve — callers show a quiet "not found", never an error.
 *
 * The text → `{ title, snippet }` step is `buildNotePreview` in
 * `shared/note-preview.ts` (#2710), so main can compute the same preview at
 * export time; this module adds only resolution, the read and the cache.
 */
import { resolveWikiLinkTarget } from '../../../shared/wiki-link-resolver';
import { parseTransclusionTarget } from '../../../shared/transclusion';
import { buildNotePreview, type NotePreviewText } from '../../../shared/note-preview';

export interface NotePreview extends NotePreviewText {
  /** Resolved relativePath of the target note. */
  path: string;
}

export interface NotePreviewDeps {
  /** Live list of note relativePaths (for target resolution). */
  getNotePaths: () => string[];
  /** Live frontmatter alias entries, so `[[alias]]` resolves like navigation. */
  getAliases?: () => readonly { alias: string; relativePath: string }[];
  readNote: (path: string) => Promise<string>;
}

export type NotePreviewFetcher = (target: string) => Promise<NotePreview | null>;

const CACHE_TTL_MS = 5000;

export function makeNotePreviewFetcher(deps: NotePreviewDeps): NotePreviewFetcher {
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
    const section = { ...(parsed.heading ? { heading: parsed.heading } : {}), ...(parsed.blockId ? { blockId: parsed.blockId } : {}) };
    return { path: resolved, ...buildNotePreview(content, resolved, section) };
  };
}
