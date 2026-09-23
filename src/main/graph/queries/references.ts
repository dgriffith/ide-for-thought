/**
 * Reference lookups (#1838 — split by family out of `queries.ts`).
 *
 * "Which notes point at this thing?", where the thing is a source, an excerpt,
 * or a heading anchor — as distinct from `./links`, which answers the same
 * question for note-to-note edges. Also the two whole-project note listings
 * (`allNotePaths`, `termNotePaths`) that the refactor and glossary paths walk.
 *
 * `findNotesLinkingToAnchorImpl` is imported by `graph/indexers.ts` through the
 * `queries.ts` facade — the one place the write side reaches into the read
 * side, and it stays a one-way edge.
 *
 * Read-only, reaches only `../state`, re-exported by `queries.ts`.
 */
import * as $rdf from 'rdflib';
import type { ProjectContext } from '../../project-context-types';
import { indexedNotePaths } from '../note-index';
import { NOTE_LINK_TYPES_BY_PREDICATE } from './inbound-links';
import {
  type GraphState,
  getState,
  MINERVA, RDF, THOUGHT,
  noteUri, sourceUri, excerptUri,
} from '../state';

/** Notes with a `thought:cites` edge to the given source URI. */
export function findNotesCitingSource(ctx: ProjectContext, sourceId: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const target = sourceUri(state, sourceId);
  return collectNotePathsWithPredicate(state, THOUGHT('cites'), target);
}

/** Notes with a `thought:quotes` edge to the given excerpt URI. */
export function findNotesQuotingExcerpt(ctx: ProjectContext, excerptId: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const target = excerptUri(state, excerptId);
  return collectNotePathsWithPredicate(state, THOUGHT('quotes'), target);
}

function collectNotePathsWithPredicate(
  state: GraphState,
  predicate: ReturnType<typeof MINERVA>,
  target: $rdf.NamedNode,
): string[] {
  const { store } = state;
  const stmts = store.statementsMatching(undefined, predicate, target);
  const seen = new Set<string>();
  for (const st of stmts) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const p = pathStmts[0]?.object.value;
    if (p && p.endsWith('.md')) seen.add(p);
  }
  return [...seen];
}

/** Relative paths of every note typed `thought:Term` — glossary entries
 *  (#1142). Used to give term nodes a distinct rendering in the neighborhood
 *  graph. Returned as a Set for O(1) membership during graph classification. */
export function termNotePaths(ctx: ProjectContext): Set<string> {
  const state = getState(ctx);
  if (!state) return new Set();
  const { store } = state;
  const paths = new Set<string>();
  for (const st of store.statementsMatching(undefined, RDF('type'), THOUGHT('Term'))) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const p = pathStmts[0]?.object.value;
    if (p && p.endsWith('.md')) paths.add(p);
  }
  return paths;
}

/** All indexed `.md` note paths in the thoughtbase (#215 — cross-note
 *  rules use this to reason about which link shortenings are unambiguous). */
export function allNotePaths(ctx: ProjectContext): string[] {
  const state = getState(ctx);
  if (!state) return [];
  return indexedNotePaths(ctx).filter((p) => p.endsWith('.md'));
}

/** Like findNotesLinkingTo, but scoped to links whose anchor is exactly `slug`. */
export function findNotesLinkingToAnchor(
  ctx: ProjectContext,
  targetRelativePath: string,
  slug: string,
): string[] {
  const state = getState(ctx);
  if (!state) return [];
  return findNotesLinkingToAnchorImpl(state, targetRelativePath, slug);
}

export function findNotesLinkingToAnchorImpl(
  state: GraphState,
  targetRelativePath: string,
  slug: string,
): string[] {
  const { store } = state;
  // The anchored target IRI is fully known here, so this is a plain
  // object-indexed lookup — O(inbound edges at that anchor). It used to walk
  // all twelve note-targeted link predicates' buckets and string-compare each
  // object against this very IRI, i.e. O(total links in the project) to find
  // the handful that match exactly (#2215).
  //
  // This one is on the SAVE path: `detectHeadingRename` calls it once per
  // heading whose text changed, so a note with several renamed headings paid
  // that scan several times per keystroke-triggered save. Measured on a
  // 3,000-note × 5-link thoughtbase: 15,001 statements examined to return 1 row.
  //
  // The predicate filter keeps the previous semantics exactly: only typed body
  // links reach an anchored IRI, and an inbound edge from something that isn't
  // a link type (were one ever to appear) should not count as a heading
  // reference the rename rewriter will rewrite.
  const exactTarget = $rdf.sym(`${noteUri(state, targetRelativePath).value}#${slug}`);
  const seen = new Set<string>();
  for (const st of store.statementsMatching(undefined, undefined, exactTarget)) {
    if (!NOTE_LINK_TYPES_BY_PREDICATE.has(st.predicate.value)) continue;
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value;
    if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
  }
  return [...seen];
}


