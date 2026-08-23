# Architecture Review

Generated: 2026-08-23 08:09:03
Scope: entire project (/Users/davegriffith/minerva)
Prior review: reports/architecture-review-entire-project-2026-08-01-212629.md

## Executive Summary

Minerva is a 759-file / 127,310-line Electron + Svelte 5 + TypeScript desktop
markdown IDE with 596 test files (74,940 lines). Three weeks after the August 1
review, **the plan in that review was executed again** — five of its seven
recommendations are done, one is partial, one was not attempted.

Verified against the code:

| # | Aug 1 recommendation | Status | Evidence |
|---|---|---|---|
| 1 (High) | Make the type-migrate batch safe | **Done** (#1611) | `src/main/types/migrate.ts:26-66` — `RetypeFailure`/`RetypeResult`, per-note isolation, only disk-confirmed notes enter `rewritten` |
| 2 (High) | Split `graph/indexers.ts` | **Done** | 1,665 → 991 lines; `src/main/graph/indexers/{tables.ts 303, source.ts 161, excerpt.ts 119, note-files.ts 110}` |
| 3 (Med) | Data-flow rule → allowlist | **Not done** | `eslint.config.mjs:25-54` is still a denylist regex; live gap at `Editor.svelte:506` |
| 4 (Med) | Slice `register-conversation.ts` | **Done** | 967 → 452, plus `register-conversation-drafts.ts` (601) |
| 5 (Med) | Complete typed-contract coverage | **Done** (#1606) | `src/shared/ipc-contract.ts:1-27` now spans every invoke domain, structurally enforced |
| 6 (Low) | Split oversized components | **Partial** | Preview 2185→1531, Editor 1475→1206, SettingsDialog 1423→779; SourcesPanel unchanged (1297), PropertiesPanel grew (1127→1156) |
| 7 (Low) | Document the registry pattern | **Done** | `src/shared/tools/registry.ts:3-20` |

The structural health indicators all hold: `madge --circular` over 452
main/shared/preload files reports **no cycles**; `src/shared` is verifiably pure
(no `node:*`, no electron, no main/renderer imports); there are **5**
`eslint-disable` comments in all of `src/`; `src/main/ipc.ts` is a 69-line
orchestrator over 24 registrars and 349 channels.

The eight most recent merged PRs all deliver local per-note history (#1158, epic
#1157), and that subsystem is mostly a model citizen: `src/main/history/` is 539
lines across four files with a documented one-way import boundary
(`notebase/fs` → `history` → `store` → `policy`, verified — `history/` imports
nothing from `notebase/`), five dedicated test files, its own coverage floor
(`vitest.config.mts:101-106`), and a `register-history.ts` that keeps restore
*orchestration* in IPC rather than inverting the dependency. The CLAUDE.md
LLM/graph checklist was followed for a non-LLM feature, which is the right
instinct.

But it introduced four things a maintainer should act on:

1. **The ambient history source is a process-global mutable var with no
   async-context scoping** (`history/index.ts:34`). It is written from six
   independent call sites, across `await` boundaries, in an app with per-window
   projects and no write queue anywhere in `src/main`. Interleaving does not just
   mislabel a revision — it can leave the ambient source permanently stuck on a
   non-default value, tagging later manual edits as `proposal`.
2. **History is the one domain with no store and no change event.** Its mutations
   live in `App.svelte` (which grew 2,011 → 2,114 as a result), and the panel
   keeps itself fresh with a 700 ms polling timer because no `HISTORY_CHANGED`
   broadcast exists.
3. **Capture is fully synchronous on the hot path of every save** — roughly six
   extra filesystem operations per autosave (autosave fires 1 s after a typing
   pause), including an uncached re-read of `history-settings.json`.
4. **Brand-new code re-introduced two documented #1631 anti-patterns**
   (`history/store.ts:44-53` swallows a corrupt index as "no history";
   `store.ts:182-188` overloads `null`).

Elsewhere, the #1631 migration backlog is essentially frozen (one of eleven items
moved), 19 of 24 IPC registrars still have no direct test despite that being an
explicit CLAUDE.md checklist item, `graph/queries.ts` (1,294) has quietly become
the largest main-process module, and `website/docs/` — 118 hand-maintained pages
that are a **build input to the shipped app** — carries ~7,400 lines of
byte-identical copy-pasted chrome with no generator.

**No Critical issues.** The architecture remains the best-governed thing in this
review series; the findings below are about where the *newest* code bent the
existing rules, not about the rules failing.

## Current Architecture

### Overview

**Style.** Four enforced layers — a pure `shared` domain library, `main` (Node),
`preload` (the single `contextBridge` surface), `renderer` (Svelte 5 runes) —
plus a fifth, *unenforced* layer: `src/cli` (1,780 lines), the headless
substrate/MCP entry point that imports `src/main` modules directly.

**Key components.**

- **Main** (`src/main/`, ~40 subsystems). File I/O behind `notebase/fs.ts`
  (`assertSafePath`); the RDF graph as a 235-line facade (`graph/index.ts`) over
  `queries.ts` (1,294), `indexers.ts` (991) + `indexers/` (4 files), `state.ts`
  (467), `health-checks.ts` (777), `write-guard.ts` (102), `integrity.ts` (61);
  the approval engine (`llm/approval.ts`, 199 lines) + `apply-dispatch.ts` (499,
  a self-registering payload-kind registry) + `proposal-persistence.ts` (247);
  the **provider seam** (`llm/provider/`, 1,154 lines — one `LLMProvider`
  interface, three implementations, one factory); skills (`skills/`); object
  types (`types/`); local history (`history/`, 539); sources, compute, publish,
  search, embeddings, substrate; 24 `ipc/register-*.ts` behind a 69-line
  orchestrator.
- **Preload** (`src/preload/preload.ts`, 613) — declarative passthrough, gated by
  a full-surface snapshot contract test rather than a coverage floor
  (`vitest.config.mts:192-197`).
- **Renderer** — 124 components, **26** singleton rune stores, **11** App-ops
  modules, `lib/ipc/client.ts` (1,226) as the typed `api` wrapper, `App.svelte`
  (2,114) as composition root.
- **Shared** (`src/shared/`, 6,435 lines of `.ts` + the ontologies) — channels
  (349), `ipc-contract.ts` (717), types, and pure domain logic. Verified pure by
  grep and by `eslint.config.mjs:246-256`.

**Design patterns observed.**

- **Proposal/approval (command + memento)** — the Trust Principle. `apply-dispatch.ts`
  applies per payload kind with reverse-order rollback; `graph/write-guard.ts` is
  fatal under test.
- **Pipeline, applied three times** — skills (`parse → loader → compile →
  register`), object types (`parse → loader → compile → write/migrate`), and now
  history (`index (hooks) → store (disk) → policy (pure retention)`).
- **Per-project state slot** — `project-store.ts` (72 lines): a self-registering
  `Map<rootPath, T>` so `disposeAllProjectStores` tears a project down without
  naming each subsystem. This is the load-bearing multi-project seam.
- **Typed IPC contract** — one `ChannelMap`; `handle()`/`invoke()` are both
  `<K extends keyof ChannelMap>` and no handler uses raw `ipcMain.handle`, so a
  new channel *cannot compile* without a contract entry.
- **Provider factory (new, #1148)** — `llm/provider/index.ts` resolves the
  provider from the effective model. Genuine dependency inversion.
- **Store-owns-mutation (#1086)** — lint-enforced, with the caveats in P1 below.
- **Ambient context (new)** — `runWithHistorySource`, and `enterLLMContext` /
  `enterTrustedContext` in the write guard. Both are module-global depth/value
  vars; the write guard's is depth-counted, history's is not.

### Architecture Diagram

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │  src/shared  (PURE — eslint-enforced: no node:*/electron/main/renderer)  │
   │  channels(349) · ipc-contract(717, ALL invoke domains) · types · objects/ │
   │  tools/{registry,grouping,models,model-tiers} · skills/menu-config ·      │
   │  history.ts · format-datetime.ts · provenance · ontology-thought.ttl      │
   └────▲────────────────────────────────────────────────────────────▲────────┘
        │ typed imports                                 typed imports │
 ┌──────┴───────────────────┐   contextBridge    ┌───────────────────┴─────────────┐
 │       RENDERER            │   window.api      │             MAIN                 │
 │                           │   preload(613)    │                                  │
 │ App.svelte (2114)         │── invoke ────────▶│ ipc.ts (69) ─▶ 24 register-*.ts   │
 │  = composition root       │◀── events ────────│   typed-ipc · helpers · broadcast │
 │  + 11 ops modules         │                   │   ⚠ 19/24 have no direct test     │
 │  ⚠ owns history mutations │                   │        │                          │
 │    (412-431) — no store   │                   │        ▼                          │
 │                           │                   │ ┌──────────────────────────────┐  │
 │ 26 stores (own api.* +    │                   │ │ graph/index.ts (235 facade)  │  │
 │  subscriptions)           │                   │ │  queries.ts (1294) ◀ NEW MAX │  │
 │  ⚠ no history store       │                   │ │  indexers.ts(991)+indexers/  │  │
 │                           │                   │ │  state.ts · write-guard(102) │  │
 │ 124 components            │                   │ └──────────────▲───────────────┘  │
 │  reads only (67 api.*     │                   │ ┌──────────────┴──────────────┐   │
 │  methods, all reads/OS…   │                   │ │ llm/ approval(199)          │   │
 │  ⚠ except runCell:506)    │                   │ │  ├ apply-dispatch(499)      │   │
 │                           │                   │ │  ├ provider/ (1154) ── DIP  │   │
 │ HistoryPanel: polls every │                   │ │  └ ⚠ imports ./conversation │   │
 │  700ms — no changed event │                   │ │      for a display string   │   │
 └───────────────────────────┘                   │ └─────────────────────────────┘   │
                                                 │                                   │
                                                 │  notebase/fs.ts (221)             │
                                                 │    writeFile ──┬─▶ onNoteWriting  │
                                                 │                └─▶ onNoteWritten  │
                                                 │                       │           │
                                                 │        history/index.ts (92)      │
                                                 │        ⚠ ambientSource: module    │
                                                 │           var, 6 writers, no ALS  │
                                                 │              │                    │
                                                 │        history/store.ts (304)     │
                                                 │              │                    │
                                                 │        history/policy.ts (84 pure)│
                                                 │        history/settings.ts (59)   │
                                                 │          ⚠ import {app} 'electron'│
                                                 └──────────────▲────────────────────┘
                                                                │ direct imports
                              ┌─────────────────────────────────┴──────────────────┐
                              │  src/cli (1780)  — NO eslint boundary rule          │
                              │  engine.ts imports 8 src/main modules directly;     │
                              │  "electron-free" held only by a build-time alias    │
                              │  to src/cli/electron-stub.ts (all exports undefined)│
                              └────────────────────────────────────────────────────┘

  madge over 452 files: NO CYCLES · 5 eslint-disable in all of src/
  website/docs: 118 pages / 20,650 lines, ~7,400 duplicated chrome, no generator,
                and a BUILD INPUT → resources/help-docs/corpus.json
```

## Architectural Issues

### Critical Issues

- [ ] **None.** No layering violation, no cycle, no approval-engine bypass, no
      data-loss-shaped defect was found. The August 1 assessment holds.

### Design Flaws

- [ ] **D1 — `ambientSource` is process-global, not async-context-scoped
      (`src/main/history/index.ts:34`).** `runWithHistorySource` (`:44-52`) saves
      the previous value into a local, sets a module var, awaits `fn()`, and
      restores in `finally`. That is correct only for strictly LIFO nesting.
      There are **six** independent entry points that wrap `await`-heavy writes:
      `notebase/fs.ts:187`, `llm/approval.ts:148` (wraps an entire `applyBundle`,
      which can rewrite many notes), `ipc/register-history.ts:33` (wraps
      `writeAndReindex`, which awaits graph + search indexing),
      `ipc/register-bibliography.ts:134`, `ipc/register-refactor.ts:60`,
      `ipc/register-conversation-drafts.ts:596`. A grep for any serialization
      primitive across `src/main` (`Mutex|withLock|acquireLock|writeQueue|inFlight`)
      returns **nothing**, and `window-manager.ts:105,178-184` gives every
      BrowserWindow its own `rootPath`, so two windows on two projects can be
      mid-write simultaneously. Interleave A(set X) → B(set Y, prev=X) → A(restore
      default) → B(restore X) and the ambient source is **permanently left at X**:
      subsequent plain editor saves are recorded as `origin: 'proposal'` with
      someone else's cause. That silently corrupts the #1159 provenance-over-time
      guarantee the `RevisionOrigin` field exists to provide
      (`src/shared/history.ts:8-11`). The docstring's justification — "note writes
      are serialized per note" (`shared/history.ts:41-42`) — is true but answers
      the wrong question; the hazard is *cross*-note and *cross-window*
      interleaving. `node:async_hooks`' `AsyncLocalStorage` is the exact fit and is
      available in main.

- [ ] **D2 — History is the only domain with no store and no change event.** Its
      mutations live in `App.svelte:405-431` (`handleHistoryRestore`,
      `handleHistoryLabel`, `handleHistoryRemoveLabel`) plus
      `lib/app/refactor-ops.svelte.ts:479` (`labelNotes`); its reads and list
      state live in `HistoryPanel.svelte:36-102`. `src/shared/channels.ts:600-606`
      defines seven history channels, **none of them an event** — so nothing tells
      the renderer a revision was captured. The panel compensates with a 700 ms
      `setTimeout` refresh keyed off the editor's `content` prop
      (`HistoryPanel.svelte:96-102`) and a manual `loadList()` after each
      mutation (`:62,69`). This is polling standing in for a missing seam, and it
      is exactly what the 26 other stores exist to avoid. It is also why
      `App.svelte` grew 2,011 → 2,114 against the prior review's shrink trend: the
      "App.svelte is the composition root" exemption in the data-flow rule is the
      pressure valve every new feature will reach for unless a store is the
      cheaper path.

- [ ] **D3 — Capture is synchronous on the hot path of every save.**
      `notebase/fs.ts:168-179` awaits `onNoteWriting` then `onNoteWritten` inside
      `writeFile`. Per save that is: `readIndex` (JSON parse) in
      `ensureInitialRevision`; `getHistorySettings()` → `loadConfigFile` →
      **uncached** `readFile` of `history-settings.json` (`config/config-store.ts:72-86`
      has no cache); a second `readIndex`; `readFile` of the previous snapshot for
      byte-comparison (`store.ts:61-69`); `writeFile` of the new snapshot; a full
      rewrite of `index.json`; plus prune `rm`s. Autosave fires 1 s after a typing
      pause (`editor.svelte.ts:164`). Storage is full-content, not delta or
      content-addressed, with defaults of 500 revisions/note over 30 days
      (`history/settings.ts:19-25`) and **no global disk budget** —
      `pruneAllHistory` runs only on a settings change (`register-history.ts:76`)
      or note-by-note on the next capture. A 200 KB note at the cap is ~100 MB.

- [ ] **D4 — `graph/queries.ts` (1,294) is the new largest main-process module.**
      It carries six unrelated query families behind section comments: aliases and
      frontmatter (`:32`), citations and anchors (`:133`), SPARQL plumbing
      (`:224`), tags (`:348`), links and backlinks (`:499`), source detail
      (`:824`). This is precisely the shape `indexers.ts` had before it was split,
      and the split pattern (`graph/indexers/`) already exists in the same package
      as the template.

- [ ] **D5 — The approval engine acquired a presentation dependency.**
      `llm/approval.ts:24` imports `./conversation` for one purpose: `proposalCause()`
      (`:107-122`) loads a conversation transcript to recover a skill's display
      name for the History panel's "what did this?" column. It is not a cycle —
      `llm/conversation.ts` imports nothing from `approval` (verified) — and it is
      correctly best-effort. But the module whose stated job is "approval-tier
      policy and the propose/approve/reject/expire orchestration" (`:1-2`) now
      reads conversation storage to build a UI string. The cause belongs either in
      the caller or in a `proposal-cause.ts` beside `describeProposalCause`.

### Pattern Inconsistencies

- [ ] **P1 — The renderer data-flow rule still fails open (unchanged from Aug 1).**
      `eslint.config.mjs:25-54` is a hand-maintained denylist of ~120 method names
      plus 13 generic verbs. #1674 added a second selector for the raw
      `window.api` call form, but did not change the denylist model. Live
      consequence: **`Editor.svelte:506` calls `api.compute.runCell(language, code, filePath)`
      directly from a component** and lint passes, because `runCell` is not in the
      regex (`grep runCell eslint.config.mjs` → no match). That call executes user
      Python in a shared kernel carrying session state, consent, and an audit log.
      Whether it *should* be classed a mutation is arguable — the point is that the
      rule did not decide; the regex omitted it. To the team's credit the manual
      step was honored for history (`restore|setLabel|labelNotes` were added at
      `eslint.config.mjs:48`), but that is discipline, not enforcement.

- [ ] **P2 — Brand-new code re-introduced two documented #1631 anti-patterns.**
      `history/store.ts:44-53` (`readIndex`) catches everything and returns `[]`,
      explicitly commenting "A corrupt index shouldn't crash a save; treat it as
      'no history yet'." That is the "swallowing" anti-pattern verbatim: a
      corrupted `index.json` makes a note's entire version history *disappear from
      the UI* while capture silently keeps appending. CLAUDE.md prescribes
      `readJsonFileOr` (`ipc/helpers.ts`) for exactly this — ENOENT → fallback,
      parse/IO error → rethrow. Separately, `store.ts:182-188`
      (`getRevisionContent`) returns `null` for both "revision not found" and "read
      failed", violating rule 5 ("`null` marks exactly ONE expected absence").

- [ ] **P3 — The #1631 migration backlog is frozen at 10 of 11.** Still
      `withRootPathOr(null, …)` conflating no-project with not-found:
      `GRAPH_SOURCE_DETAIL` (`register-graph.ts:60`), `GRAPH_EXCERPT_SOURCE`
      (`:63`), `PROPOSAL_DETAIL` (`register-proposals.ts:20`), `TEMPLATES_GET`
      (`register-templates.ts:13`); `FORMATTER_LOAD_SETTINGS`
      (`register-refactor.ts:96`) still swallows to a fallback object. The one
      item that moved is `CONVERSATION_LOAD` (`register-conversation.ts:223`),
      now `withRootPath`. Nothing new was added *to* the backlog by the IPC layer
      — the new outliers are in `history/store.ts` (P2), below the IPC line.

- [ ] **P4 — 19 of 24 IPC registrars have no direct test, against an explicit
      CLAUDE.md checklist item.** Only `register-bookmarks`, `register-conversation`,
      `register-conversation-drafts`, `register-history`, and `register-shell` are
      imported by any test. Untested and non-trivial: `register-notebase` (431
      lines), `register-sources` (343), `register-publish` (171), `register-refactor`
      (160), `register-bibliography` (144), `register-graph` (135),
      `register-links` (132). The `src/main/ipc/**` coverage floor
      (`vitest.config.mts:140-145`: 24 L / 10 F / 22 S / **5 B**) is honestly
      labeled a backstop, but 5% branch coverage on the layer that owns
      `withRootPath` semantics means the P3 backlog above cannot regress *into*
      a test failure. To the team's credit, the newest registrar
      (`register-history`) *does* ship with a test — the checklist worked for the
      new thing and has not been applied retroactively.

- [ ] **P5 — `src/cli` is a fifth layer with no boundary rule.** `eslint.config.mjs`
      has blocks for `src/shared/**`, `src/main/**`, and `src/renderer/**` — and
      no mention of `cli` (grep confirms). `src/cli/engine.ts:21-30` imports eight
      `src/main` modules directly. The "electron-free read core" property (epic
      #1145 / #1148) is held entirely by a build-time alias mapping `electron` to
      `src/cli/electron-stub.ts`, whose exports are all `undefined`
      (`electron-stub.ts:17-27`). Nothing at lint or test time prevents new main
      code on the CLI's import graph from *calling* an electron API. The newest
      subsystem did add one: `history/settings.ts:13,28` imports `app` and calls
      `app.getPath('userData')`, and is reachable from `notebase/fs` — which
      `cli/engine.ts:28` imports. Today it is not *invoked* on any CLI path (the
      CLI only files proposals, never approves), so this is latent rather than
      live. But the guard is "which functions happen to be reached", and history's
      hooks swallow their own errors (`history/index.ts:75-77,89-91`), so the
      failure mode when it does land is a silent no-op, not a crash.

- [ ] **P6 — Config roots are documented in prose with no code seam, and the
      prose has already drifted.** Fourteen sites hand-roll
      `path.join(app.getPath('userData'), '<name>')`. `docs/config-roots.md`
      (#1642) is the inventory — and it already omits **`history-settings.json`**
      and **`inspection-settings.json`** from the `userData/` table, and omits
      `<thoughtbase>/.minerva/history/` from the project table entirely. CLAUDE.md's
      own "Migrated so far" list (`ingest-settings`, `python-settings`,
      `project-config`) is likewise stale: `history/settings.ts:16` and
      `config/inspection-settings.ts` both correctly use `loadConfigFile` and
      neither is listed. The convention is being *followed* and the documentation
      of it is what is rotting.

- [ ] **P7 — `website/docs/` is 118 hand-maintained pages with no generator, and
      it is a build input to the shipped app.** 20,650 lines across 118 files.
      Lines 12-45 of every page — the 34-line site nav, including a full inline
      SVG logo — are **byte-identical across all 118** (single md5). Each page
      also carries a ~29-line `<aside class="docs-nav">` sidebar that differs only
      in which link has `class="active"`. That is roughly **7,400 lines (~36%) of
      copy-pasted chrome**, and adding one docs page means editing 118 files to
      add its sidebar entry. This is not merely a marketing-site concern:
      `scripts/build-help-corpus.mjs:4,80,110` chunks `website/docs/*.html` into
      `resources/help-docs/corpus.json`, which ships inside the app and backs the
      in-app help search (`src/main/help-docs/`), gated by a snapshot staleness
      test. A production data source with no schema and no generator.

### Where the architecture is genuinely good

Worth stating plainly, because it explains why the above list is short:

- **The boundaries are machine-frozen, and they held under pressure.** Eight
  feature PRs in three weeks added a whole subsystem, three new `src/shared`
  modules, and a new IPC domain — and `madge` still reports zero cycles across
  452 files, `src/shared` is still pure, and there are 5 `eslint-disable`
  comments in 127k lines. The `#668` rules are doing real work.
- **The typed IPC contract is now structurally complete, not aspirational.**
  Because `handle()` and `invoke()` are both `<K extends keyof ChannelMap>` and
  no handler uses raw `ipcMain.handle`, a channel without a contract entry does
  not compile (`ipc-contract.ts:16-20`). That is enforcement by type system
  rather than by review, and it is why 349 channels have not produced a single
  `unknown`-arg handler.
- **`history/` gets the import direction exactly right.** The facade documents it
  (`history/index.ts:10-13`) and the code obeys it: `history/` imports nothing
  from `notebase/`, and restore orchestration (write-back + reindex + editor
  reload) lives in `register-history.ts:23-37`, composing `history` with
  `write-pipeline` — never the reverse. A weaker design would have had `store.ts`
  call `writeAndReindex` and created the cycle.
- **`policy.ts` (84 lines) is pure and separately tested.** Retention selection,
  dedupe, and size limits are decision functions taking `(entries, now, options)`
  — which is why `tests/main/history/policy.test.ts` can exhaustively test
  retention without touching a disk.
- **The provider seam (#1148) landed as real dependency inversion.**
  `llm/provider/index.ts` resolves a provider from the effective model behind one
  `LLMProvider` interface with three implementations. The conversation layer names
  no vendor. This is the first place in the codebase where a substitutable
  hierarchy carries weight, and it holds.
- **`project-store.ts` (72 lines) is the right multi-project primitive.** A
  self-registering per-`rootPath` slot with a dispose hook means adding a stateful
  subsystem no longer means editing a teardown function. Commit `45a4921e`
  ("key conversation storage by project, not by module state") shows the class of
  bug it exists to prevent, being fixed the right way.
- **Coverage gating is unusually thoughtful.** Per-file floors on the six
  1,000-line components (`vitest.config.mts:204-273`) exist specifically because
  an aggregate net hides a single large file rotting toward zero — that is the
  correct diagnosis, and the rationale is written down next to every number.

## SOLID Principles Assessment

**Single Responsibility — 4/5** (up from 3/5). Every SRP item from August was
executed: `types/migrate.ts` is per-note isolated, `indexers.ts` shed its
per-format handlers into `graph/indexers/`, `register-conversation.ts` split
967 → 452 + 601, and `ipc.ts` is a 69-line orchestrator. The new `history/`
subsystem is four files that each do one thing (hooks / disk / pure policy /
settings). Held below 5 by three files that mix concerns: `graph/queries.ts`
(1,294 — six query families, D4), `App.svelte` (2,114 — now also owning history
mutations, D2), and `register-conversation-drafts.ts` (601 — the new registrar
outlier).

**Open/Closed — 4/5** (unchanged). Three subsystems now extend without code
edits: skills and object types load from `stock/*.md` + user dirs, and
`apply-dispatch.ts` is a self-registering payload-kind registry whose docstring
correctly claims "adding a kind needs no edit here" (`approval.ts:4-5`). The
provider factory adds a fourth. Two closure leaks persist and are the reason
this is not 5: `graph/queries.ts` and `indexers.ts` are still extended by adding
a function rather than registering a handler, and — more consequentially —
`DATAFLOW_MUTATION_METHODS` must be hand-edited for every new mutation channel
(`eslint.config.mjs:25-54`), which is a lint rule that is *not* open for
extension.

**Liskov Substitution — 4/5** (unchanged). Still a largely functional codebase,
but it now has one hierarchy that carries load: `LLMProvider`
(`llm/provider/types.ts`, 165 lines) with Anthropic / OpenAI / Google
implementations resolved by a factory. Callers hold the interface and name no
vendor; the one place provider identity leaks out is deliberate and documented
(`provider/index.ts:22-25` — attributing a failure to the user's chosen
provider). Discriminated unions (`ProposalPayload`, `RevisionOrigin`,
`CellResult`) and the `ProjectContext` brand substitute cleanly. No violations
found.

**Interface Segregation — 4/5** (unchanged). Consumers depend on narrow slices:
one `ChannelMap` entry per channel, 26 focused stores, a namespaced `api.*`. The
component-level evidence is strong — of 67 distinct `api.<domain>.<method>` calls
across 124 components, all but one are reads or exempt OS side-effects. The drag
is unchanged: `lib/ipc/client.ts` (1,226) is one flat surface, and
`register-history.ts:14` does `import * as history` — pulling the whole facade
where four named imports would do.

**Dependency Inversion — 3.5/5** (up from 3/5). Two genuine inversions landed:
the provider factory, and `WritePipelineHooks` (`write-pipeline.ts:34-45`),
which injects broadcast/mark hooks so the pipeline is testable without Electron.
Against that, the newest code moved the wrong way: `notebase/fs.ts:8` — the
lowest-level, most security-sensitive file in main — now hard-imports
`../history` and awaits two of its functions inside `writeFile`, and
`history/settings.ts:13` hard-imports `electron` at the bottom of that chain
(P5). A capture-hook *registration* seam (`registerWriteObserver(fn)`) would
have kept `fs.ts` ignorant of history and made the CLI's electron-free property
structural instead of build-time. Concrete coupling elsewhere (registrars →
subsystem modules) remains a deliberate, correct trade-off for this codebase.

**Overall SOLID: ~3.9/5** (up from ~3.6). The gain is SRP, earned by executing
the August plan; DIP moved half a point on the provider seam and gave some back
in `notebase/fs`.

## Improvement Plan

### High Priority

1. **Replace the ambient history source with `AsyncLocalStorage` (D1).**
   *First step:* in `src/main/history/index.ts`, `import { AsyncLocalStorage } from 'node:async_hooks'`,
   declare `const historySource = new AsyncLocalStorage<RevisionSource>()`, make
   `runWithHistorySource(source, fn)` return `historySource.run(source, fn)`, and
   change `onNoteWritten` to read `historySource.getStore() ?? MANUAL_EDIT`. Then
   add a regression test that starts two overlapping `runWithHistorySource` calls
   (resolve the inner one first) and asserts each capture got its own source *and*
   that the default is restored afterward — that test fails against today's code.
   No call site changes.

2. **Add a `HISTORY_CHANGED` broadcast and a `history.svelte.ts` store (D2).**
   *First step:* add `HISTORY_CHANGED: 'history:changed'` to `src/shared/channels.ts`
   beside the existing seven, and emit it from `onNoteWritten` in
   `history/index.ts` when `captureSnapshot` returns non-null (it already returns
   the `RevisionMeta` and knows `rootPath` + `relPath`). Then create
   `src/renderer/lib/stores/history.svelte.ts` owning the subscription, the
   revision list, and the three mutations, and delete the 700 ms timer at
   `HistoryPanel.svelte:96-102` plus the three handlers at `App.svelte:405-431`.
   This also reverses App.svelte's growth.

3. **Fix the two #1631 regressions in `history/store.ts` (P2).**
   *First step:* replace the hand-rolled `readIndex` (`:44-53`) with
   `readJsonFileOr(path.join(dir, INDEX_FILE), [])` from `ipc/helpers.ts` so a
   corrupt index throws instead of presenting as "no history"; keep an explicit
   `Array.isArray` shape check. Then split `getRevisionContent`'s `null`
   (`:182-188`) so only ENOENT returns `null` and other IO errors throw.

### Medium Priority

4. **Move history capture off the synchronous save path (D3).**
   *First step:* memoize `getHistorySettings()` behind a cached value invalidated
   by `setHistorySettings` — that alone removes one uncached `readFile` +
   `JSON.parse` from every autosave, and is a ~10-line change in
   `history/settings.ts`. Then decide whether `onNoteWritten` should be
   fire-and-forget (it already swallows its own errors, so awaiting it buys
   nothing but latency) and whether snapshots should be content-hashed to
   deduplicate restore-to-a-previous-state.

5. **Convert the data-flow rule to an allowlist, or add a coverage assertion (P1).**
   *First step:* add a test that reads `src/shared/channels.ts`, extracts every
   channel whose contract return type is `void`/`Promise<void>` or whose name
   matches a write verb, and asserts each corresponding client method name appears
   in `DATAFLOW_MUTATION_METHODS`. That converts the manual step into a failing
   test rather than a silent omission, and would have caught `runCell`. Then
   classify `api.compute.runCell` deliberately — either add it to the list and
   route `Editor.svelte:506` through `run-cell-with-trust.ts`'s ops path, or
   document it as an exempt "stateless execution" call.

6. **Split `graph/queries.ts` by family (D4).**
   *First step:* move the tag block (`:348-497`, six exported functions, no
   cross-family calls) into `graph/queries/tags.ts` and re-export from
   `queries.ts`. It is the most self-contained section; `tests/main/graph/`
   already covers it. Then repeat for links, source-detail, and aliases, one PR
   each, exactly as `indexers/` was done.

7. **Give `src/cli` a boundary rule and a smoke test (P5).**
   *First step:* add an `eslint.config.mjs` block for `src/cli/**/*.ts` restricting
   imports from `src/renderer/**` and `src/preload/**`, and add a build-level test
   that runs `.vite/build/cli.js query "SELECT ..." --project tests/fixtures/sample-project`
   under plain Node and asserts a zero exit. A stronger follow-up: introduce
   `main/config/user-data-path.ts` so `app.getPath('userData')` has exactly one
   call site the CLI can stub, instead of fourteen.

8. **Give the untested registrars tests, starting with the largest (P4).**
   *First step:* `register-notebase.ts` (431 lines) — it owns the write path and
   the `NOTEBASE_FILE_EXISTS` boolean overload still on the #1631 backlog. Use
   `tests/main/ipc/register-shell.test.ts` as the template. Then ratchet the
   `src/main/ipc/**` branch floor off 5%.

### Low Priority

9. **Template the docs site (P7).**
   *First step:* write `scripts/build-docs.mjs` that reads a `website/docs/_nav.json`
   plus per-page content fragments and emits the 118 HTML files, and make
   `scripts/build-help-corpus.mjs` consume the same content fragments rather than
   re-parsing generated HTML. That collapses ~7,400 duplicated lines to one nav
   file and makes "add a docs page" a one-file change. Run it once and diff the
   output against the committed HTML to prove the generator is faithful before
   deleting anything.

10. **Move `proposalCause` out of `approval.ts` (D5).**
    *First step:* move `proposalCause` (`approval.ts:107-122`) into a new
    `llm/proposal-cause.ts` beside its `shared/history` helper and drop the
    `./conversation` import from `approval.ts`.

11. **Regenerate `docs/config-roots.md` from the code (P6).**
    *First step:* add `history-settings.json`, `inspection-settings.json`, and
    `<thoughtbase>/.minerva/history/` to the tables now; then add a test that
    greps for `getPath('userData')` call sites and asserts each filename appears
    in the doc, so the inventory cannot drift again. Also refresh CLAUDE.md's
    "Migrated so far" config list.

12. **Finish the component split (D3-Aug, still partial).**
    *First step:* `SourcesPanel.svelte` (1,297) is the only one of the six that
    has not moved at all since August; extract its filter/sort toolbar and the
    per-source row into children.

## Migration Strategy

### Phase 1: Foundation (correctness first, ~1 week)

Items 1-3. All three are in the newest subsystem, all three are small and
independently shippable, and all three have a natural failing test to write
first. Do #1 before anything else touches `history/` — it changes the shape of
`runWithHistorySource` without changing any of its six call sites, so it is
cheapest now and gets more expensive with each new wrapper added. Do #3 in the
same window while `store.ts` is still fresh. #2 is the largest of the three and
should land last in the phase, because the store it introduces is where a future
`HISTORY_CHANGED` subscription belongs.

### Phase 2: Core Refactoring (~2 weeks, one PR each)

Items 4-8, sequenced by blast radius. #5 (the data-flow coverage test) goes
first because it is a guardrail that protects everything after it. #6 (`queries.ts`)
is mechanical and leans on the existing `tests/main/graph/` suite as the
regression net — one family per PR, exactly the cadence that worked for
`indexers.ts`. #7 and #8 are independent and can run in parallel with #6. #4 is
sequenced after #2 because moving capture off the save path is easier to reason
about once the renderer stops polling for freshness.

### Phase 3: Optimization & polish (~1 week)

Items 9-12. #9 (the docs generator) is the largest single win in the phase and
is fully isolated from `src/` — it can be done by anyone, at any time, without
touching app code, and it is verified by a byte-diff against the committed HTML.
#10-12 are cleanups that should be attached opportunistically to whatever PR
next touches the relevant file, per the "migrate when you touch one" convention
already in CLAUDE.md.

## Impact Analysis

**Development velocity.** The August decomposition paid off measurably: an
entire versioning subsystem plus a settings panel plus a right-sidebar panel
landed in eight PRs without a single cycle, layering violation, or
`eslint-disable`. New subsystems land cheaply because the shapes to copy are
obvious (skills → types → history all use the same pipeline form). The two
frictions that will bite next are both in this report: the missing history store
(every subsequent history feature will accrete into `App.svelte`) and the
denylist lint rule (every new mutation channel is a manual edit somebody must
remember). Both are ~1-day fixes that compound.

**Testing requirements.** Phase 1 needs three new tests, one of which — the
interleaved `runWithHistorySource` test — is the single most valuable test in
this plan because it converts an invisible hazard into a CI gate. Phase 2's #5
needs a channel-coverage test that reads `channels.ts` and the eslint config;
#8 needs registrar tests modeled on `register-shell.test.ts`. Nothing here
requires new test infrastructure: `tests/main/history/` (4 files),
`tests/main/ipc/` and the fixture project already provide every pattern needed.
The 596-file / 74,940-line suite plus per-area coverage floors mean refactors in
Phase 2 are genuinely safe — `graph/**` sits at an 80/80/78/62 floor, so a
botched `queries.ts` split fails CI rather than shipping.

**Risk.** Low across the board, with one concentration. Phase 1 #1 is a
behavior-preserving swap with no call-site changes. Phase 2 #6 is mechanical
re-export splitting against a strong test suite. The concentrated risk is #4
(moving capture off the synchronous save path): making `onNoteWritten`
fire-and-forget changes the ordering guarantee between a write completing and its
snapshot existing, which the `ensureInitialRevision` baseline logic depends on —
that one needs the interleaving test from #1 in place first, which is why it is
sequenced into Phase 2 rather than Phase 1. The residual risk everywhere else is
that 19 of 24 IPC registrars have no direct test, so an IPC-layer refactor has a
5%-branch-coverage net under it; that is why #8 exists.

**Performance.** The incremental named-graph-per-note indexing remains strong and
untouched. The one new cost is D3: history capture adds roughly six filesystem
operations to every autosave, at 1 s-after-pause cadence, with full-content
snapshots and no global disk budget. This has not been measured, and should be
before it is optimized — but the uncached settings read (#4's first step) is a
free win regardless of what the measurement says.

## Recommendations

**Patterns to adopt.**

1. **`AsyncLocalStorage` for every ambient context in main.** History needs it
   now (D1). The write guard's `llmContextDepth` / `trustedContextDepth`
   (`graph/write-guard.ts:18-19`) has the same shape and the same latent issue —
   it is depth-counted so it degrades more gracefully, but under concurrent
   LLM and non-LLM writes it can still attribute a write to the wrong context.
   Adopting ALS once and applying it to both makes "ambient context" a pattern
   with a correct implementation rather than a recurring hazard.
2. **Observer registration instead of a hard import at the bottom layer.**
   `notebase/fs.ts` should expose `registerWriteObserver(fn)` and let
   `main.ts` wire history in, rather than `fs.ts` importing `../history`
   (which transitively imports `electron`). One seam fixes the DIP regression,
   the CLI fragility (P5), and makes capture trivially swappable in tests.
3. **A store per domain, with no exceptions.** The "App.svelte is the composition
   root" clause is correct policy but is functioning as an escape hatch. Make the
   rule "a new IPC domain ships with a store" and App.svelte's growth reverses on
   its own.
4. **Generated over hand-maintained, for anything with more than ~10 instances.**
   118 copies of a nav block and 14 copies of `path.join(app.getPath('userData'), …)`
   are the same failure at different scales, and both already have documentation
   that has drifted away from the code.

**Tools.**

- Wire `madge --circular` into CI. It currently passes and is only run
  ad hoc; it is the cheapest possible guard on the property this codebase most
  depends on, and takes about a second over 452 files.
- Add the channel-coverage test (#5) — it is the missing half of the #1086 rule.
- Consider `dependency-cruiser` if the `src/cli` boundary rule (#7) needs to
  express "may import main, may not import electron transitively", which
  `no-restricted-imports` cannot.

**Documentation needs.**

- `docs/config-roots.md` is already stale three weeks after being written (P6) —
  fix the entries and add the test that keeps it honest.
- CLAUDE.md's config "Migrated so far" list and the #1631 "Migration backlog"
  both need a pass; the former undercounts (history and inspection-settings did
  migrate), the latter is accurate but has only moved by one item in three weeks,
  which is worth acknowledging explicitly rather than leaving as an
  ever-present list.
- There are no ADRs (`docs/architecture/` has two topic notes). The ambient-source
  decision (D1), the "history is best-effort and swallows its errors" decision,
  and the `electron-stub` decision are all deliberate, well-reasoned choices
  currently recorded only in file-header comments. They are exactly the decisions
  a future maintainer will otherwise re-litigate.

**Resist.** Do not add abstraction for its own sake. DIP sits at 3.5/5 by choice
and the functional, registry-driven, contract-typed style is demonstrably
working — three subsystems in three weeks with zero cycles is the proof. The two
DIP moves recommended here (#2 above and the provider seam already shipped) are
targeted at specific, named fragilities, not at raising a score.

## Estimated Effort

| # | Item | Priority | Effort |
|---|---|---|---|
| 1 | `AsyncLocalStorage` for history source + interleave test | High | 3-4 h |
| 2 | `HISTORY_CHANGED` event + `history.svelte.ts` store | High | 1 day |
| 3 | `readJsonFileOr` + null split in `history/store.ts` | High | 2-3 h |
| 4 | Cache history settings; move capture off the save path | Medium | 1 day |
| 5 | Data-flow channel-coverage test; classify `runCell` | Medium | 0.5-1 day |
| 6 | Split `graph/queries.ts` into 4 families | Medium | 2 days |
| 7 | `src/cli` eslint boundary + headless smoke test | Medium | 0.5 day |
| 8 | Tests for the 6 largest untested registrars | Medium | 2 days |
| 9 | `scripts/build-docs.mjs` + collapse 118 pages | Low | 1.5 days |
| 10 | Extract `proposal-cause.ts` from `approval.ts` | Low | 1 h |
| 11 | Refresh `config-roots.md` + drift test | Low | 3 h |
| 12 | Split `SourcesPanel.svelte` | Low | 1 day |

- **Total tasks: 12**
- **Critical-fix hours: 0** (no Critical issues). **High-priority fix hours: ~14**
  (items 1-3), the bounded set that removes the correctness hazard, the polling
  workaround, and the two error-handling regressions in the newest subsystem.
- **Full refactor: ~3 weeks** (~11.5 engineer-days of work across items 1-12,
  sequenceable one PR at a time; Phase 1 ≈ 1 week, Phase 2 ≈ 2 weeks
  wall-clock with parallel tracks, Phase 3 ≈ 1 week and fully deferrable).

Net: the remaining debt is roughly the same size as August's and is
*differently located* — August's was residual god-modules inherited from the
past, this one is almost entirely in code written in the last three weeks. That
is a healthier position (the debt is fresh, small, and its authors still have
context) but it carries a different lesson: the decomposition arc is essentially
finished, and the discipline that now needs attention is the one governing how
new subsystems attach to the existing seams — a store, an event, an
async-scoped context, and `readJsonFileOr`, none of which the otherwise
exemplary `history/` module used.
