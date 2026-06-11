# Architecture Review Plan
Generated: 2026-06-10 11:49:11
Scope: entire project (/Users/davegriffith/minerva)

## Executive Summary

Minerva is a mature, well-layered Electron + Svelte 5 + TypeScript desktop
markdown IDE. For a single-developer project of ~380 source files (71k LOC) it
shows unusually disciplined architecture: a genuinely pure `src/shared` layer
(no Node builtins, no cross-layer imports), a strong context-isolation boundary,
264 test files with a coverage floor on `shared`, and a thoughtfully designed
Trust Principle (approval engine) that is the strongest single architectural
idea in the codebase.

The architecture is sound. The problems are almost entirely about **module size
and the absence of enforced boundaries**, not about wrong structure. Four files
exceed 2,000 lines (`ipc.ts` 2,717; `graph/index.ts` 2,717; `App.svelte` 3,764;
`Preview.svelte` 2,585), and the IPC surface (~256 channel constants, 187
handlers all registered in one function) is the dominant maintainability risk. A
single concrete layer violation exists (`src/main/compute/save-cell-output.ts`
importing from `src/renderer`). The Trust Principle is well-implemented but the
write guard is explicitly dev-only and the `notify_only` tier applies before the
user sees anything, which is worth documenting as an accepted trade-off.

Top findings:
1. `src/main/ipc.ts` (2,717 lines, one 2,000+ line `registerIpcHandlers()`) is
   a god-module; the IPC surface needs domain-sliced registration.
2. `src/renderer/App.svelte` (3,764 lines) is an over-large root component
   holding dialogs, menu wiring, IPC subscriptions, and orchestration.
3. Layer violation: `src/main/compute/save-cell-output.ts:18` imports from
   `src/renderer/lib/editor/output-block`.
4. No tooling enforces the layer boundaries that the code currently respects by
   convention (`eslint.config.mjs` has no `no-restricted-imports`).
5. `graph/index.ts` (2,717 lines) mixes store lifecycle, per-format indexers,
   SPARQL execution, the write guard, and rename heuristics in one module.

## Current Architecture

### Overview

**Style:** Three-process Electron app (Main / Preload / Renderer) with strict
`contextBridge` isolation, plus a fourth conceptual layer — a pure `shared`
domain library imported by both ends.

**Key components:**
- **Main** (`src/main/`, ~28.9k LOC): file I/O (`notebase/fs.ts` with
  `assertSafePath`), git, the RDF graph + indexer (`graph/index.ts`), SPARQL via
  Comunica over an N3.Store, the LLM/approval engine (`llm/`), the skills
  pipeline (`skills/`), sources/ingestion (`sources/`), compute kernels
  (`compute/`), publish/export (`publish/`), menus, and window management.
- **Preload** (`src/preload/preload.ts`, 551 lines): the single `contextBridge`
  surface exposing `window.api`.
- **Renderer** (`src/renderer/`, ~42.2k LOC): Svelte 5 runes UI; two stores
  (`notebase.svelte.ts`, `editor.svelte.ts`) plus a large `conversations`
  store (890 lines); IPC client wrapper (`lib/ipc/client.ts`, 834 lines).
- **Shared** (`src/shared/`): channel constants, types, the thought ontology,
  and pure logic reused by both ends (skills menu-config, tool registry/grouping,
  formatter rules, markdown helpers). Verified pure: no imports of `fs`/`path`/
  `child_process`/`electron`, no imports from `main` or `renderer`.

**Design patterns observed:**
- **Proposal / approval (command + memento)**: `ProposalPayload` bundles with a
  per-payload apply/rollback dispatcher (`approval.ts:413 applyBundle`,
  `:440 dispatchApply`, reverse-order rollback at `:432`).
- **Context object**: `ProjectContext` brand type
  (`project-context-types.ts`) threaded through main APIs to avoid passing raw
  root-path strings — a deliberate type-safety affordance.
