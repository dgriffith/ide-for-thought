/**
 * Directory-listing ignore policy for a thoughtbase root (#1897).
 *
 * Two things get skipped when walking a thoughtbase: any dot-prefixed entry
 * (hidden files/dirs — `.git`, `.minerva`, `.obsidian`, `.DS_Store`, …) and
 * `node_modules` specifically, the one ignored name that ISN'T dot-prefixed.
 * `IGNORED_DIRS` keeps `.git`/`.minerva`/`.obsidian` listed explicitly even
 * though the dot-check already catches them — CLAUDE.md documents the policy
 * by these names, and a caller reading `IGNORED_DIRS` should see the same
 * list the docs describe rather than infer three of the four from "starts
 * with a dot".
 *
 * Before this module existed, four files declared byte-identical copies of
 * `IGNORED_DIRS` and eleven more inlined the equivalent
 * `name.startsWith('.') || name === 'node_modules'` check directly — one
 * policy, fifteen chances to drift. Electron-free so every consumer (several
 * of which are themselves electron-free — graph/search/llm indexing) can
 * import it without pulling electron in.
 *
 * NOT for every directory walk in `src/main`: a walker over a *fixed,
 * Minerva-managed* location (`.minerva/types/`, `.minerva/templates/`,
 * a skills folder) isn't scanning an arbitrary thoughtbase tree a user could
 * have dropped a `node_modules` into, so those intentionally keep a plain
 * dot-check instead of importing this — see the comment at each such site.
 */

export const IGNORED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);

/** True for a directory-listing entry that should be skipped when walking a
 *  thoughtbase root: any dot-prefixed name, or one of {@link IGNORED_DIRS}. */
export function isIgnoredEntry(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

/**
 * True when any segment of a thoughtbase-relative path is one
 * {@link isIgnoredEntry} would skip — `.minerva/secrets.json`,
 * `notes/.git/config`, `node_modules/x/README.md`, `..`. Lets a single-path
 * read refuse exactly what the walkers never list (#2452): an external
 * agent's `read_note` should reach the notes it could have found, not
 * Minerva's own state. `.` segments and empty ones (`./a.md`, `a//b.md`) are
 * not names and are ignored. Splits on both separators, since a
 * Windows-style path reaches the same `path.resolve`.
 */
export function hasIgnoredSegment(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]/)
    .some((seg) => seg !== '' && seg !== '.' && isIgnoredEntry(seg));
}
