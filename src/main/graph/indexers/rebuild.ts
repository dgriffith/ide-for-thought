/**
 * Full-tree rebuild orchestration (#2050 — split out of indexers.ts as part
 * of finishing the facade split `graph/queries.ts` already reached).
 *
 * `indexAllNotes` is the one function that walks the whole thoughtbase: reset
 * the store, reload the type catalog + ontology, re-derive every note/source/
 * excerpt from disk, and restore the `thought:Proposal` statements that
 * aren't derivable from files (they'd otherwise vanish on every rebuild).
 * Everything here exists to serve that one entry point — the proposal
 * preservation helpers and `ensureProject` have no other caller.
 */

import * as $rdf from 'rdflib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseMarkdown } from '../parser';
import { isIndexable } from '../../../shared/indexable-files';
import { isIgnoredEntry } from '../../../shared/ignored-dirs';

import type { ProjectContext } from '../../project-context-types';

import {
  type GraphState,
  getState, invalidate, resetN3Mirror, instrumentStoreMirror,
  MINERVA, DC, RDF, THOUGHT, DCAT,
  projectUri,
} from '../state';

import { loadTypeCatalog } from '../../types/loader';
import { materializeTypeClasses } from './type-classes';

import { buildLinkResolveCtx, ensureFolder } from '../index-helpers';
import { walkAndIndexExcerpts } from './excerpt';
import { walkAndIndexSources } from './source';
import { indexNote, isAliasNameValid, rebuildAliasMap } from './note';

// Ontology triples are loaded fresh on every startup and are not persisted
// to .minerva/graph.ttl. Holding the parsed statements lets us (1) self-heal
// old graph.ttl files that included the ontology by removing any matching
// triples, and (2) strip them before writing on persistGraph().
import ONTOLOGY_TTL from '../../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../../shared/ontology-thought.ttl?raw';
import { clearNoteCaches } from '../note-caches';
import { clearNoteIndex, registerNotePath, setNoteAliases } from '../note-index';

/**
 * Reload the type catalog into graph state + re-materialize the type classes,
 * WITHOUT a full note reindex — so a freshly-saved user type ("Save Note as
 * Object Type") is immediately usable for promotion + indexing. Materialize is
 * idempotent (store.add dedupes), so re-adding existing classes is harmless.
 */
export async function reloadTypeCatalog(ctx: ProjectContext): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  state.typeCatalog = await loadTypeCatalog(state.rootPath);
  materializeTypeClasses(state.store, state.typeCatalog);
}

export function addOntologyToStore(state: GraphState): void {
  const tempStore = $rdf.graph();
  try {
    $rdf.parse(ONTOLOGY_TTL, tempStore, MINERVA('').value, 'text/turtle');
  } catch { /* ontology parse failure is non-fatal */ }
  try {
    $rdf.parse(THOUGHT_ONTOLOGY_TTL, tempStore, THOUGHT('').value, 'text/turtle');
  } catch { /* thought ontology parse failure is non-fatal */ }
  state.ontologyStatements = tempStore.statements.slice();
  for (const st of state.ontologyStatements) {
    state.store.removeMatches(st.subject, st.predicate, st.object);
  }
  for (const st of state.ontologyStatements) {
    state.store.add(st.subject, st.predicate, st.object, st.graph);
  }
}

function ensureProject(state: GraphState): void {
  const { store, rootPath } = state;
  const proj = projectUri(state);
  const existing = store.statementsMatching(proj, RDF('type'), MINERVA('Project'));
  if (existing.length === 0) {
    store.add(proj, RDF('type'), MINERVA('Project'));
    // Additive DCAT alignment (#2033): a thoughtbase is a standard "catalog
    // of things" to any generic DCAT-aware tooling, on top of its Minerva-
    // specific typing — see the sibling `dcat:Dataset` triples on each note.
    store.add(proj, RDF('type'), DCAT('Catalog'));
    store.add(proj, DC('title'), $rdf.lit(path.basename(rootPath)));
  }
}

/**
 * Statements describing every `thought:Proposal` in the store. Proposals are the
 * review queue's source of truth and are NOT rebuilt from notes, so a
 * from-scratch reindex must carry them across the reset — otherwise the queue
 * empties on every rebuild and a CLI/MCP-filed proposal (persisted in graph.ttl)
 * would be dropped the moment the app next indexes, before the user ever sees it
 * (#1151, epic #1145 — substrate/fleet provenance).
 */