- **Pipeline**: skills `parse.ts → loader.ts → compile.ts → register.ts`, with a
  non-executing template DSL (`template.ts`).
- **Registry**: `shared/tools/registry.ts` Map-based tool registry,
  instantiated independently in both main and renderer (shared pure logic,
  duplicated state — intentional).
- **Named-graph-per-note indexing**: each note's triples live in a named graph
  keyed by note URI, enabling clean incremental re-index via `removeMatches`
  (`graph/index.ts:748-753`) — a strong, scalable choice.

### Architecture Diagram (ASCII)

```
                        ┌──────────────────────────────────────────┐
                        │  src/shared  (PURE — no fs/electron/IO)   │
                        │  channels • types • ontology • tools/      │
                        │  registry+grouping • skills/menu-config •  │
                        │  formatter rules • markdown helpers        │
                        └───────────▲───────────────────▲──────────┘
                                    │ imports           │ imports
              ┌─────────────────────┘                   └────────────────────┐
              │                                                               │
   ┌──────────┴───────────┐        contextBridge          ┌─────────────────┴────────────┐
   │     RENDERER          │  window.api  (preload.ts)     │           MAIN                │
   │  App.svelte (3764) ───┼──── IPC invoke/handle ───────▶│  ipc.ts (2717, 187 handlers) │
   │  Preview (2585)       │◀─── events (webContents.send) │  ┌─────────────────────────┐ │
   │  ConversationsPanel   │                               │  │ graph/index.ts (2717)   │ │
   │  stores: notebase /   │                               │  │  N3.Store + Comunica    │ │
   │  editor / conversations│                              │  │  named-graph-per-note   │ │
   │  lib/ipc/client.ts ───┘                               │  │  WRITE GUARD (dev)      │ │
   └───────────────────────┘                               │  └───────────▲─────────────┘ │
        ▲  LAYER VIOLATION                                  │  ┌───────────┴───────────┐  │
        └──────────────────────────────────────────────────┼──┤ llm/ approval.ts(640) │  │
           main/compute/save-cell-output.ts imports         │  │  proposeWrite/approve │  │
           renderer/lib/editor/output-block                 │  │  applyBundle+rollback │  │
                                                            │  └───────────────────────┘  │
                                                            │  skills/ (parse→loader→     │
                                                            │  compile→register)          │
                                                            │  sources/ notebase/ compute/│
                                                            │  publish/ git/ menu.ts      │
                                                            └──────────────────────────────┘
```

## Architectural Issues

### Critical Issues

**C1 — `src/main/ipc.ts` is a 2,717-line god-module with one mega-function.**
All 187 `ipcMain.handle` registrations live in a single `registerIpcHandlers()`
(`ipc.ts:432` onward), with 81 imports at the top. The file mixes pure
registration with substantial business logic (e.g. `recordComputeProposalRun`,
`buildComputeProposalNoteBlock`, `escapeTurtleLiteral`, the `propose_compute`
helpers at `:307`). This concentrates every domain's IPC concerns in one place,
makes merge conflicts likely, and obscures which channels belong to which
subsystem. The `~256` channel constants in `channels.ts` plus ad-hoc string
channels (`'notebase:openPath'`, `'recent:clear'`, `'notebase:newWindow'` at
`ipc.ts:442-527`) mean the channel surface is partly typed, partly stringly.

