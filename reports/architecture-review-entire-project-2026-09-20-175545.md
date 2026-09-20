# Architecture Review Plan
Generated: 2026-09-20T17:55:45Z
Scope: entire project

## Executive Summary

Minerva is ~136,500 lines of TypeScript/Svelte across five layers (`src/main` 52.9k, `src/renderer` 66.1k, `src/shared` 15.0k, `src/preload` 0.7k, `src/cli` 1.8k), written in under six months (first commit 2026-03-28, 1,247 commits, **715 of them in the last 90 days**). At that velocity most codebases lose their shape. This one largely hasn't, and the reason is mechanical rather than cultural: **16 architecture-ratchet tests in `tests/architecture/` plus four eslint layer-boundary blocks convert most of CLAUDE.md's prose into failing builds.** I went looking for the gap between what CLAUDE.md claims and what is enforced, and in the big three cases — layer purity, IPC typing, store ownership — the enforcement is real and in several places *stronger* than the documentation admits.

Specifically verified as genuinely airtight:

- **The IPC contract.** 361 channel constants (`src/shared/channels.ts`), 362 contract keys (260 `ChannelMap` + 39 hand-written + 64 derived `EventMap`), **zero channels without a contract entry**. All 260 main-side handlers go through the typed `handle()` wrapper (`src/main/ipc/typed-ipc.ts:5-11`); raw `ipcMain.handle` appears nowhere else in `src/`. Zero `any`, zero `@ts-ignore` in `preload.ts`/`client.ts`/`ipc-contract.ts`. `client.ts:1337`'s `_ClientMatchesPreload` assertion ties the renderer's hand-written `IdeApi` back to the real preload object at compile time.
- **Layer direction.** No renderer file imports `src/main`; no main file imports `src/renderer`; no shared file imports any of them or `electron`. Frozen by `eslint.config.mjs:276-344`, plus three *intra*-layer edge rules (`:355-397`) that hold documented design decisions (approval.ts ↛ conversation storage, history ↛ notebase, graph ↛ llm).
- **Cycles.** `tests/architecture/no-cycles.test.ts` runs `dependency-cruiser` with `tsPreCompilationDeps: true` and `.svelte` resolution, and passes. This invariant isn't even mentioned in CLAUDE.md — the test exceeds the docs.
- **The graph package's outward hygiene.** `src/main/graph/**` imports `electron` zero times and `src/main/ipc/**` zero times; the direction is inverted through `graph-events.ts` / `inspection-events.ts` pub/sub.
- **The component layer itself.** 120 `api.*` call sites across 51 component files, 67 distinct `domain.method` pairs — **zero uncovered mutations**, zero event subscriptions, zero destructured aliases or bracket access that would evade the eslint AST selector. Inside its declared scope the data-flow rule is not merely enforced, it is unblemished.
- **Three clean extension seams.** The skills pipeline (`parse → loader → compile → register`) is strictly acyclic with no back-edges and no edge to `llm/` in either direction. The LLM provider abstraction is real: `@anthropic-ai/sdk` appears only in `src/main/llm/provider/anthropic.ts:12`, `openai` only in `provider/openai.ts:20`, `@google/genai` only in `provider/google.ts:21`. And proposal payload kinds use a **self-registering handler registry** (`src/main/llm/apply-dispatch.ts:32-67`) with an `assertWiredPayloads` check (`approval.ts:53-64`) that throws at propose-time rather than failing silently at approve-time — no switch statement to forget.

Against that, the findings that matter are not "the conventions aren't enforced" but **"three load-bearing invariants are enforced by a mechanism whose scope is narrower than the invariant, and the gap is already occupied."**

1. **The #2036 ontology migration left five inspection checks querying a predicate nothing writes.** `checkUnsupportedClaims` (`src/main/graph/health-checks.ts:141-142`) and `checkEvidenceGaps` (`:222-224`) require exact `?claim a thought:Claim` **and** `?claim thought:label ?label`. A claim filed by the current canonical path (`buildClaimNoteContent`, `src/main/ipc/register-conversation-drafts.ts:66` → `type: claim`) asserts `a types:Claim` — reaching `thought:Claim` only via an `rdfs:subClassOf` bridge — and carries `dc:title`, not `thought:label`. Nothing in `src/main` writes `thought:label` at all; it is read at 8 sites and produced only by hand-authored Turtle. The inspections are silently dead for every claim the app itself creates. Nothing detected this because **no test cross-checks the 185 hardcoded `thought:` literals against `ontology-thought.ttl`**.

2. **The renderer data-flow rule is scoped by file location, not by responsibility — and the gap is already occupied by 9 real mutation call sites.** Inside its scope the rule is spotless (see above); the problem is the scope. The eslint rule is `files: ['src/renderer/lib/components/**/*.svelte']` (`eslint.config.mjs:427`) and the fail-closed backstop walks `.svelte` only (`tests/renderer/dataflow-rule-coverage.test.ts:81`). Renderer `.ts` helper modules outside `stores/`/`lib/app/` are unpoliced by both: `src/renderer/lib/sources/source-actions.ts:37,61,95` (`setTitle`, `delete`, `addTag`), `src/renderer/lib/editor/image-upload.ts:91` (`writeBinary`), `src/renderer/lib/tools/output.ts:24,25` (`createFile`, `writeFile`), `src/renderer/lib/formatter/settings.ts:55,68` (`saveSettings`), `src/renderer/lib/compute/run-cell-with-trust.ts:80` (`runCell`). Every one of those method names **is** on the 115-name denylist. The rule is being routed around by file extension.

3. **The LLM write guard is asserted per-function at the facade rather than at the chokepoint, and seven store-mutating functions already skip it** — including `indexAllNotes` (`src/main/graph/indexers/rebuild.ts:160`, which swaps `state.store` wholesale), `reloadTypeCatalog` (`:50`), and `materializeTypeClasses` in `src/main/types/compile.ts`, which writes `state.store` **from outside the `graph/` package entirely**. `instrumentStoreMirror` (`src/main/graph/state.ts:409,430,438`) already wraps `store.add`/`store.removeMatches` for N3 mirroring — that wrapper is the chokepoint where the guard would be total by construction instead of opt-in-and-remember.

Two structural observations round it out. **`GraphState` is not a god-object class — it's worse-shaped than that: a 12-field open mutable record with zero behavior** (`src/main/graph/state.ts:221-276`), bundling eight responsibilities and mutated in place by 12+ modules across three packages. And **the native menu is a second, undisciplined command surface**: `src/main/menu.ts` (1,024 lines, 26 imports) calls `runMaintenance`, `runBackfill`, `tables.registerAllCsvs`, `restartPythonKernel` and `graph.exportGraph` directly from click handlers, bypassing the IPC contract, the `withRootPath` helpers, and every ratchet that governs the registrar layer.

The honest one-line summary: **the boundaries are real and well-policed; the policing mechanisms are each one scope-notch smaller than the boundary they protect, and every one of those notches is already inhabited.**

---

## Current Architecture

### Overview

**Five layers, four enforced directions.**

| Layer | LOC | Files | Role |
|---|---|---|---|
| `src/shared` | 14,999 | 161 | Pure logic + types. No `electron`, no `node:*`, no main/renderer/preload imports. |
| `src/main` | 52,885 | 350 | Node side: file I/O, RDF graph, DuckDB, Python kernel, embeddings, LLM, git/S3 publish, native menu. |
| `src/preload` | 700 | 2 | The single `contextBridge` crossing. 260 typed `invoke` + 100 typed `subscribe`. |
| `src/renderer` | 66,092 | 326 | Svelte 5 runes UI. 28 stores, 13 ops modules, 130 components. |
| `src/cli` | 1,792 | 10 | Headless substrate/MCP entry. Imports `src/main`; `electron` aliased to an all-undefined stub. |

**Main process — 26 subsystems.** The lifecycle spine is three files:

- `src/main/project-context-types.ts:9-13` — a branded `ProjectContext` (`readonly _brand: 'ProjectContext'`) so a bare `rootPath` string can't be passed where a context is wanted.
- `src/main/project-store.ts:43-64` — `createProjectStore<T>()`, a self-registering per-project state slot. Five subsystems use it (graph, search, tables, vectors, +1).
- `src/main/project-context.ts:57-128` — `acquireProject`/`releaseProject` refcounted by window id. First acquirer runs an ordered 8-subsystem init; last release persists then calls `disposeAllProjectStores`.

**Graph package — 29 files, 6,117 lines.** rdflib `IndexedFormula` is the single source of truth; an N3 store is a derived mirror maintained incrementally by monkey-patching `store.add`/`store.removeMatches` (`src/main/graph/state.ts:409-440`); Comunica reads only the mirror (`src/main/graph/queries/sparql.ts:99`). The search index (MiniSearch) is a wholly separate subsystem joined only at the fan-out call site (`src/main/notebase/index-fanout.ts:28,53`).