function captureProposalStatements(store: $rdf.IndexedFormula): $rdf.Statement[] {
  const out: $rdf.Statement[] = [];
  for (const typed of store.statementsMatching(undefined, RDF('type'), THOUGHT('Proposal'))) {
    // Proposals are flat records — every triple on the proposal subject.
    out.push(...store.statementsMatching(typed.subject, undefined, undefined));
  }
  return out;
}

/**
 * Rewrite a term whose IRI/literal carries the old base to the new base
 * (#1443 Part B — rewrite-on-rebase). NamedNodes under `from` are re-pointed;
 * literals containing `from` (the proposal's `thought:payloadJson`, which
 * embeds base IRIs in its turtle) get every occurrence replaced. The base is a
 * unique URL prefix, so this can't touch the fixed `minerva:`/`thought:`/`prov:`
 * ontology namespaces. Other terms pass through untouched.
 */
function rebaseTerm(term: $rdf.Node, from: string, to: string): $rdf.Node {
  if (term.termType === 'NamedNode' && term.value.startsWith(from)) {
    return $rdf.sym(to + term.value.slice(from.length));
  }
  if (term.termType === 'Literal' && term.value.includes(from)) {
    const lit = term as $rdf.Literal;
    return $rdf.literal(lit.value.split(from).join(to), lit.language || lit.datatype);
  }
  return term;
}

function restoreProposalStatements(
  store: $rdf.IndexedFormula,
  stmts: $rdf.Statement[],
  rebase?: { from: string; to: string },
): void {
  for (const st of stmts) {
    if (rebase) {
      // Predicates are ontology terms (never base-derived), so leave them.
      store.add(
        rebaseTerm(st.subject, rebase.from, rebase.to) as $rdf.NamedNode,
        st.predicate,
        rebaseTerm(st.object as $rdf.Node, rebase.from, rebase.to),
      );
    } else {
      store.add(st.subject, st.predicate, st.object);
    }
  }
}

/**
 * `rebaseFrom` (#1443 Part B): the previous base IRI when this rebuild is a
 * rebase. Pending/approved proposals aren't re-derivable from files, so they're
 * carried across the reset — and, when rebasing, their base-prefixed IRIs +
 * payload turtle are rewritten to the (already-updated) `state.baseUri` so they
 * neither dangle on apply nor break the trust-integrity join for approved ones.
 */
export interface IndexAllNotesOptions {
  rebaseFrom?: string;
  /**
   * Determinate progress for a user-visible rebuild (#1814). Called once per
   * note during the main pass; `total` comes from the alias pre-pass, which
   * has already walked the whole tree, so it costs nothing extra to know.
   */
  onProgress?: (done: number, total: number) => void;
}

