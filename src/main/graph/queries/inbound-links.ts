/**
 * "Which statements point AT this note?", answered in O(inbound degree) (#2215).
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * rdflib's `IndexedFormula` keeps a subject, predicate, object and graph index,
 * and `statementsMatching` with a single bound term hands back that term's
 * bucket directly. So `statementsMatching(undefined, undefined, <note IRI>)` is
 * genuinely O(inbound degree) — cheap, and `backlinks()` already used it for
 * frontmatter edges.
 *
 * The typed-body-link pass could not, for one reason: a wiki-link may carry a
 * heading or block anchor, and the indexer materialises `[[foo#components]]` as
 * an object IRI of `<…/note/foo#components>` — a *different term* from
 * `<…/note/foo>`, in a different object bucket. There is no way to ask an
 * object index for "every term whose IRI starts with this prefix". So the code
 * did the only other thing available: walk all twelve note-targeted link
 * predicates' buckets — i.e. every note→note link edge in the project — and
 * string-compare each object against `<target>` / `<target>#`.
 *
 * That made a backlink lookup O(total links in the project) instead of
 * O(this note's backlinks), and it was measured, not assumed: on a synthetic
 * 3,000-note × 5-link thoughtbase (40,116 triples), one `backlinks()` call
 * examined 15,016 statements to return 5 rows. `neighborhood()` calls
 * `backlinks()` once per BFS node up to `cap = 200`, so a depth-5 walk examined
 * 3,007,200 statements (2.2s), and the folder-rename path's
 * `findNotesLinkingTo`-per-descendant loop examined 4,503,300 for 300 files
 * (3.7s).
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * Do the prefix scan ONCE per graph generation instead of once per lookup, and
 * keep only what the object index structurally cannot answer: a
 * `bare note IRI → statements whose object is <that IRI>#something` map. Exact
 * (unanchored) inbound edges still come straight from the object index and are
 * never cached at all — so the cache holds the small, rare half and the hot,
 * large half stays a live index read.
 *
 * ── Why this can't go stale ─────────────────────────────────────────────────
 *
 * #2215 flags this as the real risk, and it is the right thing to worry about:
 * a backlink list that silently omits a link the user just wrote is worse than
 * a slow one. The invalidation is therefore not a list of writers anybody has
 * to keep up to date — it's a generation counter read from the store itself.
 *
 * `storeMutationCount` (../state) returns a monotonic count bumped inside the
 * wrappers around `store.add` / `store.removeMatches` — the #2231 chokepoint
 * every triple mutation in the system passes through, bulk `$rdf.parse` loads
 * included. A cached index is used only when BOTH the store object identity and
 * that count are unchanged, so:
 *
 *   - any indexNote / removeNote / proposal apply / Turtle load bumps it;
 *   - `indexAllNotes` swaps `state.store` wholesale, which fails the identity
 *     check. That half is NOT belt-and-braces: the counter lives on the store
 *     instance and therefore **restarts at zero on every swap**, so after a
 *     rebuild of a similar-sized corpus it routinely lands back on a value the
 *     cache already holds. Verified by removing the identity check, which made
 *     the plain "rebuild after editing files on disk" case serve the OLD
 *     store's statements — a collision reached by an ordinary user gesture, not
 *     a contrived one;
 *   - a store that was never instrumented reports `null`, and we then refuse to
 *     cache at all rather than trusting a counter that will never move. That is
 *     the one case that would otherwise be silently wrong forever.
 *
 * The cost of that strictness is that a write invalidates the index for the
 * whole project, so the first lookup after each save pays one O(total links)
 * build — exactly what a single lookup cost before. Every lookup after it in
 * the same generation is O(inbound degree). Since the expensive callers are all
 * loops (200 BFS hops, one per renamed descendant, one per selected note in a
 * safe-delete), that's where the win is, and a lone post-save lookup is no
 * worse than it was.
 */
import type * as $rdf from 'rdflib';
import { LINK_TYPES, type LinkType } from '../../../shared/link-types';
import { createProjectStore } from '../../project-store';
import { projectContext } from '../../project-context-types';
import { type GraphState, storeMutationCount, linkPredicate } from '../state';

/**
 * The note-targeted link types, by predicate IRI. Cite/quote links point at
 * sources and excerpts and are handled by separate paths; a link type with no
 * explicit `targetKind` defaults to 'note'.
 */
export const NOTE_TARGETED_LINK_TYPES: readonly LinkType[] =
  LINK_TYPES.filter((lt) => !lt.targetKind || lt.targetKind === 'note');