**IPC — 25 registrars, one pattern.** `src/main/ipc.ts` (79 lines) wires three Electron-free event emitters into renderer broadcasts (`:36-52`) then calls 25 `registerX()` functions. All 260 handlers use the typed `handle()`; project-scoped ones use `withRootPath`/`withRootPathWin`/`withRootPathOr` from `ipc/helpers.ts`.

**Renderer — a three-tier data flow.** Components read stores and call store methods; stores own `api.*` mutations and event subscriptions; `App.svelte` is the composition root wiring seven ops factories (`note-ops`, `source-ops`, `refactor-ops`, `template-ops`, `conversation-ops`, `project-ops`, `nav-view`) plus `registerAppIpc`.

**Two typing systems, one bridge.** `types:` (user-extensible object types, `<root>/.minerva/types/*.md` + 10 bundled stock) is authoritative for the catalog, all views, and all LLM writes. `thought:` (`src/shared/ontology-thought.ttl`, 1,219 lines, 92 classes) is a fixed epistemic vocabulary reached via `externalClass:` → `rdfs:subClassOf` (`src/main/types/compile.ts:32-43`).

**Skills.** 56 stock `.md` files bundled by `import.meta.glob` (`src/main/skills/loader.ts:29`), compiled to `ThinkingToolDef`, registered into `src/shared/tools/registry.ts` — a deliberately duplicated per-process singleton (main gets prompt bodies, renderer gets metadata only).

### Architecture Diagram

```
                         ┌───────────────────────────────────────────┐
                         │  src/shared  (15.0k LOC, 161 files)       │
                         │  channels.ts(361) · ipc-contract.ts(362)  │
                         │  tools/registry · objects/ · ontology.ttl │
                         │  PURE — no electron, no node:*            │
                         └───────────────────────────────────────────┘
                            ▲              ▲                  ▲
            (types only)    │              │                  │   (types only)
   ┌────────────────────────┘              │                  └────────────────────┐
   │                                       │                                       │
┌──┴──────────────────────────┐   ┌────────┴──────────┐   ┌────────────────────────┴──┐
│  src/main  (52.9k, 350)     │   │ src/preload (700) │   │ src/renderer (66.1k, 326) │
│                             │   │  THE ONLY         │   │                            │
│  main.ts → window-manager   │   │  CROSSING         │   │  App.svelte (2096)         │
│         → project-context ──┼──►│                   │   │   ├ 7 ops factories        │
│              (acquire /     │   │ 260 invoke<K>     │   │   ├ registerAppIpc         │
│               release)      │◄──┤ 100 subscribe<K>  │◄──┤   └ ~20 dialog show* flags │
│                             │   │ 2 raw ipcMain.on ◄┼───┤                            │
│  ipc.ts (79) ─► 25 register-*│   │ contextBridge     │   │  stores/ (28, 4.2k)        │
│    all via typed handle()   │   │  'api'            │   │   conversations(1165)      │
│         │                   │   └───────────────────┘   │   editor(913)              │
│         ▼                   │                           │  lib/app/ (13, 4.0k)       │
│  ┌──────────────────────┐   │                           │  components/ (130, 38.2k)  │
│  │ graph/ (29, 6.1k)    │   │   ╔═══════════════════╗   │   └ 105 FLAT in one dir    │
│  │  GraphState{12 fields│◄──┼───╢  menu.ts (1024)   ║   │  lib/{editor,preview,…}    │
│  │   open mutable}      │   │   ║  SECOND COMMAND   ║   └────────────────────────────┘
│  │  rdflib ──► N3 mirror│   │   ║  SURFACE — calls  ║
│  │       (monkey-patched│   │   ║  subsystems       ║          src/cli (1.8k)
│  │        add/remove)   │   │   ║  DIRECTLY,        ║          imports src/main
│  │  ▲ write-guard: 14 of│   │   ║  bypasses IPC     ║          electron → stub
│  │    ~21 write fns     │   │   ╚═══════════════════╝
│  └──────────────────────┘   │
│    ▲          ▲       ▲     │
│    │          │       └─────┼── types/compile.ts  ◄── WRITES state.store
│    │          │             │                          FROM OUTSIDE graph/
│    │       llm/ (9.3k)      │
│    │        approval.ts(173)│   graph → llm : 0 imports  (eslint-enforced)
│    │        apply-dispatch  │   llm → graph : 23 sites, 4 bypass graph/index.ts
│    │        provider/{anthropic,openai,google}
│    │                        │
│  notebase/ ◄──► graph/      │   ← package-level cycle (no FILE cycle;
│  (graph→notebase: 3 leaf    │      no-cycles.test.ts cannot see it)
│   utils; notebase→graph: 7) │
│                             │
│  search/  sources/ compute/ │   Per-project state: createProjectStore (5 users)
│  embeddings/ history/       │   …except health-checks.ts, 4 hand-rolled Maps,
│  mcp-client/(3.0k) skills/  │      2 of which never get deleted (:59, :65)
│  publish/ git/ clipper/     │
└─────────────────────────────┘

ENFORCEMENT OVERLAY
  eslint.config.mjs:276-344  layer direction (shared↛*, main↛renderer, renderer↛main, cli↛renderer/preload/electron)
  eslint.config.mjs:355-397  3 intra-layer edges (approval↛conversation, history↛notebase, graph↛llm)
  eslint.config.mjs:427-446  data-flow denylist — SCOPE: components/**/*.svelte ONLY  ◄── gap
  tests/architecture/*       16 ratchets (no-cycles, file-size, store-ownership, config-loader, …)
  tests/renderer/dataflow-rule-coverage.test.ts  fail-closed — SCOPE: .svelte only  ◄── same gap
```

---

## Architectural Issues

### Critical Issues

#### A1 — The `types:` / `thought:` migration (#2036) left five inspection checks querying a predicate the app never writes

**Verified end to end.**

`src/main/types/stock/claim.md:5` declares `externalClass: thought:Claim`, and `src/main/types/compile.ts:32-43` materializes that as `types:Claim rdfs:subClassOf thought:Claim` — deliberately `subClassOf` rather than `owl:equivalentClass`, so the store's `a/rdfs:subClassOf*` idiom reaches it without OWL entailment. A claim note therefore asserts **`a types:Claim`, never `a thought:Claim`**. Its title is emitted as `dc:title` (`src/main/graph/indexers/note.ts:178`).

Two health checks were not migrated:

```
src/main/graph/health-checks.ts:141-142   ?claim a thought:Claim .
                                          ?claim thought:label ?label .
src/main/graph/health-checks.ts:222-224   (same two patterns, checkEvidenceGaps)
```

Both patterns fail for every claim the app itself produces. `src/main/ipc/register-conversation-drafts.ts:44-51` even documents the switch in its own doc-comment ("Typed via `type: claim` … rather than an embedded turtle block") without anyone revisiting the queries that depended on the old shape.

The blast radius is wider than two checks. `grep` for `thought:label` across `src/main` returns **8 read sites and zero write sites**: `health-checks.ts:143,224,252,315,316`, `integrity.ts:34`, `register-graph.ts:110`. The only producers anywhere are the `crystallize` stock skill's prose instruction (`src/main/skills/stock/crystallize.md:31`) and hand-authored Turtle in the tutorial (`resources/tutorial-thoughtbase/Structured Reasoning.md`). So `checkUnsupportedClaims`, both `checkEvidenceGaps` sub-queries, `checkOrphanWarrants` and `checkContradictoryClaims` all only see the *legacy* Turtle-block representation. By contrast `src/main/graph/integrity.ts:31` — the trust gate — correctly uses `rdf:type/rdfs:subClassOf*`. The right idiom exists in the codebase; it just wasn't applied uniformly.

A related, narrower instance: `src/main/types/stock/book.md` and `article.md` carry **no** `externalClass`, while `ontology-thought.ttl` declares `thought:Book` and `thought:Article`. `types:Book` and `thought:Book` are unlinked classes naming one concept.

**Root cause, and why it's Critical rather than a bug:** nothing makes `ontology-thought.ttl` executable. There are **185 non-comment `thought:` literals across 31 files** (concentrated in `src/shared/stock-queries.ts` 37, `src/main/llm/proposal-persistence.ts` 34, `health-checks.ts` 22) plus 42 `THOUGHT('…')` call sites, and **no code path reads a class or predicate name out of the ttl**. The file *is* parsed into the live store on every init and rebuild (`src/main/graph/indexers/rebuild.ts:57-72`, called from `index.ts:141` and `rebuild.ts:178`) and stripped before persist (`index.ts:148-165`) — so it is queryable by user SPARQL and is handed wholesale to the model by `describe_graph_schema` (`src/main/llm/tools/describe-graph-schema.ts:1-14,26`). But no application code branches on it. The ontology is **load-bearing as prompt text and decorative as a contract.** Code and ontology can drift indefinitely, and have.