export async function indexAllNotes(ctx: ProjectContext, opts?: IndexAllNotesOptions): Promise<number> {
  const state = getState(ctx);
  if (!state) return 0;
  const { rootPath } = state;

  // Carry proposals across the from-scratch reset below (see the helper's note).
  const preservedProposals = captureProposalStatements(state.store);
  const rebase = opts?.rebaseFrom && opts.rebaseFrom !== state.baseUri
    ? { from: opts.rebaseFrom, to: state.baseUri }
    : undefined;

  // Reset and rebuild from scratch with ontology. The wholesale store swap is
  // the one mutation the incremental N3 mirror can't track, so drop the mirror
  // (rebuilt lazily on the next query) and re-instrument the fresh store (#1110).
  state.store = $rdf.graph();
  instrumentStoreMirror(state);
  resetN3Mirror(state);
  invalidate(state);
  addOntologyToStore(state);
  clearNoteIndex(ctx);
  // The derived per-note caches (#2234) are re-populated by the walk below, so
  // a from-scratch rebuild has to drop them too — otherwise a note deleted
  // while the app was closed keeps its heading snapshot and frontmatter keys.
  clearNoteCaches(ctx);

  ensureProject(state);
  restoreProposalStatements(state.store, preservedProposals, rebase);

  // Typed objects (#1062): load this project's type catalog (stock + in-tree
  // user types) and materialize the classes into the fresh store, so notes'
  // `type:` frontmatter can resolve to a registered class below and the graph
  // knows the classes exist. Reloaded on every full rebuild.
  state.typeCatalog = await loadTypeCatalog(rootPath);
  materializeTypeClasses(state.store, state.typeCatalog);

  // Two-pass build (#469): the first walk just reads frontmatter
  // aliases so the alias map is fully populated before any link gets
  // resolved. Otherwise notes indexed early would resolve `[[alias]]`
  // against an empty map and write the wrong target URI.
  /**
   * Note bodies read by the alias pre-pass, handed to the main pass (#2216).
   *
   * The two-pass shape is required — the alias map has to be complete before
   * any link resolves (#469) — but the passes visit exactly the same files, so
   * every note was read from disk twice per project open. Measured at 2,000
   * notes of ~2.2KB: 120ms per pass, so ~120ms saved for ~4.5MB held.
   *
   * BUDGETED, and it degrades to the old behaviour rather than to memory
   * pressure: past the cap the pre-pass simply stops retaining, and the main
   * pass re-reads those files exactly as it always did. That matters because
   * the saving is proportional to corpus size and so is the memory, and a
   * thoughtbase big enough for the 120ms to matter is also big enough for an
   * unbounded cache to hurt. Freed as soon as the rebuild returns.
   *
   * One consequence worth naming: a note edited BETWEEN the two passes is
   * indexed from the pre-pass's bytes rather than the newer ones. The window
   * is the length of one walk, during project open, and the watcher re-indexes
   * the file on the change anyway — so this trades a rare, self-correcting
   * staleness for a read of every note.
   */
  const PREPASS_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
  const prepassContent = new Map<string, string>();
  let prepassBytes = 0;

  let total = 0;
  await walkAndCollectAliases(rootPath, rootPath);
  rebuildAliasMap(ctx);

  // Build the wiki-link resolver index ONCE — indexedNotePaths + the alias map
  // are final after the pre-pass — and thread it into every indexNote below, so
  // link resolution across the whole pass is O(N), not O(N²) (#1473).
  const passLinkCtx = buildLinkResolveCtx(state);

  let count = 0;
  await walkAndIndex(rootPath, rootPath);
  // Each indexNote call above skipped its own rebuild (perf #1106) — the
  // pre-pass already left aliasMap correct, but rebuild once more here as a
  // cheap (O(N), not O(N²)) guarantee rather than relying on the pre-pass
  // and the main pass never diverging.
  rebuildAliasMap(ctx);
  count += await walkAndIndexSources(ctx, rootPath);
  count += await walkAndIndexExcerpts(ctx, rootPath);
  // graph.ttl is a cold snapshot now (#348). The release / quit path
  // writes the snapshot; an in-app rebuild only mutates the live store.

  async function walkAndIndex(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const rel = path.relative(root, fullPath);
        ensureFolder(state!, rel);
        await walkAndIndex(fullPath, root);
      } else if (isIndexable(entry.name)) {
        const relativePath = path.relative(root, fullPath);
        const cached = prepassContent.get(relativePath);
        const content = cached ?? await fs.readFile(fullPath, 'utf-8');
        // Release as we go: the main pass visits each note once, so a retained
        // body is dead the moment it is used (#2216).
        if (cached !== undefined) prepassContent.delete(relativePath);
        await indexNote(ctx, relativePath, content, { skipAliasRebuild: true, linkCtx: passLinkCtx });
        count++;
        opts?.onProgress?.(count, total);
      }
    }
  }

  async function walkAndCollectAliases(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walkAndCollectAliases(fullPath, root);
      } else if (isIndexable(entry.name)) {
        const relativePath = path.relative(root, fullPath);
        // Register every note path up front so the main pass resolves bare
        // `[[basename]]` links against the COMPLETE file set — otherwise a note
        // indexed early couldn't resolve a link to one indexed later (#1142).
        // Mirrors the alias pre-pass rationale (#469). All note extensions, so
        // `[[budget]]` resolves to a `budget.csv`/`.ttl`/`.py` too (#1446).
        registerNotePath(ctx, relativePath);
        // The pre-pass visits exactly what the main pass will index, so it
        // doubles as the count a progress bar needs (#1814).
        total++;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          if (prepassBytes + content.length <= PREPASS_CACHE_BUDGET_BYTES) {
            prepassContent.set(relativePath, content);
            prepassBytes += content.length;
          }
          const parsed = parseMarkdown(content);
          const valid = parsed.aliases.filter(isAliasNameValid);
          setNoteAliases(ctx, relativePath, valid);
        } catch {
          // Skip unreadable files; the main pass will surface the same error.
        }
      }
    }
  }

  // Belt to the delete-on-use braces above. In the normal case this is a
  // no-op — the main pass visits exactly the files the pre-pass cached and
  // releases each as it consumes it — and no test distinguishes keeping this
  // line from dropping it, which is stated rather than papered over. It earns
  // its keep only when a file is REMOVED between the two passes: the main pass
  // never visits it, so its bytes would otherwise stay resident until the next
  // rebuild. That is a real case, just not one this file can orchestrate
  // deterministically.
  prepassContent.clear();
  return count;
}