/** Predicate IRI → link type, for classifying an inbound statement's badge. */
export const NOTE_LINK_TYPES_BY_PREDICATE: ReadonlyMap<string, LinkType> = new Map(
  NOTE_TARGETED_LINK_TYPES.map((lt) => [linkPredicate(lt).value, lt]),
);

interface AnchorIndex {
  /**
   * The exact store instance this was built from. Identity, not rootPath: a
   * full rebuild replaces `state.store` with a brand-new `$rdf.graph()`, and
   * comparing the object catches that even though the project is the same.
   */
  store: $rdf.IndexedFormula;
  /** `storeMutationCount` at build time — see the module comment. */
  mutations: number;
  /** Bare note IRI → every statement whose object is `<that IRI>#<anchor>`. */
  byBase: Map<string, $rdf.Statement[]>;
}

/**
 * Per-project slot rather than a module-level `Map` keyed by rootPath (#2240):
 * closing a thoughtbase drops this with every other subsystem's state, without
 * `project-context.ts` having to know this cache exists. There is no `dispose`
 * hook because the index holds nothing but statement references — it needs to
 * be dropped, not closed.
 */
const anchorIndexStore = createProjectStore<AnchorIndex>();

/**
 * Scan the note-targeted link predicates once and bucket every ANCHORED object
 * by the bare note IRI it points at.
 *
 * Scoped to those twelve predicates rather than the whole statement list on
 * purpose: it is both cheaper (link edges, not all triples) and an exact match
 * for the behaviour it replaces. Frontmatter-emitted edges never carry an
 * anchor — `about: "[[a#b]]"` resolves through the same wiki-link parser, and
 * the anchored form only reaches the graph through a body link — so the
 * untyped inbound sweep has always been object-exact, and still is. Widening
 * this to every predicate would change results, not just speed.
 */
function buildAnchorIndex(store: $rdf.IndexedFormula): Map<string, $rdf.Statement[]> {
  const byBase = new Map<string, $rdf.Statement[]>();
  for (const lt of NOTE_TARGETED_LINK_TYPES) {
    for (const st of store.statementsMatching(undefined, linkPredicate(lt), undefined)) {
      const obj = st.object.value;
      const hash = obj.indexOf('#');
      if (hash === -1) continue;
      // A bare note IRI can never contain a literal '#': `noteUri` encodes each
      // path segment with encodeURIComponent, which escapes it as %23. So the
      // first '#' is unambiguously the anchor separator.
      const base = obj.slice(0, hash);
      const bucket = byBase.get(base);
      if (bucket) bucket.push(st);
      else byBase.set(base, [st]);
    }
  }
  return byBase;
}

/** The anchored-object buckets for this store, rebuilding if the generation moved. */
function anchorIndex(state: GraphState): Map<string, $rdf.Statement[]> {
  const { store } = state;
  const mutations = storeMutationCount(store);
  if (mutations === null) {
    // Uninstrumented store (a hand-built `$rdf.graph()` in a test): no
    // generation token exists, so caching would be unfalsifiable. Pay the
    // scan every time — correct, and the same cost as before #2215.
    return buildAnchorIndex(store);
  }
  const ctx = projectContext(state.rootPath);
  const cached = anchorIndexStore.get(ctx);
  if (cached && cached.store === store && cached.mutations === mutations) return cached.byBase;
  const byBase = buildAnchorIndex(store);
  anchorIndexStore.set(ctx, { store, mutations, byBase });
  return byBase;
}

/**
 * Every statement whose object is `targetSym` OR an anchored variant of it
 * (`<targetSym>#heading`, `<targetSym>#^block-id`), each exactly once.
 *
 * The exact half comes live from rdflib's object index; the anchored half from
 * the generation-keyed index above. Returned in "exact first, then anchored"
 * order — callers that care about presentation order (the backlinks panel
 * groups by link type) re-sort, and the two halves are disjoint by
 * construction, so no dedupe is needed.
 */
export function inboundStatements(state: GraphState, targetSym: $rdf.NamedNode): $rdf.Statement[] {
  const exact = state.store.statementsMatching(undefined, undefined, targetSym);
  const anchored = anchorIndex(state).get(targetSym.value);
  if (!anchored || anchored.length === 0) return exact;
  return [...exact, ...anchored];
}

/**
 * Test-only: drop the cached index for a project.
 *
 * Narrow and underscore-prefixed rather than a generic `reset()` (CLAUDE.md,
 * #1944) — it exists so a test can prove the cache is *load-bearing* (clear it,
 * observe the rebuild) without every other consumer learning about a public
 * reset it must not call.
 */
export function _clearAnchorIndexForTests(state: GraphState): void {
  void anchorIndexStore.dispose(projectContext(state.rootPath));
}
