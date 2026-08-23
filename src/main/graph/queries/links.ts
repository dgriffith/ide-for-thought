/**
 * Link queries (#1838 — split by family out of `queries.ts`).
 *
 * Everything that answers a question about how notes CONNECT: a note's
 * outgoing links (wiki-links, frontmatter edges, citations), its backlinks,
 * the inbound-link check that gates a safe delete, and the title lookups the
 * link rows render with.
 *
 * Self-contained: reaches only `../state`, and nothing outside this family
 * calls into it. Read-only, and re-exported by `queries.ts`, so every existing
 * importer is unchanged.
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
  const targetBase = noteUri(state, targetRelativePath).value;
  const seen = new Set<string>();

  // Pass 1: every triple whose object IS the target note's URI. This
  // covers typed wiki-links (minerva:supports, etc.) AND
  // frontmatter-emitted predicates that point at a note URI —
  // prov:wasDerivedFrom from `derived_from: [[note]]`, thought:decomposes
  // from `decomposes: [[note]]`, etc. (#244 acceptance criterion:
  // renaming a source should sweep the derived note's frontmatter.)
  // Using object-indexed lookup is cheap and picks up every
  // user-authored note → note edge regardless of which predicate
  // materialised it.
  const targetSym = noteUri(state, targetRelativePath);
  const exactStmts = store.statementsMatching(undefined, undefined, targetSym);
  for (const st of exactStmts) {
    const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
    const sourcePath = pathStmts[0]?.object.value;
    if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
  }

  // Pass 2: anchored variants `<targetUri>#heading`. These only come
  // from typed wiki-links (frontmatter wiki-links don't carry anchors),
  // so iterate LINK_TYPES rather than the full triple store.
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const objValue = st.object.value;
      if (!objValue.startsWith(`${targetBase}#`)) continue;
      const pathStmts = store.statementsMatching(st.subject, MINERVA('relativePath'), undefined);
      const sourcePath = pathStmts[0]?.object.value;
      if (sourcePath && sourcePath.endsWith('.md')) seen.add(sourcePath);
    }
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
  const targetBase = targetSym.value;
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

  // Pass 1 — typed body links (exact + anchored target IRI). These own the
  // richest badges (per-type label + colour from the link-type registry).
  const typedPredIris = new Set<string>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    typedPredIris.add(linkPredicate(lt).value);
    for (const st of store.statementsMatching(undefined, linkPredicate(lt), undefined)) {
      const objValue = st.object.value;
      if (objValue !== targetBase && !objValue.startsWith(`${targetBase}#`)) continue;
      if (st.subject.equals(targetSym)) continue; // a note doesn't backlink itself
      push(st.subject as $rdf.NamedNode, lt.name, lt.label, lt.color);
    }
  }

  // Pass 2 — every OTHER inbound edge at the note: frontmatter key-typed links
  // (`about:`→dc:subject, `see-also:`→thought:seeAlso, custom `meta-*` keys, …).
  // Object-indexed so it's cheap; a derived label + neutral colour keeps
  // frontmatter links first-class in the panel instead of invisible. Predicates
  // already surfaced by pass 1 and the note's own self-statements are skipped.
  for (const st of store.statementsMatching(undefined, undefined, targetSym)) {
    if (typedPredIris.has(st.predicate.value)) continue;
    if (st.subject.equals(targetSym)) continue;
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

  // Build (path → noteUri) once and a reverse map (uriValue → path) so
  // pass-A (anchored typed links) can identify which target a given
  // object IRI points at without re-walking the set per statement.
  const targetUris = new Map<string, $rdf.NamedNode>();
  const uriToPath = new Map<string, string>();
  for (const p of targetSet) {
    const u = noteUri(state, p);
    targetUris.set(p, u);
    uriToPath.set(u.value, p);
  }

  // Predicate IRIs we consider "typed" — used both to label rows and
  // to skip those predicates in the untyped sweep below (since we'll
  // have already counted them with a richer label).
  const typedPredByIri = new Map<string, LinkType>();
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    typedPredByIri.set(linkPredicate(lt).value, lt);
  }

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

  // Pass A — typed link predicates. Match both exact target IRI and
  // anchored variants (`#heading`). This pass owns the linkLabel.
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    const stmts = store.statementsMatching(undefined, linkPredicate(lt), undefined);
    for (const st of stmts) {
      const objValue = st.object.value;
      const hashIdx = objValue.indexOf('#');
      const baseValue = hashIdx === -1 ? objValue : objValue.slice(0, hashIdx);
      const target = uriToPath.get(baseValue);
      if (!target) continue;
      const row = ensureRow(target, st.subject as $rdf.NamedNode);
      if (!row) continue;
      row.linkCount += 1;
      if (!row.linkLabel) row.linkLabel = lt.label;
    }
  }

  // Pass B — untyped sweep. Catches frontmatter wiki-links that
  // materialise as `prov:wasDerivedFrom`, `thought:decomposes`, plain
  // `[[…]]` → `minerva:linksTo`, etc. Skip predicates already covered
  // by pass A so we don't double-count, and skip self-statements.
  for (const [target, targetSym] of targetUris) {
    for (const st of store.statementsMatching(undefined, undefined, targetSym)) {
      if (typedPredByIri.has(st.predicate.value)) continue;
      if (st.subject.equals(targetSym)) continue;
      const row = ensureRow(target, st.subject as $rdf.NamedNode);
      if (!row) continue;
      row.linkCount += 1;
    }
  }

  // Order for stable display: by target, then source.
  return [...byKey.values()].sort((a, b) =>
    a.target.localeCompare(b.target) || a.source.localeCompare(b.source),
  );
}
