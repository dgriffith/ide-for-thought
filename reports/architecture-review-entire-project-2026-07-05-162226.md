# Architecture Review Plan
Generated: 2026-07-05 16:22:26
Scope: entire project (/Users/davegriffith/minerva)

## Executive Summary

Minerva is a three-process Electron + Svelte 5 + TypeScript desktop markdown IDE
(571 `.ts`/`.svelte` source files, ~100k LOC, 412 test files) backed by an RDF
knowledge graph and git. The architecture is **mature and, in its subsystems,
genuinely well-designed**: process isolation is intact, the plugin/registry
patterns (skills, formatter rules, LLM tools, embeddings) are clean and
extensible, and the most safety-critical invariant in the product — the "Trust
Principle" (LLM proposes, human confirms) — is *enforced*, not merely observed,
via a runtime write guard that is fatal under test.

The debt is concentrated in a handful of predictable places that a fast-moving,
feature-rich codebase accumulates:

- **An incomplete architectural migration.** A typed IPC contract
  (`ChannelMap` + typed `handle()`/`invoke()` + runtime validators, #981/#983)
  exists and is excellent — but it covers only the notebase domain (29 of ~297
  channels; 1 of 19 register modules). The other ~268 channels use a second,
  untyped `ipcRenderer.invoke` path. Two coexisting patterns is the single
  largest consistency risk.
- **God-objects at the two orchestration seams.** `App.svelte` (2046 lines) on
  the renderer and `approval.ts` (937 lines) + `queries.ts`/`indexers.ts`
  (~1200 lines each) in the main process concentrate too many responsibilities.
- **A repeated-but-un-abstracted per-project state pattern** (`Map<string,
  State>` keyed by `rootPath`) reimplemented in ~5 subsystems, with undocumented
  single-thread concurrency assumptions.
- **A latent scalability bottleneck** in the graph read path (synchronous
  rdflib→N3 rebuild, O(n) in triples, on every query after a write).

None of these are critical or blocking. The codebase shows strong architectural
hygiene (only **one** circular dependency across 480 modules, and it is
type-only). The recommended work is consolidation and completion of migrations
already in flight, not rescue.

## Current Architecture

### Overview

**Architecture style.** Layered, event-driven, multi-process desktop app.
Three hard process boundaries (Main / Preload / Renderer) with strict Electron
context isolation, communicating over a request/reply + event IPC bus. Within
the main process the design is service-oriented: cohesive subsystem modules
(graph, search, embeddings, llm, skills, compute, publish, sources) each own a
per-project state registry and expose a facade. The renderer is a rune-based
Svelte 5 SPA with a store-per-concern model.

**Key components.**
- **Main** (`src/main/`, ~16 top-level + subsystem dirs): file I/O
  (`notebase/fs.ts` with `assertSafePath` traversal guard), the RDF graph
  (`graph/`), full-text search (`search/`, MiniSearch), semantic search
  (`embeddings/`, onnxruntime-web WASM), the LLM approval engine (`llm/`), the
  skills pipeline (`skills/`), the Python compute kernel (`compute/`), the
  publish/export pipeline (`publish/`), sources/bibliography, and 21 IPC
  registration modules (`ipc/register-*.ts`).
- **Preload** (`src/preload/preload.ts`, 632 lines + `typed-invoke.ts`):
  contextBridge surface exposing a nested `window.api` object.
- **Renderer** (`src/renderer/`): `App.svelte` orchestrator, 69 components, 14
  runes stores, a 982-line typed `client.ts` wrapper, and 4 extracted `app/*`
  ops modules.
- **Shared** (`src/shared/`, 38 top-level files + subtrees): channel constants,
  types, the typed IPC contract, tool/skill registries, formatter rules,
  conversation draft schemas — all pure, dependency-free of main/renderer.

**Design patterns used.**
- *Facade* — `graph/index.ts` re-exports state/queries/indexers as one public
  surface; `client.ts` aggregates 33 API sub-interfaces.
- *Registry / Plugin* — formatter rules self-register at import
  (`shared/formatter/registry.ts`); LLM tools register into
  `NOTEBASE_TOOL_REGISTRY` (`llm/tools/registry.ts`); skills compile into
  `shared/tools/registry.ts`.
- *Pipeline* — skills: `parse → loader → compile → register`; notes write:
  `writeAndReindex` (`notebase/write-pipeline.ts`).
- *Value Object / branded type* — `ProjectContext` (`project-context-types.ts`)
  is a branded `{ rootPath, _brand }` carried through every subsystem.
- *Reference-counted resource lifecycle* — `project-context.ts`
  acquire/release with a shared init promise.
- *Dependency Injection via hooks* — `WritePipelineHooks` inject
  broadcast/mark so the pipeline is testable without Electron.
- *Command* — renderer command-palette registry.
- *Proposal / approval (state machine)* — `thought:Proposal` nodes transition
  pending→approved/rejected/expired; the graph mutates only on approval.

### Architecture Diagram

```
┌─────────────────────────── RENDERER (Svelte 5, runes) ───────────────────────┐
│  App.svelte (2046 LOC god-orchestrator)                                       │
│    ├─ 14 stores (editor, conversations, notebase, dialogs, flows, …)          │
│    │     no inter-store cycles; IPC-backed vs local-only                      │
│    ├─ 4 ops modules (note-ops, source-ops, refactor-ops, conversation-ops)    │
│    └─ 69 components (Preview 2809, ConversationsPanel 2041, Editor 1358 …)     │
│         34/69 call api.* DIRECTLY (inconsistent data-flow)                     │
│                              │                                                 │
│                    client.ts (982 LOC, 33 typed API interfaces → window.api)  │
└──────────────────────────────┼────────────────────────────────────────────────┘
                               │ window.api  (contextBridge)
┌──────────────────────────────┼──── PRELOAD ───────────────────────────────────┐
│  preload.ts (632)  ── invoke() TYPED path (29 notebase channels, validated)    │
│                    ── ipcRenderer.invoke() RAW path (~268 channels, untyped)   │
└──────────────────────────────┼────────────────────────────────────────────────┘
                               │ IPC (349 channel constants, 297 named)
┌──────────────────────────────┼──── MAIN (Node) ───────────────────────────────┐
│  ipc.ts → 19 register-*.ts (1 typed handle(), 18 raw ipcMain.handle)          │
│      withRootPath / withRootPathOr helpers resolve ProjectContext by window    │
│                              │                                                 │
│  project-context.ts  ── ref-counted acquire/release ──┐                        │
│      (single init promise: graph+search+tables+vectors+conversation+health)    │
│                              │                          │                       │
│   ┌──────────┬───────────┬───┴───────┬──────────┬──────┴──────┐                │
│  graph/     search/    embeddings/  llm/        skills/      compute/          │
│  state      Minisearch  wasm+worker  approval    parse→       python-kernel    │
│  queries                +DuckDB      +tools/     compile→     +rpc-server       │
│  indexers   ← each keeps its own Map<string,State> keyed by rootPath →         │
│  write-guard ── enter/exit LLM & Trusted context ── checkLLMWriteGuard (FATAL  │
│                 under test) gates EVERY store mutation                          │
│  fs.ts (assertSafePath traversal fence — single chokepoint)                    │
└────────────────────────────────────────────────────────────────────────────────┘

SHARED (src/shared/): channels · types · ipc-contract/validators · tools & skills
  registries · formatter rules · conversation-*-drafts · ontology .ttl
  → verified: imports NOTHING from main/ or renderer/ (clean lower layer)
```

## Architectural Issues

### Critical Issues

There are **no critical (correctness- or security-breaking) architectural
issues.** Process isolation holds, the path-traversal fence is a single
chokepoint (`notebase/fs.ts:94–105`), and the LLM write guard makes the trust
invariant CI-enforced. The items below are structural risks, not defects.

### Design Flaws

1. **Two coexisting IPC invocation paths (incomplete #981/#983 migration).**
   - `src/shared/ipc-contract.ts` defines `ChannelMap` for only **29 channels**
     (all `notebase:*`); `src/shared/channels.ts` declares **297** named
     channels.
   - `src/main/ipc/typed-ipc.ts` provides a compile-time-checked `handle()`
     wrapper, but only `register-notebase.ts` imports it. The other 18
     `register-*.ts` use raw `ipcMain.handle` (e.g. `register-conversation.ts`
     has 30 raw handlers, `register-bibliography.ts` 11). A wrong field name in
     an untyped handler (e.g. `register-app.ts:22` `APP_GET_INFO`) does not fail
     `tsc`.
   - Preload mirrors this: `invoke(Channels.NOTEBASE_*)` is typed+validated via
     `typed-invoke.ts`; `ipcRenderer.invoke(Channels.GRAPH_QUERY, …)`
     (preload.ts:116+) is `Promise<any>`. ~268 channels have no runtime
     validation. This is the highest-leverage consistency problem.

2. **`approval.ts` is overburdened (937 lines, SRP + OCP).** It owns policy
   (`getApprovalTier`), the proposal lifecycle (`proposeWrite`, `approve`,
   `reject`, `expire`), established-node escalation, apply/rollback of 8 payload
   kinds via `dispatchApply`/`dispatchRollback` **switch statements**
   (`approval.ts:588`, `:718`), and persistence/serialization. Adding a payload
   kind means editing two switches — closed to extension. This is the natural
   candidate to split into `approval` (policy+orchestration) /
   `apply-dispatch` / `proposal-persistence`.

3. **`App.svelte` god-component (2046 lines).** Instantiates 11 stores inline
   (`:91–110`), owns 25+ local state vars, 15+ async handlers, 40+
   `api.menu.on*` bindings (`:1000–1063`), the command-palette registry
   (`:535–589`, rebuilt on any state change), tab drag-to-split pointer logic
   (`:222–295`), theme, and all dialog state. The `app/*-ops` extraction is a
   good start but App still orchestrates all init and IPC event wiring.

4. **Repeated per-project state pattern with no shared abstraction.** Each of
   `graph/state.ts`, `search/index.ts`, `sources/tables.ts`,
   `embeddings/vector-store.ts`, and `llm/conversation.ts` independently
   declares a `Map<string, X>` keyed by `rootPath` plus its own
   get/set/dispose. There is no generic per-project registry, so lifecycle
   correctness (acquire/init/dispose ordering) is re-established by hand in each
   and coordinated only by `project-context.ts:51–128`.

5. **Graph read-path scalability bottleneck.** Writes mutate a synchronous
   rdflib `IndexedFormula` and call `invalidate()` (nulls `n3Cache`). The next
   SPARQL query rebuilds an immutable N3 store statement-by-statement — O(n) in
   triple count (`graph/state.ts:33–51`, consumed in `queries.ts`), **on the
   main thread with no yield**. A large base with frequent write-then-query
   (e.g. auto-link backlink checks on save) pays this repeatedly. Fine at
   current scale (~5–10k triples); a latent cliff at 100k+.

### Pattern Inconsistencies

- **Renderer data-flow is not disciplined.** 34 of 69 components call `api.*`
  directly (Preview.svelte:32, Editor.svelte:386/493/501,
  ConversationsPanel.svelte, SourcesPanel, SourceDetail) rather than routing
  mutations through stores or parent callbacks. Three coexisting patterns
  (store-first, component-first, callback-driven) with no rule for which
  applies.
- **Handler project-resolution is mixed.** Some handlers use
  `withRootPath`/`withRootPathOr` helpers (register-tags.ts:9), others hand-roll
  `rootPathFromEvent(e)` + `if (!rootPath) throw` (register-queries.ts:11).
  Cosmetic, but 86× hand-rolled before #990 consolidated most.
- **Draft-validation boilerplate.** `if (!draft || !Array.isArray(draft.payloads)…) throw`
  repeats 4× in `register-conversation.ts` (:357, :605, :690, :720).
- **Conversation draft schema family** (8 files, `conversation-*-drafts.ts`)
  shares a thin `ConversationDraftBase` but repeats a `note: string` field 6×
  and diverges in result shapes (single outcome vs `outcomes[]`), weakening
  polymorphic handling.
- **One circular dependency:** `shared/skills/types.ts ↔
  shared/skills/menu-config.ts` — but `types.ts`'s import of `MenuConfig` is
  **type-only** (erased at compile), so there is no runtime cycle. Low severity;
  worth breaking for madge cleanliness by moving `MenuConfig` to a leaf type
  module.

## SOLID Principles Assessment

- **Single Responsibility: 3/5.** Excellent at the subsystem/plugin level
  (skills pipeline, formatter rules, embeddings, LLM tools each do one thing).
  Dragged down by concentrated god-objects: `App.svelte`, `approval.ts`,
  `queries.ts`/`indexers.ts` (~1200 LOC each, though internally cohesive by
  read-vs-write), and the `CONVERSATION_SEND` handler (170 LOC, but a justified
  orchestrator).
- **Open/Closed: 3/5.** Strong where registries exist — new formatter rule,
  skill, or LLM tool needs zero core edits. Weak at the IPC seam (5-step manual
  add-a-channel across channels.ts/register/preload/contract/validators) and at
  `approval.ts` dispatch switches (new payload kind edits two switches).
- **Liskov Substitution: 4/5.** Little inheritance; interface conformance is
  clean (`FormatterRule<Config>`, `NotebaseTool`, `ChunkEmbedder`). Minor smell:
  divergent conversation-draft result shapes make uniform draft handling
  fragile.
- **Interface Segregation: 3/5.** `window.api`/`client.ts` is one flat 33-API
  surface; consumers depend on the whole object rather than mockable slices.
  Renderer components take 15–20 callback props (Editor, Preview). `FormatContext`
  is a good counter-example (optional, pay-for-what-you-use).
- **Dependency Inversion: 4/5.** Subsystems depend on abstractions
  (`ChunkEmbedder`, `FormatterRule`, `WritePipelineHooks` injected for tests,
  RPC dispatch to service interfaces). Weakened only by renderer components
  binding directly to the concrete `window.api` rather than an injected seam.

## Improvement Plan

### High Priority (Structural Fixes)

1. **Complete the typed-IPC migration (#981/#983).** Extend `ChannelMap` to all
   ~297 channels (incrementally per domain, or code-gen the skeleton from
   `channels.ts`), convert all 19 `register-*.ts` to the typed `handle()`
   wrapper, and add return validators for high-value shapes. Eliminates the
   two-path inconsistency and closes the untyped surface. This is the single
   most valuable structural fix.
2. **Split `approval.ts`** into `approval.ts` (policy + `proposeWrite` /
   `approve` / `reject` orchestration), `apply-dispatch.ts` (the 8 apply +
   rollback handlers), and `proposal-persistence.ts` (graph writes,
   serialization). Consider a payload-kind registry to retire the two switch
   statements (restores OCP). Keep the trust-context wrapping intact.
3. **Extract an App controller.** Move store instantiation, IPC event wiring,
   command-registry construction, and dialog/local state into an
   `AppController.svelte.ts` (or extend the existing `app/` module set), leaving
   `App.svelte` as ~400–500 LOC of rendering. Provide the controller via Svelte
   context to kill prop drilling.

### Medium Priority (Design Improvements)

4. **Introduce a generic per-project state registry.** A small
   `createProjectStore<T>({ init, dispose })` used by graph/search/tables/
   vectors/conversation would centralize the `Map<string, T>` + lifecycle and
   let `project-context.ts` iterate registered stores instead of naming each.
5. **Impose a renderer data-flow rule.** e.g. "components may call `api.*` only
   for read-only queries; all mutations go through a store or a parent
   callback." Route ConversationsPanel/Preview IPC listeners into their stores.
6. **Split the largest components.** Extract citation-renderer and
   chart/compute-cell rendering out of `Preview.svelte`; extract composer,
   message-list, and draft-cards out of `ConversationsPanel.svelte`. Target
   ≤500 LOC per component.
7. **Document + guard graph concurrency.** Add an explicit comment at
   `graph/state.ts:157` recording the Electron-main-thread serialization
   assumption; instrument `buildN3Store` timing and set a dev warning threshold
   so the O(n) rebuild cliff is observable before it bites.

### Low Priority (Consistency)

8. Extract `ensureDraftPayloads(draft, kind)` to kill the 4× validation
   boilerplate in `register-conversation.ts`.
9. Introduce a generic `ConversationToolDraft<Payload, Outcome>` base to remove
   the repeated `note` field and normalize result shapes across the 8 draft
   files (leave compute/refactor separate if they don't fit).
10. Break the type-only `skills/types.ts ↔ menu-config.ts` cycle by relocating
    `MenuConfig` to a leaf type module.
11. Standardize handler project-resolution on `withRootPath`/`withRootPathOr`.
12. Cluster `preload.ts` and `client.ts` by domain into segregated sub-modules
    for mockability.

### Preserve (do not "fix")

The following are deliberate and correct — flag for reviewers so they aren't
"refactored" away: the LLM write guard's fatal-under-test/warn-in-prod split
(#944); the intentional main/renderer duplicate tool-registry copies (#675); the
`indexAllNotes`-before-`registerAllCsvs` sequencing in `project-context.ts`
(#337); graph.ttl as a cold snapshot persisted on release, not per-write (#348);
and defense-in-depth path validation living in `fs.ts`, not at the IPC boundary.

## Migration Strategy

### Phase 1: Foundation
- Land the generic per-project state registry (#4) and the graph-concurrency
  doc + timing instrumentation (#7) — low-risk, unblocks later work and makes
  the state model legible.
- Break the type-only cycle (#10) and standardize handler resolution (#11).
- Add a lint/test that fails when a channel exists in `channels.ts` but is
  missing from `ChannelMap` once a domain is migrated (ratchet to prevent
  regression).

### Phase 2: Core Refactoring
- Execute the typed-IPC completion (#1) domain-by-domain behind the ratchet.
- Split `approval.ts` (#2) with the payload-kind registry; the existing
  trust-guard tests plus the integrity SPARQL query are the safety net.
- Extract the App controller (#3) and impose the renderer data-flow rule (#5);
  move IPC listeners into stores.

### Phase 3: Optimization
- Split Preview/ConversationsPanel into sub-components (#6).
- Address the N3 rebuild cost if instrumentation shows it: incremental on-write
  N3 maintenance, or wrap the rebuild in `setImmediate`/a worker to preserve UI
  responsiveness on large graphs.
- Draft-schema generalization (#8, #9) and preload/client domain clustering
  (#12).

## Impact Analysis

- **Typed-IPC completion** touches every `register-*.ts`, `preload.ts`, and
  `ipc-contract.ts` but is mechanical and incremental; risk is low with the
  ratchet test. High payoff: eliminates ~268 untyped channels and a whole class
  of silent renderer-corruption bugs. The existing preload snapshot test
  (`tests/preload/preload-bridge.test.ts`) already guards the surface.
- **approval.ts split** is the highest-risk refactor because it sits on the
  trust boundary. Mitigated by the fatal write guard, the integrity SPARQL
  query, and the 32 tests under `tests/main/llm/`. Behavior must be preserved
  byte-for-byte in the graph.
- **App controller + data-flow rule** improves testability (components become
  mockable) and reduces the merge-conflict surface of the 2046-line file, but
  touches many components; stage it component-by-component.
- **Per-project state registry** is invisible to users and reduces the chance
  of a future acquire/dispose ordering bug (the code already warns of one latent
  hazard at `project-context.ts:69–83`).
- **Graph perf** work only matters at scale; instrumentation first avoids
  premature optimization.
- **Test architecture is a strong safety net**: 412 test files mirror the source
  tree (38 graph, 32 llm, 26 sources, e2e via Playwright), so refactors are
  well-covered.

## Recommendations

1. Treat the typed-IPC migration as the flagship architectural initiative for
   the next cycle — it is already designed, just unfinished, and every untyped
   channel added meanwhile widens the gap. Add the ratchet test first.
2. Split `approval.ts` and introduce a payload-kind registry before more
   proposal payload kinds are added; each new kind currently deepens the OCP
   debt in two switch statements.
3. Extract an App controller and adopt one renderer data-flow rule; the
   `app/*-ops` + context-object pattern already in the codebase is the template.
4. Add a generic per-project state registry so lifecycle correctness is defined
   once rather than five times.
5. Instrument (don't yet optimize) the graph N3 rebuild; decide with data.
6. Keep doing what is working: the plugin registries (formatter, skills, tools),
   the write guard, the reference-counted project lifecycle, the clean
   shared-layer boundary, and the test-mirrors-source discipline are genuine
   strengths — protect them in review.

## Estimated Effort

| Item | Priority | Est. effort | Risk |
|------|----------|-------------|------|
| #1 Complete typed-IPC (all domains) | High | 3–5 dev-days (incremental) | Low (mechanical + ratchet) |
| #2 Split approval.ts + payload registry | High | 2–3 dev-days | Med-High (trust boundary) |
| #3 Extract App controller | High | 4–6 dev-days | Medium (broad touch) |
| #4 Generic per-project state registry | Medium | 1–2 dev-days | Low |
| #5 Renderer data-flow rule + move listeners | Medium | 2–3 dev-days | Medium |
| #6 Split Preview / ConversationsPanel | Medium | 2–3 dev-days each | Low-Med |
| #7 Graph concurrency doc + N3 timing | Medium | 0.5 day | Low |
| #8–#12 Consistency (drafts, boilerplate, cycle, preload cluster) | Low | 2–3 dev-days total | Low |

**Total indicative effort:** ~4–5 focused engineer-weeks for High+Medium,
sequenced across the three phases. All items are independently shippable via the
project's one-change-per-PR workflow; none require a big-bang rewrite.
</content>