**C2 — `src/renderer/App.svelte` (3,764 lines) is an over-large root component.**
It owns dialog state (`showPrompt`/`showConfirm`), menu-command dispatch, IPC
event subscriptions, and cross-panel orchestration. At this size it is the
renderer's equivalent of `ipc.ts` — the place every feature reaches into. The
self-aware comment at `App.svelte:499` ("menu still lives in `src/main/menu.ts`
— moving menus to read...") signals known coupling between native menu wiring and
renderer state.

**C3 — Layer violation: main imports renderer.**
`src/main/compute/save-cell-output.ts:18` imports `findRunnableFences`, `codeOf`,
`FenceRange` from `../../renderer/lib/editor/output-block`. This inverts the
dependency direction (main must not depend on renderer) and means a renderer-only
build/refactor can break the main process. The shared fence-parsing logic should
move to `src/shared/` (where `shared/compute/cell-id` already lives — note
`save-cell-output.ts:23` already imports from there, so the pattern exists).

### Design Flaws

**D1 — `graph/index.ts` (2,717 lines) has too many responsibilities.** It holds:
store lifecycle/state, the LLM write guard (`:236-270`), per-format indexers
(`indexTurtleFile`, `indexCsvFile`, `indexPythonFile`, table/CSVW indexing
`:993+`), SPARQL execution, alias/heading tracking, and rename heuristics. The
write guard in particular is a cross-cutting concern that would be better as its
own module so it can be unit-tested in isolation and reused.

**D2 — Write guard is dev-only and easy to bypass by construction.** `graph`
exports `enterLLMContext`/`exitLLMContext` and `checkLLMWriteGuard` only *logs*
(`graph/index.ts:230+` comment: "Dev-time guard... No-op in trusted context").
Any new code path that mutates the store while *not* in LLM context (the common
case for non-LLM features) is unguarded — correct by design, but it means the
Trust Principle's enforcement depends on every LLM entry point remembering to
call `enterLLMContext()` (done manually at `ipc.ts:2090`, `auto-link.ts`,
`auto-tag.ts`). There is no integrity *test* asserting the gate cannot be
skipped, despite CLAUDE.md's checklist requesting one.

**D3 — Self-approving writes outside the approval engine.**
`ipc.ts recordComputeProposalRun` writes a `thought:ComputeProposal` with
`thought:proposalStatus thought:approved` directly via `graph.parseIntoStore`,
bypassing `proposeWrite`/`approveProposal`. This is intentional (it is an
audit-trail record of an already-user-confirmed compute run, not a graph claim),
but it is exactly the kind of direct `parseIntoStore` from a near-LLM path the
write guard is meant to catch. Worth an explicit comment tying it to the trust
model and an integrity-query carve-out.

**D4 — `notify_only` applies before the user sees it.** `approval.ts:193-195`
calls `applyBundle` immediately for `notify_only` and writes the proposal with
status `approved` (`:180`). This is per the documented tier table, but it means
"confidence updates / status changes" mutate the graph with no review window —
acceptable, but the boundary between `notify_only` and `requires_approval` is the
single most security-relevant policy line (`DEFAULT_POLICY`, `approval.ts:112`)
and deserves tests pinning each `OperationType` to its tier.

**D5 — Unwired proposal payload kinds throw at apply time.** `dispatchApply`
(`approval.ts:473-477`) throws for `source` and `saved-query` kinds. The type
advertises five kinds but only three are wired. This is documented and
deliberate, but a proposal can be *created* with a kind that will fail on
approve — a latent footgun if a skill emits one. Consider validating payload
kind at `proposeWrite` time, not only at apply time.

### Pattern Inconsistencies

**P1 — Channel definition is half-typed, half-stringly.** Most handlers use
`Channels.*` constants; several use raw strings (`ipc.ts:442,448,462,468,527`).
Pick one convention.

**P2 — No enforced import boundaries.** `eslint.config.mjs` has no
`no-restricted-imports`/boundary rules. The clean layering (verified: shared is
pure, renderer→main is absent except C3) is maintained purely by discipline; one
errant import (C3) already slipped through.

**P3 — Tool registry duplicated across processes.** `shared/tools/registry.ts`
holds module-level `Map` state and is instantiated separately in main and
renderer. This is the intended design (renderer gets serializable `SkillInfo`),
but module-global mutable state in a *shared* file is a subtle pattern that can
surprise (e.g. in tests importing the registry). Acceptable, but document it.

**P4 — Oversized Svelte components beyond App.svelte.** `Preview.svelte` (2,585),
`ConversationsPanel.svelte` (2,232), `SettingsDialog.svelte` (2,205),
`SourcesPanel.svelte` (1,509), `Editor.svelte` (1,337). These mix rendering,
local state, and IPC orchestration that could be extracted into child components
or per-feature stores.

## SOLID Principles Assessment

**Single Responsibility — 2/5.** The pure-logic modules in `shared/` and the
small skills-pipeline files (`compile.ts`, `register.ts`, `loader.ts`) are
exemplary. But the load-bearing files violate SRP badly: `ipc.ts`,
`graph/index.ts`, `App.svelte`, `Preview.svelte`, `ConversationsPanel.svelte`
each carry 4+ distinct responsibilities. The average is dragged down by where it
matters most.

**Open/Closed — 4/5.** Strong. The skills system makes the entire Tools-for-
Thought surface extensible without code changes (markdown files + a template
DSL), and menu-config logic is pure and shared. The approval engine's
`ProposalPayload` discriminated union + dispatcher is open to new payload kinds
(though D5 shows the extension point isn't fully wired). Per-format indexers in
`graph/index.ts` are extended by adding a branch rather than a registered
handler — minor closure leak.

**Liskov Substitution — 4/5.** Few class hierarchies; the codebase is largely
functional. The `ProjectContext` brand type and discriminated unions
(`ProposalPayload`, exporters) are used substitutably and correctly. No notable
violations.

**Interface Segregation — 3/5.** `window.api` (preload, 551 lines) and
`lib/ipc/client.ts` (834 lines, ~75 methods) are large monolithic interfaces —
every renderer consumer depends on the whole `api` surface. Slicing `api` into
namespaced sub-objects (`api.graph`, `api.skills` already exist per CLAUDE.md)
is partially done; completing it would improve segregation.

**Dependency Inversion — 3/5.** The `ProjectContext` indirection and the
shared-types boundary are good DIP instincts. But concrete coupling dominates:
`approval.ts` imports `graph` and `notebaseFs` concretely (`approval.ts:2-3`),
IPC handlers call concrete subsystem modules directly, and the C3 violation is a
hard dependency from main onto renderer internals. No DI/abstraction layer
between IPC and the domain modules.

Overall SOLID: ~3.2/5 — held up by excellent OCP/LSP and the pure shared layer,
pulled down by SRP in the four mega-modules and the missing boundary enforcement.

## Improvement Plan

### High Priority (Structural Fixes)

1. **Fix the C3 layer violation.** Move `findRunnableFences`/`codeOf`/`FenceRange`
   from `renderer/lib/editor/output-block` into `src/shared/compute/` and have
   both `save-cell-output.ts` and the renderer import from shared. Removes the
   only main→renderer dependency.
2. **Add enforced import boundaries.** Add `no-restricted-imports` (or
   `eslint-plugin-boundaries`) rules to `eslint.config.mjs`: shared may import
   nothing from main/renderer/node-builtins; main may not import renderer;
   renderer may not import main. This freezes the currently-clean topology.
3. **Decompose `ipc.ts`.** Split `registerIpcHandlers()` into per-domain
   registrars (`registerNotebaseIpc`, `registerGraphIpc`, `registerLlmIpc`,
   `registerSourcesIpc`, `registerSkillsIpc`, ...) in `src/main/ipc/*.ts`, each
   importing only its subsystem. Move embedded business logic
   (`recordComputeProposalRun`, turtle escaping) into the relevant domain module.

### Medium Priority (Design Improvements)

4. **Decompose `App.svelte`.** Extract dialog management, menu-command dispatch,
   and IPC-event subscription into dedicated modules/stores. Target < 1,000
   lines for the root.
5. **Extract the write guard** from `graph/index.ts` into
   `src/main/graph/write-guard.ts` and **add a test** asserting an
   in-LLM-context direct `store.add` is detected (satisfies the CLAUDE.md
   checklist item "tests that verify the approval gate cannot be skipped").
6. **Pin the approval policy with tests.** Unit-test `DEFAULT_POLICY` →
   `getApprovalTier` for every `OperationType`, and the established-node
   escalation rule. This is the highest-value test surface in the app.
7. **Validate proposal payload kinds at `proposeWrite` time** (D5) so an unwired
   kind fails fast at creation, not at the user's approval click.

### Low Priority (Consistency)

8. **Normalize channel definitions** — convert the raw-string channels in
   `ipc.ts` to `Channels.*` constants (P1).
9. **Split the largest Svelte components** (`Preview`, `ConversationsPanel`,
   `SettingsDialog`) into feature sub-components.
10. **Complete `window.api` namespacing** for interface segregation (P4/ISP).
11. **Document the duplicated tool registry pattern** (P3) at the top of
    `shared/tools/registry.ts`.

## Migration Strategy

### Phase 1: Foundation
- Add eslint boundary rules (#2). Fix C3 first so the new rule passes (#1).
- Add the approval-policy and write-guard tests (#5, #6) before any refactor, so
  the Trust Principle is regression-protected during later moves.

### Phase 2: Core Refactoring
- Split `ipc.ts` into per-domain registrars (#3). Mechanical and low-risk because
  each handler is independent; do it one domain per PR.
- Decompose `App.svelte` (#4) and extract the write guard (#5).
- Add payload-kind validation at propose time (#7).

### Phase 3: Optimization
- Slice `Preview.svelte`/`ConversationsPanel.svelte`/`SettingsDialog.svelte`.
- Finish `window.api` namespacing.
- Normalize channels; revisit per-format indexers in `graph/index.ts` toward a
  small registered-indexer pattern (OCP).

## Impact Analysis

- **Risk concentration:** `ipc.ts`, `graph/index.ts`, and `App.svelte` are the
  three files every feature touches; they are the blast radius for almost any
  change. Decomposing them reduces merge-conflict surface the most.
- **Trust Principle integrity:** Currently sound in code but under-tested. The
  enforcement is convention (manual `enterLLMContext`) + a logging guard, so the
  *tests* in Phase 1 are what actually protect the most important design
  decision. Until then, a new LLM tool that forgets `enterLLMContext` would
  bypass the guard silently.
- **Performance:** Indexing is *incremental* and well-designed — named-graph-
  per-note (`graph/index.ts:748-753`) means a single note write re-indexes only
  that note's graph, not the whole store; `indexNote` is sync-bodied with a
  single staleness `invalidate` at the boundary (`:744`). Full reindex is reserved
  for explicit rebuild. No re-index-the-world-on-every-keystroke problem.
- **Extensibility:** The skills framework is the codebase's biggest future-proof
  win — 43 stock skills, user skills additive at runtime, pure menu-config logic
  shared across native menu / renderer / settings UI. New tools require no code.

## Recommendations

1. Treat the four mega-modules as the primary debt; everything else is minor.
2. Lock the layering you already have with eslint before it erodes further.
3. Invest the next test increment in the approval engine specifically — it is the
   load-bearing trust boundary and the CLAUDE.md checklist already asks for it.
4. Keep the shared-layer purity discipline — it is the single best structural
   property of this codebase and the reason refactors will stay tractable.
5. Don't over-abstract. The functional, registry-driven style is working; resist
   adding DI frameworks. The fixes here are extractions and boundary rules, not
   re-architecture.

## Estimated Effort

| Item | Effort |
|------|--------|
| C3 fix + eslint boundary rules (#1, #2) | 0.5 day |
| Approval-policy + write-guard tests (#5, #6) | 1 day |
| Split `ipc.ts` into domain registrars (#3) | 2–3 days (incremental) |
| Decompose `App.svelte` (#4) | 2–3 days |
| Payload-kind validation (#7) | 0.5 day |
| Channel normalization (#8) | 0.5 day |
| Split large Svelte components (#9) | 3–4 days |
| `window.api` namespacing (#10) | 1–2 days |
| **Total** | **~11–15 days**, sequenceable one PR at a time |
