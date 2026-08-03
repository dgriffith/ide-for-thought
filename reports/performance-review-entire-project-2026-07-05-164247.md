# Performance Review Plan
Generated: 2026-07-05 16:42:47
Scope: entire project (/Users/davegriffith/minerva)

---

## Executive Summary

Minerva is a local, single-user Electron desktop app (Main / Preload / Renderer,
Svelte 5 runes, RDF graph + git). There is **no server, no network backend, and
no database server**, so the classic web-performance concerns — connection
pooling, load balancing, horizontal scaling, request throughput — do not apply.
The performance surface that matters here is: **main-process responsiveness**
(the Electron main thread is shared by file I/O, git, and *all* graph/search
work), **IPC round-trip cost**, **graph/index rebuild cost**, **renderer
rendering cost**, **embeddings/search compute**, and **startup time**.

The codebase is, on the whole, performance-aware and defensively engineered:
embeddings run in an off-thread `worker_threads` worker; the embedding index is
incremental and content-hash keyed; `graph.ttl` was deliberately made a *cold
snapshot* (persisted on release, not per-write, #348); the Preview re-render is
debounced; and a non-gating benchmark suite (#1004) already guards the two
highest-risk numeric surfaces (graph index/query latency, embedding pooling +
cosine).

The dominant risk is a **single latent architectural bottleneck in the graph
read path**, already flagged in the 2026-07-05 architecture review: every write
invalidates the immutable N3 mirror the SPARQL engine reads, and the next query
rebuilds that mirror **statement-by-statement, synchronously, on the main
thread, with no yield** (`buildN3Store`, `graph/state.ts:33`). At small vaults
this is invisible; it degrades linearly with triple count and there is a real
save-then-query pattern (auto-link inbound checks, panel refreshes) that pays
it repeatedly. Secondary findings — an **O(N²) alias rebuild during full
indexing**, a **whole-index JSON rewrite of the search index on every note
save**, and the **search provider holding every note's full text in main-process
memory** — are all bounded today but scale poorly.

None of these are correctness bugs and none block shipping. They are
scale-cliff risks: they bite at 10× the notes/triples of a typical vault, not at
today's. The right posture (consistent with the architecture review) is
**instrument first, then optimize the confirmed cliffs** — the benchmark suite
is the correct foundation and should be extended with committed baselines.

> Metrics note: this review did **not** run a live profiler against the packaged
> app. Where a number would require one, findings are labelled *"not profiled —
> estimated from complexity/benchmarks"* and reasoned from algorithmic
> complexity plus the shape of the #1004 benchmark suite. No precise numbers are
> invented.

---

## Performance Bottlenecks

### Critical

#### C1 — N3 store is fully rebuilt on the first query after any write
**Files:** `src/main/graph/state.ts:33-52` (`buildN3Store`), `:173-175`
(`invalidate`); `src/main/graph/queries.ts:283-284` (`queryGraph` rebuild
point); write-side invalidation at `src/main/graph/indexers.ts:374`
(`indexNote`), and `src/main/graph/index.ts:166,188` (`parseIntoStore`,
`removeMatchingTriples`).

rdflib's mutable `IndexedFormula` is the source of truth; Comunica (the SPARQL
engine) reads from a separate immutable `N3.Store` mirror cached on
`state.n3Cache`. Every write calls `invalidate(state)`, which nulls the whole
mirror:

```ts
// state.ts
export function invalidate(state: GraphState): void { state.n3Cache = null; }
```

The next `queryGraph` rebuilds the *entire* mirror from scratch:

```ts
// queries.ts:283
if (!state.n3Cache) state.n3Cache = buildN3Store(store);
```

`buildN3Store` iterates **every statement** in the store, converting each term
and calling `addQuad`, all synchronously on the main thread with no `await`/
`setImmediate` yield (`state.ts:37-51`). This is O(triples).

Why it's critical, not merely theoretical: several flows write and then query in
the same interaction. The auto-link-inbound save path, the neighborhood graph
view, and any panel that issues SPARQL after a save all trip a full rebuild.
There are 22 `queryGraph`/SPARQL call sites in `src/main/graph` + `src/main/ipc`.

**Estimated cost (not profiled — estimated from complexity/benchmarks):** the
`n3-cache.bench.ts` suite seeds 500 notes and measures the *warm* (cache-hit)
query only — it does **not** measure the cold rebuild, so the repo has no
committed number for the exact cost being flagged. Reasoning from complexity: a
typical note emits ~10-30 triples, so 500 notes ≈ 5k-15k triples and 5,000 notes
≈ 50k-150k triples. Per-triple `convertTerm` + `addQuad` is on the order of
single-digit microseconds, putting a full rebuild at roughly tens of
milliseconds at 500 notes and **hundreds of milliseconds at 5,000 notes** — well
past the 16 ms frame budget, i.e. a visible main-thread stall on the next query
after a save.

#### C2 — Every write throws away the whole mirror, even a one-triple change
Same files as C1. The invalidation is all-or-nothing: approving a single
proposal (`removeMatchingTriples` → one predicate replaced), or a `notify_only`
confidence bump, nulls a mirror that may hold 100k triples, forcing a full
rebuild on the next read. There is no incremental "apply this delta to the N3
store" path. This is the structural reason C1 cannot be mitigated by caching
alone — the cache is correct but its invalidation granularity is the entire
graph.

### High

#### H1 — O(N²) alias-map rebuild during full indexing
**Files:** `src/main/graph/indexers.ts:473` (per-note call inside `indexNote`),
`:105-127` (`rebuildAliasMap`), `:363` (`indexAllNotes` drives it per note).

`indexNote` calls `rebuildAliasMap(state)` **on every note**, and
`rebuildAliasMap` iterates `state.indexedNotePaths` — **every note in the
project** — on every call:

```ts
// indexers.ts:121
for (const path of state.indexedNotePaths) {
  const stem = path.replace(/\.md$/i, '').toLowerCase();
  next.delete(stem);
  ...
}
```

During a full `indexAllNotes` (startup for a vault whose graph.ttl is missing/
stale, and every manual "Rebuild graph"), N notes each trigger an O(N) rebuild →
**O(N²)**. At 500 notes that's ~250k iterations (matching the `graph-index.bench.ts`
seed loop, which is itself O(N²)); at 5,000 notes ~25M iterations of string
`.replace`/`.toLowerCase`/`Set.delete` on the main thread. The comment at
`indexNote` says invalidation is flagged "once, at the boundary" — the same
one-shot discipline should apply to the alias rebuild, but it does not.

