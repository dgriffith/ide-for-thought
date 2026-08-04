/**
 * The file extensions Minerva treats as first-class notes — everything that is
 * indexed as `a minerva:Note` and is a valid wiki-link target. Kept in `shared/`
 * (no `main/` imports) so the renderer, the pure wiki-link resolver, and the
 * main-side indexer all agree on one list.
 *
 * ORDER IS PRECEDENCE: when a bare wiki-link like `[[budget]]` could match more
 * than one file with the same stem (`budget.md` vs `budget.csv`), the earliest
 * extension here wins — `.md` first. An explicitly-extended link (`[[budget.csv]]`)
 * bypasses this via an exact-path match in the resolver.
 *
 * `main/notebase/indexable-files.ts` derives `INDEXABLE_EXTS` from this, so
 * adding a note format is a one-line change here.
 */
export const NOTE_EXTENSIONS = ['.md', '.ttl', '.csv', '.py'] as const;

export type NoteExtension = (typeof NOTE_EXTENSIONS)[number];

const NOTE_EXT_RE = new RegExp(`(${NOTE_EXTENSIONS.map((e) => `\\${e}`).join('|')})$`, 'i');

/** True when `relativePath` ends in a note extension (case-insensitive). */
export function isNotePath(relativePath: string): boolean {
  return NOTE_EXT_RE.test(relativePath);
}

/** Strip a trailing note extension, leaving the stem. Non-note paths (and paths
 *  with some other extension) are returned unchanged. */
export function stripNoteExt(s: string): string {
  return s.replace(NOTE_EXT_RE, '');
}

/** Precedence rank of a path's note extension (lower = higher priority, `.md`
 *  = 0). A path with no note extension sorts last. Used for the md-first stable
 *  sort that makes bare-link resolution deterministic regardless of caller order. */
export function noteExtRank(relativePath: string): number {
  const lower = relativePath.toLowerCase();
  for (let i = 0; i < NOTE_EXTENSIONS.length; i++) {
    if (lower.endsWith(NOTE_EXTENSIONS[i]!)) return i;
  }
  return NOTE_EXTENSIONS.length;
}
