/**
 * Link queries (#1838 — split by family out of `queries.ts`).
 *
 * Everything that answers a question about how notes CONNECT: a note's
 * outgoing links (wiki-links, frontmatter edges, citations), its backlinks,
 * the inbound-link check that gates a safe delete, and the title lookups the
 * link rows render with.
 *
 * Self-contained: reaches `../state` and `./inbound-links` (the shared
 * "what points at this note?" primitive, #2215), and nothing outside this
 * family calls into it. Read-only, and re-exported by `queries.ts`, so every
 * existing importer is unchanged.
 */
import * as $rdf from 'rdflib';
import type { ProjectContext } from '../../project-context-types';
import { LINK_TYPES, type LinkType } from '../../../shared/link-types';
import type { OutgoingLink, Backlink, SafeDeleteBlocker } from '../../../shared/types';
import {
  getState,
  MINERVA, DC, PROV, THOUGHT,
  noteUri, sourceUri,
  linkPredicate, stripFragment,
} from '../state';
import {
  inboundStatements,
  NOTE_TARGETED_LINK_TYPES,
  NOTE_LINK_TYPES_BY_PREDICATE,
} from './inbound-links';

function existsPredicateFor(lt: LinkType) {
  if (lt.targetKind === 'source') return MINERVA('sourceId');
  if (lt.targetKind === 'excerpt') return MINERVA('excerptId');
  return MINERVA('relativePath');
}

/** A note's display title from the graph (`dc:title`), falling back to its
 *  filename stem. Used by the semantic Related panel (#838). */
export function noteTitle(ctx: ProjectContext, relativePath: string): string {
  const state = getState(ctx);
  const stem = relativePath.replace(/\.md$/i, '').split('/').pop() ?? relativePath;
  if (!state) return stem;
  const titleStmts = state.store.statementsMatching(noteUri(state, relativePath), DC('title'), undefined);
  return titleStmts[0]?.object.value ?? stem;
}

/** A source's display title from the graph (`dc:title`), falling back to its id.
 *  Used by the semantic Related panel for source/excerpt hits (#839). */
export function sourceTitle(ctx: ProjectContext, sourceId: string): string {
  const state = getState(ctx);
  if (!state) return sourceId;
  const titleStmts = state.store.statementsMatching(sourceUri(state, sourceId), DC('title'), undefined);
  return titleStmts[0]?.object.value ?? sourceId;
}

export function outgoingLinks(ctx: ProjectContext, relativePath: string): OutgoingLink[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const subject = noteUri(state, relativePath);
  const results: OutgoingLink[] = [];

  for (const lt of LINK_TYPES) {
    const stmts = store.statementsMatching(subject, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const targetNode = st.object as $rdf.NamedNode;
      // Note-typed link targets may carry a `#anchor` fragment. Look up the
      // bare note's metadata, not the fragmented URI. Default (undefined)
      // targetKind counts as 'note'.
      const isNoteTarget = !lt.targetKind || lt.targetKind === 'note';
      const bareNode = isNoteTarget && targetNode.value.includes('#')
        ? $rdf.sym(stripFragment(targetNode.value))
        : targetNode;
      const pathStmts = store.statementsMatching(bareNode, MINERVA('relativePath'), undefined);
      const titleStmts = store.statementsMatching(bareNode, DC('title'), undefined);
      const existsPredicate = existsPredicateFor(lt);
      const typeStmts = store.statementsMatching(bareNode, existsPredicate, undefined);
      const isExternalTarget = lt.targetKind === 'source' || lt.targetKind === 'excerpt';

      results.push({
        target: pathStmts[0]?.object.value ?? (isExternalTarget ? targetNode.value : ''),
        targetTitle: titleStmts[0]?.object.value ?? targetNode.value,
        linkType: lt.name,
        linkLabel: lt.label,
        linkColor: lt.color,
        exists: typeStmts.length > 0,
      });
    }
  }

  return results;
}

/**
 * Return the relative paths of notes with outgoing wiki-links pointing at
 * the given note. Used by the rename handler to decide which notes need
 * link rewrites.
 *
 * Only note-targeted link types are considered — cite/quote links point at
 * sources/excerpts and are handled by a separate rename path.
 */
/**
 * Find an existing derived note whose frontmatter pins it to
 * (`sourceRelativePath`, `cellId`). Used by the "Pin to notebook"
 * save path (#244) — when the source cell is pinned, the saver
 * overwrites this note rather than prompting for a new destination.
 *
 * Returns the derived note's relativePath, or null when no note in
 * the graph claims that (source, cellId) pair. Ambiguous matches
 * (more than one derived note for the same cell, e.g. after a user
 * copy) return the lexicographically-smallest path for determinism.
 */
