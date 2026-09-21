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
import { type HeadingSnapshot, getState, noteUri } from '../state';
import { allFrontmatterKeys, getHeadings } from '../note-caches';
import {
  aliasMapObject,
  aliasEntries,
  aliasesForNote as aliasesForNoteIndex,
  type AliasEntry,
} from '../note-index';

/**
 * The alias readers (#469 / #492 / #1074). All three are now thin projections
 * of `graph/note-index` (#2234 PR 2), which owns the path + alias index and the
 * single implementation of its conflict policy. `getAliasEntries` used to
 * re-implement that policy here, carrying a comment that it "matches
 * rebuildAliasMap's second pass" — two copies of one rule in two files, with
 * nothing checking they agreed.
 */

/** Snapshot of the live alias map: lowercased alias → relativePath, as a plain
 *  object for the IPC boundary. */
export function getAliasMap(ctx: ProjectContext): Record<string, string> {
  return aliasMapObject(ctx);
}

export type { AliasEntry } from '../note-index';

/** The frontmatter aliases declared by a single note (#1074) — for pointing the
 *  unlinked-mentions embeddings query at an object's title + aliases. */
export function aliasesForNote(ctx: ProjectContext, relativePath: string): string[] {
  return aliasesForNoteIndex(ctx, relativePath);
}

/** Winning aliases in their ORIGINAL casing (#492), so picking an autocomplete
 *  suggestion inserts `[[JFK]]` rather than `[[jfk]]`. */
export function getAliasEntries(ctx: ProjectContext): AliasEntry[] {
  return aliasEntries(ctx);
}

/**
 * Deduped, alphabetically-sorted list of every frontmatter key
 * currently in use across the project. Powers the Properties panel's
 * Add-Property autocomplete (#488). Empty when the project has no
 * graph state yet.
 */
export function getAllFrontmatterKeys(ctx: ProjectContext): string[] {
  return allFrontmatterKeys(ctx);
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
  return getHeadings(ctx, relativePath);
}