**Fix:** (a) change both queries to `?claim rdf:type/rdfs:subClassOf* thought:Claim` and `OPTIONAL { ... } UNION` on `dc:title|thought:label`; (b) add `tests/architecture/ontology-terms.test.ts` — parse both `.ttl` files, extract every declared class and predicate local-name, and assert every `THOUGHT('x')` argument and every `thought:X` literal in `src/` resolves to a declared term. That turns the 185 literals into a checked reference.

#### A2 — The renderer data-flow rule is scoped by file location; nine denylisted mutations already live in the gap

CLAUDE.md states the rule as a property of *responsibility* ("every state mutation goes through a store or an App ops handler"). Both enforcement mechanisms implement it as a property of *file path*:

- eslint: `files: ['src/renderer/lib/components/**/*.svelte']` (`eslint.config.mjs:427`), matching `api.<domain>.<method>()` against a 115-name `DATAFLOW_MUTATION_METHODS` denylist (`:25-58`).
- the fail-closed backstop: `tests/renderer/dataflow-rule-coverage.test.ts:81`'s `walk()` collects `.svelte` only.

Everything in `src/renderer/lib/**` that is a `.ts` file outside `stores/` and `lib/app/` is invisible to both. Verified occupants (all on the denylist):

| Site | Call |
|---|---|
| `src/renderer/lib/sources/source-actions.ts:37` | `api.sources.setTitle` |
| `src/renderer/lib/sources/source-actions.ts:61` | `api.sources.delete` |
| `src/renderer/lib/sources/source-actions.ts:95` | `api.sources.addTag` |
| `src/renderer/lib/editor/image-upload.ts:91` | `api.notebase.writeBinary` |
| `src/renderer/lib/tools/output.ts:24` | `api.notebase.createFile` |
| `src/renderer/lib/tools/output.ts:25` | `api.notebase.writeFile` |
| `src/renderer/lib/formatter/settings.ts:55` | `api.formatter.saveSettings` |
| `src/renderer/lib/formatter/settings.ts:68` | `api.formatter.saveSettings` |
| `src/renderer/lib/compute/run-cell-with-trust.ts:80` | `api.compute.runCell` |

(`src/renderer/lib/appearance/zoom.ts:40,46` also appears in the scan but `api.view.*` is an explicitly exempt stateless OS side-effect per CLAUDE.md — correctly out of scope.)

There are also **6 `.ts` files directly under `components/`** that the `**/*.svelte` glob skips.

This is not a hypothetical: `source-actions.ts` is exactly the "extract the handler out of the component" refactor the rule is supposed to survive, and extracting it silently removed the enforcement. The denylist is also a pure denylist — `store-ownership.test.ts` and the coverage test both key off it, so a mutation method named something nobody thought to add (`persistLayout`, `commitDraft`) is invisible to all three checks at once.

**Fix:** widen both scopes to all of `src/renderer/**` except `stores/`, `lib/app/`, and `lib/ipc/client.ts`, then classify the nine sites (most are plausible new small stores: a `sources` mutation belongs in `source-data.svelte.ts`, which already exists).

#### A3 — The LLM write guard is opt-in per function, and seven store-mutating functions already opt out

`src/main/graph/write-guard.ts` is well built — `AsyncLocalStorage`-based depth counters (`:50-51`), `withLLMContext`/`withTrustedContext` using `.run()` for real async isolation (`:81,110`), fatal under vitest and warn-only in prod (`:123,136`). The mechanism is sound. Its **placement** is not.

`checkLLMWriteGuard(...)` is pasted by hand into 14 facade functions: `indexers/note.ts:301,451`, `indexers/source.ts:31,123`, `indexers/excerpt.ts:28,55`, `indexers/tables.ts:132,175,192,224,264,278`, `index.ts:169,191`.

Seven functions that mutate the store do **not** call it:

| Function | Site | Mutation |
|---|---|---|
| `indexAllNotes` | `src/main/graph/indexers/rebuild.ts:160` | swaps `state.store` wholesale (`:174`) |
| `reloadTypeCatalog` | `src/main/graph/indexers/rebuild.ts:50` | `materializeTypeClasses(state.store, …)` (`:54`) |
| `addOntologyToStore` | `src/main/graph/indexers/rebuild.ts:57` | `removeMatches` (`:67`) + `add` (`:70`) |
| `initGraph` | `src/main/graph/index.ts:102` | `$rdf.parse` into store (`:133`) |
| `persistGraph` | `src/main/graph/index.ts:148` | `removeMatches` (`:158`) + `add` (`:162`) |
| `setBaseUri` | `src/main/graph/index.ts:204` | mutates `state.baseUri` |
| `materializeTypeClasses` | `src/main/types/compile.ts:15-44` | writes `state.store` **from outside `graph/`** |

The last one is the sharpest: a module in a different package holds a reference to the graph's internal `IndexedFormula` (obtained via `import { … } from '../graph/state'`, `src/main/types/compile.ts:12`) and writes to it. No guard, no facade, no package boundary.

**The chokepoint already exists.** `instrumentStoreMirror` (`src/main/graph/state.ts:409`) monkey-patches `store.add` (`:430`) and `store.removeMatches` (`:438`) to maintain the N3 mirror. Every single triple mutation in the system passes through those two wrappers. Moving `checkLLMWriteGuard` there makes coverage **total and unforgettable**, eliminates the 14 hand-pasted calls, and closes the `materializeTypeClasses` hole for free.

CLAUDE.md is right that this is a development guardrail, not a security boundary — which is why this is Critical-for-architecture rather than Critical-for-safety. But the guard's entire value proposition is "a new LLM write path that bypasses approval fails CI," and that proposition is currently false for any path that routes through `indexAllNotes` or the type compiler.

---

### Design Flaws

#### D1 — `GraphState` is an open mutable record with zero behavior, mutated by 12+ modules across 3 packages

`src/main/graph/state.ts:221-276`:

```ts
export interface GraphState {
  rootPath; baseUri; store; n3Cache; ontologyStatements; typeCatalog;
  headingsPerNote; aliasMap; aliasesPerNote; indexedNotePaths;
  frontmatterKeysPerNote; neighborhoodCache;
}
```

Twelve public fields, **all directly assignable by anything holding the reference**, and no methods. Calling it a god-object understates it: a god-object at least encapsulates. The eight responsibilities bundled here:

1. rdflib store ownership (`:224`, `:233`)
2. N3 mirror / SPARQL read model (`:231`)
3. Project identity + URI minting base (`:222-223`)
4. Typed-objects catalog (`:237`)
5. Rename-detection heading snapshot (`:239`)
6. Wiki-link alias resolution index (`:246,250,255`)
7. Frontmatter-key autocomplete index (`:262`)
8. Neighborhood BFS LRU memo (`:274`)

Items 5–8 are **derived caches for UI features**, co-located with the RDF store purely because the indexer walk already touches the files. They have no reason to share a lifetime or a lock with the triple store.

Three consequences already visible:

- **Four write paths, not one.** The guarded facade; `index.ts:133/174` direct parse; `rebuild.ts:160` whole-store swap; and `types/compile.ts` from outside the package. This is the structural cause of A3.
- **Invariants held by comment.** `src/main/project-context.ts:76-84` carries a 9-line comment explaining why `indexAllNotes` must complete before `registerAllCsvs` — "if a schema write lands before the reset … those triples go to the discarded store and vanish silently." An encapsulated store would make that a method contract, not a prose warning about array ordering.
- **The N3 mirror's nulling behaviour** (perf review C2/H1) is a direct consequence: `persistGraph`'s ontology strip/re-add is a *serialization* concern reaching into the same mutable `store` that a *mirroring* concern instrumented, with no layer between them.

Cross-reference: the perf review's C2 (`persistGraph` 15.0× query regression) and H1 (mirror resets every ~20 ordinary saves) are the same root cause seen from the other side.

#### D2 — The native menu is a second command surface, outside every discipline that governs IPC

`src/main/menu.ts` is 1,024 lines with **26 imports spanning nearly every subsystem**: `graph/index`, `search/index`, `sources/tables`, `publish`, `embeddings/backfill`, `compute/python-kernel`, `maintenance`, `auto-update`, `cli-install`, `saved-queries`, `recent-projects`, `window-manager`, `shared/tools/registry`.

It does not merely broadcast commands to the renderer. It **executes them**:

```
src/main/menu.ts:361   await runMaintenance({ … })
src/main/menu.ts:377   await tables.registerAllCsvs(ctx)
src/main/menu.ts:379   await tables.registerAllNoteTables(ctx)
src/main/menu.ts:407   await runBackfill(projectContext(rootPath), { … })
src/main/menu.ts:449   await restartPythonKernel(rootPath)
src/main/menu.ts:860   await graph.exportGraph(projectContext(rootPath), result.filePath)
```

