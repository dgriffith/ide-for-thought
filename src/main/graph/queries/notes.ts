/**
 * Note-identity and frontmatter lookups (#1838 — the last family out of
 * `queries.ts`).
 *
 * What the store knows about a note AS a note: its aliases (both directions),
 * the project's frontmatter vocabulary, its IRI, and its heading snapshot.
 * Everything here is keyed by a note path or resolves one.
 *
 * Read-only, reaches only `../state`, re-exported by `queries.ts`.
 */
import type { ProjectContext } from '../../project-context-types';
import { stripNoteExt } from '../../../shared/note-extensions';
import { type HeadingSnapshot, getState, noteUri } from '../state';

/**
 * Snapshot of the live alias map (#469). Returns alias → relativePath
 * pairs as a plain object; the renderer uses it for wiki-link
 * navigation and (eventually) autocomplete. Keys are lower-cased.
 */
export function getAliasMap(ctx: ProjectContext): Record<string, string> {
  const state = getState(ctx);
  if (!state) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of state.aliasMap) out[k] = v;
  return out;
}

/**
 * Entries form of the alias map, preserving original casing (#492).
 * `getAliasMap` lowercases everything for case-insensitive resolution;
 * the wiki-link autocomplete needs the original casing so picking a
 * suggested alias inserts `[[JFK]]` rather than `[[jfk]]`.
 *
 * Same conflict policy as `rebuildAliasMap`:
 *   - Alphabetical-first-writer wins on alias collisions.
 *   - Aliases that lowercase-collide with a real note's path stem or
 *     basename are dropped.
 */
export interface AliasEntry {
  alias: string;
  relativePath: string;
}
/** The frontmatter aliases declared by a single note (#1074) — for pointing the
 *  unlinked-mentions embeddings query at an object's title + aliases. */
export function aliasesForNote(ctx: ProjectContext, relativePath: string): string[] {
  const state = getState(ctx);
  return state?.aliasesPerNote.get(relativePath) ?? [];
}

export function getAliasEntries(ctx: ProjectContext): AliasEntry[] {
  const state = getState(ctx);
  if (!state) return [];
  const claimed = new Set<string>(); // lowercase aliases already taken
  // Drop any alias whose lowercase form collides with a real note's
  // canonical name — matches rebuildAliasMap's second pass.
  const canonicals = new Set<string>();
  for (const path of state.indexedNotePaths) {
    const stem = stripNoteExt(path).toLowerCase();
    canonicals.add(stem);
    const basename = stem.split('/').pop() ?? '';
    if (basename) canonicals.add(basename);
  }
  const out: AliasEntry[] = [];
  const paths = [...state.aliasesPerNote.keys()].sort();
  for (const path of paths) {
    const aliases = state.aliasesPerNote.get(path) ?? [];
    for (const alias of aliases) {
      const key = alias.toLowerCase();
      if (canonicals.has(key)) continue;
      if (claimed.has(key)) continue;
      claimed.add(key);
      out.push({ alias, relativePath: path });
    }
  }
  return out;
}

/**
 * Deduped, alphabetically-sorted list of every frontmatter key
 * currently in use across the project. Powers the Properties panel's
 * Add-Property autocomplete (#488). Empty when the project has no
 * graph state yet.
 */
export function getAllFrontmatterKeys(ctx: ProjectContext): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const seen = new Set<string>();
  for (const keys of state.frontmatterKeysPerNote.values()) {
    for (const k of keys) seen.add(k);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * The IRI Minerva uses to identify the note at `relativePath` in the
 * graph for project `ctx`. Exposed so callers outside graph/index.ts
 * (notably the conversation module, which writes thought:contextNote
 * triples) can write a real IRI instead of stuffing a relative path
 * into an angle-bracket slot. Returns null when the project has no
 * graph state yet — caller should treat that as "no triple to write".
 */
export function noteUriFor(ctx: ProjectContext, relativePath: string): string | null {
  const state = getState(ctx);
  if (!state) return null;
  return noteUri(state, relativePath).value;
}

/** Return headings present in the last indexNote call for `relativePath`, or []. */
export function headingsFor(ctx: ProjectContext, relativePath: string): HeadingSnapshot[] {
  const state = getState(ctx);
  return state?.headingsPerNote.get(relativePath) ?? [];
}


