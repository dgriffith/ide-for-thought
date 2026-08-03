# Architecture Review Plan
Generated: 2026-07-04-083009
Scope: Entire project (/Users/davegriffith/minerva)

## Executive Summary

Minerva is a **mature, disciplined, and genuinely well-architected** Electron +
Svelte 5 + TypeScript desktop application. The three-process topology (main /
preload / renderer) is strictly enforced — not merely by convention but by a
type-aware ESLint `no-restricted-imports` rule set (`eslint.config.mjs:188-227`,
issue #668) that makes a layer violation a lint error. Verified empirically:
zero renderer→main imports, zero shared→main/renderer imports, `src/shared`
imports no Node builtins.

Signals of engineering maturity are pervasive and unusually strong:

- **Zero `TODO`/`FIXME`/`HACK`/`XXX` markers** across all 537 `.ts`/`.svelte`
  source files — work is tracked as GitHub issues (`#NNN` references appear in
  nearly every module header).
- **~10 `as any` / `as unknown as` casts and 7 `@ts-*` suppressions** across the
  entire codebase — exceptional type discipline.
- **399 test files** against 537 source files (~0.74 ratio), with **per-area
  coverage floors gating CI** (`vitest.config.mts`): trust path (`src/main/llm`)
  and security path (`src/main/notebase`) carry the highest floors (80% lines on
  notebase).
- The security posture is correct by default: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true` (`window-manager.ts:78-83`), a CSP
  response header (`security.ts:38`), and a single `assertSafePath()` chokepoint
  (`notebase/fs.ts:92`) guarding every file operation.
- The graph module was deliberately refactored (#671) into a clean facade
  (`graph/index.ts`) over leaf modules (`state`, `indexers`, `queries`,
  `write-guard`, `neighborhood`) with no cycles.

The "LLM proposes, human confirms" trust principle is not a slogan — it is
**mechanically enforced**. The write guard (`graph/write-guard.ts`) throws under
the test runner if any LLM-context graph write bypasses the approval engine,
turning the core invariant into a CI gate.

The genuine architectural debt is modest and concentrated in four places:
(1) the `src/main/llm/tools.ts` monolith (2157 lines: a 773-line definition
array + a 21-case dispatch switch + 40 runner functions); (2) the
`conversation-*-drafts.ts` proliferation (9 near-identical files) signalling a
missing draft abstraction; (3) the manual 5-file IPC boilerplate with no
compile-time channel↔handler type linkage and no runtime payload validation; and
(4) two performance characteristics of the in-memory RDF store (full N3 cache
rebuild and alias-map rebuild on write) that are fine at desktop scale but are
the first thing that will bend under a very large knowledge base.

None of these are structural emergencies. This codebase does not need a
refactor; it needs a handful of targeted abstractions applied opportunistically.

## Current Architecture

### Overview

**Architecture style:** Layered, process-isolated desktop application. Four
layers with a strictly enforced dependency direction:

```
shared (pure: types, protocol, pure logic — no Node, no main, no renderer)
   ▲            ▲
   │            │
 main       renderer  ←── preload (contextBridge) ──→ main
 (Node)      (Svelte 5 runes UI)
```

**Key components:**

- **Main process** (`src/main/`, 179 `.ts` files): file I/O + path-traversal
  sandbox (`notebase/fs.ts`), git (isomorphic-git), RDF graph indexing
  (`graph/`), SPARQL via Comunica, LLM integration + approval engine (`llm/`),
  skills pipeline (`skills/`), publish/CSL, embeddings (onnxruntime-web), menus,
  window/project lifecycle.
- **Preload** (`src/preload/preload.ts`, 630 lines): a hand-written flat
  `contextBridge` surface — 271 `ipcRenderer` call sites, snapshot-tested.
- **Renderer** (`src/renderer/`, 222 files, 92 Svelte components): Svelte 5
  runes UI. 14 independent rune stores, a handler-cluster logic layer
  (`lib/app/`), a typed IPC client facade (`lib/ipc/client.ts`).
- **Shared** (`src/shared/`, 90 `.ts` files): the IPC protocol — channel
  constants, wire types, tool/skill registries, ontology TTL, and pure logic
  (menu-config, grouping, slug, frontmatter canonicalization).

**Design patterns in evidence (all verified):**

- **Facade** — `graph/index.ts` re-exports the read (`queries`), write
  (`indexers`), and guard surfaces; external callers never touch `GraphState`.
- **Reference-counted resource registry** — `project-context.ts` acquires
  per-project subsystem state on the first window and disposes on the last
  (`acquireProject`/`releaseProject`, `project-context.ts:51-128`), keyed by
  `rootPath`. This cleanly supports multi-window/multi-project.
- **Pipeline** — skills `parse → loader → compile → register`; each stage is
  single-responsibility and non-throwing on bad data (returns an error list).
- **Strategy/Dispatch (bounded switch)** — the approval engine's
  `dispatchApply`/`dispatchRollback` (`llm/approval.ts:577-781`) over a fixed
  `WIRED_PAYLOAD_KINDS` set.
- **Context injection / dependency injection** — renderer handler clusters
  (`createNoteOps(ctx)`, etc., `lib/app/note-ops.ts:33`) and the write pipeline
  inject hooks (`notebase/write-pipeline.ts:31-42`) so logic is testable without
  Electron.
- **Guarded-context (ambient token) pattern** — `enterLLMContext` /
  `enterTrustedContext` depth counters gate the write guard.

### Architecture Diagram

```
                            ┌──────────────────────────────────────────┐
                            │            RENDERER (Svelte 5)            │
                            │                                          │
  ┌───────────────┐        │  App.svelte (root orchestrator, 2001 L)  │
  │ 14 rune stores│◄───────┤   ├─ lib/app/*  (7 handler clusters via   │
  │ (no cross-    │  read   │   │             context injection)        │
  │  coupling)    │────────►│   └─ 92 components (66 pure props/cb)     │
  └───────────────┘        │  lib/ipc/client.ts  (32 domain Api facades)│
                            └───────────────┬──────────────────────────┘
                                            │ window.api.*  (typed)
                            ┌───────────────▼──────────────────────────┐
                            │  PRELOAD  preload.ts (contextBridge)      │
                            │  271 ipcRenderer.invoke/on  (snapshot-    │
                            │  tested; manual flat map)                 │
                            └───────────────┬──────────────────────────┘
                                            │ IPC (302 channels, shared/channels.ts)
   ┌────────────────────────────────────────▼─────────────────────────────────┐
   │                                   MAIN (Node)                             │
   │                                                                           │
   │  ipc.ts ── registers ──► 18× ipc/register-*.ts  (209 ipcMain.handle)      │
   │                                     │                                     │
   │        ┌────────────────────────────┼──────────────────────────┐         │
   │        ▼                            ▼                          ▼         │
   │  notebase/ (fs sandbox,      llm/ (approval engine,       graph/ (facade)│
   │   write-pipeline)             tools.ts monolith,          state/indexers/│
   │        │                      auto-tag/link,               queries/       │
   │        │                      TOOL_CALLBACK_KEYS)          write-guard)   │
   │        │  writeAndReindex()          │  proposeWrite()         │          │
   │        └──────────────┐              │  approveProposal()      │          │
   │                       ▼              ▼                         ▼          │
   │                 graph.indexNote() ── checkLLMWriteGuard ──► rdflib store  │
   │                 (incremental,        (fatal under test)     + N3 mirror   │
   │                  named-graph)                                (Comunica)   │
   │                                                                           │
   │  skills/ parse→loader→compile→register ──► shared/tools/registry (main copy)│
   │  project-context.ts  (ref-counted per-project state registry)             │
   └───────────────────────────────────────────────────────────────────────────┘
                                            │
                            ┌───────────────▼──────────────┐
                            │  SHARED (pure)                │
                            │  channels.ts / types.ts /     │
                            │  tools/ / skills/ / ontology  │
                            │  (ESLint-enforced purity #668)│
                            └───────────────────────────────┘
```

## Architectural Issues

### Critical Issues

There are **no critical (structurally dangerous) issues**. The invariants that
would be critical if broken — layer isolation, the LLM approval gate, path
traversal — are each enforced by tooling (ESLint, the fatal-under-test write
guard, `assertSafePath`). What follows are real but non-emergency concerns.

**C1. No compile-time linkage between IPC channels and handler signatures.**
`Channels` is a stringly-typed `const` object (302 entries, `shared/channels.ts`).
A handler registered in `register-*.ts` and its preload exposure and its
`client.ts` interface are three hand-maintained truths with no shared type
binding them. A wrong parameter or return type on a handler is not caught until
runtime. There is also **no runtime payload validation** at the boundary — a
misshapen main-process response silently corrupts renderer state
(`lib/ipc/client.ts` casts `window.api` with no validation). The preload
snapshot test (`tests/preload/preload-bridge.test.ts`) catches *shape* drift but
not *type* drift, and cannot distinguish an intentional omission from an
accidental one — evidenced by **5 orphaned menu channels** (`MENU_DUPLICATE_LINE`,
`MENU_EXTEND_SELECTION`, `MENU_JOIN_LINES`, `MENU_SHRINK_SELECTION`,
`MENU_TOGGLE_CASE`) defined in `channels.ts` and used in `menu.ts` but never
exposed in `preload.ts`.

**C2. `src/main/llm/tools.ts` is a 2157-line monolith with a hardcoded dispatch
switch.** It bundles a 773-line `NOTEBASE_TOOLS` definition array
(`tools.ts:113-886`), a 21-case `executeNotebaseTool` switch
(`tools.ts:942-999`), and ~40 `run*` implementation functions. Adding one tool
requires three coordinated edits in this single file, plus (per the memory note)
adding the callback to `TOOL_CALLBACK_KEYS` in `llm/index.ts` or it silently
fails. This is the single largest cohesion liability in the codebase.

### Design Flaws

**D1. `conversation-*-drafts.ts` proliferation — a missing abstraction.** Nine
near-identical shared modules (`conversation-drafts.ts`,
`-source-drafts.ts`, `-property-drafts.ts`, `-claims-drafts.ts`,
`-compute-drafts.ts`, `-refactor-drafts.ts`, `-source-property-drafts.ts`,
`-note-body-drafts.ts`, plus `conversation-tools.ts`) each define a draft type
sharing the same base shape (`draftId`, `conversationId`, `note`, `createdAt`).
The cost surfaces downstream: `renderer/lib/stores/conversations.svelte.ts`
repeats the pattern 9× — 9 imports, 9 `Anchored*Draft` intersections, 9
`TabRuntime` arrays, 9 `*Subscribed` flags, and 9 ~10-line subscription handlers
that differ only in the callback name. Adding a 10th draft type is a ~5-file
change (shared type + channel + store array + subscription + main-side
`onFooDraft`). A `ConversationDraftBase` interface plus a generic subscriber
factory would make it a ~2-file change. This is the clearest genuine debt item.

**D2. Repeated 5-step IPC boilerplate.** Per CLAUDE.md, adding one main
operation touches 5 files (channel constant, impl, `register-*.ts` handler,
`preload.ts` exposure, `client.ts` type). With 302 channels this is a real,
recurring maintenance tax and the mechanical source of drift (C1). The
documentation is also stale: it says "register in `src/main/ipc.ts`" but
`ipc.ts` is a 41-line orchestrator (`ipc.ts:21-41`); registration actually lives
in the 18 `register-*.ts` modules.

**D3. Extension points that require editing a central switch (OCP friction).**
Three parallel spots grow by editing a central construct rather than adding a
file: the tools switch (C2), the approval engine's
`dispatchApply`/`dispatchRollback` + `WIRED_PAYLOAD_KINDS`
(`llm/approval.ts:248, 577-781`), and the draft plumbing (D1). To the codebase's
credit, the approval switch is *intentionally* bounded and documented — its lack
of a plugin registry is a deliberate "changes must be visible and reviewed"
choice appropriate for a trust-critical path. Contrast with the **skills
pipeline**, which is genuinely open for extension: dropping a `.md` file adds a
tool with no code edit. The inconsistency (skills are open, LLM tools are not)
is the notable point.

### Pattern Inconsistencies

- **P1. Two RDF representations kept in sync.** The store is `rdflib`
  (`IndexedFormula`) for mutation/serialization, mirrored into an `N3.Store` for
  Comunica SPARQL (`graph/state.ts:122`, `queries.ts:283`). Any write calls
  `invalidate(state)` (nulls `n3Cache`), so the next query rebuilds the whole N3
  mirror from scratch. Correct and cleanly encapsulated, but it is two graph
  engines (`rdflib` + `n3` + `@comunica/query-sparql-rdfjs`) plus a third
  (`cytoscape` for viz) — a nontrivial dependency surface for one concern.
- **P2. Two benign circular dependencies** (via `madge`):
  `menu.ts ↔ window-manager.ts` (a real runtime function-call cycle — menu needs
  window helpers, window-manager calls `rebuildMenu`; common in Electron, low
  risk) and `shared/skills/types.ts ↔ shared/skills/menu-config.ts` (type-only
  `import type` on one side, so it erases at compile — effectively a non-cycle).
- **P3. Registry duplication across processes** (`shared/tools/registry.ts`).
  Main and renderer each populate their own singleton registry copy — main with
  full `ThinkingToolDef` (prompt bodies), renderer with `SkillInfo` stubs. This
  is **intentional and documented** (registry.ts header) to keep prompt bodies
  out of the renderer; noted only so a future reader doesn't "fix" it.

## SOLID Principles Assessment

**Single Responsibility — 4/5.** Excellent at the module level: the graph facade,
the write pipeline, the skills pipeline stages, and the 14 rune stores each do
one thing. Even the large UI components (`Preview.svelte` 2747 L,
`ConversationsPanel.svelte` 2108 L) own a single cohesive domain rather than
many. The point deduction is `tools.ts` (definitions + dispatch + 40 runners in
one file) and the way one logical IPC operation is smeared across 5 files.

**Open/Closed — 3/5.** Split personality. The skills system is a model of OCP
(add a `.md` file, extend nothing). But LLM tools, approval payload kinds, IPC
operations, and conversation drafts all require editing a central switch/list to
extend. Some of this (approval switch) is a deliberate trust-driven choice;
`tools.ts` and the draft plumbing are not — they are just un-refactored.

**Liskov Substitution — 4/5.** Minimal class inheritance; the codebase favors
discriminated unions and interfaces over hierarchies, so LSP is largely N/A. The
payload-kind union and the draft types are used substitutably and correctly.
Nothing violates it; the score reflects limited applicability rather than risk.

**Interface Segregation — 4/5.** Strong. `client.ts` is decomposed into 32
domain-specific `Api` interfaces composed into one `IdeApi`
(`client.ts:765-798`) rather than one fat interface. `ToolCallbacks` is
projected to only the keys a tool uses via `TOOL_CALLBACK_KEYS`
(`llm/index.ts`). The write pipeline exposes a narrow `WritePipelineHooks`. The
deduction: `Editor.svelte` takes 42 props — defensible as callback-injection but
at the upper bound of a comfortable interface.

**Dependency Inversion — 4/5.** Good. The write pipeline depends on injected
hooks, not on Electron (`write-pipeline.ts:31-42`); renderer handler clusters
depend on an injected `Ctx`; the graph facade hides `GraphState`. The main
residual is direct module-singleton coupling (stores and subsystem state are
imported module singletons rather than injected), which is a pragmatic and
common Svelte/Electron choice, not a flaw.

**Aggregate: 19/25** — a strong, healthy score. The recurring theme across the
lost points is OCP friction at a few central switches, not tangled dependencies.

## Improvement Plan

### High Priority (Structural Fixes)

1. **Introduce a `ConversationDraftBase` + generic draft subscriber (D1).**
   Define the shared base interface and a discriminated union in `src/shared`;
   replace the 9 hand-rolled subscription blocks in
   `conversations.svelte.ts:237-340` with a single
   `createDraftSubscriber<T extends ConversationDraftBase>(...)` factory. Do this
   the next time a draft type is added. Highest ROI: removes the most
   copy-paste and the most error-prone extension path.

2. **Type-link the IPC boundary (C1).** Introduce a single channel→signature map
   type (`type ChannelMap = { [NOTEBASE_OPEN]: (p: string) => NoteFile; ... }`)
   and derive the `ipcMain.handle` registration, the preload exposure, and the
   `client.ts` interface from it, so a signature change fails at compile time.
   Even a partial version (typed `handle`/`invoke` wrappers) closes the largest
   correctness gap. Retire or expose the 5 orphaned menu channels while here.

3. **Break up `tools.ts` (C2).** Move each tool to a self-registering module
   `{ definition, run }` collected into a `Record<ToolName, ...>`, so
   `executeNotebaseTool` becomes a map lookup and adding a tool is a new file.
   This mirrors the pattern the skills pipeline already proves works.

### Medium Priority (Design Improvements)

4. **Add runtime payload validation at the IPC boundary (C1).** A lightweight
   validator (or hand-written type guards on trust-critical channels first —
   proposals, approval, source writes) prevents a main-side shape bug from
   silently corrupting renderer state.

5. **Cache the parsed skill-template AST (perf).** `compile.ts` re-parses the
   template string on each skill invocation (`skills/compile.ts:19-20`). Parse
   once at compile time and cache the AST if skill execution ever becomes hot.

6. **Fix the CLAUDE.md IPC step (D2)** to name `src/main/ipc/register-*.ts` as
   the registration site, not `ipc.ts`. Cheap, prevents ongoing confusion.

### Low Priority (Consistency)

7. **Resolve the `menu.ts ↔ window-manager.ts` cycle (P2)** by extracting the
   shared `rebuildMenu` trigger behind a tiny event/callback, if it ever
   complicates testing. Low value today.

8. **Document the dual rdflib+N3 store choice (P1)** in a short comment/ADR so
   the two-engine cost is a known, deliberate trade-off rather than a surprise.

9. **Consider consolidating the many `register-*.ts` draft-filing handlers**
   (14 in `register-conversation.ts`) behind the same generic path once D1
   lands, since they share the identical validate→proposeWrite→approveProposal→
   broadcast template.

## Migration Strategy

### Phase 1: Foundation
- Land the `ConversationDraftBase` + generic subscriber factory (Item 1) *the
  next time a draft type is added* — pair the refactor with the feature so it is
  paid for by work already happening.
- Fix the CLAUDE.md IPC documentation (Item 6) and audit/expose-or-delete the 5
  orphaned menu channels (Item 2, partial). Both are near-zero-risk.
- Add type guards on the trust-critical channels only (proposals/approval/source
  writes) as the beachhead for Item 4.

### Phase 2: Core Refactoring
- Introduce the `ChannelMap` type and typed `handle`/`invoke` wrappers (Item 2);
  migrate one domain (e.g. `notebase`) end-to-end as a template, then convert the
  remaining domains incrementally — the pattern tolerates a mixed state.
- Refactor `tools.ts` into per-tool `{ definition, run }` modules with a lookup
  registry (Item 3), migrating a few tools at a time behind the existing switch.

### Phase 3: Optimization
- Extend runtime validation to all channels (Item 4).
- Template-AST caching (Item 5) and any observed graph hot-path work: if very
  large knowledge bases appear, revisit the N3-mirror full rebuild
  (`state.ts:169`) and the per-`indexNote` alias-map rebuild
  (`indexers.ts` `rebuildAliasMap`) — e.g. incremental N3 patching or a dirty-set
  rebuild. Only do this against measured evidence; both are correct today.

## Impact Analysis

**Developer velocity.** Current velocity is *high* despite the boilerplate,
because the layer rules, the write guard, and the coverage floors let developers
move fast without fear — a mistake tends to fail the build, not ship. The IPC
5-file dance (D2) and the draft proliferation (D1) are the two friction points a
contributor feels most; fixing them compounds positively. The `tools.ts`
monolith slows anyone adding an LLM tool but is edited infrequently.

**Testing requirements.** The refactors are *lower risk than average* here
because the safety net is unusually good: 399 test files, per-area coverage gates
(`vitest.config.mts`), the preload snapshot test, and the fatal-under-test write
guard. The IPC type-linking work (Item 2) is mostly compile-time and self-
verifying. The `tools.ts` split (Item 3) needs behavioral tests per tool, most
of which exist under `tests/main/llm` and `tests/main/tools`.

**Risk.** Low across the board. The highest-risk item is IPC type-linking only
because it touches many files — but it is mechanical, incrementally adoptable,
and caught by `pnpm lint`'s `tsc --noEmit`. The draft and tools refactors are
internal to their subsystems with no cross-layer blast radius (verified: those
modules are not reached across the enforced boundaries).

## Recommendations

1. **Do not undertake a broad refactor.** This codebase's architecture is sound;
   treat the items above as opportunistic, feature-adjacent improvements.
2. **Fix D1 (draft abstraction) first**, bundled with the next draft-type
   feature — best effort-to-payoff ratio and it removes the most copy-paste.
3. **Invest in the IPC boundary type-linkage (C1/Item 2)** as the one item worth
   scheduling proactively: it closes a real correctness gap (silent shape drift),
   eliminates the orphaned-channel class of bug, and reduces the standing 5-file
   tax on every future feature.
4. **Split `tools.ts` (C2/Item 3)** to match the OCP quality the skills pipeline
   already demonstrates — make adding an LLM tool as cheap as adding a skill.
5. **Preserve the deliberate constraints** — the bounded approval switch, the
   per-process registry duplication, the fatal write guard, and ESLint layer
   enforcement are *features*. Any refactor must keep them intact; the write
   guard in particular must keep tripping under test.
6. **Keep the discipline that produced this** — issue-tracked debt (zero inline
   TODOs), coverage floors on trust/security paths, and enforced layer purity.
   These are the reasons the debt is this shallow.

## Estimated Effort

**Total actionable tasks:** 9 (3 high, 3 medium, 3 low).

**Critical-fix hours** (the two items worth scheduling now):
- Draft abstraction + generic subscriber (Item 1): ~8-12 hours incl. tests.
- IPC channel type-linkage, one-domain template + orphan-channel cleanup
  (Item 2, first slice): ~12-16 hours.
- `tools.ts` split into a registry (Item 3): ~10-16 hours incl. per-tool tests.
- **Immediate high-priority total: ~30-44 hours (~1 to 1.5 dev-weeks).**

**Full-refactor scope** (all 9 items, including migrating every IPC domain to
the typed wrapper, full runtime validation, and the optional graph perf work):
**~4-6 dev-weeks**, best spread across normal feature work rather than done as a
dedicated sprint. Given the low risk and high existing test coverage, an
incremental, feature-adjacent adoption is strongly preferred over a big-bang
effort.