Every one of these is an operation the registrar layer would express as a typed `handle()` with `withRootPath`, an entry in `ChannelMap`, a preload method, a client signature, and a registrar test enforced by `ipc-registrar-coverage.test.ts`. Routed through a menu click handler, it gets none of that: it constructs its own `projectContext(rootPath)` from a raw string, has no contract entry, and is covered by no ratchet. `menu.ts` is budgeted at 1,024 lines (`tests/architecture/file-size-budgets.test.ts:66`) — which caps its growth but says nothing about what it's allowed to do.

This is the single largest unaddressed layering violation in the main process, and it's invisible to every existing check because every existing check is about *imports* or *IPC*, and this is neither.

#### D3 — `ThinkingToolDef` is a type that lies in one of the two processes that use it

`src/shared/tools/registry.ts:6-25` documents the deliberate per-process duplication well. The problem is that both copies are typed identically while only one is complete.

`src/renderer/lib/tools/tool-registry.ts:33`:

```ts
buildPrompt: () => '', // never invoked in the renderer
```

`ThinkingToolDef.buildPrompt` is a **required** field (`src/shared/tools/types.ts:148`) documented as "Used for one-shot tools." The renderer satisfies it with a stub that returns the empty string. Any renderer code that calls `getTool(id)?.buildPrompt(ctx)` type-checks perfectly and silently produces an empty prompt. `buildSystemPrompt` and `buildFirstMessage` are optional and simply absent, so the same call shape gives `undefined` there instead — two different failure modes for the same conceptual absence.

The same defect has a second, dormant expression in the same file. `ThinkingToolInfo` (`src/shared/tools/types.ts:181-202`) is documented as the "serializable subset … (no functions)" and its *type* correctly omits all three builders. But the projection that produces it strips only one:

```ts
// src/shared/tools/registry.ts:68-71
function toInfo(tool: ThinkingToolDef): ThinkingToolInfo {
  const { buildPrompt: _, ...info } = tool;
  return info;
}
```

`src/main/skills/compile.ts:43-46` attaches `buildSystemPrompt` and `buildFirstMessage` to every `outputMode: 'openConversation'` skill, and the spread carries both through at runtime. So `getAllToolInfos()` / `getSlashCommands()` return objects that *claim* to be function-free and are not. This is not exploited today — no main-side IPC handler currently sends `toInfo()` output across the bridge (the renderer builds its own registry from `SkillInfo`) — but the first one that does will get a `DataCloneError` from structured clone, on conversational skills only, with a type signature insisting the payload is clean.

Both are the same Interface Segregation violation and have one fix: split `ThinkingToolMeta` (id/name/category/description/parameters/…, the serializable half) from `ThinkingToolDef extends ThinkingToolMeta` (adds the three builders), have the shared registry hold `ThinkingToolMeta`, and let main narrow on retrieval. `SkillInfo` (`src/shared/skills/types.ts:64-97`) already *is* essentially that meta type — `skillInfoToToolDef` exists only to widen it back into a lie, and `toInfo`'s hand-written destructure stops being a thing that can fall behind the type.

#### D4 — `App.svelte` is a dialog-visibility god object, and the documented rationale for the split has expired

App.svelte is down to 14 `api.*` calls (all reads, orchestration, or exempt OS side-effects — clean) and 30 functions. But it holds **46 `$state` declarations**, of which roughly twenty are feature-dialog visibility flags: `showSettings:165`, `showOnboarding:174`, `showThoughtbaseProperties:176`, `showEditSavedViews:403`, `typeEditorState:407`, `attachEvidenceExcerptId:418`, `exportDialogGroup:464`, `publishDialogOpen:465`, `showAbout:466`, `showShortcuts:467`, `showGotoLine:562`, `showGotoNote:563`, `showCommandPalette:564`, `mergePickerSource:645`, `showEditSavedQueries:646`, `saveQueryRequest:648`, `findInNotesMode:654`, `safeDeleteDialogState:707`, … plus ~45 dialog component imports in the template.

`src/renderer/lib/stores/dialogs.svelte.ts:10-12` states the split: *"Feature-specific dialogs (mine-references, resolve-stub, safe-delete, export, command palette) stay in App.svelte — they close over feature handlers and aren't general primitives."* That was written at #670. It has since been overtaken by the ops-bag pattern (#1922, #2049) that CLAUDE.md now documents: a dialog that needs feature handlers can receive a typed ops object, exactly as `Sidebar.svelte:53-86` does. The original justification — "they close over feature handlers" — is no longer a reason to keep state in the composition root.

Compounding it, App.svelte holds **four parallel `Record<string, Component|undefined>` instance maps** (`editorComponents:262`, `queryPanelComponents:263`, `neighborhoodGraphComponents:264`, `previewComponents:265`) keyed by group id. The `Tab` union has seven members (`src/renderer/lib/editor/tab-types.ts:101`: `NoteTab | QueryTab | SourceTab | PdfTab | GraphTab | TypeViewTab | UnsupportedTab`), so adding an eighth view kind means a fifth parallel map plus another `{#if}` arm in a ~1,060-line template — rather than one entry in a view registry.

App.svelte is budgeted at 2,096 lines (`file-size-budgets.test.ts:57`). CLAUDE.md's own memory of the #1084 breakup records "App 2279→1821"; it has regrown ~275 lines since. The budget is holding the line but the line is in the wrong place.

#### D5 — Two package-level dependency cycles that the file-level cycle test cannot see

`tests/architecture/no-cycles.test.ts` passes, and its design is excellent (real resolution via `dependency-cruiser`, type-only imports followed, self-recursion excluded by *rule* not allowlist). But it checks **module** cycles. Two **package** cycles exist underneath a clean module graph:

```
graph/indexers/rebuild.ts:29,30  ──►  types/loader.ts, types/compile.ts
types/compile.ts:12              ──►  graph/state.ts                      (graph ↔ types)

graph/indexers/rebuild.ts:17,18  ──►  notebase/{indexable-files,ignored-dirs}
graph/health-checks.ts:10        ──►  notebase/asset-references
notebase/{write-pipeline, rename-anchor, index-fanout, rename-source-excerpt,
          watch-handlers, rename, merge}  ──►  graph/*                    (graph ↔ notebase)
```

Neither is a file cycle, so the test is correct to pass. Both are real coupling: you cannot reason about `graph/` without `types/` and `notebase/`, and vice versa. The `graph → notebase` edges are three leaf utilities and are cheap to break (move `isIndexable`/`isIgnoredEntry` to `shared/`, inject `findOrphanedInlineAssets` the way `health-checks.ts` already injects `loadSettings`). The `graph ↔ types` edge is the harder one and is the same coupling as A3's `materializeTypeClasses` hole.

Four further encapsulation leaks past `graph/index.ts` (the intended facade):

- `src/main/llm/attach-evidence.ts:13` — `import { getState, excerptUri } from '../graph/state'`
- `src/main/types/compile.ts:12` — namespaces from `graph/state`
- `src/main/llm/approval.ts:14`, `src/main/history/policy.ts` — `DAY_MS` from `graph/queries`
- `src/main/publish/vega-render.ts` — `queryGraph` from `graph/queries`

#### D6 — Two IPC registrars carry substantial LLM business logic

`src/main/ipc/register-conversation.ts` is 453 lines, of which **214 precede the first `handle()` call**: `DEFAULT_CONVERSATION_SYSTEM_PROMPT` (`:16`), `buildConversationSystemPrompt` (`:63`), `stripCodeExecutionTurns` (`:113`), `buildStreamCallbacks` (`:123`), `runCompletionWithContainerRecovery` (`:178`), plus `compactConversation` (`:395`) after. Prompt assembly, stream-callback wiring and an API-error recovery *strategy* are not IPC glue; they belong in `src/main/llm/`.

`src/main/ipc/register-conversation-drafts.ts` is 608 lines (the largest registrar, budgeted at exactly 608 at `file-size-budgets.test.ts:81`) with a 130-line preamble including `buildClaimNoteContent` (`:51`) — the function that emits claim-note frontmatter, and therefore the function whose #2036 change orphaned the inspections in A1. Note-content authoring living in a registrar is precisely why that change wasn't noticed by anyone looking at the graph layer.

By contrast `register-sources.ts` (386 lines, 40 handlers) and `register-notebase.ts` (411 lines, 36 handlers) are large by *handler count* with thin delegation — the right shape.

#### D7 — Project init is a hardcoded sequence; disposal is registry-driven

`src/main/project-store.ts:66-73` gives every subsystem automatic teardown via `disposeAllProjectStores`. `src/main/project-context.ts:61-119` gives none of them automatic setup: `acquireProject` hardcodes an eight-step ordered sequence (graph → tables → vectors → [indexAllNotes ∥ search] → registerAllCsvs → registerAllNoteTables → reindexConversations → healthChecks → registerProject).

