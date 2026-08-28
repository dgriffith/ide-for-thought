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
