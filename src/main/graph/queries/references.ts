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
import { LINK_TYPES } from '../../../shared/link-types';
import {
  type GraphState,
  getState,
  MINERVA, RDF, THOUGHT,
  noteUri, sourceUri, excerptUri,
  linkPredicate,
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
  return [...state.indexedNotePaths].filter((p) => p.endsWith('.md'));
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
  const exactTarget = `${noteUri(state, targetRelativePath).value}#${slug}`;
  const seen = new Set<string>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      if (st.object.value !== exactTarget) continue;
      const sourceNode = st.subject;
      const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
      const sourcePath = pathStmts[0]?.object.value;
      if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
    }
  }
  return [...seen];
}