The asymmetry is *justified* (`project-store.ts:12-18` explains that init order is a real cross-store dependency a generic store must not own) and I agree with the reasoning. The cost is that **adding a new per-project subsystem gets free disposal and requires manual, ordered init-wiring in a file that imports 15 subsystems** — and the ordering contract lives in a comment (`project-context.ts:76-84`) rather than in any declared dependency. A declared `dependsOn: [graphStore]` on `createProjectStore` with a topological sort would keep the ordering guarantee while removing the hand-wiring.

#### D8 — `health-checks.ts` hand-rolls four per-project state maps; two of them leak

`createProjectStore` (#1085) exists to eliminate exactly this. `src/main/graph/health-checks.ts` keeps four module-level maps keyed by `rootPath` string:

| Map | Site | Torn down? |
|---|---|---|
| `autoByProject` | `:760` | yes — `disarmAutoChecks:789` ← `project-context.ts:143` |
| `timersByProject` | `:799` | yes — `stopPeriodicChecks:825` ← `project-context.ts:142` |
| `runningProjects` | `:65` | only per-run (`:133`); never on project close |
| `lastResultsByProject` | `:59` | **never** — no `.delete` call exists |

Because they never registered with the project-store registry, `disposeAllProjectStores` cannot reach them. Closing a thoughtbase leaves its full inspection result list resident, and reopening it shows the stale list until the first re-run completes (`:102` returns the cached results while a run is in flight). Small in bytes; it is the precise failure mode #1085 was built to make impossible.

#### D9 — `STANDARD_PREFIXES` exists twice, hand-synced, with no parity test

- `src/main/graph/state.ts:169-184` — the real one; drives `injectSparqlPrefixes` (`src/main/graph/queries/sparql.ts:18-31`) and `resolveStandardCurie`.
- `src/shared/sparql-completions.ts:47-64` — a second array, whose own doc-comment says *"Standard prefixes the main-process `injectSparqlPrefixes` auto-adds,"* consumed by `src/renderer/lib/editor/sparql-autocomplete.ts:8,17`.

They match today (15 entries, same order). No test asserts it. The failure mode is quiet and confusing: the editor autocompletes a prefix the query engine doesn't inject, or the reverse. The shared copy is already in `src/shared` — the main one could import it instead of restating it, since `state.ts:169` has no reason to own the list.

#### D10 — No system-level architecture document

`docs/architecture/` holds two files totalling 327 lines (`compute-sandbox.md`, `rdf-and-dom-libraries.md`). The architectural knowledge for a 136k-LOC, 26-subsystem application lives in CLAUDE.md (498 lines, heavily weighted toward conventions), module header comments, and — genuinely, unusually — test file headers, several of which are the best architecture prose in the repo (`no-cycles.test.ts:1-25`, `store-state-ownership.test.ts:1-23`, `project-store.ts:1-18`).

Keeping documentation adjacent to enforcement is a defensible and largely successful strategy. What's missing is the layer above it: there is no single place that says what the 26 main subsystems are, which own per-project state, what the init ordering contract is, or how the `types:`/`thought:` split works. A1 and D2 are both failures of *nobody holding the whole picture*, which is what such a document is for.

---

### Pattern Inconsistencies

#### P1 — `shell:revealFile` is registered in both `ChannelMap` and `EventMap`, and the ⌘⇧R menu item is dead

`src/shared/ipc-contract.ts:216` types it as an invoke channel `(relativePath?: string) => void`; `:745` types the same string as an event `() => void`. `src/main/ipc/register-shell.ts:30` registers the invoke handler. `src/main/menu.ts:344` — the "Reveal in Finder" item, accelerator `CmdOrCtrl+Shift+R` — calls `send(Channels.SHELL_REVEAL_FILE)`, a one-way broadcast.

**No preload subscriber exists.** There are 100 `subscribe(...)` calls in `preload.ts`; this channel is not one of them. `src/renderer/lib/app/ipc-wiring.ts:318` wires the sibling `onOpenInDefault`; there is no `onRevealFile` counterpart. The renderer only ever calls `api.shell.revealFile(path)` as an *invoke*, from its own context menus and from `App.svelte:1404`.

So ⌘⇧R does nothing. The dual registration is what let it type-check: one channel name legitimately satisfying two different maps removes the only signal that a sender has no receiver.

#### P2 — Two payloaded channels are typed `() => void` in the contract

`src/main/ipc/register-app.ts:40` and `:44` are the only two raw `ipcMain.on` registrations in `src/`. They carry real payloads (`ThemeMode`, `MenuEditorState`). `EventMap` derives both from `MENU_COMMANDS` as zero-arg (`ipc-contract.ts:683-684`), and both sides hand-declare the payload independently (`preload.ts:574-575` uses raw `ipcRenderer.send`; `client.ts:947-948` hand-types it). If `MenuEditorState` changes shape, nothing fails `tsc`. These are the only two of 362 channels not covered by the typed wrappers — a two-site exception in an otherwise complete system.

#### P3 — All 100 event-subscription signatures are excluded from the client↔preload check

`src/renderer/lib/ipc/client.ts:1332`'s `OmitEvents<T>` strips every `on*` method from both sides before comparing. The exclusion is documented at length (`:1323-1331`) and its justification is real: the ~10 `on*Draft` callbacks are deliberately typed wider on the send side. But the carve-out is 10× larger than its justification — `client.ts` and `preload.ts` each have exactly 100 `on*` members, and a payload-type drift on any of the other 90 is invisible to `tsc`.

A second, smaller hole in the same assertion: `InvokeOnly<PreloadApi> extends InvokeOnly<IdeApi>` uses method-shorthand declarations on both sides, so TypeScript checks parameters **bivariantly**. Return-type drift is caught; parameter-type drift on an invoke method may not be.

#### P4 — Coverage floors cover 11 of 26 main subsystems, and the largest un-floored one is the newest

CLAUDE.md's LLM/Graph PR checklist asks: *"is its module covered by a `vitest.config.mts` threshold?"* Fifteen main subsystems have no per-area floor and sit only under the 45%-lines global backstop:

| Subsystem | LOC | Floor |
|---|---|---|
| `src/main/mcp-client` | **2,977** | none |
| `src/main/skills` | 978 | none |
| `src/main/clipper` | 604 | none |
| `src/main/types` | 580 | none |
| `src/main/search` | 352 | none |
| `src/main/mcp-servers` | 299 | none |
| `src/main/substrate` | 272 | none |
| …plus config, formatter, bibliography, help-docs, tools, citations, images, menu, youtube | | none |

`mcp-client` is a **hand-rolled MCP protocol implementation** — stdio + two HTTP transports + SSE parsing + a full OAuth 2.1 flow with dynamic client registration, token store and a local callback server — with no `@modelcontextprotocol/sdk` dependency (checked: not in `package.json`'s 44 deps). In fairness it is *well tested today* (4,494 lines of tests under `tests/main/mcp-client/` against 2,977 of source, 11 OAuth test files). The gap is the **ratchet**, not the tests: nothing stops that ratio degrading, on the subsystem where a coverage regression has security consequences.

#### P5 — 105 Svelte components in one flat directory

`src/renderer/lib/components/` holds 38,229 LOC. Only four subdirectories exist (`conversations` 3 files, `right-sidebar` 16, `ui` 6, `icons`), leaving **105 `.svelte` files flat at the top level**. `file-size-budgets.test.ts` governs individual file size; nothing governs directory cohesion. The obvious groupings are already visible in the names (`*Dialog.svelte` ×32, sources/*, query/*, type/*) and would roughly halve the flat count.

#### P6 — Four latent holes in the layer-boundary lint rules (no current violations)

The four eslint blocks at `eslint.config.mjs:276-344` are correct for everything they cover, and **nothing violates them today** — I resolved every relative import in `src/` to its real target and bucketed by layer: `renderer → main` 0, `main → renderer` 0, `main → preload` 0, `shared → {main,renderer,preload}` 0. The holes are all in what the globs don't say:

1. **Shared-purity bans `node:*` but not bare builtins or `electron`.** `eslint.config.mjs:281-283` is `group: ['**/main/**', '**/renderer/**', '**/preload/**', 'node:*']`. An `import fs from 'fs'` (unprefixed) or `import { app } from 'electron'` in `src/shared` passes lint. The only `electron` hit in `src/shared` today is a *comment* at `src/shared/inspections.ts:162` warning about exactly this ("Learned the hard way: an `import { app } from 'electron'` reachable from a…") — so the team has already been bitten by the precise case the rule doesn't cover.
2. **There is no eslint block scoped to `src/preload/**` at all.** A `preload → main` import is entirely unenforced (currently 0 — preload's 9 imports are `electron`, `./typed-invoke`, and 7 type-only `../shared/*`).
3. **The renderer ban list is only `**/main/**`** (`eslint.config.mjs:303`). `electron` and node builtins in renderer code are unenforced by lint; the sandbox catches them at runtime rather than at review time.
4. **Nothing enforces that `src/renderer/lib/ipc/client.ts:11` stays type-only.** It is the single renderer→preload edge, deliberately `import type { PreloadApi }` (#1920). Flipping it to a value import would pull `electron` into the renderer bundle, and only the spelling prevents it.

Six strings added to group (1), one new block for (2)–(3), and an `import/consistent-type-specifier-style`-style guard or a one-line ratchet for (4).

#### P7 — One contract key has no `Channels.*` constant

`'menu:openRecentProject'` (`src/shared/ipc-contract.ts:751`) is sent as a bare string literal at `src/main/menu.ts:190` and subscribed as a bare string literal at `src/preload/preload.ts:603`. Still type-safe against `EventMap`, but it sidesteps the convention all 361 other channels follow — and `tests/shared/ipc-contract-ratchet.test.ts:140` ("every `ChannelMap` key is a real channel") checks `ChannelMap` only, so this class of drift is unguarded.

#### P8 — `describe_graph_schema` tells the model about `thought:` and never mentions `types:`

`src/main/llm/tools/describe-graph-schema.ts:1-14` inlines both `.ttl` files verbatim — 1,380 lines — and `:26` describes the result to the model as "authoritative." Neither file contains the string `types:`. The model therefore receives an authoritative schema that omits **the namespace every typed note in the thoughtbase actually asserts** (`a types:Claim`, `types:expectsProperty`, `types:<propName>`), while the write-side tools (`list-object-types.ts:26-31`, `llm/object-types.ts:44-80`, `llm/infer-types.ts:38-50`) all correctly read the live catalog. Read and write disagree about what the graph contains.

#### P9 — The stock-skill catalog and the docs site can drift silently

Adding a stock skill is a genuinely excellent one-file change (`src/main/skills/stock/<slug>.md`, picked up by `import.meta.glob` at `src/main/skills/loader.ts:29-33`; menu placement needs no config because `src/shared/skills/menu-config.ts:18-21` makes "enabled, in its declared menu" the implicit default). The historical commits confirm the two-file convention: the `.md` plus a ~25-line test.

What has no enforcement is the *inventory*. `tests/main/skills-analysis.test.ts:29` asserts `cat.errors` is empty — it catches a malformed skill but never enumerates or counts them, so an additive change passes silently. And `website/docs/_content/thinking-tools-{analysis,learning,research,…}.html` enumerate skill names **by hand** with no parity test against the catalog; `tests/scripts/help-docs-corpus-staleness.test.ts` only fires if you happen to edit those HTML files. With 56 stock skills and a one-file add path, the docs will fall behind and nothing will say so. A ~20-line test asserting `loadSkillCatalog()` names ⊆ the names appearing in the four menu HTML files would close it.

#### P10 — `madge` gives a false pass on this repo; only the committed test is trustworthy

Worth recording because the obvious reflex when checking cycles is to reach for `madge`. Running `npx madge --circular --extensions ts,svelte src/` reports "No circular dependency found" — but it enumerates all 131 `.svelte` files as nodes and extracts **zero imports from every one of them**. Only the 719 `.ts` files are actually analyzed, so the entire component layer is silently skipped. `tests/architecture/no-cycles.test.ts` is correct to use `dependency-cruiser` with `enhancedResolveOptions.extensions` including `.svelte` (`:42`) and to assert `modules.some(m => m.source.endsWith('.svelte'))` as a vacuity floor (`:77`) — that assertion is exactly what distinguishes it from the madge result. (Separately: the `dependency-cruiser` **CLI binary** refuses to run on Node 25.x; the test works because it imports the library API directly. Both facts belong in a comment next to the test so nobody "simplifies" it to a CLI invocation.)

#### P11 — Documentation drift in CLAUDE.md and two test headers

- CLAUDE.md cites `readJsonFileOr(absPath, fallback)` as living in `ipc/helpers.ts` — twice. It is `src/main/ipc/read-json.ts:18`. Both `helpers.ts` and `read-json.ts` exist, so the wrong path is plausible; the tests cite it correctly (`pattern-ratchets.test.ts:357`, `config-loader-usage.test.ts:95`).
- `tests/architecture/ui-dialog-adoption.test.ts:8,16` says "14 holdouts"; `UNMIGRATED_BASELINE` (`:36-52`) holds 16.
- `tests/architecture/store-ownership.test.ts:15` claims "26 domains out of 27"; the live floor asserts only `> 15` (`:114`).
- CLAUDE.md lists `GIT_COMMIT.success` (vestigial hardcoded `true`) among items "ratcheted by `pattern-ratchets.test.ts`." It is ratcheted by nothing.

---

## SOLID Principles Assessment

SOLID is class-shaped. This codebase is three things, none of them class-oriented: **functional modules with module-level state** (main), **reactive singleton stores + declarative components** (renderer), and **a type-level contract** (shared). I score the three principles that translate cleanly — SRP, ISP, DIP — and explain why LSP and OCP translate only partially rather than inventing numbers for them.

### Single Responsibility — **2.5 / 5**

The main process is *better* than this score at the package level and much worse at four specific files.

**Exemplary:** `src/main/project-store.ts` (72 lines) owns one thing — a per-project state slot — and documents exactly what it refuses to own (init order, `:12-18`). `src/main/graph/graph-events.ts` (45 lines) and `inspection-events.ts` (35 lines) each own one pub/sub channel and exist precisely so `graph/` need not know about Electron. `src/main/ipc/typed-ipc.ts` (11 lines) owns one thing: type-binding `ipcMain.handle` to `ChannelMap`.

**Violating:**
- `GraphState` (`graph/state.ts:221-276`) — eight responsibilities in one open record (D1).
- `menu.ts` (1,024 lines, 26 imports) — menu construction *and* direct execution of six subsystem operations (D2).
- `App.svelte` (2,096 lines) — composition root *and* owner of ~20 feature dialogs' visibility *and* four component-instance registries (D4).
- `register-conversation.ts` — IPC registration *and* prompt assembly *and* stream wiring *and* API-error recovery (D6).

Score reflects that the four worst offenders are also the four most-edited files in the repo.

### Open/Closed — **not scored cleanly; split verdict**

Extension points in this codebase are exceptional in one place and absent in another, and averaging them would be dishonest.

**Open:** adding a stock skill is a **one-file change** — drop a `.md` into `src/main/skills/stock/`, picked up by `import.meta.glob` (`src/main/skills/loader.ts:29`). 56 skills now exist under that seam. Adding a user object type is likewise one `.md` in `<root>/.minerva/types/`. Adding an LLM provider has a real seam: `src/main/llm/provider/{types,anthropic,openai,google}.ts` (180/274/290/272 lines) — the Anthropic SDK is *not* smeared through the codebase; it costs one new file plus entries in four centralized tables (`shared/tools/providers.ts`, `models.ts`, `model-tiers.ts`, and the two switches in `provider/index.ts:55-85,112-124`), with settings storage and the renderer settings UI both iterating `PROVIDER_IDS` generically so neither needs an edit. Adding a **proposal payload kind** is the best of the three: one variant on the `ProposalPayload` union (`src/main/llm/proposal-types.ts:39+`) plus one `register({ kind, apply, rollback })` block in `apply-dispatch.ts` — persistence is generic, and `ProposalsPanel.svelte` degrades gracefully to `p.kind` (`:158`) and a JSON dump (`:213`) for a kind it doesn't recognise, so the review UI is optional polish rather than a required edit.

**Closed:** adding an IPC channel requires edits to five files (`channels.ts`, `ipc-contract.ts`, a `register-*.ts`, `preload.ts`, `client.ts`) plus a snapshot regeneration (`tests/preload/preload-bridge.test.ts -u`). That is shotgun surgery — but it is *type-enforced* shotgun surgery: miss any step and `tsc` or a test fails, and each file genuinely encodes a different concern. I'd call it acceptable. Adding an editor **view kind** is not: `Tab` has seven members (`tab-types.ts:101`) and a new one needs a fifth parallel instance map plus another template arm in App.svelte (D4). Adding a **per-project subsystem** needs manual ordered wiring in `acquireProject` (D7).

### Liskov Substitution — **not applicable in the OOP sense; one real instance of the underlying defect**

There is essentially no inheritance. The principle's substance — "a subtype must honour its supertype's contract" — does appear once, and it's D3: `ThinkingToolDef` in the renderer satisfies the type while violating the contract (`buildPrompt: () => ''`, `tool-registry.ts:33`). A caller holding a `ThinkingToolDef` cannot rely on its documented behaviour without knowing which process it's in.

### Interface Segregation — **3 / 5**

**Good:** `SkillInfo` vs the main-side compiled def is a deliberate DTO seam — the renderer explicitly never receives prompt bodies. `src/renderer/lib/ipc/client.ts` splits `window.api` into 59 focused interfaces rather than one. `ProjectContext` is a one-field branded type, the narrowest possible.

**Bad:** `ThinkingToolDef`'s forced `buildPrompt` (D3) is the canonical ISP violation — the renderer is compelled to depend on a method it cannot implement. `GraphState` (D1) is the same failure at record granularity: `neighborhood.ts` needs `store` + `neighborhoodCache` and is handed URI minting, the type catalog, the alias index and the heading snapshots.

### Dependency Inversion — **4 / 5**

The strongest principle here, and deliberately so.

- `src/main/graph/**` imports `electron` **zero times** and `src/main/ipc/**` **zero times**. The inversion runs through `graph-events.ts` / `inspection-events.ts`, consumed at `src/main/ipc.ts:36-52`. `health-checks.ts` takes `{ loadSettings }` as an injected dependency (`project-context.ts:115,120`) precisely because the real settings loader reaches Electron.
- `src/main/project-store.ts` inverts teardown: the orchestrator iterates a registry instead of naming subsystems.
- The eslint block at `eslint.config.mjs:386-397` freezes the direction with the right rationale: *"The graph is the substrate; the LLM is one of its clients."*

The missing point: `src/main/types/compile.ts:12` reaches *into* `graph/state` and writes the store (A3/D5), and four other modules bypass `graph/index.ts` to reach `graph/state` or `graph/queries` (D5). The facade exists and four callers ignore it.

---

## Improvement Plan

### High Priority (Structural Fixes)

**H1 — Fix the orphaned inspection queries and make the ontology executable.** (A1)
Change `health-checks.ts:141-142` and `:222-224` to `rdf:type/rdfs:subClassOf*` + accept `dc:title` alongside `thought:label`; audit `:252,315,316` and `register-graph.ts:110` for the same shape. Then add `tests/architecture/ontology-terms.test.ts`: parse `src/shared/ontology.ttl` and `ontology-thought.ttl`, collect declared class/predicate local-names, and assert every `THOUGHT('x')` argument and `thought:X` literal in `src/` resolves. Add `externalClass:` to `book.md`/`article.md` or delete the duplicate `thought:` classes.

**H2 — Move the LLM write guard to the store chokepoint.** (A3)
Put `checkLLMWriteGuard` inside the `store.add` / `store.removeMatches` wrappers in `instrumentStoreMirror` (`src/main/graph/state.ts:430,438`), remove the 14 hand-pasted facade calls, and re-run the trust-integrity suite. This closes `indexAllNotes`, `reloadTypeCatalog`, `persistGraph`, `initGraph` and the out-of-package `materializeTypeClasses` in one change. Expect to need a `withTrustedContext` wrap around `initGraph`/`persistGraph`, which is the correct outcome — those are trusted bulk paths and should say so.

**H3 — Rescope the data-flow rule from file location to responsibility.** (A2)
Widen `eslint.config.mjs:427` to `src/renderer/**/*.{ts,svelte}` with `ignores: ['src/renderer/lib/stores/**', 'src/renderer/lib/app/**', 'src/renderer/lib/ipc/client.ts']`, and widen `dataflow-rule-coverage.test.ts:81`'s `walk()` to `.ts` as well. Then classify the nine occupants — most fold into existing stores (`source-data.svelte.ts` already owns the `sources` domain).

**H4 — Bring `menu.ts` under the IPC discipline.** (D2)
Every `await`-ing click handler in `menu.ts:361-449,860` should become a typed `handle()` in a registrar (or a call to an existing one), with the menu item invoking it. This removes six unreviewed command paths, gets them contract entries and registrar-coverage enforcement, and takes ~200 lines out of a 1,024-line file.

### Medium Priority (Design Improvements)

**M1 — Decompose `GraphState`.** (D1) Split the four derived UI caches (`headingsPerNote`, `aliasMap`/`aliasesPerNote`/`indexedNotePaths`, `frontmatterKeysPerNote`, `neighborhoodCache`) into their own `createProjectStore` slots, leaving `GraphState` as `{ rootPath, baseUri, store, n3Cache, ontologyStatements, typeCatalog }`. Then make `store` non-public (expose `addTriple`/`removeMatching`/`query` methods) so the four bypass callers in D5 have to come through the facade. This is also the structural precondition for the perf review's C2 fix.

**M2 — Split `ThinkingToolDef` into meta + builders.** (D3) `ThinkingToolMeta` in `shared/tools/types.ts`, `ThinkingToolDef extends ThinkingToolMeta` with the three builder functions, registry holds meta, main narrows on retrieval. Deletes the `buildPrompt: () => ''` lie and probably `skillInfoToToolDef` with it.

**M3 — Extract the feature dialogs out of `App.svelte`.** (D4) Migrate the ~20 `show*` flags into a `feature-dialogs.svelte.ts` store (or per-feature stores), passing handlers via the ops-bag pattern CLAUDE.md already documents. Replace the four parallel component-instance maps with one `Record<string, TabViewHandle>` keyed by the `Tab` union's `type`.

**M4 — Extract LLM logic out of the two conversation registrars.** (D6) `buildConversationSystemPrompt`, `stripCodeExecutionTurns`, `buildStreamCallbacks`, `runCompletionWithContainerRecovery` → `src/main/llm/`; `buildClaimNoteContent` → `src/main/llm/` or a `shared/` note-authoring module next to the claim type definition.

**M5 — Break the `graph ↔ notebase` package cycle.** (D5) Move `isIndexable` and `isIgnoredEntry` to `src/shared/`, and inject `findOrphanedInlineAssets` into `health-checks.ts` the way `loadSettings` already is. Three edges, all cheap.

**M6 — Add coverage floors for the un-floored subsystems.** (P4) Start with `src/main/mcp-client/**` (measure current, set 3-5 points below, as the existing floors document), then `skills`, `types`, `clipper`.

**M7 — Register health-check state with `createProjectStore`.** (D8) Converts `lastResultsByProject` and `runningProjects` into disposal-managed slots and removes the leak.

### Low Priority (Consistency)

- **L1** — Delete or wire the dead ⌘⇧R menu item; remove `shell:revealFile` from `EventMap` so one channel name serves one role (P1).
- **L2** — Give `menu:reportTheme` / `menu:reportEditorState` real `EventMap` signatures instead of the derived `() => void`, and a typed `send<K>` wrapper in preload (P2).
- **L3** — Narrow `OmitEvents` to just the `on*Draft` family so the other 90 event signatures get checked; consider `(x: T) => void` property syntax on `IdeApi` to get contravariant param checking (P3).
- **L4** — Close the four layer-lint holes: bare builtins + `electron` in the shared-purity group, a new `src/preload/**` block, `electron`/builtins added to the renderer group, and a guard keeping `client.ts:11` type-only (P6).
- **L5** — Add a `Channels.MENU_OPEN_RECENT_PROJECT` constant; extend `ipc-contract-ratchet.test.ts` to cover `EventMap` keys (P7).
- **L6** — Have `graph/state.ts` import `STANDARD_PREFIXES` from `shared/sparql-completions.ts` instead of restating it (D9).
- **L7** — Include the live type catalog in `describe_graph_schema`'s output (P8).
- **L8** — Fix the four documentation-drift items (P11); add the skill-catalog ↔ docs-site parity test and a note on the madge trap next to `no-cycles.test.ts` (P9, P10).
- **L9** — Group `components/`'s 105 flat files into subdirectories (P5).
- **L10** — Write `docs/architecture/overview.md`: the five layers, the 26 main subsystems, which own per-project state, the init ordering contract, and the `types:`/`thought:` split (D10).

---

## Migration Strategy

### Phase 1: Foundation

Make the invariants match their enforcement before changing any structure. Nothing here moves a file.

1. **H1's test half first** — land `ontology-terms.test.ts` and watch it fail; the failure list *is* the audit of how far the #2036 migration actually got. Then fix the queries.
2. **H3** — rescope the eslint glob and the coverage test. Land the scope change and the nine call-site fixes in one PR so CI is never red.
3. **L4, L5, L1, L2** — the four one-to-ten-line contract/lint corrections. Each is independently revertible.
4. **M6** — coverage floors for `mcp-client`, `skills`, `types`, `clipper`. Pure ratchet addition; measure, set below, commit.
5. **D7's declaration only** — add an optional `dependsOn` field to `createProjectStore` and populate it for the five existing users *without* changing `acquireProject` yet. Makes the ordering contract machine-readable before anything relies on it.

Phase 1 is where the leverage is: it closes every "the rule doesn't cover what it claims" gap without touching the shape of the code.

### Phase 2: Core Refactoring

The structural work, ordered so each step de-risks the next.

1. **H2 (guard → chokepoint).** Do this *before* M1. Moving the guard to `store.add`/`removeMatches` means any subsequent restructuring of `GraphState` is protected by a total guard rather than 14 opt-ins that the refactor would have to preserve by hand.
2. **M5 (break `graph ↔ notebase`)** — three edges, mechanical, and it shrinks the surface M1 has to reason about.
3. **M1 (decompose `GraphState`)** — split the four derived caches out, then make `store` private behind methods. The four bypass callers in D5 are fixed as a consequence. This is the largest single change in the plan and should be its own multi-PR effort; the perf review's C2/H1 work should be sequenced *after* it or merged into it, since both touch `persistGraph` and the mirror.
4. **H4 (menu → IPC)** — six handlers, independent of the graph work, parallelizable.
5. **M4 (LLM logic out of registrars)** — independent, parallelizable.
6. **M2 (`ThinkingToolDef` split)** — independent, touches ~6 files.

### Phase 3: Optimization

Consistency and ergonomics, once the boundaries are right.

1. **M3 (App.svelte dialogs)** — do it after M2 and H4, when the ops-bag surface is stable. Target: App.svelte under 1,400 lines, budget lowered in the same PR.
2. **D7 completion** — topological init from the `dependsOn` declarations added in Phase 1; delete the hardcoded sequence and the ordering comment.
3. **P5 (component directory grouping)** — large diff, zero risk, best done when no other renderer work is in flight.
4. **D10 / L10 (architecture overview doc)** — write it last, when it describes the post-refactor state rather than a moving target.
5. **L3, L6, L7, L8, L9** — cleanup.

---

## Impact Analysis

**What A1 costs today.** Two inspection checks report nothing for the claims the app creates, and three more are in the same family. Users doing the exact workflow the product is built around — mining claims from sources with `extract-key-claims`, then asking "which claims lack support?" — get an empty panel and read it as "no problems." This is worse than a broken feature: it is a *silent wrong answer* from a tool whose purpose is finding gaps in reasoning. It is also the cheapest fix in this report.

**What A2 costs today.** Nine mutation call sites outside the store layer. None is individually dangerous; the cost is that the rule's guarantee is false, and its falseness is *invisible* — a reviewer who trusts "lint enforces this" will approve the tenth. The pattern that created them (extract a handler out of a component into a sibling `.ts`) is a refactor the codebase actively encourages, so the count will keep growing.

**What A3 costs today.** Nothing observable — I found no actual approval bypass. The cost is that the guard's claim ("an LLM write that skips approval fails CI") is conditional on the write not going through `indexAllNotes`, `reloadTypeCatalog`, or the type compiler, and nobody reading CLAUDE.md would know that. Given the Trust Principle is described there as "the most important design decision in the system," a conditional guard is a governance problem even with a clean record.

**What D1/D2 cost.** These are velocity taxes, not bugs. `GraphState` is why the perf review's two worst findings (C2, H1) exist and why fixing them is risky: a serialization concern and a mirroring concern share mutable state with no layer between. `menu.ts` is why six subsystem operations have no contract, no test requirement and no error-handling convention. At 715 commits/90 days, both compound fast.

**Risk of the plan itself.** Phase 1 is near-zero risk — additive tests, lint scope, and nine mechanical call-site moves. Phase 2's M1 is the real risk: `GraphState` is touched by 12+ modules and the perf-sensitive paths run through it. Mitigations that already exist: `tests/main/graph/` has a shared temp-project fixture enforced by its own ratchet, `graph/**` has a coverage floor, `no-cycles.test.ts` will catch any restructuring that introduces a cycle, and `pnpm bench` exists — though the perf review found its baselines stale (C4), so **re-blessing the bench baselines is a prerequisite for M1**, not an optional extra.

**What not to do.** Don't add a `GraphState` "manager class" that wraps the same 12 fields — that renames the problem. Don't try to make `ontology-thought.ttl` runtime-authoritative (a SHACL/reasoner layer) in response to A1; the fix is a *test* that checks the literals against the file, which costs a day instead of a quarter and catches the same drift. And don't merge the `types:`/`thought:` systems — the `externalClass` bridge (`types/compile.ts:32-43`) is a genuinely good design that gets user-extensibility and a fixed epistemic vocabulary at once. It just needs the code to use the bridge consistently.

---

## Recommendations

1. **Land `ontology-terms.test.ts` this week.** It is the highest value-per-hour item in this report: it fixes a user-visible silent failure, and its first run is a free audit of every remaining `thought:` literal in the codebase. Everything else can wait; this one is actively producing wrong answers.

2. **Adopt one rule for ratchet scope: enforcement scope must equal invariant scope, or the difference must be written down.** All three Critical findings are the same mistake in different clothes — an invariant stated over "mutations," "LLM writes," or "the ontology," enforced over "`.svelte` files in `components/`," "these 14 functions," or nothing. The existing tests are unusually honest about their *known* blind spots (`store-ownership.test.ts:20-31` names two, and `store-state-ownership.test.ts` was written to close one of them). Extend that habit: when a check can't cover the whole invariant, say so in the header — that's how #2051 came to exist.

3. **Move guards to chokepoints wherever one exists.** H2 is the instance, but the principle generalizes: `instrumentStoreMirror` already proved that this codebase can wrap `store.add` for cross-cutting concerns. Every "remember to call X in each new Y" convention is a future gap.

4. **Give `menu.ts` the same treatment `App.svelte` got.** #1084 broke App.svelte's script into ops factories and the result is visibly healthier (14 `api.*` calls, all legitimate). `menu.ts` is at the same stage App.svelte was: 1,024 lines, 26 imports, executing business operations from event handlers. The refactor pattern is already proven in this repo.

5. **Keep doing the ratchet thing, and write one document above it.** The 16 architecture tests are the reason this codebase is legible at 136k lines and six months old, and they are better than the prose they enforce — several test headers are the clearest architecture writing in the repo. The one thing they structurally can't do is describe the whole. A 2-3 page `docs/architecture/overview.md` naming the layers, the 26 subsystems, the per-project-state owners and the `types:`/`thought:` split would have made A1 and D2 visible to a reader in an afternoon.

6. **Two things to explicitly *not* fix.** The five-file IPC channel addition is shotgun surgery that earns its keep — every file encodes a distinct concern and `tsc` catches every omission; leave it. And the per-process duplication of `shared/tools/registry.ts` is correct and well-documented; only the `ThinkingToolDef` type needs splitting (M2), not the registry.

---

## Estimated Effort

Days are engineer-days including tests and review. Given this repo's demonstrated velocity (~8 commits/day over 90 days), these are small multiples of a normal working rhythm rather than quarters.

| Item | Effort | Risk | Sequencing |
|---|---|---|---|
| **Phase 1 — Foundation** | **5–7 d** | Low | Do first, mostly parallelizable |
| H1 ontology test + query fixes (A1) | 2–3 d | Low | Start here |
| H3 data-flow rescope + 9 call sites (A2) | 1.5 d | Low | Independent |
| M6 coverage floors ×4 (P4) | 0.5 d | None | Independent |
| L1/L2/L4/L5 contract + lint fixes (P1,P2,P6,P7) | 1 d | Low | Independent |
| D7 `dependsOn` declaration only | 0.5 d | None | Precondition for Phase 3 |
| **Phase 2 — Core Refactoring** | **13–19 d** | Med–High | H2 gates M1 |
| H2 guard → `store.add`/`removeMatches` (A3) | 1.5–2 d | Medium | **Before M1** |
| M5 break `graph ↔ notebase` (D5) | 1 d | Low | Before M1 |
| Re-bless `pnpm bench` baselines (perf C4) | 0.5 d | None | **Prerequisite for M1** |
| M1 decompose `GraphState` (D1) | 6–9 d | **High** | 3–4 PRs; coordinate with perf C2/H1 |
| H4 menu → IPC handlers (D2) | 2–3 d | Medium | Parallel to M1 |
| M4 LLM logic out of registrars (D6) | 1.5 d | Low | Parallel |
| M2 `ThinkingToolDef` split (D3) | 1 d | Low | Parallel |
| M7 health-check state → project store (D8) | 0.5 d | Low | Parallel |
| **Phase 3 — Optimization** | **6–9 d** | Low | After Phase 2 settles |
| M3 App.svelte dialogs → store (D4) | 3–4 d | Medium | After M2, H4 |
| D7 topological init | 1 d | Low | — |
| P5 component directory grouping | 1 d | None | Quiet window only |
| L10 architecture overview doc (D10) | 1 d | None | Last |
| L3/L6/L7/L8/L9 cleanup | 1–2 d | None | — |
| **Total** | **24–35 d** | | |

**If only three days are available:** H1 (2–3 d). It is the only finding in this report that is producing incorrect output for users right now, and its test half permanently prevents the class of drift that caused it.

**If only two weeks are available:** all of Phase 1 plus H2 and M5 from Phase 2 (≈9–11 d). That closes all three Critical findings, leaves `GraphState` for later, and leaves the codebase with no invariant whose enforcement is narrower than its claim.
