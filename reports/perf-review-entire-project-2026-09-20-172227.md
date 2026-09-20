# Performance Review Plan
Generated: 2026-09-20T17:22:27Z
Scope: entire project

## Executive Summary

Minerva has already been through one serious performance round. The July 2026 review (issues #1106–#1116) closed nine of eleven findings: `indexAllNotes` link resolution went O(N²)→O(N) (#1473), the N3/Comunica mirror became incremental instead of a full rebuild per write (#1110), the search-index persist was debounced off the save path (#1107), the conversation list was virtualized (#1112), and the neighborhood graph was memoized (#1113). A benchmark harness (`pnpm bench`) and a committed regression gate (`scripts/bench-check.mjs`, `tests/main/bench-baseline.json`) were built along the way. **This report is not "the app is slow."** The bulk indexing and warm query paths are genuinely good, and I measured them to confirm it: a warm SPARQL query is 0.41 ms, and `indexNote` into a 500-note store is 0.50 ms.

What this review found is that **the work moved off the save path has been quietly replaced by different work on the save path** — and that the gate built to notice such things is inert.

Four findings dominate, all verified and most measured:

1. **The post-save health-check burst is the single most expensive thing the app does.** Two seconds after every save, `runAllChecks` fires ~17 whole-graph SPARQL queries on the Electron main thread (`src/main/graph/health-checks.ts:98-123`). One of them — `checkStaleness` — carries an `ORDER BY ?modified` before its `LIMIT 100`, forcing Comunica to sort every stale note in the corpus. **Measured against this repo's own Comunica/N3: 190 ms at 300 notes, 371 ms at 1,000, 1,064 ms at 3,000** — roughly 30× the same query without the `ORDER BY`. Riding along in that same burst is `findOrphanedInlineAssets` (`src/main/notebase/asset-references.ts:105-129`, shipped in the most recent commit `6aae1323`), which walks and serially reads *every* text file in the project — deliberately including every retained `.minerva/history/**/*.snap`. All of it is on by default.

2. **`persistGraph()` has three independent problems, and one of them silently undoes #1110.** It strips and re-adds all ~905 ontology triples around the serialize (`src/main/graph/index.ts:157-163`). Each `removeMatches` bottoms out in rdflib's `RDFArrayRemove` — a linear scan of `store.statements` — so the strip alone is O(|ontology| × T) and measures **326 ms at 3,000 notes**, with the serialize adding another 262 ms. Worse, because the store mirrors every mutation into N3, those 1,810 mutations cross the `N3_PERIODIC_REBUILD_EVERY = 1000` threshold (`src/main/graph/state.ts:331`) and **null the mirror on every single call**. I measured the consequence directly: at 2,000 notes a warm query is 2.18 ms; the query right after a `persistGraph()` is 32.80 ms — **a 15.0× regression**, back to roughly pre-#1110 cost. Every proposal filed and every proposal approved pays all three.

3. **The 120 ms preview render tick fans out to full-library disk I/O.** `applyCslMarkers` (`src/renderer/lib/preview/citation-render.ts:55-57`) has no cache, and its handler re-reads and re-parses **every source `meta.ttl` and every excerpt** plus constructs a fresh citeproc engine — per tick, while typing. `hydrateTransclusions` (`src/renderer/lib/preview/hydrate.ts:232-237`) re-walks the entire project directory tree with a `stat` per file, also per tick. Both guards that should prevent this are defeated by the `{@html}` swap that replaces the DOM they mark.

4. **The regression gate that should have caught #2 is disarmed.** The three `cold rebuild` baselines were committed 2026-07-28 (`69b4f95c`), one day *before* the #1110 fix landed (`a1b80f26`). The re-bless never happened. I re-ran them: actual 2.98/5.97/13.26 ms against baselines of 20.05/60.82/147.69 ms. **The save→query path can regress 13–22× and still pass.**

Beyond those: the N3 mirror also resets every ~20 *ordinary* saves (a normal `indexNote` issues 30–60 mirrored `add`s against a 1,000 budget); `buildLinkResolveCtx` rebuilds the whole project's wiki-link index on every single-note save, and the committed bench understates it because the fixtures use `note-42.md`-style names with far fewer suffix slugs than real filenames; there is no execution timeout on Python cells, so a hung cell wedges its project's kernel permanently; and `node_modules` is fully watched because two of the three chokidar ignore patterns are dead strings under chokidar 5's exact-match semantics.

The honest one-line summary: **the algorithms are mostly fixed; the invalidation and scheduling discipline is not.** Nearly every top finding is a correct optimization defeated by something adjacent — the mirror nulled by ontology bookkeeping, hydration guards nulled by `{@html}`, caches nulled by the app's own autosave, the bench gate nulled by a stale baseline, and a steadily growing pile of work re-attached to the save path two seconds downstream of where it was removed.

---

## Performance Bottlenecks

### Critical Issues (Severe Impact)

#### C1 — The post-save health-check burst: ~17 whole-graph SPARQL queries + a 1-second `ORDER BY` + a full-corpus disk scan

**Verified end to end; the SPARQL costs are measured.**

**The trigger.** `indexNote`'s `finally` block unconditionally emits `graphChanged` (`src/main/graph/indexers/note.ts:286`) → `armAutoChecks` debounces 2,000 ms (`src/main/graph/health-checks.ts:761,775-785`) → `runAllChecks`. Autosave is 1 s after the last keystroke (`src/renderer/lib/stores/editor.svelte.ts:54`), so a typing pause reliably schedules a corpus-wide pass 3 s later. `startPeriodicChecks` repeats the whole thing every 5 minutes (`health-checks.ts:814-821`). Every check is on by default — `DEFAULT_INSPECTION_SETTINGS = { disabled: [], ... }` (`src/shared/inspections.ts:174`).

**Problem 1a — the `ORDER BY` cliff.** `src/main/graph/health-checks.ts:163-173`:

```sparql
    ORDER BY ?modified
    LIMIT ${STALE_NOTES_LIMIT}
```

The query is a 4-pattern join (`a minerva:Note`, `relativePath`, `dc:title`, `dc:modified`) plus a `FILTER`. SPARQL semantics force the sort *before* the limit, so Comunica materializes and sorts **every stale note in the thoughtbase** to return 100 rows.

Measured against this repo's own `n3` + `@comunica/query-sparql-rdfjs`, on a synthetic Minerva-shaped store with mixed mtimes (~90% past a 30-day cutoff):

| notes | with `ORDER BY` | without `ORDER BY` |
|---|---|---|
| 300 | **190 ms** | 54 ms |
| 1,000 | **371 ms** | 42 ms |
| 3,000 | **1,064 ms** | 36 ms |

The sort is ~30× the rest of the query at 3k notes and grows superlinearly. Two siblings have the identical shape: `health-checks.ts:386` (`checkLongUnresolvedStubs`, `ORDER BY ?modified`) and `health-checks.ts:422` (`checkCitedUnreadSources`, `GROUP BY` + `ORDER BY DESC(?cites)`) — smaller today because they are source-scoped, same cliff. So is `src/main/graph/note-properties.ts:137` (`ORDER BY LCASE(?title) ?path`).

**Fix:** drop the `ORDER BY` and sort the ≤100 returned rows in JS. One line per site, ~30× on the biggest cost.

**Problem 1b — ~17 queries, serialized on the main thread.** `runAllChecks` (`health-checks.ts:98-123`) runs 11 checks in `Promise.all`, but `checkDuplicateSources` issues 2 queries and `checkBrokenLinks` issues 4 (`health-checks.ts:544-556` prefetch ×3, `:568` the link walk) — ~17 Comunica round-trips per burst. `Promise.all` buys nothing here: this is one JS thread on the Electron **main** process, so they serialize and block IPC to every window.

Measured at 3,000 notes / 33k triples, three of the ~17:

- notes prefetch (`?n minerva:relativePath ?path . ?n a minerva:Note`) — 50 ms, 3,000 rows
- broken-link walk (`?source ?predicate ?target VALUES {12 IRIs}`) — 146 ms, 15,000 rows
- staleness — 1,064 ms

**1.26 s for 3 of 17.** Comunica's fixed per-query planning overhead alone measured 1.8–2.6 ms warm (14 ms cold). A realistic total at 3k notes is ~1.5 s of main-thread work, two seconds after you stop typing.

**Problem 1c — a full-corpus serial disk read rides along.** `health-checks.ts:122` puts `checkUnreferencedImages` in the same `Promise.all` → `health-checks.ts:200` → `src/main/notebase/asset-references.ts:111-129`:

```ts
await walk(rootPath, rootPath, files);               // :111  full recursive readdir
for (const rel of files) {
  if (remaining.size === 0) break;                   // :114  the only fast path
  const stat = await fs.stat(abs).catch(() => null); // :118  serial stat per file
  content = await fs.readFile(abs, 'utf-8');         // :122  serial full read per file
  for (const basename of [...remaining.keys()]) {    // :126  re-allocates the key array PER FILE
    if (content.includes(basename)) remaining.delete(basename);
  }
}
```

Three compounding issues:

- **The corpus deliberately includes history.** The module header (`asset-references.ts:19-25`) explains that `.minerva/history/**/*.snap` files are intentionally scanned so a retained revision counts as a reference. But history writes one **full file copy** per save (`src/main/history/store.ts:167`) up to `maxRevisionsPerNote: 500` — so the size of this scan is proportional to how much the user has typed. A 1,000-note base with 50 retained revisions each is ~50,000 files stat'd and read serially.
- **The fast path inverts.** `remaining.size === 0` only short-circuits when *every* asset is referenced. The moment one genuine orphan exists — the steady state after any image deletion, and precisely what the check hunts — the loop reads the entire corpus every time.
- **The skip list misses this codebase's own binaries.** `SKIPPED_EXTENSIONS` (`asset-references.ts:47-51`) has `.db` and `.sqlite` but not `.duckdb`, so `.minerva/vectors.duckdb` is read as UTF-8; remote-image cache entries are written with **no extension** (`src/main/images/remote-image-cache.ts:34-35`) so `path.extname()` returns `''` and they miss the skip set — and the cache cap (20 MB) sits just inside `MAX_SCAN_FILE_BYTES` (20 MB, `:56`). `.minerva/search-index.json` is read as text too.

**Fixes, cheapest first:** drop the `ORDER BY`s (1a); raise the debounce well above 2 s and/or move the burst to an idle callback; add `.duckdb`/extensionless/`.minerva/cache` to the skip set; take the orphan check off the save trigger entirely; then make it a single-pass O(F+A) scan — asset basenames have the distinctive `<sha-prefix>-<stem>.<ext>` shape, so one regex extract per file plus a `Set` lookup replaces the nested loop.

#### C2 — `persistGraph()`: quadratic ontology strip, full re-serialize, *and* a nulled N3 mirror (MEASURED: 15.0× query regression)

**Verified; all three costs measured.** `src/main/graph/index.ts:148-165`:

```ts
  for (const st of ontologyStatements) {
    store.removeMatches(st.subject, st.predicate, st.object);   // :158
  }
  const turtle = serializeGraph(ctx);                            // :160
  for (const st of ontologyStatements) {
    store.add(st.subject, st.predicate, st.object, st.graph);    // :162
  }
  await fs.writeFile(graphPath, turtle, 'utf-8');
```

**Cost 1 — the strip is O(|ontology| × T).** `ontologyStatements` is ~1,000 triples (`ontology-thought.ttl` alone parses to **905**, confirmed by parsing it with the project's own N3; `ontology.ttl` adds ~100 — `src/main/graph/indexers/rebuild.ts:65`). Each `removeMatches` bottoms out in rdflib's `RDFArrayRemove`, a **linear scan of `store.statements` with four `.equals()` per element plus an `Array.splice`** (`node_modules/rdflib/lib/utils-js.js:280-289`, called from `store.js:861`).

Measured with the real ontology file:

| notes | triples | ontology strip | `$rdf.serialize` | output |
|---|---|---|---|---|
| 500 | 15.9 k | **65 ms** | 57 ms | 0.35 MB |
| 1,000 | 30.9 k | **101 ms** | 94 ms | 0.70 MB |
| 3,000 | 90.9 k | **326 ms** | 262 ms | 2.17 MB |

Both are fully synchronous on the main thread — **~600 ms of hard block at 3,000 notes**; only the `fs.writeFile` is async.

**Cost 2 — the mirror is nulled on every call.** The store's `add`/`removeMatches` are wrapped by `instrumentStoreMirror` (`src/main/graph/state.ts:430-449`), which bumps a counter per mutation:

```ts
function bumpAndMaybeRebuild(): void {                    // state.ts:424
  if (!state.n3Cache) return;
  marker.__minervaN3Writes = (marker.__minervaN3Writes ?? 0) + 1;
  if (marker.__minervaN3Writes >= N3_PERIODIC_REBUILD_EVERY) resetN3Mirror(state);
}
```

with `N3_PERIODIC_REBUILD_EVERY = 1000` (`state.ts:331`) and `resetN3Mirror` setting `state.n3Cache = null` (`:354-357`). 905 `removeMatches` + 905 `add` = **1,810 mirror mutations in one call**, crossing the threshold every time. The mirror is nulled and the next SPARQL query pays a full cold `buildN3Store`.

I measured this directly (2,000-note synthetic store, this machine, 5 iterations each):

```
WARM query ms:        2.88, 2.07, 2.33, 1.81, 1.81  => avg 2.18
POST-PERSIST query:  34.62, 41.69, 29.45, 31.85, 26.39 => avg 32.80
SLOWDOWN FACTOR:     15.0x
```

The `resetN3Mirror` call is a deliberate self-heal against drift, and its justifying comment (`state.ts:327-330`, "the amortized cost of one O(n) rebuild per N writes is negligible next to N incremental deltas") is sound *for real user writes*. It did not anticipate a single bookkeeping call emitting 1,810 mutations that change nothing semantically.

**Where it runs.** Good news first, verified: `persistGraph` is **not** on the note-save path — `write-pipeline.ts:78-83` and `watch-handlers.ts:51-60` debounce only the *search* index, so the cold-snapshot posture (#348) holds. But every LLM interaction pays it, undebounced:

- `src/main/llm/proposal-persistence.ts:238` — after every proposal write **and** every approve
- `src/main/llm/propose-note.ts:55` — a **second, redundant** call; `proposeWrite` on line 49 already persisted
- `src/main/llm/conversation.ts:418` — every `fileAsSource`
- `src/main/project-context.ts:151` / `:199` — last window closes / app quit (a visible close stall)
- `src/main/ipc/register-graph.ts:132`

So **approving one draft card costs two full serializations, two quadratic strips, and two mirror nukes** (`src/main/ipc/register-conversation-drafts.ts:124-126` calls `proposeWrite` then `approveProposal`). `expireProposals` (`src/main/llm/approval.ts:152-173`) calls `updateProposalStatus` in a loop — **one of everything per expired proposal**.

**Fix shape:** replace the strip with "serialize, then filter" — or keep the ontology in a named graph the serializer skips — which kills the O(1000·T) loop *and* the mirror nuke in one change. Then debounce the LLM call sites and delete the redundant `propose-note.ts:55`.

#### C3 — The 120 ms preview render tick fans out to full-library disk I/O

**Verified.** `RENDER_DEBOUNCE_MS = 120` (`src/renderer/lib/components/Preview.svelte:329`, applied at `:362-367`), and the post-render `$effect` at `:470-536` tracks `rendered`. Three separate uncached fan-outs hang off it.

**3a — citations re-read the entire source and excerpt library, and rebuild citeproc, per tick.** `src/renderer/lib/preview/citation-render.ts:55-57` calls `api.citations.renderInline(refs)` with **no cache** — note the contrast with `resolveCiteQuoteLabels` immediately below it, which *does* use `deps.citeMetaCache` (`:101`). The handler (`src/main/ipc/register-bibliography.ts:124-126`) reaches `src/main/citations/render-inline.ts:54-60`:

```ts
const projectStyleId = getBibliographyStyleId(rootPath) ?? DEFAULT_STYLE;  // → readFileSync
const assets = await loadCitationAssets(rootPath, { styleId });            // → full library walk
const renderer = assets.createRenderer();                                  // → new citeproc engine
```

- `getBibliographyStyleId` → `src/main/project-config.ts:172` → `loadConfigFileSync` → **`readFileSync`** (`src/main/config/config-store.ts:94`) — a synchronous disk read inside an IPC handler on the typing path.
- `loadCitationAssets` (`src/main/publish/csl/index.ts:79-100`) does `readdir(.minerva/sources)` + `readFile(meta.ttl)` + TTL→CSL parse **per source**, then the same **per excerpt**. No memoization.
- `createRenderer` (`csl/index.ts:110`) builds a fresh citeproc-js engine, parsing the full CSL style + locale XML, every call.

A 1,000-source / 5,000-excerpt thoughtbase pays ~6,000 file reads + 6,000 TTL parses + a citeproc construction **every 120 ms of typing**. Gated only on the note containing a `[[cite::…]]`/`[[quote::…]]` link (`citation-render.ts:34-38`) — i.e. exactly the notes this app exists to write.

**3b — transclusions re-walk the whole project tree per tick.** `src/renderer/lib/preview/hydrate.ts:232,237`:

```ts
const tree = await api.notebase.listFiles();
...
aliasMap = await api.graph.aliasMap();
```

The intended guard is `:227` — `if (!root.querySelector('.transclusion[data-embed]:not([data-resolved])')) return;` — but `{@html rendered}` (`Preview.svelte:930`) replaces the DOM wholesale, wiping the `data-resolved` markers, so the guard passes every time. The handler (`src/main/ipc/register-notebase.ts:180-183` → `src/main/notebase/fs.ts:32-84`) recurses the whole project **and** issues an `fs.stat` per file (`fs.ts:64`), uncached. Then one **serial** `readFile` per embed at `hydrate.ts:286`.

**3c — diagram and chart hydration is fully redone per tick.** The same `{@html}` swap defeats every hydrator's idempotence guard: `mermaid-renderer.ts:122` (`'.mermaid-block:not([data-mermaid-rendered])'`), `vega-renderer.ts:236`, `object-view-renderer.ts:88`, `argument-map-renderer.ts:39`, `card-callout.ts:22`. So per tick, `mermaid.render()` re-runs dagre layout for every diagram; `vega-embed` re-runs for every chart **and** `resolveVegaData` (`vega-renderer.ts:287`) **re-executes the chart's backing SPARQL/SQL over IPC**; every `.object-view-block` remounts a full `TypeView` component. The comments on those functions describe an invariant the `{@html}` swap breaks.

Compounding all three, `Preview.svelte:463-467` clears `transclusionRenderCache` and `typePropsCache` on every `revision` bump — the app's own autosave, once per second of typing.

And two more uncached per-tick IPC calls: the `search` and `semantic` query-block branches (`src/renderer/lib/preview/query-blocks.ts:72`, `:88-95`) return before reaching `deps.queryCache`, so a semantic query block **re-embeds its query text every 120 ms** — the most expensive single operation in the app.

#### C4 — The benchmark regression gate is disarmed by a stale baseline

**Verified by git archaeology and by re-running the benches.**

| Benchmark | Committed baseline | Measured today | Ratio | Dead headroom under the 2× gate |
|---|---|---|---|---|
| cold rebuild @ 500 notes | 20.05 ms | **2.98 ms** ±12.8% | 0.149 | 13.5× |
| cold rebuild @ 2000 notes | 60.82 ms | **5.97 ms** ±9.2% | 0.098 | 20.4× |
| cold rebuild @ 5000 notes | 147.69 ms | **13.26 ms** ±13.9% | 0.090 | 22.3× |

Those three means were introduced in `69b4f95c` (2026-07-28). The #1110 incremental-mirror fix landed in `a1b80f26` (2026-07-29) — one day later. The follow-up `4cf4a1bf` re-blessed only the three `indexAllNotes` means (708→492, 178→144, 2787→1181) and left the cold-rebuild entries untouched. `tests/main/graph/n3-cold-rebuild.bench.ts:11-19` documents the situation explicitly and asks for a re-bless that never happened. The 5k entry additionally carries `"budgetMs": 600` — 45× the measured 13.26 ms.

This is what makes C2 dangerous rather than merely unfortunate: **a complete regression of the save→query path back to pre-#1110 behavior passes the gate silently.** C2 is, in effect, already that regression on the persist path, and the gate said nothing.

A second, subtler baseline problem (see H3): the `writeAndReindex` benches seed notes as `note-${i}.md`, whose stem slug has 2 dash-segments and therefore 1 suffix-index entry. Real vaults use multi-word, nested filenames generating 4–6× more entries, so **the committed save-path baseline understates the real per-save link-index cost.**

---

### High Priority Issues

#### H1 — The N3 mirror also resets every ~20 *ordinary* saves

Distinct from C2's single-call blowout, and verified. `bumpAndMaybeRebuild` counts **every** mirrored `add`/`removeMatches`, and a normal `indexNote` issues roughly 30–60 `add`s for one note (8 core + 2/tag + 1/link + frontmatter). Against the 1,000 budget, that means the mirror is nulled roughly **every 20 saves**, and the next query pays a full cold rebuild from `store.statements`.

Measured N3 cold build (term construction included, which `buildN3Store`'s `convertTerm` also pays):

| triples | build |
|---|---|
| 15 k | 53 ms |
| 30 k | 79 ms |
| 90 k | 223 ms |
| 180 k | 542 ms |

`ensureN3Cache` (`src/main/graph/state.ts:102-127`) yields every 8 ms so it doesn't hard-block — but this lands directly on top of C1's 17-query burst, so the burst that triggers the rebuild is also the burst that pays for it. And if a write lands during the yields, `state.ts:124` falls back to the **atomic, non-yielding** `buildN3Store` — the full 223 ms at 90k triples in one synchronous chunk. Since the health-check burst runs 2 s after a save and each check awaits, a watcher-driven write racing that window takes the non-yielding path.

**Fix shape:** count *semantic* mutations, not mirrored operations, and raise the budget; or drive the self-heal off a time interval rather than a write count.

#### H2 — rdflib removal is O(K·T); it is the dominant term inside `indexNote`

`src/main/graph/indexers/note.ts:321-323`:

```ts
  store.removeMatches(undefined, undefined, undefined, graph);
  store.removeMatches(subject, undefined, undefined);
```

The *match* is indexed (rdflib uses the why-index when the graph is bound, `node_modules/rdflib/lib/store.js:983-1010`). The *removal* is not: `removeMany` → `remove` → `removeStatement` → `rdfArrayRemove(this.statements, st)` — a linear scan + splice **per statement** (`store.js:837-864`), with four term `.equals()` per scanned element.

Measured (raw rdflib, 30 triples/note, worst-case position late in `statements[]`; the average real case is ~half):

| notes | triples | remove + re-add |
|---|---|---|
| 200 | 6 k | 1.6 ms |
| 1,000 | 30 k | 6.2 ms |
| 3,000 | 90 k | 18.9 ms |
| 6,000 | 180 k | 50.5 ms |

Same pattern at `indexers/excerpt.ts:38-39,61-62`, `indexers/source.ts:128-129`, `indexers/note.ts:457-459`, `indexers/tables.ts:268,301`. **Not slow today** at a few thousand notes (3–10 ms), but it is what makes C2's ontology strip quadratic, and it is a clear scale risk above ~5,000 notes.

#### H3 — `buildLinkResolveCtx` rebuilds the project-wide wiki-link index on every single-note save

`src/main/graph/indexers/note.ts:368`:

```ts
  const linkCtx = opts.linkCtx ?? buildLinkResolveCtx(state);
```

`src/main/graph/index-helpers.ts:63-67` materializes every indexed path into an array, does `Object.fromEntries(state.aliasMap)`, then `buildWikiLinkIndex` (`src/shared/wiki-link-resolver.ts:156-190`) runs a `.filter().sort()` over all N files and builds **seven Maps**, including a suffix-slug map with one entry per dash-segment of every stem.

#1473 correctly hoisted this out of `indexAllNotes` (`rebuild.ts:204`), but the incremental path still pays it in full — **unconditionally, even for a note with zero wiki-links.**

Measured (faithful reimplementation of `buildWikiLinkIndex`, paths shaped `folder-N/some note title N.md`):

| notes | per call |
|---|---|
| 500 | 1.3 ms |
| 1,000 | 2.5 ms |
| 3,000 | 8.0 ms |
| 5,000 | 14.2 ms |

And as noted in C4, the committed `writeAndReindex: … 5000-note vault` baseline of 4.27 ms is measured on `note-${i}.md` fixtures that understate this by 4–6×.

On the same path, `rebuildAliasMap` (`indexers/note.ts:73-96`, via `:255` whenever `skipAliasRebuild` is false — i.e. every incremental save) is a second full O(N) pass. #1106 fixed the O(N²) *bulk* case; the per-save O(N) remains.

**Fix shape:** cache the resolve context on `GraphState`, invalidated only when `indexedNotePaths`/`aliasMap` actually change.

#### H4 — Backlink queries scan every link edge in the project, per note switch — and the graph panel does it up to 200×

`src/main/graph/queries/links.ts:214-223`:

```ts
  for (const lt of LINK_TYPES) {
    if (lt.targetKind && lt.targetKind !== 'note') continue;
    typedPredIris.add(linkPredicate(lt).value);
    for (const st of store.statementsMatching(undefined, linkPredicate(lt), undefined)) {
```

Twelve note-targeted link types, and for each it pulls **every triple with that predicate project-wide** then string-compares the object — O(total wiki-links), not O(this note's backlinks). Each match then does two more `statementsMatching` inside `push` (`:200`, `:203`). Pass 2 (`:230`) is correctly object-indexed and cheap; pass 1 is the problem, and exists only to catch `#anchor` suffixes.

Same shape at `links.ts:160-170` (`findNotesLinkingTo`), `links.ts:311-325` (`findExternalInboundLinks`, safe-delete), and `src/main/graph/queries/references.ts:101-111`. That last one is on the **save** path: `detectHeadingRename` (`indexers/note.ts:430`) calls it whenever one heading slug disappears and another appears — i.e. every heading rename.

Callers: `src/main/ipc/register-links.ts:34-35,57-58,97,105-106` and `:127`. The worst is `neighborhood` (`src/main/graph/neighborhood.ts:135`), which calls `backlinks` **once per BFS node, up to `cap = 200`** — so an uncached depth-2 neighborhood is up to 200 × O(total links). The `neighborhoodCache` (`:166-176`) is cleared wholesale by `invalidate()` on **every** graph write (`state.ts:312`), so it is cold again after each save.

At 3,000 notes × 5 links = 15,000 statements per `backlinks()` call. **Slow today for the graph panel on a large thoughtbase**; fine for the backlinks panel alone.

This is also the multiplier behind folder rename: `src/main/notebase/rename.ts:188,285` loop `findNotesLinkingTo` once per descendant file, giving O(D × 12 × L) — moving a 300-note folder in a base with 30k links is ~108M index walks. Then `rename.ts:194-197,332-346` read **every indexable file in the project, serially**, even though the referring set is already known; `planRename`/`planFolderRename` (`:122-134`, `:197-210`) do the same full-project read **just to render the preview**.

#### H5 — Boot parses `graph.ttl` in full, then throws the store away

**Verified; parse cost measured.** `src/main/graph/index.ts:130-136` does a synchronous `$rdf.parse` of the whole persisted snapshot. Eleven lines later in the boot sequence, `src/main/project-context.ts:85` calls `indexAllNotes`, whose **first act** is `src/main/graph/indexers/rebuild.ts:174`:

```ts
  state.store = $rdf.graph();
```

Everything parsed is discarded except the proposal statements captured just before the swap (`rebuild.ts:166`/`:184`). Conversations re-derive (`project-context.ts:96`), CSV/table overlays re-derive (`:88`, `:91`), notes/sources/excerpts re-derive from disk.

Measured rdflib Turtle parse — synchronous, main thread, **before any window paints**:

| notes | graph.ttl | parse |
|---|---|---|
| 500 | 0.35 MB | **143 ms** |
| 1,000 | 0.70 MB | **281 ms** |
| 3,000 | 2.17 MB | **832 ms** |

Then boot does the full walk anyway: `walkAndCollectAliases` reads + `parseMarkdown`s every file (`rebuild.ts:237-265`), `walkAndIndex` reads + indexes every file again (`rebuild.ts:218-235`), and `search.indexAllNotes` reads every `.md` a **third** time (`src/main/search/index.ts:80-95`). Three independent walks, two full reads per markdown note — four if you count `registerAllNoteTables` (`src/main/sources/tables.ts:594-618`).

Two more per-note boot costs worth naming: `src/main/graph/index-helpers.ts:25` is a **synchronous** `statSync` per note per index pass (and again on every save) — 2,000 blocking syscalls at 2,000 notes, serialized into the event loop; and `parseMarkdown` parses the frontmatter YAML **twice** (`src/main/graph/parser.ts:73` calls `extractTitle`, which itself calls `extractFrontmatter` at `:115`; line `:76` then calls `extractFrontmatter` again), a third time in the alias pre-pass (`rebuild.ts:257`).

Also: `assertSafePath` calls `realpathSync(rootPath)` on **every** file IPC (`src/main/notebase/fs.ts:93`, via `:108`), across 24 call sites, several in loops. `rootPath` is invariant for a project's life — a one-line memo.

#### H6 — Every 1-second autosave rewrites all of a note's embedding vectors as SQL text literals

`AUTO_SAVE_DELAY = 1000` (`src/renderer/lib/stores/editor.svelte.ts:54`) → `src/main/notebase/write-pipeline.ts:77` → `vectors.indexNote`.

The *embedding* side is correctly incremental — content-hashed, so only changed chunks hit the model (`src/main/embeddings/vector-store.ts:148-152`). The *persistence* side is not (`:154-158`):

```ts
await state.connection.run('BEGIN TRANSACTION');
  await deleteRef(state, kind, ref);        // DELETE every row for this note
  await insertRows(state, kind, ref, rows); // re-INSERT every row, unchanged ones included
await state.connection.run('COMMIT');
```

And every vector is serialized as a SQL **text literal** (`vector-store.ts:335-337`):

```ts
function arrayLit(vec: Float32Array): string {
  return `[${Array.from(vec).join(',')}]::FLOAT[${MODEL.dim}]`;
}
```

384 floats → a boxed 384-element array → a ~4–7 KB string, which DuckDB then lexes back into floats. No prepared statements or appender API in the module.

Editing one word in a 60-chunk note, once per second, costs: 60 SHA-256 hashes, a SELECT pulling 60 × 384 floats back into JS (`:293`, ~23k boxed-number unboxings), one embed call for the changed chunk, a DELETE of 60 rows, an INSERT built as **~300 KB of SQL string**, and a transaction commit fsync. It is fire-and-forget (`void`) so it doesn't block the save, and a per-project lock serializes overlaps, but it is ~60× write amplification against a file-backed DB.

#### H7 — No execution timeout on Python cells; a hung cell wedges the project's kernel permanently

`src/main/compute/python-kernel.ts:436-440`:

```ts
return new Promise<CellResult>((resolve) => {
  state.pending.set(cellId, { resolve, stdout: [], stderr: [] });
  const req = JSON.stringify({ op: 'exec', cellId, notebookPath, code });
  state.proc.stdin.write(req + '\n');
});
```

No `setTimeout`, no `AbortSignal`, no rejection path. The only timeouts in the whole `compute/` tree are the 2 s SIGKILL grace in `terminate()` (`:521`) and the 3 s version probe (`python-settings.ts:115`); `registry.ts:53-68` adds none.

With `while True: pass`: the promise never settles; the kernel's `main()` loop is blocked inside `exec_cell` so it never returns to `sys.stdin.readline()` (`resources/python/minerva_kernel.py:477`), meaning **every subsequent cell in that project silently queues in the pipe buffer** — including cells in other notebooks, since the kernel is per-project. Worst on Run-All (`src/renderer/lib/compute/run-all-cells.ts:43-60`), which is strictly serial.

The SIGINT machinery already exists and works (`python-kernel.ts:470-482` + the `KeyboardInterrupt` handler at `minerva_kernel.py:439-449`) — it just has no automatic trigger. A near-identical latent shape exists in embeddings: `embedder-service.ts:74-77` pending entries have no timeout, and `indexChunks` awaits `embed()` **while holding the per-project lock** (`vector-store.ts:141-150`).

This is a reliability bug as much as a performance one.

#### H8 — LLM streaming: one IPC message per token, and an O(n²) markdown re-render

**Verified at every hop; no coalescing exists anywhere on the path.**

`src/main/llm/provider/anthropic.ts:187` (same at `openai.ts:196`, `google.ts:186`) → `src/main/llm/index.ts:417` → `src/main/ipc/register-conversation.ts:139-141` → `src/main/ipc/broadcast.ts:19` (`win.webContents.send`, raw) → `src/renderer/lib/stores/conversations.svelte.ts:282-286` (`t.streamedChunks += chunk` on a `$state` proxy).

Then the quadratic part, `src/renderer/lib/components/conversations/MessageList.svelte:191`:

```svelte
<div class="msg-content">{@html md.render(tab.streamedChunks)}</div>
```

Every chunk re-parses the **entire accumulated message** through markdown-it and replaces the whole subtree's `innerHTML` — quadratic in message length, with a full DOM teardown each time (which also destroys any text selection the user makes mid-stream). And on every chunk, `MessageList.svelte:74-78`'s effect calls `scrollToBottom` (`:57-70`), which schedules two nested `requestAnimationFrame`s each reading `scrollHeight` (forced layout) — a double forced reflow per token, made worse by the `content-visibility` virtualization the comment at `:61` describes.

`TOOL_STREAM` (`src/main/ipc/register-tools.ts:32`) is identical, though it renders into a `<pre>` so it skips the markdown cost.

Compounding: after each send, `conversations.svelte.ts:520` does `await api.conversations.load(tab.id)` — a full transcript re-read + structured clone — and replaces `tab.conversation` wholesale, so the unkeyed `{#each tab.conversation.messages as msg, i}` (`MessageList.svelte:176`) re-runs `{@html md.render(msg.content)}` (`:154`) for **every** message in the transcript. Changing the model in the picker (`:663`) does the same.

#### H9 — Find-in-Notes re-reads the entire corpus on a 200 ms debounce, uncapped and uncancelled

`src/renderer/lib/components/FindInNotesDialog.svelte:70` (inside `setTimeout(…, 200)` at `:80`, driven by an `$effect` at `:83-89`) → `src/main/ipc/register-notebase.ts:365-368` → `src/main/notebase/search-in-notes.ts:90-109`:

```ts
for await (const rel of walk(rootPath)) {
  content = await fs.readFile(path.join(rootPath, rel), 'utf-8');   // strictly serial
```

`walk` (`:66-83`) re-walks the tree each call. It does **not** use the MiniSearch index that `SEARCH_QUERY` already has (`register-queries.ts:61-62`). Every match carries the full `lineText` (`:119-124`) and there is no result limit. Nothing aborts the in-flight call, so typing a 10-char query means ~10 full-corpus reads, several concurrent, each returning an unbounded payload.

#### H10 — `rebuildMenu()` does synchronous disk I/O on window focus *and* on every selection flip

`src/main/menu.ts:800` → `src/main/saved-queries.ts:154-158` → `listDir` twice → `fs.readdirSync` (`:119`) + `fs.readFileSync` **per `.rq`/`.sql` file** (`:81`). Plus `menu.ts:180` `getRecentProjects()` → `loadConfigFileSync` → `readFileSync`.

Triggers:
- `src/main/window-manager.ts:155` — `win.on('focus', () => { menuRebuilder?.(); })`
- `src/main/menu.ts:66` — `setMenuEditorState` rebuilds when the focused window's `hasSelection` flips, pushed from `src/renderer/App.svelte:294`

So every ⌘-Tab back into the app **and every time the user selects or deselects text** blocks the main process on `readdirSync` + N× `readFileSync`. The renderer-side dedupe (`App.svelte:288-292`) correctly avoids per-keystroke sends, but select/deselect is a constant editing gesture.

The whole `saved-queries.ts`/`saved-views.ts` pair is synchronous; `QUERIES_LIST` and `VIEWS_LIST` reach the same code directly as IPC handlers, and `setQueryOrder` (`saved-queries.ts:285-298`) reads and rewrites every query file synchronously in a loop.

(For contrast, the adjacent `win.on('move'/'resize')` → `persistSession` **is** correctly debounced at 500 ms — `window-manager.ts:58-78`. I checked rather than assumed.)

#### H11 — `SOURCES_CHANGED` storm: one watcher event → 6–7 IPC calls and 6 full source-graph scans, undebounced

Broadcast **per source file** during a rescan (`src/main/notebase/watch-handlers.ts:214`, `:221`), so a bulk BibTeX/Zotero import fires N broadcasts. The renderer subscriber has **no debounce** — compare `src/renderer/lib/app/ipc-wiring.ts:211-214` against the tree refresh right below it at `:368-380`, which does.

Each event fans out to `SourcesPanel.svelte:187-190` (`listAll` + `refreshCounts` + a `queueMembers`), `App.svelte:382` (a **second** `listAll`), and `ReadingQueueSection.svelte:38-45`:

```ts
const entries = await Promise.all(
  QUEUE_VIEWS.map(async (v) => [v.id, (await api.sources.queueMembers(v.id)).length] as const),
);
```

Four more calls whose handler (`src/main/ipc/register-sources.ts:301-307`) runs `graph.listAllSources(ctx)` — a walk over every `minerva:sourceId` statement with `collectSourceMetadata` per source (`src/main/graph/queries/sources.ts:34-52`), uncached, recomputed 6× per event — and which **transfer full `SourceMetadata[]` payloads just to read `.length`**. `EXCERPTS_CHANGED` (`watch-handlers.ts:230`) has the same per-file shape.

#### H12 — Startup: blank window, gated on skills, behind an 8.9 MB eager require

Three separate boot problems, ranked by visibility.

**12a — the window paints blank.** `src/main/window-manager.ts:81-100` constructs `new BrowserWindow({...})` with no `show: false`, no `backgroundColor`, and no `ready-to-show` handler. (The only `show: false` in the main tree is the PDF-export window, `src/main/publish/exporters/note-pdf/electron-render.ts:31`.) The window is mapped at `:81`, then `loadFile()` at `:129` starts fetching the **3.25 MB** entry chunk + **344 KB** CSS (measured). The user sees an empty default-colored window for the entire renderer parse+mount. Cheapest high-visibility fix in this report.

**12b — `await registerSkillsAtStartup()` gates `createWindow`.** `src/main/main.ts:91` awaits before `createWindow()` at `:101`. `src/main/skills/loader.ts:29-33` uses `import.meta.glob(…, { eager: true })`, inlining all 56 stock skills (**317 KB** of markdown, measured) into `main.js` as string literals, parsed by V8 at module load and resident forever; `loadStock()` (`:39-48`) then runs `parseSkill` + `validateTemplate` over every full body at boot, and `loadUser()` (`:88`) does a **serial** `readdir` + `readFile` per user skill. The justifying comment says this must precede menu building — but the menu builds at `main.ts:102`, *after* `createWindow()` at `:101`.

**12c — `main.js` is one 8.9 MB eager require.** Measured: 9,310,519 B. Eager from `main.ts` module scope: `rdflib`/`@comunica`/`n3` (`graph/state.ts:13-15`), **`@duckdb/node-api`** (a native `.node` binding — `embeddings/vector-store.ts:21`, `sources/tables.ts:6`, pulled in purely because `main.ts:15` imports `project-context` for a `before-quit` handler, so boot pays a `dlopen` even for users who never open a table), all three LLM SDKs (`llm/provider/{anthropic,openai,google}.ts:12/20/21`), `citeproc`, `jszip`, `isomorphic-git`, `linkedom`, `unpdf`, `chokidar`. `src/main/ipc.ts:1-25` statically imports all 25 `register-*` modules; the registration calls are cheap, the import graph is not — handler *bodies* could `await import()` on first invocation.

Also on the pre-window path: `src/main/main.ts:46` → `src/main/compute/rpc-server.ts:299-303` does `readdirSync(os.tmpdir())` plus an `unlinkSync` per stale match. The comment calls it "cheap (one tmpdir listing)"; on a long-uptime macOS box `/var/folders/…/T` routinely holds thousands of entries.

**Already correctly lazy (keep):** `onnxruntime-web`, `sql.js`, `@aws-sdk/client-s3`, `vega`/`vega-lite`, pdfjs, and on the renderer side vega-embed (939,732 B), mermaid, cytoscape (434,930 B), maplibre-gl (1.06 MB), tesseract/OCR (447,239 B), whisper worker (517,314 B), KaTeX (258,693 B) — all measured as separate chunks.

---

### Medium Priority Issues

#### M1 — Two of three chokidar ignore patterns are dead; `node_modules` is fully watched

**Verified against chokidar's source.** `src/main/notebase/watcher.ts:79-90`:

```ts
ignored: [ /(^|[/\\])\./, '**/node_modules/**', '**/.minerva/**' ],
```

chokidar 5.0.0 dropped glob support. `node_modules/chokidar/index.js:24`: `if (typeof matcher === 'string') return (string) => matcher === string;` — **exact string equality**. The literal `'**/node_modules/**'` never equals a real path. `.minerva` is still caught by the dot-regex, so that entry is merely redundant — but **`node_modules` is not dot-prefixed and is therefore fully, recursively watched**, despite `ignored-dirs.ts:32` excluding it from every listing walk. A thoughtbase that also holds code gets tens of thousands of fsevents watches.

Related: the dot-regex is tested against the normalized **absolute** path (`chokidar/index.js:26,57-58`), so a thoughtbase under any dot-segment ancestor (`~/Dropbox/.private/notes`) would have every event silently suppressed. *(Inferred from matcher semantics; not constructed.)* And neither watcher sets `awaitWriteFinish` (`:79-90`, `:273-277`), so a large external write can fire `change` mid-write and `watch-handlers.ts:153` indexes a truncated file.

#### M2 — `TYPES_LIST` re-parses the whole type catalog on every call

`src/main/ipc/register-types.ts:19-25`, and the module header at `:5` says so outright: *"Loads fresh per call."* `src/main/types/loader.ts:90-92` → `loadStock()` re-parses every bundled type (`:50-59`) **and** `loadUser()` does `readdir` + `readFile` + `parseType` per user type file (`:61-83`). Meanwhile `GraphState` already holds a `typeCatalog` this handler bypasses. Callers: `object-types.svelte.ts:25`, `ObjectsPanel.svelte:83`, `NewNoteDialog.svelte:69`, `note-ops.ts:221`, `build-keymap-and-completion.ts:103`.

#### M3 — `readProjectConfig` is an uncached `readFileSync` with 38 call sites

`src/main/project-config.ts:126-133` → `loadConfigFileSync` → `readFileSync` (`src/main/config/config-store.ts:94`). The header at `config-store.ts:87-88` names it *"for the hot read paths that can't await"* — but there is no memo. Reached from `getBibliographyStyleId` (which puts it on C3's typing path), `resolveDisplayName`, `getExcerptNoteFolder` (`register-sources.ts:236-237`), `NOTEBASE_GET_PROPERTIES` (`register-notebase.ts:400`). A single `{mtimeMs, value}` memo removes all of it.

#### M4 — `listTables` is 2N sequential queries, N of which are full CSV re-parses

CSVs are registered as lazy DuckDB **views** (`src/main/sources/tables.ts:297-299`), and the code is candid that "the view is lazy — DuckDB re-reads the file on every query" (`:244-246`). That is a defensible correctness tradeoff — until `tableShape` (`:626-637`) issues a `SELECT COUNT(*)` per table inside a sequential loop (`:645-661`). Every `COUNT(*)` on a CSV view triggers a full file re-parse: 40 CSVs averaging 20 MB → one Tables-panel refresh re-reads and re-sniffs 800 MB, strictly serially. Fires on `TABLES_LIST` (`register-graph.ts:54-55`), the `describe_tables` LLM tool, and every `TABLES_CHANGED` broadcast.

#### M5 — `SELECT *` with no LIMIT, fully materialized on the main thread

`src/renderer/lib/components/right-sidebar/TablesPanel.svelte:54` (also `:68`, `:69`, `:92`) emits `SELECT * FROM ${name}`. That lands in `runQuery` (`tables.ts:131-133`) → `reader.getRowObjectsJS()`, a synchronous full materialization into plain JS objects on the main process thread, then structured-cloned to the renderer which holds a second copy. Note the asymmetry: the QueryPanel placeholder teaches `LIMIT 10` (`QueryPanel.svelte:148`) while the Tables panel button hands the user a `LIMIT`-less query.

Related correctness footgun: `coerceDuckBigInt` (`src/main/compute/duck-values.ts:25-27`) is applied on the SQL-fence path (`executors/sql.ts:38`) and the Python RPC path (`rpc-server.ts:176`) but **not** on `TABLES_QUERY` (`register-graph.ts:51-52`), so raw BigInts reach the renderer and any consumer that `JSON.stringify`s them throws.

#### M6 — History: full file copy plus a pretty-printed index rewrite per save

Per save of one note (`src/main/history/store.ts:135-176`, from `notebase/fs.ts:187`): `mkdir`, `readFile(index.json)` + `JSON.parse`, a sha256, `writeFile(<ts>.snap, content)` — **a full copy of the note** — parallel `rm` of expired revisions, and `writeFile(index.json, JSON.stringify(sorted, null, 2))` — a **full, pretty-printed rewrite** (`:82-85`).

Snapshots are whole copies, not deltas — acknowledged at `src/main/history/settings.ts:20-22`. With `maxRevisionsPerNote: 500`, a 20 KB note edited 500 times costs 10 MB on disk, and every byte is re-read by C1c. At 500 revisions the pretty-printed `index.json` is ~70 KB read + parsed + re-stringified + written **per autosave**.

Total awaited before the write IPC resolves: 3 writes, 1 read, 2 stats (2 of them **sync**), 2 mkdirs. What's already right: `isNewContent` (`:113-125`) uses the stored hash and doesn't re-read the previous snapshot (#1836); `getHistorySettings` is memory-cached.

#### M7 — 3.25 MB eager renderer chunk; no `manualChunks`, no bundle budget

**Measured.** Entry chunk = 3,249,217 B; entry CSS = 343,578 B; eager critical path ≈ 3.93 MB across 217 chunks totalling 43 MB.

Driven by `App.svelte`: 2,096 lines with **100 top-level static imports**, including every modal dialog (`App.svelte:44-80` — `ExportDialog`, `PublishDialog`, `SettingsDialog`, `TypeEditorDialog`, `MultiFileHistoryDialog`, `OnboardingDialog`, `CommandPaletteDialog`, …), most never opened in a session. Probing the built chunk found **831 `contains:[` and 109 `aliases:[` occurrences** — the signature of a large highlight.js grammar set sitting in the eager bundle. CodeMirror is also eager (`src/renderer/lib/editor/build-extensions.ts:5-7`), which is defensible since the editor *is* the app.

`vite.renderer.config.mts` has **no `build` block at all** — no `manualChunks`, no `chunkSizeWarningLimit`; grepping all four `vite.*.mts` plus `forge.config.ts` returns nothing. `tests/architecture/file-size-budgets.test.ts` ratchets **source LOC**, not bundle bytes, so nothing guards the entry chunk from growing.

#### M8 — Chatty renderer loops: bulk refactor, tag context, tag panel, typed cards

All verified; all serial `await` in a `for` loop over a collection that can be large.

- **Bulk refactor ops — 2 round-trips per file, each write a full reindex.** `src/renderer/lib/app/refactor-ops.svelte.ts:361-371` (Add Tag), `:403+` (Remove Tag), `:604-615` (Add Property), `:637+` (Remove Property), `:724-728` (Format) all do `readFile` then `writeFile` per target. Each `writeFile` hits `writeAndReindex` (`write-pipeline.ts:63-90`) — graph reindex + search reindex + broadcast. A 500-note selection = 1,000 sequential round-trips and 500 reindexes. `HISTORY_LABEL_NOTES` (`register-history.ts:51-63`) is the existing precedent for a batch channel. Same shape for deletes at `src/renderer/lib/app/note-ops.ts:322-331`.
- **Tag context — 2N+1 round-trips, then every tagged note's full body.** `src/renderer/lib/tools/context.ts:117-140` loops `await api.tags.notesByTag(t.tag)` over **every tag in the project** to answer "which tags does this note have?", then **refetches the same tags again**, then reads the full content of every match. With 200 tags that is 200 sequential round-trips. *Currently dormant*: no stock skill declares `taggedNotes`. Same shape in-process at `src/cli/eval-context.ts:228-236`.
- **Tag panel — one IPC per matching tag.** `right-sidebar/TagsPanel.svelte:183-190`. The comment at `:176-179` names the fix (`tags.sourcesByTagPrefix`) which doesn't exist — `register-tags.ts` has the notes equivalent but not the sources one.
- **Typed cards — serial `noteProperties` per block-level link.** `src/renderer/lib/preview/typed-link-render.ts:83-94`, not `Promise.all`; `typePropsCache` helps but is cleared on every `revision` bump. The `quoteLinks` loop at `:95-104` is the same, each a separate `api.graph.query`.

#### M9 — Editor hot paths: full-document work per keystroke

- **The compute-cells gutter materializes the whole doc once per visible line.** `src/renderer/lib/editor/compute-cells.ts:197-223` calls `view.state.doc.toString()` + `findRunnableFences(doc, allowed)` **inside `lineMarker`**. CodeMirror calls `lineMarker` for every viewport line block on every gutter sync, and `updateGutters` syncs on `docChanged || heightChanged || viewportChanged` (`node_modules/@codemirror/view/dist/index.cjs:11439`, `:11528`). ~60–150 full-document flattens + fence scans per keystroke; measured 0.14 ms per scan on a 3,000-line doc → ~14 ms/keystroke at 100 viewport lines. No `lineMarkerChange` limits the resync. Registered for every markdown editor (`build-extensions.ts:122`). The same scan runs a third time in the App template — `App.svelte:1166-1167`'s `{@const hasRunnableFences = findRunnableFences(note.content, …)}` over `$state` content, per keystroke, to decide one toolbar button.
- **Word count re-splits the document on every keystroke *and* every cursor move.** `src/renderer/lib/editor/build-keymap-and-completion.ts:71-90` does two full `doc.toString()` flattens plus two `.trim()` copies and a whitespace split allocating one string per word. Measured 0.94 ms per call on a 3,000-line doc, firing on **every arrow key press** where the count cannot have changed. A third flatten per keystroke sits at `Editor.svelte:655-662`, comparing `content !== view.state.doc.toString()` purely to detect *external* disk reloads.
- **`footnoteDecorations` is the one decoration plugin that scans the whole document.** `src/renderer/lib/editor/footnote-decorations.ts:33-34,111-115` does `state.doc.toString()` + a full `scanFootnotes` on every `docChanged`, and never maps the existing `DecorationSet` through the transaction. Every sibling scans only `view.visibleRanges` — `link-decorations.ts:149-154`, `highlight-decorations.ts:25-29`, `broken-link-decorations.ts:101-104`. Copy one of those.
- **`tagCompletion` has no cache and no `validFor`.** `Editor.svelte:473` — `const tags = await api.tags.allNames();`. CodeMirror re-invokes a source without `validFor` on each keystroke, so typing `#pro` is 4 IPC calls. Both sibling sources cache (`link-autocomplete.ts:189`, `type-create-autocomplete.ts:38`). One-line fix.

#### M10 — Preview wiki-link resolution is O(links × notes); the O(1) index exists and is unused

`src/shared/wiki-link-resolver.ts:67-72` — `resolveWikiLinkTarget` calls `orderedNoteFiles(files)` (`:50-54`), which **filters and sorts the whole note list on every call**, followed by up to six linear scans (`:78-133`). `src/renderer/lib/preview/broken-links.ts:16-22` calls it **once per `.wiki-link` in the document**; `typed-link-render.ts:87` again for typed cards. `Preview.svelte:413-424`'s `typedCardDeps()` rebuilds its inputs from scratch and is invoked **twice** in the same effect (`:492`, `:514`), with `argumentMapDeps()` a third time (`:531`).

Measured at N=2,000 notes: ~2.2 ms per *unresolved* link. A note with 50 broken links costs ~110 ms per preview render, every 120 ms while typing.

**The O(1) replacement already exists and is already used by the editor**: `buildWikiLinkIndex` / `resolveWikiLinkTargetWithIndex` (`wiki-link-resolver.ts:160-211`, whose own docstring calls out exactly this O(N²)), consumed by `src/renderer/lib/editor/broken-link-decorations.ts:81-85`. The preview never adopted it.

#### M11 — Conversation transcript: 3–4 full load+persist cycles per turn, pretty-printed

`src/main/llm/conversation.ts:122,146-147` — `appendMessage` does a full `readFile` + `JSON.parse`, pushes, then `persist` (`:330`) does `JSON.stringify(conv, null, 2)` — **pretty-printed** — and a full `writeFile`. Per turn `runConversationTurn` does this three times (`register-conversation.ts:287`, `:329`, `:341-347` — the last comment admits "We write unconditionally — even if the id is unchanged"). The renderer adds a fourth full read (`conversations.svelte.ts:520-521`).

`listAll` (`conversation.ts:277-286`) reads and parses **every** conversation file in full, bodies included, with no cache. `CONVERSATION_LIST_ACTIVE` (`:294-297`) reads all conversations *including archived*, then filters.

Also: `persist` uses plain `fs.writeFile` while the sibling UI-state write uses `writeJsonFileAtomic` (`:322`) — a crash mid-write truncates a transcript. Correctness, not perf, but adjacent.

#### M12 — `QueryPanel` results: `$derived` of a *function*, unkeyed and unbounded `{#each}`

`src/renderer/lib/components/QueryPanel.svelte:353-363` declares `let sortedResults = $derived(() => {...})` — memoizing **the closure**, not the sorted array — and `:465` consumes it as `{#each sortedResults() as row}`, so the copy + `localeCompare` sort re-runs on every template invalidation. Should be `$derived.by`.

`:465` and `:467` are both unkeyed and uncapped: a query returning 10k rows × 6 columns materializes 60k `<td>` nodes. Every other large list in this codebase caps (`GotoNoteDialog.svelte:185` `.slice(0,60)`, `ComputeDraftCard.svelte:179` `.slice(0,50)`, `ExportDialog.svelte:335` `.slice(0,40)`); this is the exception. Same anti-pattern, smaller N: `right-sidebar/LinkListPanel.svelte:164`, `InspectionsPanel.svelte:165`.

#### M13 — KaTeX renders every formula from scratch on every preview render

`src/shared/markdown/math-plugin.ts:42-51` — `renderTex` calls `katex.renderToString` with no memoization, and `md.render()` is on the 120 ms debounced path (`Preview.svelte:303`). This is the one remaining synchronous heavyweight *inside* `md.render`; highlight.js was already correctly deferred out of it (the deliberate comment at `markdown-config.ts:40-48` and the `requestIdleCallback` pass at `hydrate.ts:84-97`). A `Map<`${displayMode}\0${tex}`, string>` is ~10 lines.

#### M14 — Publish paths: serial S3 PUTs and per-file `git.add`

- `src/main/publish/publish-to-s3.ts:164-171` — one sequential `await client.send(new PutObjectCommand(…))` per object, with `Body: fs.readFileSync(absPath)` (sync, blocking main) inside the loop. Publishing a 500-object static site over a 100 ms RTT link is ~50 s of pure serialization. (The orphan deletes just below, `:173-178`, are correctly batched at the 1000-key API limit.)
- `src/main/git/publish-git.ts:204-210` — `stageAll` calls `git.statusMatrix` (which hashes every file in the working tree in pure JS) then `await git.add(...)` **per file**; each `add` re-reads, re-hashes, and rewrites the entire index, making the loop quadratic in index writes. A publish flow calls `statusMatrix` twice (`pendingChanges` at `:192`, `stageAll` at `:205`). Same at `src/main/git/index.ts:49-54`. Recent isomorphic-git accepts `filepath: string[]`.

#### M15 — Embeddings: serial backfill with padding waste, and a cross-joining related query

- `src/main/embeddings/backfill.ts:106-118` awaits one worker round-trip per note/source/excerpt, many with a batch size of 1–3, and `seq = Math.max(...rows.map(r => r.length))` (`wasm-embedder.ts:53`) pads the batch to its longest member — a note with one 256-token chunk and fifteen 20-token chunks runs 16×256 instead of ~16×35, ~7× wasted compute. `item.load()` (disk) and `indexChunks` (embed + DB) strictly alternate with no pipelining. Also `ort.env.wasm.numThreads`/`simdEnabled` are never set (`wasm-embedder.ts:31-33` configures only `wasmPaths`).
- `src/main/embeddings/vector-store.ts:247-255` — `relatedToRef` computes `|corpus chunks| × |query note's chunks|` distances (a 30-chunk note against a 50k-chunk corpus = 1.5M 384-dim dot products per Related-panel open), and `GROUP BY … t.chunk_text` hashes the **entire chunk body** (up to 1000 chars) as part of the key. `chunk_text` is functionally determined by `(kind, ref_id, chunk_index)`.

#### M16 — Kernel stdout is fully buffered, then emitted as one unbounded JSON line

`resources/python/minerva_kernel.py:401,460-463` — `out = io.StringIO()` … `emit({'type': 'stdout', 'payload': out.getvalue()})`. Two consequences: **no streaming** (despite `python-kernel.ts:13-15` claiming "the kernel already streams events at the protocol level" — a cell printing progress for 60 s shows nothing until it finishes), and four in-memory copies of the full output (Python `StringIO` → `json.dumps` single line → Node `readline` with no `maxLength` at `python-kernel.ts:190` → `JSON.parse`). A Python cell can OOM the main process.

#### M17 — Dead IPC broadcast on every file change

`src/main/notebase/watcher.ts:183` broadcasts `NOTEBASE_FILE_CHANGED` unconditionally — including the app's own writes, since `wasHandled` gates only the index callbacks (`watch-handlers.ts:159-161`), not the broadcast, and the send sits *before* the `isWatchable` gate. Nothing subscribes: `onFileChanged` appears only as a type declaration (`src/renderer/lib/ipc/client.ts:60`) and preload wiring (`src/preload/preload.ts:70`). Verified by grep — zero call sites.

#### M18 — Triple-copy on renderer→main writes

Draft-approval payloads go through `plainSnapshot` — a full `JSON.parse(JSON.stringify(...))` at `src/renderer/lib/ipc/plain-snapshot.ts:12` — then hit `deproxy` in the preload, which deep-rebuilds every plain object and `map`s every array (`src/preload/typed-invoke.ts:28-39,47`), then Electron structured-clones. Three full copies. `deproxy` runs on **all** invoke args, so `HISTORY_LIST_UNIFIED`/`HISTORY_BATCH_REVERT` (`register-history.ts:69,78`) reallocate their whole `livePaths: string[]` at the boundary too. (The return-side validators are correctly shallow — `src/shared/ipc-validators.ts:46-49` — negligible, no action needed.)

#### M19 — Biggest payload channels

All verified by reading the handler:

| Channel | Payload | Fires |
|---|---|---|
| `NOTEBASE_SEARCH_IN_NOTES` | every match in every file, full line text, uncapped | per 200 ms of typing in Find-in-Notes |
| `NOTEBASE_LIST_FILES` | whole recursive tree + mtime per file | per preview tick w/ transclusions; per watcher burst |
| `SOURCES_LIST_ALL` | all `SourceMetadata` | 2× per `SOURCES_CHANGED` |
| `SOURCES_QUEUE_MEMBERS` | full `SourceMetadata[]` **discarded except `.length`** | 4× per `SOURCES_CHANGED` |
| `SOURCES_READ_PDF` | entire PDF as bytes (`register-sources.ts:214-216`) | PDF tab open / OCR |
| `CONVERSATION_LIST_ACTIVE` | all conversations incl. archived, then filtered | project open |
| `NOTEBASE_READ_BINARY` | image bytes, base64'd in-renderer at 1.33× (`hydrate.ts:123-132`) | per uncached image |

#### M20 — Smaller verified items

- **Static-site backlink dedupe is quadratic in inbound degree** — `src/main/publish/exporters/static-site/site-data.ts:46` does `!list.some(b => b.relativePath === …)` inside a nested loop; a hub note with 2,000 inbound links → ~2M comparisons per publish.
- **`schemaForCompletion` walks every triple and claims it is cheap** — `src/main/graph/queries/sparql.ts:64-69`, docstring at `:52` says "Safe to call often." Only caller is `QueryPanel.svelte:107` on panel open, so it's fine today — but the docstring invites a hotter caller. Adjacent: `injectSparqlPrefixes` (`:26`) compiles `new RegExp` per standard prefix on **every** query.
- **Undebounced full-content re-parses in sidebar panels** — `BreadcrumbsBar.svelte:65-72` calls `extractHeadings(content)` with no debounce despite its own docstring claiming 60 ms, and it is mounted for every note tab (`App.svelte:1153-1160`). Same shape, lower exposure: `OutlinePanel.svelte:15`, `HeadingGraphPanel.svelte:27-28`, `FootnotesPanel.svelte:14`, `TablesPanel.svelte:49`, `PropertiesPanel.svelte:98`. `CitationsPanel.svelte:40-63` **does** debounce and is the model to copy.
- **`queryCache` is never invalidated** — `Preview.svelte:206` is created per component and never cleared, not even on `revision`. Stale-SPARQL correctness smell more than perf.
- **Regex compiled per line** — `src/shared/formatter/parse-cache.ts:94` builds `new RegExp` inside the fence-close scan; the pattern depends only on loop-invariant `fenceChar`/`fenceLen`, and an *unterminated* fence scans to EOF compiling one per line.
- **Markdown tables round-trip through a temp file** — `src/main/sources/tables.ts:412-422` serializes → writes an `os.tmpdir()` CSV → DuckDB sniffs → `fs.rm`; `reregisterNoteTables` (`:504-527`) drops and recreates *all* of a note's tables on every external edit.
- **Serial delete passes** — `src/main/notebase/fs.ts:249,251` makes two full serial passes over a deleted folder's notes; a 200-note folder is ~1,200 serial fs ops. The comment says sequential is deliberate, but the ordering constraint only requires all `onNoteDeleting` before the `rm`, not serialization *within* the pass.
- **Search index full stringify every 3 s** — `src/main/search/minisearch-provider.ts:120-121`, O(corpus bytes), no incremental persist. There are **two** independent persist debouncers racing the same file (1 s from `watch-handlers.ts:59`, 3 s from `search/index.ts:27`).
- **Goto/palette recomputes the corpus per keystroke** — `GotoNoteDialog.svelte:139-193` runs `$derived.by` over all notes + sources + queries with ~4 allocations per item (`camelCaseMatch` rebuilds a capitals array per note, per keystroke) plus an O(N log N) sort, with no incremental narrowing.
- **`FileTree` recursive `{#each}` is unkeyed** (`FileTree.svelte:203`); **`Sidebar` recomputes the visible tree four times** (`Sidebar.svelte:296,329,352,370`, with `:296` building the whole array just to read `.length`) and `findNode` (`:284-293`) is a full recursive walk per arrow-key press.
- **`buildTagTree` is O(T²) on a flat namespace** — `src/renderer/lib/tags.ts:52`. Safe today because its only caller passes `tagsForActiveNote`; a landmine if that becomes `allTags`.
- **Consent check is sync-read + linear scan per cell run** — `src/main/compute/consent.ts:75-81` uses `loadConfigFileSync` (no cache), and `entry.cells?.includes(hash)` (`:78`) grows with every cell ever approved.
- **`runAllCellsInContent` re-scans the doc per cell** — `src/renderer/lib/compute/run-all-cells.ts:42-44` calls `findRunnableFences` at `:42` and discards the result.
- **`COMPUTE_REVEAL_AUDIT_LOG` does sync FS in a handler** — `src/main/ipc/register-compute.ts:94-95` (`mkdirSync` + `existsSync` + `writeFileSync`). Low impact — explicit menu action — but it's the only literal sync-FS-in-a-handler besides the config reads.
- **`describeSkillCatalog()` inlines ~56 skill descriptions** (~4 KB ≈ 1.1k tokens) into `run_skill`'s description on every request (`src/main/llm/tools/run-skill.ts:72-84`). Lands in the cached prefix, so mostly a first-request cost, but permanent context real estate.

---

## Performance Metrics

### Current State

**This project does have a benchmark harness** — contrary to the premise of a greenfield perf review. `pnpm bench` (`vitest.bench.config.ts`) runs six bench files; `scripts/bench-check.mjs` diffs them against `tests/main/bench-baseline.json` with a ratio gate plus optional absolute `budgetMs` ceilings, driven by a scheduled (not per-PR) `Bench` workflow. The numbers below are real.

**Measured on this machine (Darwin arm64), 2026-09-20:**

| Measurement | Value | Method |
|---|---|---|
| `queryGraph` simple SELECT, warm mirror, 500 notes | **0.41 ms** ±2.0% (p99 1.63) | `pnpm bench` |
| `queryGraph` tag filter, warm mirror, 500 notes | **0.76 ms** ±1.5% (p99 1.84) | `pnpm bench` |
| save → query (incremental mirror), 500 / 2000 / 5000 notes | **2.98 / 5.97 / 13.26 ms** | `pnpm bench` |
| **query after `persistGraph()`, 2,000 notes** | **32.80 ms** (vs 2.18 ms warm) | **direct probe, 5 iterations** |
| **C2 regression factor** | **15.0×** | measured |
| Ontology triples (drives C2) | **905** → 1,810 mirror mutations/persist | parsed with project's N3 |
| `N3_PERIODIC_REBUILD_EVERY` | 1,000 | `graph/state.ts:331` |

**Measured against this repo's `rdflib` / `n3` / `@comunica`, on synthetic Minerva-shaped stores** (representative of structure, not of any real user's data):

| Operation | 500 notes | 1,000 | 3,000 |
|---|---|---|---|
| `checkStaleness` **with** `ORDER BY` | — | 371 ms | **1,064 ms** |
| `checkStaleness` **without** `ORDER BY` | — | 42 ms | 36 ms |
| broken-link walk (15k rows @ 3k) | — | — | 146 ms |
| notes prefetch (3k rows @ 3k) | — | — | 50 ms |
| `persistGraph` ontology strip | 65 ms | 101 ms | **326 ms** |
| `$rdf.serialize` (whole store) | 57 ms | 94 ms | 262 ms |
| `graph.ttl` parse at boot | 143 ms | 281 ms | **832 ms** |
| `buildLinkResolveCtx` (per save) | 1.3 ms | 2.5 ms | 8.0 ms (14.2 ms @ 5k) |
| N3 cold mirror build | 53 ms @ 15k triples | 79 ms @ 30k | 223 ms @ 90k (542 ms @ 180k) |
| rdflib note remove + re-add | 1.6 ms @ 200 notes | 6.2 ms | 18.9 ms (50.5 ms @ 6k) |
| Comunica per-query planning overhead | 1.8–2.6 ms warm, 14 ms cold | | |

**From the committed baseline (re-blessed post-#1473, current):**

| Benchmark | Mean | Budget |
|---|---|---|
| `indexAllNotes` 500 / 2000 / 5000 notes | 144.75 / 492.78 / 1,181.86 ms | 220 / 750 / 1,800 ms |
| `indexNote` into a 500-note store | 0.50 ms | — |
| `writeAndReindex` re-save, 500 / 2000 / 5000-note vault | 0.68 / 1.50 / 4.27 ms | — (and understated, see C4/H3) |
| `cosineSimilarity`: query vs 10,000 vectors (dim 384) | 5.98 ms | — |
| `meanPoolNormalize`: seq=512 dim=384 | 0.20 ms | — |

**Stale baseline entries (C4) — gate inert:** cold rebuild @ 500/2000/5000 committed at 20.05/60.82/147.69 ms vs measured 2.98/5.97/13.26 ms — 13.5×/20.4×/22.3× of dead headroom under the 2× ratio gate.

**Measured artifact sizes (packaged build, `out/Minerva-darwin-arm64`, built Sep 18):**

| Artifact | Size |
|---|---|
| Main process `main.js` (single eager CJS require) | **9,310,519 B (8.9 MB)** |
| Renderer entry chunk | **3,249,217 B (3.1 MB)** |
| Renderer entry CSS | 343,578 B |
| **Eager renderer critical path (JS+CSS)** | **≈3.93 MB** |
| Renderer assets total / chunk count | 43 MB / **217 `.js` chunks** |
| ONNX runtime WASM / embedding model | 23,567,050 B / ~23 MB |
| Stock skills bundled into `main.js` | 56 files / 317,503 B |
| Help-docs corpus (lazy — verified not a boot cost) | 4,549,942 B |
| `.vite/build/cli.js` (shipped, not app-loaded) | 12,894,957 B |
| Packaged `.app` | ~700 MB |

**Where I have no numbers, stated plainly:**

- **No production telemetry and no end-to-end startup trace.** `src/main/main.ts:37-40` already ships a `boot()` stderr profiler logging elapsed ms per phase; running `MINERVA_E2E=1` and reading the `boot +Nms:` lines would give real per-phase attribution for H12. I did not run it, so H12's internal ranking is reasoning, not measurement.
- **C1c (the orphan-asset scan) is characterized structurally but not timed.** It needs a thoughtbase with real accumulated history to measure honestly, which a synthetic seed does not reproduce.
- **C3's citation fan-out is not timed** — the code path is verified end to end (uncached call → readdir+readFile per source and excerpt → fresh citeproc engine), but I did not build a fixture library to put a number on it.
- **Renderer per-keystroke costs (M9, M10)** were micro-benchmarked in isolation under Node, not in the live Electron renderer. Order-of-magnitude only.
- **No memory profiling.** The unbounded-growth risks (conversation transcripts, kernel stdout, `readline` with no `maxLength`) are structural, not observed.
- The SPARQL/rdflib table above is measured against **synthetic** stores shaped like Minerva's. The shapes are faithful (same predicates, same triple-per-note ratio) but a real thoughtbase's distribution will differ.

### Target State

All targets are **relative**; there is no production baseline to anchor absolute numbers to.

| # | Target | Verified by |
|---|---|---|
| T1 | No SPARQL on the post-save path sorts more rows than it returns; the health-check burst costs a small fraction of what it does today at 3k notes | Bench `runAllChecks` at three scales with a `budgetMs` |
| T2 | A note save triggers **no** full-corpus disk scan; the orphan-asset check is O(F+A) single-pass and off the save trigger | Assert each corpus file is read at most once |
| T3 | `persistGraph()` causes **zero** mirror invalidations and no O(|ontology|×T) strip; post-persist query within 1.5× of warm | New `persistGraph → queryGraph` bench with `budgetMs` |
| T4 | Bench baseline re-blessed; gated benches within 1.3–1.5× of true current means; fixtures use realistic multi-segment filenames | `pnpm bench:check` green against a fresh baseline |
| T5 | The 120 ms preview tick issues **no** full-library or full-tree IPC | Count `api.*` calls across N consecutive renders |
| T6 | Streaming is **time-bounded**, not token-bounded: ≤20 IPC messages/s regardless of token rate; markdown render O(n) per session | Count `webContents.send` for a fixed synthetic stream |
| T7 | One approval = one graph serialization, not two; `expireProposals` = one, not one-per-item | Count `persistGraph` calls in an approval test |
| T8 | A `.md` file is read **once** per project open, not three-to-four times; no `statSync`/`realpathSync` on per-file paths | Count `readFile`/`statSync` during `indexAllNotes` |
| T9 | Window never visible before first paint; skills load does not gate `createWindow` | `boot()` profiler timings + `ready-to-show` present |
| T10 | Renderer entry chunk and `main.js` have committed byte budgets that fail CI on growth | New `tests/architecture/bundle-budget.test.ts` |
| T11 | No Python cell can block its project's kernel indefinitely | Test: a `while True` cell resolves with a timeout error and the next cell runs |
| T12 | `node_modules` is genuinely not watched | Test the chokidar `ignored` predicate against representative paths |

---

## Optimization Plan

### Quick Wins (1-3 days)

Ordered by payoff-per-hour. Every item is a small, local diff.

1. **Drop the `ORDER BY` from `checkStaleness` and siblings (C1a).** Sort the ≤100 returned rows in JS. `health-checks.ts:172`, `:386`, `:422`, and `note-properties.ts:137`. **Measured ~30× on the single most expensive thing that runs after a save.**
2. **Replace `persistGraph`'s ontology strip with serialize-then-filter (C2).** Kills the O(1000·T) loop *and* the mirror nuke in one change. `src/main/graph/index.ts:157-163`. **Measured 15.0× on post-persist query latency, plus ~326 ms of main-thread block at 3k notes.**
3. **Re-bless the bench baseline and add a `persistGraph → query` bench (C4).** Without this, items 1–2 have no guard. Use realistic multi-segment filenames in the fixtures.
4. **Raise the health-check debounce well above 2 s and/or move the burst to an idle callback (C1b).** `health-checks.ts:761,775`.
5. **Take the orphan-asset check off the save trigger; add `.duckdb`/extensionless/`.minerva/cache` to the skip set (C1c).** `health-checks.ts:122`, `asset-references.ts:41-51`.
6. **Memoize `loadCitationAssets` per `(rootPath, sources+excerpts mtime)` and cache `applyCslMarkers` by ref-list identity (C3a).** Removes full-library disk I/O from the typing path.
7. **Memoize `readProjectConfig` with `{mtimeMs, value}` (M3)** — removes the `readFileSync` from C3a's handler and 37 other sites.
8. **Coalesce stream chunks main-side (H8, half).** Buffer in `buildStreamCallbacks`, flush on a ~50 ms timer. `register-conversation.ts:139-141`.
9. **`show: false` + `ready-to-show` + `backgroundColor` (H12a).** `window-manager.ts:81-100`. Most visible first-run improvement in the report.
10. **Delete the redundant `persistGraph` at `propose-note.ts:55`** and debounce the remaining LLM call sites (C2).
11. **Memoize `realpathSync(rootPath)` per root (H5).** `notebase/fs.ts:91-97`. One line; removes a sync syscall from every file IPC.
12. **Hoist the duplicate `extractFrontmatter` in `parser.ts:73`/`:76` (H5).** Free.
13. **Add a Python cell timeout (H7).** Wrap `runPython` in a configurable timeout firing the existing `interruptKernel`. `python-kernel.ts:436-440`.
14. **Fix the dead chokidar ignore patterns (M1).** Use a predicate or `RegExp`. `watcher.ts:81-83`.
15. **Cache `listSavedQueries`/`getRecentProjects`, or hoist them out of `rebuildMenu` (H10).**
16. **Debounce `api.sources.onChanged` like the tree refresh already is, and add a `queueCounts` channel returning 4 integers (H11).** `ipc-wiring.ts:211-214`.
17. **Cache the `search`/`semantic` query blocks (C3), memoize `renderTex` (M13), add `validFor` to `tagCompletion` (M9), delete the dead `NOTEBASE_FILE_CHANGED` broadcast (M17), `$derived.by` + keyed + capped `{#each}` in `QueryPanel` (M12), hoist the loop-invariant regexes (M20).**

### Major Optimizations (1-2 weeks)

1. **Cache `buildLinkResolveCtx` on `GraphState` (H3)**, invalidated only when `indexedNotePaths`/`aliasMap` actually change; make it conditional on the note having links.
2. **Fix preview hydration idempotence (C3c).** Key mermaid/vega/object-view hydration by source text in a `Map` that survives the `{@html}` swap — or stop replacing the whole subtree. Stop clearing `transclusionRenderCache`/`typePropsCache` on the app's own autosave.
3. **Cache `listFiles` in main behind the watcher (C3b)** — it already knows every mutation — plus a renderer per-revision memo for `hydrateTransclusions`.
4. **Adopt the existing O(1) wiki-link index in the preview (M10)**, and build the deps object once per effect instead of three times.
5. **Bucket the link index for backlinks (H4)**, which also defuses the folder-rename blowup. Build `object → subjects` once per index generation and key the neighborhood cache off it.
6. **Back `searchInNotes` with the MiniSearch index, cap results, abort in-flight (H9).**
7. **Debounce the embedding fan-out and diff chunk persistence (H6).** Move off the 1 s autosave to 5–10 s; DELETE only vanished hashes; replace `arrayLit` with the DuckDB appender or prepared statements.
8. **Hoist the fence scan out of the gutter's `lineMarker` into a `StateField` (M9);** same for `App.svelte:1166`. Debounce/split the word count; drop the third flatten in `Editor.svelte:655`; convert `footnoteDecorations` to a visible-ranges scan.
9. **Fix the streaming markdown render (H8, other half).** Render only the stable prefix; key the message `{#each}` so a completed turn doesn't re-render history.
10. **Add a batch write channel for bulk refactor ops (M8)**, modeled on `HISTORY_LABEL_NOTES`. Apply a shared `mapWithConcurrency(items, 8, fn)` to the serial read loops (H9, H4's rename paths, `fs.ts:249/251`, `publish-to-s3.ts:164`).
11. **Fix `listTables` (M4)** — one `information_schema` query for all tables; drop or cache `COUNT(*)` on CSV views. Add `LIMIT` to panel-generated queries (M5).
12. **Cache `TYPES_LIST` off the existing `GraphState.typeCatalog` (M2).**
13. **Code-split the dialogs out of `App.svelte` (M7)** behind `{#await import()}`, and add `chunkSizeWarningLimit` + a committed bundle-byte budget test.

### Architectural Changes (2-4 weeks)

These need design, not just a diff. Two already have open issues (#1115, #1116).

1. **Incremental project open (H5).** Persist an mtime/hash manifest; on open, load the persisted graph and search index and reconcile only changed files instead of three-plus full walks. Prerequisite: fix the discarded-`graph.ttl` problem by persisting proposal statements separately, so the 832 ms parse at `graph/index.ts:132-133` is either used or skipped.
2. **Re-home the health checks entirely.** Even fully optimized, ~17 whole-graph SPARQL queries do not belong on the main thread on a post-save timer. Either move them to a utility process, or make each check incremental over the changed note rather than corpus-wide.
3. **Address rdflib's O(K·T) removal (H2).** The linear `RDFArrayRemove` is the shared root of C2's strip cost and the per-save `indexNote` cost. Options: maintain a statement→index map, batch removals into a single filter pass, or migrate the authoritative store to N3 and drop the mirror entirely (which would also delete C2's and H1's whole problem class).
4. **Content-addressed history (M6).** Replace whole-file snapshots with a content-addressed blob store plus an append-only revision log, removing both the full copy and the full `index.json` rewrite per save. `src/main/history/settings.ts:20-22` already names this. Also shrinks C1c's corpus by an order of magnitude.
5. **Lazy main-process module graph (H12c).** Move LLM SDKs, publish exporters, git, DuckDB, and source-ingest adapters behind `await import()` in IPC *handler bodies*. Biggest lever on the 8.9 MB eager require and the boot `dlopen`.
6. **Lazy skill bodies (H12b).** Parse frontmatter at boot, load bodies at execute time; drop `eager: true` so 317 KB of markdown leaves the bundle.
7. **Streaming kernel stdout (M16).** Flush per N bytes / per newline, cap total per-cell output, set `maxLength` on the `readline` interface.
8. **Not yet warranted: ANN for semantic search (#1116).** `cosineSimilarity` against 10,000 vectors measures 5.98 ms. Fix `relatedToRef`'s cross-join (M15) first — that's the nearer cliff. Revisit above ~10⁵ chunks.

---

## Implementation Strategy

### Phase 1: Low-hanging Fruit

**Goal: re-arm the safety net, then take the measured wins.** Order matters — without a trustworthy gate, none of the subsequent work is protected.

1. Re-bless `tests/main/bench-baseline.json`; tighten tolerances on the now-low-variance benches; fix the fixture filenames so `writeAndReindex` stops understating H3 (C4).
2. Add a `persistGraph → queryGraph` bench and a `runAllChecks` bench, both with `budgetMs`. **Both should fail immediately**, reproducing C1 and C2 in CI.
3. Fix C1a (the `ORDER BY`s) and C2 (serialize-then-filter). Watch both new benches go green.
4. Ship Quick Wins 4–17 in small independent PRs — each local and separately revertable.

Exit criteria: `pnpm bench:check` green against a fresh baseline; the two new benches passing; no full-corpus disk scan on the save path.

### Phase 2: Algorithm Improvements

**Goal: remove the per-tick and per-save costs.** User-perceptible, individually contained.

1. The preview cluster as one coherent effort: hydration idempotence, `listFiles` caching, the O(1) wiki-link index, query-block caching (C3, M10).
2. Graph query shapes: link-index bucketing and the neighborhood cache (H4); `buildLinkResolveCtx` caching (H3).
3. CodeMirror: gutter scan hoist, footnote decorations, word count, `tagCompletion` `validFor` (M9).
4. Embedding persistence: debounce + diff + appender (H6).
5. Batch channels and the bounded-concurrency helper across the serial-read sites (M8, H9).

Exit criteria: add per-tick benches for the preview render and per-keystroke benches for the editor update listener, so these can't silently regress the way the cold-rebuild path did.

### Phase 3: System-level Changes

**Goal: startup and the boot-time module graph.**

1. **Run the existing `boot()` profiler first** (`main.ts:37-40`, `MINERVA_E2E=1`) and get real per-phase numbers. **Do not start this phase without them** — H12's internal ranking is reasoning, not measurement, and the profiler is already there.
2. `ready-to-show` (H12a) if not already taken in Phase 1; un-gate `createWindow` from skills loading (H12b).
3. Lazy main-process imports (H12c), one subsystem per PR, with a `main.js` byte assertion added first.
4. Incremental project open and content-addressed history — the two genuinely large items, sequenced last because they touch correctness-critical paths.

---

## Performance Testing Plan

The harness exists; the gaps are coverage, not infrastructure.

**Extend the existing bench suite** (`tests/**/*.bench.ts`, scheduled `Bench` workflow):

| New bench | Guards | Suggested budget |
|---|---|---|
| `runAllChecks` at 500/2000/5000 notes, with history snapshots seeded | C1 | absolute ceiling; assert file-read count too |
| `persistGraph → queryGraph` at three scales | C2 | ≤1.5× the warm-query mean |
| `persistGraph` alone (strip + serialize) | C2 | absolute ceiling |
| Preview full render of a fixture note (diagrams + 50 wiki-links + citations) | C3, M10 | per-tick ms and per-tick IPC count |
| Editor update-listener cost on a 3,000-line doc | M9 | per-keystroke ms |
| `indexNote` with realistic multi-segment filenames | H3 | re-bless the understated baseline |
| One approval end-to-end | C2, H8 | assert `persistGraph` call count == 1 |

**Add assertion-based tests where a count is more stable than a timing** — this codebase already prefers that shape (`pattern-ratchets.test.ts`, `file-size-budgets.test.ts`), and counts don't flap on shared runners:

- `findOrphanedInlineAssets` reads each corpus file at most once.
- `indexAllNotes` reads each `.md` exactly once (currently three-to-four times).
- A streamed response of N tokens produces ≤ `ceil(duration/50ms)` IPC sends, not N.
- `approveProposal` calls `persistGraph` exactly once; `persistGraph` causes zero mirror resets.
- N consecutive preview renders issue a constant number of `api.*` calls, not N×.
- The chokidar `ignored` predicate returns true for a `node_modules` path.

**Add a bundle-byte ratchet** — `tests/architecture/bundle-budget.test.ts`, same committed-map shape as `file-size-budgets.test.ts`, covering `main.js` and the renderer entry chunk. This is the single missing guard behind M7 and H12c.

**Keep the timing gate off per-PR CI.** `bench-check.mjs`'s header reasoning is correct — micro-benchmarks flap on shared runners. The count-based assertions above, however, are deterministic and *should* run on every PR.

**Manual verification per phase:** run `MINERVA_E2E=1` and capture `boot +Nms:` lines; open a real thoughtbase with accumulated history and watch main-process CPU during a 60-second typing session. C1 and H6 should both show as periodic spikes today and flatten after Phase 1–2.

---

## Risk Assessment

### Safe Optimizations

Local, behavior-preserving, covered by existing tests or trivially testable:

- Re-blessing the bench baseline (C4) — changes no product code.
- Dropping the `ORDER BY`s (C1a) — SPARQL `ORDER BY` before `LIMIT` is *semantically* meaningful (it selects *which* 100 rows), so preserve the semantics by sorting in JS **after** raising the limit, or accept that "oldest 100 stale notes" becomes "100 stale notes, sorted" and confirm the UI doesn't depend on the selection. Safe once that call is made deliberately.
- `show: false` + `ready-to-show` (H12a).
- Memoizing `realpathSync` per root (H5) — `rootPath` is invariant per project; keep the try/catch fallback.
- Memoizing `readProjectConfig` on mtime (M3); memoizing `renderTex` (M13); hoisting loop-invariant regexes (M20).
- Hoisting the duplicate `extractFrontmatter` (H5) — pure dead work.
- Deleting the unused `NOTEBASE_FILE_CHANGED` broadcast (M17) — verified zero subscribers.
- Dropping the redundant `persistGraph` at `propose-note.ts:55` (C2) — the preceding `proposeWrite` already persisted.
- `$derived.by` + keyed `{#each}` in `QueryPanel` (M12); `validFor` on `tagCompletion` (M9).
- Adding `.duckdb`/extensionless to the asset-scan skip list (C1c partial) — strictly narrows what is read.
- Bounded concurrency on read-only loops (H9, M14's S3 path).

### Moderate Risk

Correct fixes that touch invalidation or ordering — write the test *before* the change:

- **C2's fix.** Serialize-then-filter changes what lands in `graph.ttl`; verify byte-for-byte equivalence against the current output on a fixture. If you instead keep the strip and merely exempt it from the mirror counter, note that the counter is a deliberate self-heal against drift — prefer snapshot/restore of `__minervaN3Writes` over disabling instrumentation, and re-assert the mirror-equivalence reasoning (`state.ts:323-326`) with a test comparing the incremental mirror against a from-scratch `buildN3Store` after a persist.
- **H1's fix** (counting semantic mutations rather than mirrored ops) weakens the drift backstop unless a time-based self-heal replaces it.
- **Moving the orphan check off the save debounce (C1c)** changes when users see results. The inspection is `info` severity and the panel has a manual Run, so it's a UX call more than a technical risk — but it is a behavior change.
- **Streaming coalescence (H8)** changes perceived responsiveness. 50 ms is below the perceptual threshold for text appearing, but pick the window deliberately and make it a named constant.
- **Embedding debounce + diff (H6)** — the diff must handle `chunk_index` shifts, or search results silently drift. Round-trip test first.
- **Preview hydration keying (C3c)** — the cache key must include everything affecting output (source text *and* resolved data for query-backed charts), or a chart goes stale after its data changes.
- **Caching `listFiles` in main (C3b)** — the watcher must be the single source of truth for invalidation, including external edits; a missed invalidation shows as a stale sidebar.
- **Link-index bucketing (H4)** — must be invalidated on every index generation; a stale bucket produces *wrong* backlinks, which is worse than slow ones.
- **Lazy main-process imports (H12c)** — moving an import into a handler body changes when module side effects run. Check each for import-time registration.
- **Python cell timeout (H7)** — pick a default that doesn't kill legitimate long-running analysis. Configurable and generous (60 s+), with a clear error.

### High Risk

Design changes to correctness-critical paths. Do not attempt without a spike and a rollback plan:

- **Incremental project open.** The current full-rebuild-on-open is *why* the graph is reliable — it self-heals from any drift. An mtime-keyed incremental path trades that guarantee for speed, and a stale index is a correctness bug users cannot see. Needs a periodic full-rebuild fallback and a cheap consistency check, mirroring the reasoning already applied to the N3 mirror.
- **Replacing rdflib as the authoritative store.** The cleanest fix for H2/C2/H1 as a class, and by far the largest blast radius — every indexer, query, and the write guard touch it.
- **Content-addressed history.** This is the user's data. Needs a migration path, a verified round-trip for every existing snapshot, and a way back.
- **Moving graph work to a utility process (#1115).** rdflib's store is not trivially transferable; this likely means re-architecting around a serializable representation. The yielding down-payment (#1488) may be enough.

---

## Recommendations

1. **Do C1a and C2 first — they are the two largest measured wins and both are small diffs.** Dropping an `ORDER BY` is a one-line change worth ~1 second per save at 3k notes. Replacing the ontology strip with serialize-then-filter is a handful of lines worth 15× on post-approval query latency plus ~326 ms of main-thread block. Nothing else in this report has that ratio.

2. **Re-bless the baseline in the same week, and add the two missing benches before fixing the things they guard.** Fixing C2 without re-arming the gate just resets the clock on the next silent regression — C4 is the proof that this already happened once.

3. **Treat "what runs after a save?" as a standing budget, not a per-PR judgement call.** The July round successfully moved work off the save path; since then a 17-query health-check burst, a full-corpus disk scan, and a per-second embedding rewrite have all attached themselves 1–3 seconds downstream of it. A test asserting the number of SPARQL queries and file reads triggered by one save would have caught all three.

4. **Treat "what invalidates this cache?" as the recurring bug class.** Every top finding is a correct optimization defeated by an adjacent write: the mirror nulled by ontology bookkeeping (C2) and by ordinary save volume (H1), hydration guards nulled by `{@html}` (C3c), type-props and transclusion caches nulled by the app's own autosave, the neighborhood cache nulled on every write (H4), the bench gate nulled by a stale baseline (C4). Worth a short section in `CLAUDE.md` — the existing conventions cover *where* mutations live but say nothing about what they invalidate.

5. **Prefer count-based assertions over timing benches for per-PR CI.** The team already reached this conclusion for micro-benchmarks (`bench-check.mjs`'s header) and for lint-over-runtime checks (the `waitFor` note in `CLAUDE.md`). "This path reads each file once" and "one approval = one serialization" are deterministic, run on every PR, and would have caught several findings here — including C1c, which shipped in the most recent commit.

6. **Run the `boot()` profiler before doing any startup work.** It already exists at `main.ts:37-40`. H12's ranking is reasoning, not measurement, and startup optimization done blind is how bundles get split in the wrong places.

7. **Two items here are reliability bugs wearing performance clothing** — the missing Python cell timeout (H7) and the `node_modules` watcher leak (M1). Both should be fixed on correctness grounds regardless of performance impact.

8. **Don't open issues for everything in the Medium list.** File them for C1–C4, H1–H12, and M1–M5; leave the rest as a reference to pick up opportunistically when someone is already in the file — which is how `CLAUDE.md`'s migration backlogs are already handled.

---

## Estimated Impact

Relative, since there is no production baseline. Confidence stated per row.

| Fix | Expected effect | Confidence |
|---|---|---|
| C1a — drop the `ORDER BY`s | **~30× on the most expensive post-save query** (1,064 ms → 36 ms at 3k notes) | **Measured** |
| C1b — debounce/idle the check burst | Removes ~1.5 s of main-thread work from every typing pause at 3k notes | **Measured** (per-query), inferred (total) |
| C1c — orphan scan off the save path | Removes a full-corpus serial disk read from every save and every 5 min | High (structural; magnitude unmeasured) |
| C2 — serialize-then-filter | **15× faster query after any proposal/approve/flush** (2.18 vs 32.80 ms at 2k) **plus ~326 ms of strip removed at 3k** | **Measured** |
| C3 — cache citation assets + file tree | Removes full-library and full-tree disk I/O from the 120 ms typing tick | High |
| C4 — re-bless baseline | No runtime change; restores 13–22× of lost gate sensitivity | **Measured** |
| H1 — mirror reset on semantic volume | Removes a 79–223 ms cold rebuild from every ~20th save | **Measured** (rebuild cost) |
| H3 — cache `buildLinkResolveCtx` | Removes 2.5–14 ms from every single-note save; more with realistic filenames | **Measured** |
| H4 — bucket the link index | O(12×L) → O(inbound degree) per note open; makes the graph panel and folder rename tractable | High |
| H5 — skip the discarded parse | Removes 143–832 ms of synchronous pre-paint work from project open | **Measured** |
| H6 — embedding debounce + diff | ~60× less write amplification during sustained typing | High |
| H7 — cell timeout | Eliminates an unrecoverable-without-restart state | High (correctness) |
| H8 — stream coalescing + prefix render | IPC/s drops from token-rate to ≤20; render work O(n²)→O(n) | High |
| H12a — `ready-to-show` | Removes the blank-window flash entirely | High |
| H12b/c — boot un-gating + lazy imports | Earlier window; avoids a native `dlopen` at boot | Medium (needs the profiler to size) |
| M1 — chokidar ignore fix | Eliminates tens of thousands of stray watches for code-bearing thoughtbases | High |
| M7 — dialog code-splitting | Meaningful reduction of the 3.25 MB eager chunk | Medium |

**Where the biggest aggregate win sits:** C1 and C2 together. They are independent, both small, both measured, and between them they account for roughly **1.4 seconds of main-thread work at 3,000 notes** (1,064 ms of sort + 326 ms of strip) plus the 15× query penalty — and the two of them are perhaps a day and a half of work.

---

## Effort Estimate

Engineer-days assuming familiarity with the subsystem. Benchmarks and tests included in each figure.

| Phase | Items | Effort |
|---|---|---|
| **Phase 1 — Low-hanging fruit** | C1 (all three), C2, C3a, C4, H5 (partial), H7, H8 (main-side), H10, H11, H12a, M1, M3, M12, M13, M17, M20 (regex hoists) | **5–7 days** |
| **Phase 2 — Algorithm improvements** | C3b/c, H3, H4, H6, H9, M2, M4, M5, M8, M9, M10, M14 | **9–13 days** |
| **Phase 3 — System-level** | H12b, H12c, M7 + bundle ratchet, M15, M16 | **6–9 days** |
| **Architectural (separate track)** | Incremental project open; re-homed health checks; rdflib removal cost; content-addressed history; #1115 | **20–30 days**, plus design |

**Totals:** ~20–29 engineer-days for Phases 1–3. The architectural track roughly doubles it and should be scheduled independently, gated on the profiler numbers from Phase 3 step 1.

**Sequencing note:** Phase 1 items 1–3 (re-bless + add the two benches, drop the `ORDER BY`s, fix `persistGraph`) are ~2 days combined and deliver every measured win in this report. If only one thing gets done, do that.

---

*Method note: findings marked "measured" come from `pnpm bench` runs, a direct probe, and micro-benchmarks executed against this repo's own `rdflib`/`n3`/`@comunica`/`chokidar` on 2026-09-20 (Darwin arm64). The probe file was removed and the working tree left unmodified. Synthetic stores are shaped like Minerva's data (same predicates, same triple-per-note ratio) but are not real user data. All other findings were verified by reading the cited code path end to end; items explicitly labelled inferred were not executed. Nine of the eleven findings from the July 2026 review (#1106–#1116) were confirmed closed and are not re-reported; #1115 and #1116 remain open and are referenced where relevant.*
