# Architecture Review

Generated: 2026-08-01 21:26:29
Scope: entire project (/Users/davegriffith/minerva)
Prior review: reports/architecture-review-entire-project-2026-06-10-114911.md

## Executive Summary

Minerva remains a mature, unusually well-layered Electron + Svelte 5 + TypeScript
desktop markdown IDE (~120k LOC across ~700 source files). The headline of this
review is not new problems — it is that **the June review's entire High-Priority
plan has been executed**, and the codebase is materially healthier for it.

Specifically, every top-3 structural fix from June is done:

- **C3 (main→renderer layer violation) is fixed.** `grep` for `renderer/` imports
  under `src/main` now returns nothing.
- **Enforced import boundaries exist** (`eslint.config.mjs:192-232`, #668):
  `shared` may not import main/renderer/preload/`node:*`; main may not import
  renderer; renderer may not import main. The clean topology is now machine-frozen,
  not convention.
- **`ipc.ts` (was 2,717 lines, one mega-function) is gone.** It is now 21
  domain-sliced `src/main/ipc/register-*.ts` modules plus a typed dispatch layer
  (`typed-ipc.ts`, `helpers.ts`) and a single typed contract
  (`src/shared/ipc-contract.ts`, #981). Only the wrapper itself calls raw
  `ipcMain.handle`; all 21 registrars go through the typed `handle`.
- **`graph/index.ts` (was 2,717 lines) is 226 lines**, a thin facade over
  extracted modules: `indexers.ts`, `queries.ts`, `state.ts`, `write-guard.ts`,
  `health-checks.ts`, `integrity.ts`, `neighborhood.ts`, `parser.ts`.
- **The write guard is its own module** (`graph/write-guard.ts`, 102 lines) with
  dedicated tests (`write-guard.test.ts`, `write-guard-wired.test.ts`,
  `trust-integrity.test.ts`) — closing June's D2 gap ("no integrity test asserting
  the gate cannot be skipped").

The renderer story changed just as much. June counted **two** stores; there are
now **24 rune stores** plus **10 App-ops modules**, and the renderer data-flow
rule (#1086) is enforced by an eslint `no-restricted-syntax` block
(`eslint.config.mjs:241-279`) with **zero `eslint-disable` escapes** anywhere in
the tree. `App.svelte` shrank from 3,764 to 2,011 lines (script portion ends at
line 956; the rest is template).

The new object-type editor work (#1584-1588) is a model of seam adherence: it
mirrors the skills pipeline exactly (`src/main/types/` = parse/loader/compile/
write/migrate + `stock/*.md`), keeps its domain logic pure in `src/shared/objects/`,
exposes a typed `register-types.ts`, and fronts all mutations through a proper
`object-types.svelte.ts` store.

What remains is a **shorter, milder** list than June's: one residual god-module
(`graph/indexers.ts`, 1,665 lines), a cluster of oversized Svelte components
(`Preview` 2,185, `Editor` 1,475, `SettingsDialog` 1,423, `SourceDetail` 1,365,
`SourcesPanel` 1,297, `PropertiesPanel` 1,127), the largest IPC registrar
(`register-conversation.ts`, 967), a fragility in the data-flow rule's denylist
design, and one genuinely new correctness finding: the type rename/delete batch
rewrite (`types/migrate.ts`) is non-atomic.

**No Critical issues remain.** The architecture is in the best shape this review
series has recorded.

## Current Architecture

### Overview

**Style:** Three-process Electron app (Main / Preload / Renderer) with strict
`contextBridge` isolation, plus a fourth conceptual layer — a genuinely pure
`shared` domain library imported by both ends. All four boundaries are now
eslint-enforced.

**Key components:**

- **Main** (`src/main/`) — Node. File I/O behind `notebase/fs.ts`
  (`assertSafePath` traversal guard); the RDF graph as a thin facade
  (`graph/index.ts`, 226 lines) over `indexers.ts`/`queries.ts`/`state.ts`/
  `write-guard.ts`; SPARQL via Comunica over an N3.Store; the LLM/approval engine
  (`llm/`, with `approval.ts` now 163 lines + `apply-dispatch.ts` 482 +
  `proposal-persistence.ts` + a `tools/` folder of per-tool proposers); the skills
  pipeline (`skills/`); the **new type system** (`types/`); sources (`sources/`);
  compute kernels (`compute/`); publish/export (`publish/`); a new `substrate/`
  app-server (MCP epic #1145) and `search/` (minisearch provider); IPC registrars
  (`ipc/register-*.ts`).
- **Preload** (`src/preload/preload.ts`, 721 lines) — the single `contextBridge`
  surface exposing `window.api`.
- **Renderer** (`src/renderer/`) — Svelte 5 runes UI. **24 singleton stores**
  (`lib/stores/*.svelte.ts`) own `api.*` mutations + event subscriptions; **10 App
  ops modules** (`lib/app/*`) provide top-level orchestration clusters wired by
  `App.svelte` as the composition root; `lib/ipc/client.ts` (1,122 lines) is the
  typed `api` wrapper.
- **Shared** (`src/shared/`) — channel constants, types, the typed IPC contract
  (`ipc-contract.ts`), the thought ontology, and pure logic: skills menu-config,
  tool registry/grouping, formatter rules, markdown/refactor helpers, and the new
  `objects/` type-definition domain. Verified pure (no fs/path/electron/`node:`,
  no main/renderer imports) both by grep and by the eslint boundary rule.

**Design patterns observed:**

- **Proposal / approval (command + memento):** the Trust Principle. `llm/`
  proposes; the human confirms; `apply-dispatch.ts` applies per-payload with
  reverse-order rollback. Now split out of the old monolith into `approval.ts` +
  `apply-dispatch.ts` + `proposal-persistence.ts`.
- **Pipeline, applied twice:** skills (`parse → loader → compile → register`) and
  now **types** (`types/parse.ts → loader.ts → compile.ts → write.ts / migrate.ts`),
  both fed by bundled `stock/*.md`. The type system deliberately reuses the exact
  shape of the skills subsystem.
- **Typed IPC contract (#981):** `shared/ipc-contract.ts` is one source of truth
  linking channel ↔ handler ↔ preload ↔ client signatures; the typed
  `handle`/`invoke` wrappers derive arg/return types from it, so a wrong
  param/return fails `tsc`. This resolves June's P1 (half-typed/half-stringly
  channels).
- **Store-owns-mutation (#1086):** every state write and every main→renderer
  subscription lives in a store or ops module; components read reactive state and
  call store methods. Enforced by lint.
- **Context object:** `ProjectContext` brand type threaded through main APIs.
- **Named-graph-per-note indexing:** incremental re-index per note; unchanged and
  still strong.

### Architecture Diagram (real 3-process + store/ops + graph)

```
        ┌────────────────────────────────────────────────────────────────┐
        │  src/shared  (PURE — eslint-enforced: no fs/electron/node/main)  │
        │  channels • types • ipc-contract(#981) • ontology •              │
        │  objects/ (type-def, inheritance, card) • tools/registry+group • │
        │  skills/menu-config • formatter rules • markdown/refactor        │
        └───────▲──────────────────────────────────────────────▲─────────┘
                │ imports (typed)                                │ imports (typed)
   ┌────────────┴───────────────┐   contextBridge   ┌───────────┴──────────────────┐
   │        RENDERER             │  window.api       │            MAIN               │
   │                             │  (preload 721)    │                               │
   │  App.svelte (2011)          │                   │  ipc/register-*.ts  (21 files)│
   │   = composition root        │── invoke/handle ─▶│  typed-ipc.ts + helpers.ts    │
   │   wires 10 ops modules      │◀── events ────────│  register-conversation (967)  │
   │                             │                   │        │                      │
   │  24 stores (own api.* +     │                   │        ▼                      │
   │   subscriptions):           │                   │  ┌──────────────────────────┐ │
   │   notebase editor           │                   │  │ graph/index.ts (226 facade)│ │
   │   conversations proposals   │                   │  │  indexers.ts (1665) ◀─OCP  │ │
   │   object-types source-data  │                   │  │  queries.ts(1267) state.ts │ │
   │   settings … (+16)          │                   │  │  write-guard.ts (tested)   │ │
   │                             │                   │  │  N3.Store + Comunica       │ │
   │  components/ (read-only api;│                   │  └────────────▲───────────────┘ │
   │   mutations via stores —    │                   │  ┌────────────┴──────────────┐ │
   │   lint-enforced #1086)      │                   │  │ llm/ approval.ts (163) +   │ │
   │  Preview(2185) Editor(1475) │                   │  │  apply-dispatch.ts (482) + │ │
   │  SettingsDialog(1423) …     │                   │  │  tools/ proposers          │ │
   │                             │                   │  └────────────────────────────┘ │
   │  Type editor (#1584-88):    │                   │  types/ (parse→loader→compile→  │
   │   ObjectTypesSettings →     │                   │   write/migrate) + stock/*.md   │
   │   object-types store →──────┼── api.types.* ───▶│  register-types.ts (typed)      │
   │   TypeEditorDialog TypeView │                   │  skills/ sources/ compute/      │
   │                             │                   │  publish/ substrate/ search/    │
   └─────────────────────────────┘                   └───────────────────────────────┘
        NO main→renderer imports (C3 fixed) · NO circular deps (madge, 703 files)
```

## Architectural Issues

### Critical Issues

**None.** June's three Critical items (C1 `ipc.ts` god-module, C2 `App.svelte`
size, C3 main→renderer import) are all resolved. C1 and C3 are fully closed; C2 is
substantially reduced (3,764 → 2,011, with orchestration extracted to 10 ops
modules) and downgraded to a Design Flaw below.

### Design Flaws

**D1 — `graph/indexers.ts` (1,665 lines) is the last real god-module.** The graph
decomposition extracted the store, queries, write-guard, health-checks and parser,
but concentrated *all* per-format indexing plus several unrelated concerns into one
file: note indexing (`indexNote`, `indexers.ts:565`), CSV tables
(`indexCsvTable`, `:889`), markdown tables (`indexMarkdownTable`, `:981`), sources
(`indexSource`, `:1222`), excerpts (`indexExcerpt`, `:1341`), the type catalog
(`reloadTypeCatalog`, `:268`), ontology bootstrap (`addOntologyToStore`, `:518`),
and frontmatter-predicate resolution (`resolveFrontmatterPredicate`, `:275`). It is
the single file most future graph features will have to touch. Splitting per-format
indexers into `graph/indexers/{note,tables,source,excerpt}.ts` would mirror what was
already done to `ipc.ts`.

**D2 — Non-atomic batch rewrite in type rename/delete (NEW, #1588).**
`types/migrate.ts:28-41` (`retypeNotes`) loops over every instance of a type,
reading, `writeFile`-ing, and `indexNote`-ing each note in sequence. If any
iteration throws (a read/write error, a reindex failure), earlier notes are already
rewritten and later ones are not — leaving the thoughtbase in a half-migrated state
with **no rollback**, and the returned `migrated`/`cleared` list will not reflect
what actually persisted vs. what the caller believes. For a type with many
instances this is also O(n) sequential disk writes + full per-note reindex. This is
correctly *outside* the approval engine (it is a user-initiated frontmatter rewrite,
like the promote flow, not an LLM write — the header documents this and it is the
right call), but it should either be made resumable/idempotent or at minimum
surface partial-failure to the caller instead of propagating a bare throw.

**D3 — Oversized Svelte components persist below `App.svelte`.** `Preview.svelte`
(2,185), `Editor.svelte` (1,475), `SettingsDialog.svelte` (1,423),
`SourceDetail.svelte` (1,365), `SourcesPanel.svelte` (1,297), and
`PropertiesPanel.svelte` (1,127) still mix rendering, local state, and orchestration.
`SettingsDialog.svelte` in particular is a container for many unrelated settings
panes and is a natural split candidate. These are less risky than the old god-modules
(they don't concentrate cross-feature wiring), but they remain the renderer's biggest
SRP offenders. Note `Preview` and `SettingsDialog` actually shrank slightly since
June (2,585→2,185; 2,205→1,423), so the trend is right.

**D4 — `register-conversation.ts` (967 lines) is the outlier registrar.** The IPC
split produced 20 small, single-domain registrars and one large one: the
conversation registrar carries ~36 handler/function sites and concentrates the
LLM conversation lifecycle, proposal wiring, and tool-callback surface. Because this
is an LLM/graph write path, it is also the highest-stakes registrar. It would
benefit from the same slicing the other domains received (e.g. splitting proposal
handling from conversation lifecycle).

### Pattern Inconsistencies

**P1 — The data-flow rule is a hand-maintained denylist, not an allowlist.** The
`no-restricted-syntax` selector (`eslint.config.mjs:247-272`) matches a long regex
of specific mutation method names plus a set of generic verbs
(`merge|rename|remove|create|add|delete|save|move|import|reload|execute|cancel`).
This is enforced and currently has zero bypasses, but a **newly added mutation
channel whose verb is not in the list** (and isn't one of the generic verbs) will
silently pass lint from inside a component — the rule is only as complete as the
regex, and CLAUDE.md itself flags the manual step ("When you add a new mutation
channel, add its method name to the regex below"). An allowlist model (components
may only call a known set of read/`shell`/`export`/`view` methods) would fail
*closed* instead of *open*. Reviewers of new IPC PRs must remember this coupling.

**P2 — Typed IPC contract is scoped, not universal.** `ipc-contract.ts` is
documented as the contract "for the notebase domain (#981)". Most channels flow
through it and the typed `handle`, which is a large improvement over June, but the
contract's name/scope suggests not every domain's signatures are yet centralized in
one `ChannelMap`. Worth confirming that skills/types/sources/publish signatures are
all represented so no channel falls back to `unknown` args.

**P3 — Tool/type registries carry module-level mutable state in `shared/`.**
Unchanged from June P3: `shared/tools/registry.ts` (and the analogous type catalog
handling) hold module-global `Map`/state instantiated independently per process.
This is intentional (renderer gets serializable info), but module-global mutable
state in a *pure* layer remains a subtle pattern that can surprise tests importing
the registry. Still just worth a documented note at the top of the file.

## SOLID Principles Assessment

**Single Responsibility — 3/5** (up from 2/5). The two worst offenders (`ipc.ts`,
`graph/index.ts`) were decomposed into cohesive modules; `App.svelte` lost its
orchestration to 10 ops modules and 24 stores. The score is held below 4 by the
residual `graph/indexers.ts` (1,665, D1) and the oversized-component cluster (D3).
The new `types/` and `objects/` modules are exemplary — each file does one thing.

**Open/Closed — 4/5** (unchanged, now doubly demonstrated). The skills system made
Tools-for-Thought extensible without code; the **new type system extends the same
pattern** — a user drops `.minerva/types/<id>.md` and it is picked up without a
rebuild (`register-types.ts:5-6`). The one closure leak persists: per-format
indexers in `indexers.ts` are extended by adding a branch/function rather than
registering a handler (OCP), which is exactly what D1 would fix.

**Liskov Substitution — 4/5** (unchanged). Still a largely functional codebase with
few hierarchies; discriminated unions (`ProposalPayload`, exporters, `PropertyType`)
and the `ProjectContext` brand are used substitutably. No violations found.

**Interface Segregation — 4/5** (up from 3/5). The typed `ipc-contract.ts` plus the
namespaced `api.*` surface plus **24 focused stores** mean consumers now depend on
narrow slices (`objectTypesStore`, `sourceData`, `proposals`) rather than one
monolithic `api`. The remaining drag is that `lib/ipc/client.ts` (1,122 lines) and
the preload bridge are still single large surfaces, but the *consumption* is well
segregated.

**Dependency Inversion — 3/5** (unchanged). Concrete coupling still dominates:
`types/migrate.ts` imports `graph` and `notebaseFs` concretely (`migrate.ts:8-9`),
registrars call subsystem modules directly, and the approval engine imports graph
concretely. The typed contract and `ProjectContext` are good DIP instincts, and the
enforced boundaries prevent *cross-layer* inversion, but there is still no
abstraction seam between IPC and the domain modules. This is an acceptable,
deliberate trade-off for a functional single-developer codebase — not a defect to
fix, just a ceiling on the score.

**Overall SOLID: ~3.6/5** (up from ~3.2). The gain is almost entirely SRP + ISP,
earned by executing June's decomposition plan.

## Improvement Plan

### High Priority

1. **Make the type migrate batch safe (D2).** In `types/migrate.ts`, either (a)
   collect all rewrites, apply them, and on any failure roll back the notes already
   written, or (b) make `retypeNotes` return per-note success/failure and have the
   caller report a partial result to the UI instead of throwing. At minimum, wrap
   the loop so a mid-batch failure does not leave the returned list lying about what
   persisted. Add a test with a forced write failure on the k-th instance.

2. **Split `graph/indexers.ts` (D1).** Extract per-format indexers into
   `graph/indexers/{note,tables,source,excerpt}.ts` behind the existing
   `graph/index.ts` facade. Mechanical and low-risk (the functions are already
   independent exports); do one format per PR. Optionally introduce a small
   registered-indexer map to close the OCP leak.

### Medium Priority

3. **Harden the data-flow rule (P1).** Convert the `no-restricted-syntax` denylist
   to an allowlist of permitted read/OS methods, or add a lint/test that asserts
   every mutation channel name in `channels.ts` appears in the rule's regex, so a
   new mutation channel can't be called from a component by omission.

4. **Slice `register-conversation.ts` (D4)** into conversation-lifecycle vs.
   proposal/tool-callback registrars, mirroring the other 20 domains.

5. **Confirm/complete typed-contract coverage (P2).** Ensure every domain's channel
   signatures live in `ipc-contract.ts` (or a per-domain contract) so no handler
   falls back to `unknown`.

### Low Priority

6. **Split the oversized components (D3):** `SettingsDialog.svelte` into per-pane
   children; extract local orchestration from `Preview`, `Editor`, `SourceDetail`,
   `SourcesPanel`, `PropertiesPanel` into stores/sub-components.

7. **Document the module-global registry pattern (P3)** at the top of
   `shared/tools/registry.ts` and the type catalog loader.

## Migration Strategy

### Phase 1: Correctness (do first)
- Fix the type-migrate atomicity bug (#1) and add its failure-path test. This is the
  only finding with user-visible data-loss potential (silent half-migration), so it
  leads regardless of size.

### Phase 2: Decomposition (mechanical, one PR each)
- Split `graph/indexers.ts` by format (#2), one format per PR, leaning on the strong
  existing graph test suite (`csv-indexing`, `markdown-table-indexing`,
  `python-indexing`, `sources-index`, `excerpt-index`, etc.) as the regression net.
- Slice `register-conversation.ts` (#4).

### Phase 3: Guardrails & polish
- Convert the data-flow rule to an allowlist or add the channel-coverage assertion
  (#3); confirm typed-contract completeness (#5).
- Split the oversized components (#6); document the registry pattern (#7).

## Impact Analysis

- **Risk concentration has genuinely dropped.** The three files every feature used
  to touch (`ipc.ts`, `graph/index.ts`, `App.svelte`) are decomposed; blast radius
  and merge-conflict surface are far smaller than in June. The remaining
  concentration points are `graph/indexers.ts` (graph features) and the oversized
  components (their own features) — narrower, domain-local hotspots.
- **Trust Principle integrity is now tested, not just observed.** June's D2 gap is
  closed: `write-guard.ts` is isolated with `write-guard.test.ts`,
  `write-guard-wired.test.ts`, and `trust-integrity.test.ts` asserting the honest
  path is empty and bypass/pending-only paths are flagged. The
  `findUnreviewedLLMWrites` integrity gate (CLAUDE.md) runs on every PR. This is the
  single most important improvement since June.
- **Layering is frozen.** The eslint boundary rules (#668) plus verified-clean grep
  plus zero data-flow-rule bypasses mean the topology can no longer erode silently —
  exactly the durability June asked for.
- **The type system fits the existing seams with zero new architecture.** It reuses
  the skills pipeline shape, the pure-shared discipline, the typed-IPC pattern, and
  the store/ops rule. This is the strongest signal that the architecture is
  self-consistent enough that new subsystems land cheaply.
- **Performance:** incremental named-graph-per-note indexing is unchanged and still
  strong. The one new perf note is the O(n) sequential write+reindex in type
  migration (D2), which is bounded by a type's instance count and only runs on an
  explicit rename/delete.

## Recommendations

1. **Ship the type-migrate atomicity fix first** — it is the only finding with a
   data-loss shape, and it is small.
2. **Finish the decomposition arc you started:** `graph/indexers.ts` and
   `register-conversation.ts` are the last two files that carry the old god-module
   smell. The pattern for fixing them already exists in this repo.
3. **Make the data-flow guard fail closed.** The rule is excellent policy but its
   denylist implementation can be defeated by omission; an allowlist or a
   channel-coverage test removes the one manual step in an otherwise-enforced system.
4. **Keep doing exactly what produced this delta.** The June plan was executed
   almost verbatim and the codebase is measurably better; the pure-shared discipline,
   the store/ops rule, and the typed IPC contract are the load-bearing structural
   wins — protect them.
5. **Resist new abstraction.** DIP sits at 3/5 by choice; the functional,
   registry-driven, contract-typed style is working. The remaining work is
   extraction and one bug fix, not re-architecture.

## Estimated Effort

| Item | Effort |
|------|--------|
| Type-migrate atomicity + failure test (#1) | 0.5–1 day |
| Split `graph/indexers.ts` by format (#2) | 2–3 days (incremental) |
| Data-flow rule → allowlist / coverage test (#3) | 0.5–1 day |
| Slice `register-conversation.ts` (#4) | 1 day |
| Confirm typed-contract coverage (#5) | 0.5 day |
| Split oversized components (#6) | 4–5 days |
| Document registry pattern (#7) | 0.25 day |
| **Total** | **~9–12 days**, sequenceable one PR at a time |

Net: the remaining debt is roughly two-thirds the size of June's, and none of it is
Critical. The June review's "treat the four mega-modules as the primary debt"
directive was followed — three are gone and the fourth (`indexers.ts`, spun out of
the old `graph/index.ts`) is the main structural item left.