export function findDerivedNoteForCell(
  ctx: ProjectContext,
  sourceRelativePath: string,
  cellId: string,
): string | null {
  const state = getState(ctx);
  if (!state) return null;
  const { store } = state;
  const sourceSym = noteUri(state, sourceRelativePath);
  // Notes whose prov:wasDerivedFrom points at the source. (The graph
  // indexer materialises `derived_from: [[source]]` as this triple.)
  const derivedStmts = store.statementsMatching(undefined, PROV('wasDerivedFrom'), sourceSym);
  const candidates: string[] = [];
  for (const st of derivedStmts) {
    const cellStmts = store.statementsMatching(st.subject, THOUGHT('derivedFromCell'), undefined);
    const cellMatch = cellStmts.some((cs) => cs.object.value === cellId);
    if (!cellMatch) continue;
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const p = pathStmts[0]?.object.value;
    if (p && p.endsWith('.md')) candidates.push(p);
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[0]!;
}

export function findNotesLinkingTo(ctx: ProjectContext, targetRelativePath: string): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const seen = new Set<string>();

  // Every triple whose object is the target note's URI, exact or anchored
  // (`<uri>#heading`). Covers typed wiki-links (minerva:supports, etc.) AND
  // frontmatter-emitted predicates that point at a note URI —
  // prov:wasDerivedFrom from `derived_from: [[note]]`, thought:decomposes from
  // `decomposes: [[note]]`, etc. (#244 acceptance criterion: renaming a source
  // should sweep the derived note's frontmatter), regardless of which predicate
  // materialised the edge.
  //
  // This used to be two passes, the second of which walked every note-targeted
  // link predicate's whole bucket just to find anchored objects — so a lookup
  // cost O(total links in the project). `inboundStatements` answers both halves
  // in O(inbound degree) (#2215); the folder-rename path runs this once per
  // moved descendant, so that scan was multiplied by the size of the folder.
  const targetSym = noteUri(state, targetRelativePath);
  for (const st of inboundStatements(state, targetSym)) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value;
    if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
  }

  return [...seen];
}

/** Muted badge colour for frontmatter (key-typed) backlinks, so they read as
 *  first-class but stay visually distinct from the typed-body-link vocabulary. */
const FRONTMATTER_LINK_COLOR = '#9399b2';

/** Humanize a predicate's local name into a badge label: `seeAlso`→"See Also",
 *  `meta-related`→"Related", `subject`→"Subject", `wasDerivedFrom`→"Was Derived From". */
