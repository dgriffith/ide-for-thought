# ADR: RDF and DOM library stacks

**Status:** Accepted (2026-07). Consolidation evaluation for [#1013]; dual-store
rationale for [#987]. Source: modernization review F7 + architecture review P1/8.

> **§1 revisited 2026-09 by the [#2213] design spike — see [§1.5](#15-2026-09-revision-2213-spike).**
> Two parts of §1 below are now out of date: the sync model it describes was
> replaced by [#1110], and the migration-scope assessment predates [#2234]. The
> original text is kept as written because the revision is a response to it.

This record answers two "why do we carry more than one library for the same
job?" questions and locks in the decisions so the redundancy reads as
deliberate, not accidental.

---

## 1. Two RDF stacks — `rdflib` (source of truth) + `N3.Store` (Comunica mirror)

### Context

Every open thoughtbase keeps its triples in an **`rdflib` `IndexedFormula`**
(`GraphState.store`, `src/main/graph/state.ts`). Essentially all graph work goes
through rdflib's API:

- `.add` (~127 call sites) and `.statementsMatching` (~92) for mutation and
  pattern reads;
- `$rdf.NamedNode` / `$rdf.lit` / `$rdf.sym` / `$rdf.Namespace` / `$rdf.parse`
  (Turtle in) / `$rdf.serialize` (Turtle out);

…spread across `src/main/graph/*`, **`src/main/llm/approval.ts` (the
trust/approval path)**, and `src/main/sources/import-zotero-rdf.ts` — roughly
250 sites in all, including the most safety-critical data path in the app.

SPARQL, however, is served by **Comunica** (`@comunica/query-sparql-rdfjs`),
which needs an **RDF/JS**-compliant source. rdflib's `IndexedFormula` is not one,
so `queryGraph` builds an **`N3.Store`** mirror (`buildN3Store`,
`state.ts`) and caches it on `GraphState.n3Cache`.

So each engine does what it is best at:

| Library | Role |
|---|---|
| `rdflib` `IndexedFormula` | mutable **source of truth** — parse, mutate, `statementsMatching`, prefixed-Turtle serialize |
| `N3.Store` (+ Comunica) | **query** — an RDF/JS mirror the SPARQL engine can read |

### The sync model — full rebuild on write

`n3Cache` is a *derived* cache, never mutated directly. Any graph write calls
`invalidate(state)` (`state.ts`), which nulls `n3Cache`; the next `queryGraph`
(`queries.ts`) rebuilds the **entire** N3 mirror from the rdflib store.

Cost model: writes stay cheap (rdflib only; the mirror is simply discarded), and
the *first* query after any write pays one `O(triples)` rebuild, after which
queries reuse the cache until the next write. Given that writes are frequent and
queries comparatively rare — and a project-sized store rebuilds fast — this beats
a finer-grained incremental mirror (mirror each add/remove), which adds standing
complexity for little gain against this access pattern.

### Can `rdflib` be retired for `n3` + Comunica?

**Technically yes.** `N3.Store` is RDF/JS, parses/serializes Turtle
(`N3.Parser` / `N3.Writer`), and supports add/remove/`getQuads`. A single
`N3.Store` could in principle be *both* the mutable store *and* the Comunica
source, deleting `rdflib`, the mirror, and the rebuild-on-write step.

**In practice it is a large, high-risk migration for a low-priority footprint
win**, so it is deferred:

- ~250 rdflib sites — across the graph core **and** the trust/approval path —
  would move to n3's `DataFactory` + `getQuads` (different match semantics than
  `statementsMatching`) and `N3.Writer` (different prefix/serialization handling
  than `$rdf.serialize`).
- rdflib conveniences (`Namespace` helpers, statement-pattern reads, prefixed
  Turtle round-trip) would need re-implementing on n3.

**Decision: keep both.** If this is ever revisited, the target is **n3-only**
(`N3.Store` as store + Comunica source, `N3.Writer` for serialization) — this
doc is the record of that intended direction and of why it hasn't been taken.


---

## 1.5 2026-09 revision ([#2213] spike)

§1 was written in 2026-07 and two of its load-bearing claims have since gone
stale. This section records what changed, what was measured, and what the
numbers imply. **It does not overturn the decision** — that is a call for the
maintainer — but the evidence has moved enough that "keep both" should be
re-affirmed or reversed deliberately rather than by default.

### What is stale in §1

**The sync model.** §1 describes `n3Cache` as nulled on every write and rebuilt
in full by the next query, and argues that this "beats a finer-grained
incremental mirror (mirror each add/remove), which adds standing complexity for
little gain". [#1110] then built exactly that incremental mirror, and it is what
ships: `instrumentStoreMirror` wraps `store.add` / `store.removeMatches` and
applies each delta to the live mirror. The ADR argues against the design now in
place.

That complexity is not free, and it has since produced its own defects — the
mirror nulled by ontology bookkeeping ([#2209]) and a self-heal rebuild whose
cadence was independent of its cost ([#2212]). Both were fixed by reasoning
about the mirror; neither would exist without one.

**The migration scope.** §1 puts the surface at "~250 rdflib sites — across the
graph core **and** the trust/approval path". The count is still roughly right
(233 `$rdf.*` references; 120 `.add`, 92 `.statementsMatching`, 19
`.removeMatches`) but the *shape* has changed completely. [#2234] sealed the
store inside `graph/`, with `tests/architecture/graph-store-encapsulation.test.ts`
enforcing it. Today **18 files import rdflib and 16 of them are inside
`graph/`**:

| where | what it needs |
|---|---|
| `src/main/graph/**` (16 files) | the store itself — behind the [#2234] boundary |
| `src/main/llm/proposal-persistence.ts` | `$rdf.graph()` + `$rdf.parse` only — a scratch store for proposal payloads |
| `src/main/sources/import-zotero-rdf.ts` | `$rdf.parse` of **RDF/XML** into a private scratch store |

The trust path's dependency is now two calls in one file, not a tangle through
`approval.ts`. The API in use is also narrower than the raw count suggests:
`.any`, `.each`, `.holds` and `.match` are used **zero** times.

### Measurements

Synthetic stores, 30 triples per note, one note re-indexed (the two
`removeMatches` in `indexers/note.ts:321-323` plus 30 `add`s), median of 20:

| notes | triples | rdflib | n3 | ratio |
|---|---|---|---|---|
| 200 | 6,000 | 2.24ms | 0.418ms | 5x |
| 1,000 | 30,000 | 9.18ms | 0.255ms | 36x |
| 3,000 | 90,000 | 20.77ms | 0.767ms | 27x |
| 6,000 | 180,000 | 50.43ms | 1.298ms | 39x |

rdflib grows linearly with the whole store; n3 is effectively flat. The
mechanism is exact: `removeStatement` calls `rdfArrayRemove(this.statements,
st)`, a full linear scan of the statements array **per statement removed**, so K
removals cost O(K·T). The four index buckets it also maintains are the cheap
part.

Turtle I/O, same stores:

| size | parse rdflib | parse n3 | serialize rdflib | serialize n3 |
|---|---|---|---|---|
| 30k triples (0.48MB) | 573ms | 36ms (**15.9x**) | 110ms | 13ms (**8.6x**) |
| 90k triples (1.44MB) | 1,892ms | 99ms (**19.2x**) | 664ms | 33ms (**20.3x**) |

Quad counts are identical across both. So the removal complexity is not an
isolated wart — rdflib is an order of magnitude slower at every bulk operation
Minerva performs.

### The two cheaper options do not work

§1's successor issue offers three fixes. Two were investigated and rejected on
evidence:

**Batch removals into a single filter pass.** Prototyped against rdflib's
internals: collect the doomed statements, filter the index buckets, then compact
`this.statements` once instead of once per statement.

| notes | rdflib | batched | ratio |
|---|---|---|---|
| 1,000 | 9.36ms | 3.51ms | 2.7x |
| 3,000 | 22.62ms | 8.43ms | 2.7x |
| 6,000 | 57.23ms | 20.33ms | 2.8x |

It reduces the constant and **leaves the complexity class alone** — still
linear in store size per save, 3.51 → 8.43 → 20.33ms as the corpus grows. It
also requires reaching into `index`, `statements`, `canon` and `id`, all
private, for a constant factor. Not worth the coupling.

**Maintain a statement→index map.** Does not help for the same underlying
reason: knowing a statement's array position in O(1) does not make removing it
cheaper, because the splice still shifts every later element *and* invalidates
every stored index after it. Making that work means tombstones plus periodic
compaction — i.e. reimplementing rdflib's store inside Minerva.

Only migrating the authoritative store changes the curve.

### A conformance bug that constrains the ORDER of any migration

rdflib's Turtle parser mishandles `\U`-escaped astral characters. N3.Writer
emits the spec-correct 8-digit form (`"x \U00020000 y"`); rdflib's writer emits
the raw character instead, and rdflib's *parser* cannot read N3's form —
U+20000 comes back as a literal NUL, U+1F600 is dropped entirely. Verified
per-stage: N3.Parser is correct, a pure n3 write→read round trip is correct,
and only `N3.Writer → $rdf.parse` corrupts.

This is not a live bug (rdflib writes and rdflib reads, and its own output
round-trips), but it is a trap for a staged migration: **serialization must not
move to N3.Writer while parsing still uses rdflib**, or every emoji in a note
is corrupted on the next read. Migrate the reader first, or both together.

### Also worth knowing: Turtle loses named graphs either way

Persisting through `text/turtle` discards graph assignment — measured, both
stacks land everything in `urn:x-minerva:void` on reload. This is inherent to
Turtle, not a difference between the libraries, and it is harmless today
because `indexAllNotes` re-derives every note from disk and only proposals are
carried across ([#2216]). Any future design that expects `graph.ttl` to preserve
per-note graphs needs TriG, not Turtle.

### Where this leaves the decision

The case for the §1 status quo was "large, high-risk migration for a
low-priority footprint win". Two of those three words have weakened:

- it is **not a footprint win**, it is an order of magnitude on every bulk graph
  operation, plus the deletion of the mirror and the two defect classes it has
  already produced ([#2209], [#2212]);
- it is **less large** than assessed, because [#2234] already confined 16 of 18
  files behind one package boundary and the API in use is three store methods.

It remains **high-risk**, and that has not changed: it touches the trust path
and the persistence format.

A staged shape that respects the constraint above:

0. A differential harness asserting n3 and rdflib agree on Minerva's actual
   mutation and match patterns — the safety net everything else leans on.
1. Move `graph/` internals to n3 behind the [#2234] boundary, reader and writer
   **together** (see the conformance bug).
2. Port `llm/proposal-persistence.ts` — two calls, but on the trust path, so it
   gets its own change and its own scrutiny.
3. Delete the mirror: `instrumentStoreMirror`, the rebuild budget ([#2212]), and
   `persistGraph`'s filtered-view machinery ([#2209]).
4. Carve out `sources/import-zotero-rdf.ts`. **n3 cannot parse RDF/XML**, so
   "n3-only" is not literally reachable; `rdfxml-streaming-parser` is already
   present transitively (2.4.0) and would need promoting to a direct dependency.

**Recommendation: worth doing, not worth starting casually.** The evidence now
favours migrating, but it is a multi-PR change through the approval path and
should be scheduled as such rather than begun opportunistically. Until then the
status quo stands, and the scale risk is bounded — at 3,000 notes the removal
cost is ~21ms per save, which is real but not urgent.

[#1110]: https://github.com/dgriffith/ide-for-thought/issues/1110
[#2209]: https://github.com/dgriffith/ide-for-thought/issues/2209
[#2212]: https://github.com/dgriffith/ide-for-thought/issues/2212
[#2213]: https://github.com/dgriffith/ide-for-thought/issues/2213
[#2216]: https://github.com/dgriffith/ide-for-thought/issues/2216
[#2234]: https://github.com/dgriffith/ide-for-thought/issues/2234

---

## 2. Three DOM libraries — `linkedom` (runtime) + `happy-dom` & `jsdom` (tests)

### Context — and a correction

The modernization review listed `jsdom` as the main-process HTML parser. That is
**stale**: `jsdom` is *not imported anywhere in `src/`* — it is a
`devDependency` used only as a vitest test environment. The actual runtime parser
is **`linkedom`** (a real `dependency`).

| Library | Where | Why |
|---|---|---|
| **`linkedom`** | runtime — `src/main/sources/{ingest,site-handlers}.ts`, `api-adapters/{arxiv,pubmed}.ts` | Parses fetched HTML/XML for source ingestion and feeds Mozilla Readability. Chosen over jsdom on purpose: *"a standards-ish Document backed by a fast tree — enough for Readability without dragging undici/jsdom into the bundle"* (`ingest.ts`). |
| **`happy-dom`** | test env — 31 files (`@vitest-environment happy-dom`) | The fast default for renderer/component render tests. |
| **`jsdom`** | test env — 7 files (`@vitest-environment jsdom`) | The tests needing higher DOM fidelity than happy-dom offers (sanitization, canvas/image, `DOMParser` edge cases). |

So the **runtime has exactly one DOM library** (`linkedom`) — there is no
runtime redundancy to remove.

### Decision: keep all three

The two *test* environments are a deliberate **speed/fidelity split**: happy-dom
for the fast majority, jsdom for the handful that need fidelity happy-dom lacks
(those 7 opted in for a reason). Collapsing to one environment would either slow
the 31 happy-dom tests (all → jsdom) or break the 7 (all → happy-dom) — a net
loss. Should happy-dom close its fidelity gaps, the 7 jsdom tests could migrate
and jsdom be dropped, but that is a per-test verification with low upside; not
worth doing speculatively.

---

## Summary

| Concern | Decision |
|---|---|
| `rdflib` + `N3.Store` dual RDF store | **Keep.** rdflib = mutation/parse/serialize source of truth; `N3.Store` = the Comunica SPARQL mirror — maintained *incrementally* since [#1110], not rebuilt on write as §1 describes (see §1.5). |
| Retire `rdflib` for `n3` + Comunica | **Feasible, deferred — but the evidence moved.** §1.5 measures n3 at 5-39x on removal (and flat rather than linear), ~19x on parse, ~20x on serialize, with the surface now confined behind [#2234]. Recommendation there: worth doing, schedule it deliberately. Not literally n3-only: RDF/XML import needs its own parser. |
| Three DOM libraries | **Keep all.** `linkedom` is the sole *runtime* parser (no redundancy); `happy-dom` + `jsdom` are a per-test speed/fidelity split. |

Resolves [#1013] (consolidation evaluation) and [#987] (dual-store ADR).

[#1013]: https://github.com/dgriffith/ide-for-thought/issues/1013
[#987]: https://github.com/dgriffith/ide-for-thought/issues/987