**Estimated cost:** not profiled — estimated from complexity. Startup/rebuild is
already a one-time blocking operation; the quadratic makes it grow super-linearly
and turns a large-vault rebuild into a multi-second main-thread freeze.

#### H2 — Full search-index JSON rewrite on every note save
**Files:** `src/main/notebase/write-pipeline.ts:75-77` (per-save `search.persist`),
`src/main/search/index.ts:86-90` (`persist` → provider `save`),
`src/main/search/minisearch-provider.ts:68-74` (`save`).

`writeAndReindex` runs on every note save and, unless `skipPersist` is set,
calls `search.persist`, which serializes the **entire** MiniSearch index *plus a
copy of every document's title+content* to JSON and writes it to disk:

```ts
// minisearch-provider.ts:68
const data = { index: this.engine.toJSON(), docs: Object.fromEntries(this.docs) };
await fs.writeFile(destPath, JSON.stringify(data), 'utf-8');
```

Unlike `graph.ttl` (deliberately a cold snapshot, #348), the search index is
rewritten in full on **every save**. Cost is O(total corpus bytes), not O(the one
changed note). For a 5,000-note vault of a few KB each this is a multi-megabyte
`JSON.stringify` + disk write on every keystroke-triggered autosave.

#### H3 — Search provider holds every note's full text in main-process memory
**File:** `src/main/search/minisearch-provider.ts:10,34-35`.

```ts
private docs = new Map<string, { title: string; content: string }>();
...
this.docs.set(relativePath, { title, content }); // full body, per note
```

MiniSearch doesn't store field bodies, so the provider keeps a parallel `docs`
Map of **full note content** purely for snippet extraction. This is O(total
vault bytes) resident in the main process for the lifetime of the project, on
top of MiniSearch's own inverted index and the rdflib store. For a large vault
(tens of MB of markdown) this is a meaningful, permanent main-process heap
footprint — and it is duplicated into the on-disk JSON by H2.

#### H4 — Link / backlink queries fan out across all link types, and are called per-node in graph BFS
**Files:** `src/main/graph/queries.ts:629-661` (`backlinks`), `:677-767`
(`findExternalInboundLinks`), `src/main/graph/neighborhood.ts:88-131`
(`noteHop`), driven by `neighborhood` (`:141-149`) with `DEFAULT_CAP = 200`.

`backlinks` loops all 14 `LINK_TYPES` and issues a predicate-indexed
`statementsMatching` per type, filtering objects by string prefix. `outgoingLinks`
is similar. rdflib's `IndexedFormula` makes each `statementsMatching(?, pred, ?)`
indexed (not a full scan), so a single call is acceptable — but the neighborhood
traversal calls `noteHop` (= `outgoingLinks` + `backlinks`) **for every node up
to the 200-node cap**, so a depth-2 neighborhood does up to ~200 × (14 + 14)
predicate lookups plus per-result `statementsMatching` for path/title. And
`findExternalInboundLinks` pass B (`queries.ts:753-761`) does an object-indexed
`statementsMatching(undefined, undefined, targetSym)` per target — fine for a
handful of targets, but this is the safe-delete pre-flight over a multi-select.

This is invoked reactively from the renderer: `NeighborhoodGraph.svelte` calls
`api.links.neighborhood(path, {depth})` inside a `$effect`, so switching notes
with the graph view open re-runs the whole BFS each time.

#### H5 — ConversationsPanel renders all messages with no virtualization
**File:** `src/renderer/lib/components/ConversationsPanel.svelte:1015`.

```svelte
{#each tab.conversation.messages as msg, i}
```

The message list is rendered in full with no windowing/virtualization. A long
LLM conversation (hundreds of messages, each potentially containing rendered
markdown, proposals, and diff views) mounts hundreds-to-thousands of DOM nodes,
and every append re-diffs the whole list. This is the one place in the renderer
where the DOM cost is genuinely unbounded by user activity rather than by vault
size — a long-running research conversation degrades scroll and input latency in
this panel specifically. Virtualizing (render only the visible window) is the
fix. Ranked High because, unlike the graph cliffs, it degrades within a single
session with no large vault required.

### Medium

#### M1 — Command palette registry re-derived on unrelated state changes
**Files:** `src/renderer/App.svelte:535-589` (`commandDeps` + `const commands =
$derived(buildCommandRegistry(commandDeps))`), `src/renderer/lib/command-palette/
registry.ts` (`buildCommandRegistry`, evaluates each command's `enabled` getter
at build time).

`buildCommandRegistry` computes each of ~60 commands' `enabled` by invoking
getter predicates (`hasProject`, `hasNote`, `canGoBack`, `canGoForward`,
`hasActiveNoteTab`). Because the `$derived` tracks those reactive reads, the
**entire ~60-object command array is rebuilt on every note switch, navigation,
and project open — even when the palette is closed** and nothing will consume the
result. Cost per rebuild is small (~60 allocations), so this is Medium, not
High, but it is pure avoidable churn on hot navigation paths.

#### M2 — Preview re-parses and re-highlights the whole document per edit; per-render IPC fan-out
**Files:** `src/renderer/lib/components/Preview.svelte:186` (`new MarkdownIt`),
`:190-193` (synchronous `hljs.highlight`), `:859-884` (debounced full re-render
`$effect`), `:898-916` (post-render DOM walk + per-element IPC).

The render `$effect` is correctly debounced (`RENDER_DEBOUNCE_MS`), but on each
fire it calls `renderContent(c)` which runs `md.render` over the **entire
document** with **synchronous** highlight.js highlighting — O(document size) on
the main renderer thread. For a large note this is a per-edit stall after the
debounce. The subsequent `$effect` (`:898`) walks the freshly rendered DOM and
fires an IPC round-trip **per** query-block, cite-link, quote-link, and local
image (`resolveCiteLabel`/`resolveQuoteLabel`/`applyCslMarkers`/image
hydration). A citation-heavy note therefore issues N IPC calls on every
re-render. Neither markdown parsing nor highlighting is offloaded to a worker or
done incrementally. Transclusion hydration (`Preview.svelte:~923`) additionally
calls `md.render()` **again** per `![[…]]` embed, so a note with many
transclusions multiplies the parse cost. Two smaller renderer O(n) items compound
here: `Sidebar.svelte:85` recomputes `countFiles(files)` (a full recursive walk
of the file tree) on every file-tree change for a display chip, and the
post-render effect fires an IPC round-trip per cite/quote/image element as noted
above.

#### M3 — DuckDB semantic search is brute-force KNN (linear in chunks)
**Files:** `src/main/embeddings/vector-store.ts:206-223` (`searchRelated`,
`array_cosine_distance … ORDER BY dist LIMIT`), `:230-249` (`relatedToRef`,
`FROM table t, q` cross join).

Nearest-neighbour is exact brute force (`array_cosine_distance` over the whole
`note_chunks` table) — deliberately, to avoid the VSS extension and stay offline
(documented in the header). Cost is O(chunks) per search; `relatedToRef` is a
cross join O(query_chunks × corpus_chunks) grouped and sorted. The `pooling.bench.ts`
suite benchmarks the equivalent JS `cosineSimilarity` against a **10,000-vector**
corpus, so 10k is the acknowledged scale target. At a few chunks per note this is
fine to low-thousands of notes; beyond that, each "Related" panel refresh and
each `search_related` grows linearly. Acceptable for a desktop app today, a cliff
at 10× corpus.

#### M4 — Reactive graph IPC on every navigation (panels re-fetch on note switch)
**Files (renderer, in `$effect`):** `NeighborhoodGraph.svelte`
(`api.links.neighborhood`), `right-sidebar/CitationsPanel.svelte`
(`api.links.citationsForNote`), `SourceDetail.svelte` (`api.sources.hasPdf`),
plus dialog-gated fetches in `NewNoteDialog`, `ToolParamsDialog`, `ExportDialog`,
`AboutDialog`, `ShortcutsDialog`.

34 of 93 renderer `.svelte` components call `api.*` directly. Most are one-shot
fetches gated on a dialog opening (fine). The reactive ones keyed on the active
note path (`NeighborhoodGraph`, `CitationsPanel`) re-issue a main-process graph
query/traversal on **every note switch** — each of which, per H4/C1, may in turn
trigger a full N3 rebuild or a 200-node BFS. The individual cost is bounded, but
these compound with C1/H4 on the exact hot path (navigation).

#### M5 — `indexNote` re-snapshots and re-parses on every save; embeddings DuckDB txn per save
**Files:** `src/main/notebase/write-pipeline.ts:70-74`,
`src/main/graph/indexers.ts:363-484`, `src/main/embeddings/vector-store.ts:131-160`.

Each save runs the full pipeline: `graph.indexNote` (removeMatches + full
markdown re-parse + re-add all triples + `rebuildAliasMap` per H1),
`search.indexNote` (discard + re-add + re-tokenize whole body), and a
fire-and-forget `vectors.indexNote` (chunk + hash + a `readExisting` SELECT + a
BEGIN/DELETE/INSERT transaction). The embedding path is correctly non-blocking
(worker + fire-and-forget) and incremental (only changed-hash chunks re-embed),
but the graph + search legs are synchronous on the main thread and re-do the
whole note each save. This is the per-save fixed cost that H1/H2/C1 amplify.

---

## Strengths (things already done right)

- **Embeddings are off the main thread.** `embedder-service.ts:38-86` spawns a
  `worker_threads` worker lazily and multiplexes by id; `write-pipeline.ts:74`
  fires embedding indexing as `void vectors.indexNote(...)` so a save never
  blocks on the model.
- **Embedding index is incremental + content-hash keyed.** `vector-store.ts:131-160`
  re-embeds only chunks whose sha256 changed and carries unchanged vectors over;
  `backfill.ts` is resumable and model-change aware.
- **`graph.ttl` is a cold snapshot, not per-write** (#348) — the graph's own
  persistence is *not* on the save hot path (contrast H2 for search).
- **Preview re-render is debounced** (`Preview.svelte:857-876`) and short-circuits
  when content is unchanged.
- **rdflib `IndexedFormula` gives indexed `statementsMatching`** — subject/
  predicate/object lookups are not full scans (the linear cost is confined to
  `buildN3Store`'s full-store walk, C1).
- **A benchmark suite already exists** (#1004): `graph-index.bench.ts`,
  `n3-cache.bench.ts`, `pooling.bench.ts`, run non-gating via `.github/workflows/
  bench.yml` (weekly + manual) — the correct instrumentation foundation.

---

## Performance Metrics

> All "Current" figures are *not profiled* unless drawn from the committed
> benchmark suite; they are reasoned from algorithmic complexity and the
> benchmark structure. The benches print to the CI job log only — there is **no
> committed baseline number** in the repo, which is itself a gap (see Testing
> Plan).

| Metric | Current (estimated) | Target | Basis |
|---|---|---|---|
| N3 mirror rebuild (cold), 500-note vault | tens of ms, main thread | < 16 ms or off-thread/incremental | C1 complexity; `n3-cache.bench` measures warm only |
| N3 mirror rebuild (cold), 5,000-note vault | 100s of ms, blocking | < 50 ms perceived | C1 complexity (50k-150k triples) |
| Warm SPARQL query (cache hit), 500 notes | benchmarked in `n3-cache.bench.ts` | no regression | committed bench (number in job log) |
| Full `indexAllNotes`, 500 notes | O(N²) alias, ~250k inner iters | O(N) | H1; `graph-index.bench` seed loop |
| Full `indexAllNotes`, 5,000 notes | seconds, blocking | sub-second | H1 quadratic projection |
| Search-index persist per save, 5,000 notes | multi-MB JSON write every save | O(changed note), debounced | H2 |
| Main-process resident search text | O(total vault bytes) | O(index only) or on-disk snippets | H3 |
| `meanPoolNormalize` (seq 512 × dim 384) | benchmarked | no regression | `pooling.bench.ts` |
| `cosineSimilarity` vs 10k corpus | benchmarked | no regression | `pooling.bench.ts` |
| Semantic search (brute force) | O(chunks)/query | acceptable to ~low-thousands notes | M3 |
| Preview full re-parse per debounced edit | O(doc size), sync main thread | incremental / worker for large docs | M2 |
| Command registry rebuild | ~60 allocs per navigation | 0 when palette closed | M1 |
| Cold start (init graph + search load) | not profiled | < 1 s for typical vault | needs profiler |

---

## Optimization Plan

### Quick Wins (low effort, low risk)

1. **Hoist `rebuildAliasMap` out of the per-note loop during full index (H1).**
   `indexAllNotes` already calls `rebuildAliasMap` once up front after
   `walkAndCollectAliases` (`indexers.ts`). The per-note `rebuildAliasMap` inside
   `indexNote` (`:473`) is only needed for *incremental single-note* re-index.
   Add a flag/param so `indexNote` skips the rebuild when called from
   `indexAllNotes`, and rebuild once at the end. Turns O(N²) → O(N). Highest
   value-to-effort item in this report.

2. **Debounce / coalesce `search.persist` (H2).** The write pipeline already
   supports `skipPersist` for batch callers. Replace per-save full persistence
   with a debounced/idle-time flush (e.g. persist at most once every few seconds
   or on blur/quit), the same "cold snapshot" posture `graph.ttl` already uses
   (#348). Removes a multi-MB write from the save hot path.

3. **Gate the command registry rebuild on palette visibility (M1).** Only derive
   `commands` when the palette (or a keybinding UI) is actually open, or move
   `enabled` evaluation into the palette so navigation doesn't rebuild 60 objects
   it won't show. `App.svelte:589`.

4. **Add a dev-only timing + warn threshold around `buildN3Store` (C1).** Per the
   architecture review's recommendation #7: instrument the rebuild
   (`console.warn` when it exceeds, say, 50 ms) so the cliff is observable in dev
   before it ships. Cheap, unblocks the data-driven decision for the major work.

5. **Commit benchmark baselines.** Extend the #1004 benches to write a
   baseline JSON artifact (or assert against a checked-in threshold) so
   regressions are detectable without eyeballing the weekly job log.

### Major Optimizations (medium effort, medium risk)

6. **Incremental N3 mirror maintenance (C1/C2).** Instead of nulling the whole
   `n3Cache` on every write, apply the same add/remove deltas to the live
   `N3.Store` that the indexers apply to rdflib. The indexers already know the
   exact triples they add/remove per note (named-graph scoped removal at
   `indexers.ts:381-383`), so the delta is available. This eliminates the full
   O(triples) rebuild entirely and makes save→query O(changed triples).

7. **Add the N3 rebuild baseline bench (C1).** `n3-cache.bench.ts` measures only
   the warm path. Add a cold-rebuild bench (invalidate, then time the first
   query) at 500 / 2,000 / 5,000 notes so the C1 cliff has a committed number and
   the incremental fix (item 6) can be proven.

8. **Stop holding full note bodies in the search provider (H3).** Extract
   snippets from disk on demand (the file is already on disk) or store only a
   short pre-computed snippet field, rather than the full body in `docs`.
   Removes an O(vault-bytes) permanent main-process allocation and shrinks the
   persisted JSON (compounds with item 2).

8b. **Virtualize the ConversationsPanel message list (H5).** Render only the
   visible window (windowing) so a long conversation stops mounting thousands of
   DOM nodes and re-diffing the whole list on each append. `ConversationsPanel.svelte:1015`.

9. **Cache/short-circuit neighborhood + backlink queries (H4/M4).** Memoize
   `noteHop` results within a single `neighborhood` build (a node reached from
   two directions is hopped twice today) and cache the last neighborhood keyed on
   `(path, depth)` so re-selecting a note doesn't re-run the BFS. Consider an
   inbound-link adjacency index maintained on write instead of per-query
   predicate fans.

### Architectural (higher effort, plan carefully)

10. **Move heavy graph work off the main process, or yield it.** If instrumentation
    (items 4/7) confirms C1/H1 stalls at realistic vault sizes even after the
    incremental fix, wrap full rebuilds (`indexAllNotes`, any unavoidable
    `buildN3Store`) in `setImmediate`/chunked yielding, or relocate graph
    indexing/query to a `utilityProcess`/worker so the main thread (which also
    serves file I/O and git) stays responsive. This is the natural end-state of
    the "graph read-path scalability" thread the architecture review opened.

11. **Approximate nearest-neighbour for semantic search (M3).** If corpus grows
    past low-thousands of notes, revisit the brute-force decision — an on-disk
    ANN index (or DuckDB VSS when its offline story firms up) bounds search cost
    sublinearly. Deliberately deferred today; revisit with corpus-size telemetry.

12. **Incremental / worker-based Preview rendering for large notes (M2).** For
    documents past a size threshold, render off the main thread or incrementally
    (only re-render changed blocks), and batch the post-render cite/quote/image
    IPC into a single round-trip rather than one per element.

---

## Implementation Strategy

### Phase 1 — Instrument and pick the quick wins (≈1-2 days)
- Items 1, 2, 3 (alias O(N²) fix, search-persist debounce, palette gate) — pure
  wins, low risk, immediately reduce save + navigation + startup cost.
- Items 4, 5, 7 (dev timing on `buildN3Store`, committed bench baselines, cold
  N3 rebuild bench). This turns every subsequent decision data-driven and gives
  the C1 cliff a number.
- Exit criterion: full-index is O(N); save no longer writes the whole search
  index; the N3 cold-rebuild cost is measured and thresholded.

### Phase 2 — Fix the confirmed bottlenecks (≈3-5 days)
- Item 6 (incremental N3 mirror) — the single highest-impact change; gated on
  Phase 1 showing the cliff is real at target vault sizes.
- Items 8, 9 (drop resident bodies from search; memoize/cache neighborhood +
  backlinks).
- Exit criterion: save→query no longer triggers a full O(triples) rebuild;
  main-process search memory is index-only; navigation with the graph panel open
  doesn't re-run the BFS.

### Phase 3 — Architectural, only if telemetry demands it (scoped, deferred)
- Items 10, 11, 12 (off-main-thread graph work; ANN search; worker/incremental
  Preview). Each is a real project; do not start without Phase 1 data showing the
  simpler fixes were insufficient at realistic scale.

---

## Performance Testing Plan

**Foundation already in place (#1004).** `pnpm bench` runs
`tests/main/graph/graph-index.bench.ts`, `tests/main/graph/n3-cache.bench.ts`,
`tests/main/embeddings/pooling.bench.ts` via `vitest.bench.config.ts`; CI is
non-gating (`.github/workflows/bench.yml`, weekly + manual) — the correct call
given micro-benchmark noise on shared runners.

**Gaps to close:**
1. **No committed baselines.** Benches print to the job log; nothing fails on
   regression. Add threshold assertions or a checked-in baseline artifact
   (item 5).
2. **Cold N3 rebuild is unmeasured.** `n3-cache.bench.ts` warms the cache first
   and measures the hit. Add a bench that invalidates then times the first query,
   at 500 / 2,000 / 5,000 notes (item 7) — this is the exact C1 surface.
3. **No full-`indexAllNotes` bench.** `graph-index.bench.ts` measures one
   `indexNote` into a 500-note store, not the O(N²) full rebuild (H1). Add a
   full-index bench across vault sizes to prove item 1.
4. **No save-pipeline end-to-end bench.** Add one covering `writeAndReindex`
   (graph + search + persist) to catch H2/H1/C1 interaction on the real save
   path.
5. **No renderer/IPC benchmark.** Command-registry rebuild (M1), Preview full
   re-parse (M2), and per-render IPC fan-out are unmeasured. Add a lightweight
   renderer micro-bench or a Playwright timing pass (the project already runs
   Playwright, per recent commits) for large-note preview render latency.
6. **No cold-start measurement.** Add a startup-time probe (init graph + load
   search index + first paint) across vault sizes.

**Method for each:** run at 3 vault scales (≈500 / 2,000 / 5,000 notes and the
proportional triple/chunk counts), record on the macos-latest runner that
`bench.yml` and `ci.yml` already use, and compare against the committed baseline.

---

## Risk Assessment

| Change | Risk | Mitigation |
|---|---|---|
| Item 1 (alias rebuild hoist) | Low — must ensure incremental single-note index still rebuilds the map | Keep per-note rebuild for the incremental path; only skip inside `indexAllNotes`; existing alias tests cover collisions |
| Item 2 (debounce search persist) | Medium — a crash between save and flush loses index freshness (rebuildable, not data loss) | Persist on blur/quit; the index is fully reconstructible via `indexAllNotes` |
| Item 6 (incremental N3 mirror) | **High** — the mirror could drift from rdflib and silently return wrong SPARQL results | Keep a periodic full-rebuild fallback; property-test incremental vs full-rebuild equivalence; the existing SPARQL/query tests are the safety net |
| Item 8 (drop resident bodies) | Medium — snippet extraction now hits disk (latency) | Async snippet fetch; cache recently searched; snippets are only needed for the visible result page |
| Item 10 (off-main-thread graph) | High — serialization boundary + concurrency around the shared store | Do only if data demands it; the store is already per-project isolated (`states` Map), easing a move |
| Item 11 (ANN search) | Medium — approximate results change ranking | Keep brute force as the correctness oracle in tests |
| Deferring everything | Low today, High at 10× scale | Instrumentation (Phase 1) makes the cliff observable before users hit it |

The overarching risk is **over-optimizing before measuring**. Every Critical/High
finding here is latent at today's scale; the architecture review reached the
same conclusion ("Graph perf work only matters at scale; instrumentation first").
Phase 1 is explicitly instrument-first for this reason.

---

## Recommendations

1. **Do the four quick wins now** (items 1-4): the alias-rebuild hoist (H1), the
   search-persist debounce (H2), the palette-rebuild gate (M1), and dev-timing on
   `buildN3Store` (C1). All are low-risk, and three of them remove work from the
   two hottest paths (save, navigation).
2. **Commit benchmark baselines and add the cold-rebuild + full-index benches**
   (items 5, 7, 3-of-testing-plan) so the graph cliffs have numbers before any
   invasive change.
3. **Treat incremental N3 mirror maintenance (item 6) as the flagship
   optimization** — but gate it on Phase 1 data confirming the cliff, and protect
   it with full-vs-incremental equivalence tests (the drift risk is the one that
   could produce *wrong* query results, not just slow ones).
4. **Keep the good instincts that are already here:** off-thread embeddings,
   incremental hashed embedding index, cold `graph.ttl` snapshot, debounced
   Preview. Extend the same "cold snapshot / off-thread / incremental" posture to
   the search index (H2/H3) and the N3 mirror (C1).
5. **Defer the architectural items (10-12)** until telemetry proves the simpler
   fixes are insufficient. Do not move graph work off the main process or adopt
   ANN speculatively.

---

## Estimated Impact

- **Item 1 (alias O(N²) → O(N)):** turns full-index/rebuild from super-linear to
  linear — the difference between a multi-second freeze and a sub-second one at
  5,000 notes. *Not profiled — estimated from complexity.*
- **Item 2 (debounce search persist):** removes a multi-MB `JSON.stringify` +
  disk write from every save; save latency at large vaults drops from
  I/O-dominated to graph/search-index-only.
- **Item 6 (incremental N3 mirror):** eliminates the C1 full-rebuild entirely;
  save→query goes from O(all triples) to O(changed triples) — the single largest
  win for perceived responsiveness on the write-then-read path, growing more
  valuable with vault size.
- **Item 8 (drop resident bodies):** removes an O(vault-bytes) permanent
  main-process allocation (tens of MB for a large vault).
- **Items 3, 9 (palette gate, neighborhood memoize):** remove avoidable per-
  navigation work; smoother note switching, most noticeable with the graph/
  citations panels open.
- **Combined:** the quick wins (Phase 1) alone should make save and navigation
  feel flat up to a few thousand notes; item 6 (Phase 2) is what keeps SPARQL-
  backed panels responsive at 10× scale.

All impact figures are directional and complexity-based; commit the benchmark
baselines (item 5) to replace them with measured numbers.

---

## Effort Estimate

| Phase | Work | Effort | Risk |
|---|---|---|---|
| **Phase 1** | Alias hoist (1) · search-persist debounce (2) · palette gate (3) · `buildN3Store` dev timing (4) · commit bench baselines + cold-rebuild & full-index benches (5,7) | **1.5-2.5 days** | Low |
| **Phase 2** | Incremental N3 mirror + equivalence tests (6) · drop resident search bodies (8) · neighborhood/backlink memoization (9) | **3-5 days** | Medium (item 6 High, mitigated by tests) |
| **Phase 3** (only if data demands) | Off-main-thread graph (10) · ANN search (11) · worker/incremental Preview (12) | **1-3 weeks, scoped separately** | High |
| **Total (Phases 1-2)** | The recommended near-term program | **≈1 week** | Low-Medium |

Phases 1-2 are the recommended near-term investment and are dominated by the
graph read-path work the prior architecture review already surfaced. Phase 3 is
explicitly conditional on instrumentation.