function humanizePredicateLocal(local: string): string {
  const key = local.startsWith('meta-') ? local.slice('meta-'.length) : local;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export function backlinks(ctx: ProjectContext, relativePath: string): Backlink[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const targetSym = noteUri(state, relativePath);
  const results: Backlink[] = [];

  const push = (sourceNode: $rdf.NamedNode, linkType: string, linkLabel: string, linkColor: string) => {
    const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value ?? '';
    if (!sourcePath.endsWith('.md')) return; // only note sources (skip folders/tags/claims)
    const titleStmts = store.statementsMatching(sourceNode, DC('title'), undefined);
    results.push({
      source: sourcePath,
      sourceTitle: titleStmts[0]?.object.value ?? sourceNode.value,
      linkType, linkLabel, linkColor,
    });
  };

  // One object-indexed read for the note's whole inbound fan — exact hits plus
  // the anchored (`<uri>#heading`) ones the object index structurally cannot
  // find on its own (#2215). This replaces a pair of passes whose first half
  // walked every note-targeted link predicate's entire bucket, making a single
  // backlink lookup O(total links in the project); `neighborhood()` then ran it
  // once per BFS node, up to `cap = 200` times.
  const inbound = inboundStatements(state, targetSym);

  // Partitioned into typed-then-untyped rather than emitted in store order, to
  // preserve the pre-#2215 row order the panel renders: every typed body link
  // first, grouped in LINK_TYPES registry order, then the frontmatter edges.
  const typedByPredicate = new Map<string, $rdf.Statement[]>();
  const untyped: $rdf.Statement[] = [];
  for (const st of inbound) {
    if (st.subject.equals(targetSym)) continue; // a note doesn't backlink itself
    const bucket = typedByPredicate.get(st.predicate.value);
    if (bucket) { bucket.push(st); continue; }
    if (NOTE_LINK_TYPES_BY_PREDICATE.has(st.predicate.value)) {
      typedByPredicate.set(st.predicate.value, [st]);
    } else {
      untyped.push(st);
    }
  }

  // Typed body links own the richest badges (per-type label + colour from the
  // link-type registry).
  for (const lt of NOTE_TARGETED_LINK_TYPES) {
    const stmts = typedByPredicate.get(linkPredicate(lt).value);
    if (!stmts) continue;
    for (const st of stmts) push(st.subject as $rdf.NamedNode, lt.name, lt.label, lt.color);
  }

  // Every OTHER inbound edge at the note: frontmatter key-typed links
  // (`about:`→dc:subject, `see-also:`→thought:seeAlso, custom `meta-*` keys, …).
  // A derived label + neutral colour keeps frontmatter links first-class in the
  // panel instead of invisible.
  for (const st of untyped) {
    const iri = st.predicate.value;
    const local = iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
    push(st.subject as $rdf.NamedNode, iri, humanizePredicateLocal(local), FRONTMATTER_LINK_COLOR);
  }

  return results;
}

/**
 * Safe-delete pre-flight (#429). Given the set of notes about to be
 * deleted, return every inbound edge whose source is *not* itself in
 * the set — i.e. the edges that would become broken links if the
 * delete proceeded. Records are deduped per (target, source) and
 * carry a count + a representative typed link-label when available.
 *
 * Selection-internal edges (where source ∈ paths) are filtered out so
 * the "closed loop" case (A↔B both in the set) proceeds silently.
 * Self-statements about the target node (its own type / title / path
 * triples) are ignored — they aren't *inbound from another note*.
 *
 * Non-.md paths and unknown paths are skipped without error.
 */
export function findExternalInboundLinks(
  ctx: ProjectContext,
  paths: string[],
): SafeDeleteBlocker[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const targetSet = new Set(paths.filter((p) => p.endsWith('.md')));
  if (targetSet.size === 0) return [];

  // Build (path → noteUri) once.
  const targetUris = new Map<string, $rdf.NamedNode>();
  for (const p of targetSet) targetUris.set(p, noteUri(state, p));

  type Row = SafeDeleteBlocker;
  const byKey = new Map<string, Row>();
  const ensureRow = (target: string, sourceNode: $rdf.NamedNode): Row | null => {
    const pathStmts = store.statementsMatching(sourceNode, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value;
    if (!sourcePath || !sourcePath.endsWith('.md')) return null;
    if (targetSet.has(sourcePath)) return null;
    const key = `${target} ${sourcePath}`;
    let row = byKey.get(key);
    if (!row) {
      const titleStmts = store.statementsMatching(sourceNode, DC('title'), undefined);
      row = {
        target,
        source: sourcePath,
        sourceTitle: titleStmts[0]?.object.value ?? sourcePath,
        linkLabel: null,
        linkCount: 0,
      };
      byKey.set(key, row);
    }
    return row;
  };

  // One inbound fan per target — exact hits from rdflib's object index plus the
  // anchored (`#heading`) variants it can't reach (#2215). This used to be two
  // passes, the first of which walked every note-targeted link predicate's
  // whole bucket, so a safe-delete pre-flight cost O(total links) regardless of
  // how few notes were selected.
  //
  // Typed link predicates own the linkLabel; everything else (frontmatter
  // wiki-links materialised as `prov:wasDerivedFrom`, `thought:decomposes`,
  // plain `[[…]]` → `minerva:linksTo`, …) counts toward the same row without
  // one. Self-statements about the target node aren't inbound from another
  // note, so they're skipped — as are the target's own typed self-links, which
  // `ensureRow` would filter anyway via `targetSet`.
  for (const [target, targetSym] of targetUris) {
    for (const st of inboundStatements(state, targetSym)) {
      if (st.subject.equals(targetSym)) continue;
      const row = ensureRow(target, st.subject as $rdf.NamedNode);
      if (!row) continue;
      row.linkCount += 1;
      const lt = NOTE_LINK_TYPES_BY_PREDICATE.get(st.predicate.value);
      if (lt && !row.linkLabel) row.linkLabel = lt.label;
    }
  }

  // Order for stable display: by target, then source.
  return [...byKey.values()].sort((a, b) =>
    a.target.localeCompare(b.target) || a.source.localeCompare(b.source),
  );
}
