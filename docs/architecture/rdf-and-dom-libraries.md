# ADR: RDF and DOM library stacks

**Status:** Accepted (2026-07). Consolidation evaluation for [#1013]; dual-store
rationale for [#987]. Source: modernization review F7 + architecture review P1/8.

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
| `rdflib` + `N3.Store` dual RDF store | **Keep.** rdflib = mutation/parse/serialize source of truth; `N3.Store` = lazily-rebuilt (invalidate-on-write) Comunica SPARQL mirror. |
| Retire `rdflib` for `n3` + Comunica | **Feasible, deferred.** Large, high-risk rewrite of the graph + trust core for a low-priority footprint win. Target if revisited: n3-only. |
| Three DOM libraries | **Keep all.** `linkedom` is the sole *runtime* parser (no redundancy); `happy-dom` + `jsdom` are a per-test speed/fidelity split. |

Resolves [#1013] (consolidation evaluation) and [#987] (dual-store ADR).

[#1013]: https://github.com/dgriffith/ide-for-thought/issues/1013
[#987]: https://github.com/dgriffith/ide-for-thought/issues/987
