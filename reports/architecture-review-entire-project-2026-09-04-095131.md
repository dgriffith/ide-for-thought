# Architecture Review Plan
Generated: 2026-09-04 09:51:31
Scope: entire project (/Users/davegriffith/minerva)
Prior review: reports/architecture-review-entire-project-2026-08-23-080903.md

## Executive Summary

Minerva is a 787-file (664 `.ts` + 123 `.svelte`) / ~127,600-line Electron +
Svelte 5 + TypeScript desktop markdown IDE, now at v2.0.0, with 660 test files
totaling ~87,700 lines. Ninety-five commits landed between the prior review
(2026-08-23) and today, each still following the one-issue-per-PR cadence the
prior review credited for the codebase's health, and the discipline held:
**all 12 `tests/architecture/*.test.ts` fitness functions pass, `pnpm lint`
passes clean, `madge --circular` finds zero cycles across 788 files, and every
file-size budget baseline matches the real file to the line** — nothing this
review checked had silently drifted since three weeks ago.

Better still, nearly everything the prior review recommended actually shipped:
`graph/queries.ts` (was 1,294 lines) is now an 87-line facade over six query
families; the local-history subsystem got its store (`history.svelte.ts`),
its `HISTORY_CHANGED` broadcast, its `AsyncLocalStorage`-scoped ambient source
(replacing the module-global var flagged as a correctness hazard), and its
`readJsonFileOr` migration; all 24 IPC registrars now carry direct tests
(`KNOWN_UNTESTED` in `ipc-registrar-coverage.test.ts` is empty); `src/cli` got
an eslint boundary plus a runtime electron-free proof; the 118-page docs tree
got a generator (`scripts/build-docs.mjs`). This is a codebase that reliably
converts "architecture review found X" into "X is fixed within a month."

This review's job was therefore to find what the last one couldn't have: new
issues introduced or exposed since 2026-08-23, plus honest verification of
whether the enforcement mechanisms have blind spots. Four concrete findings
came out of that, none of them "already tracked in CLAUDE.md":

1. **A real production crash shipped and was fixed same-day, with zero
   regression test added.** The packaged CLI has been crashing on its first
   dynamically-imported dependency (AWS SDK pieces for S3 publish) since
   `#1437`, undetected because nothing had run the actual packaged shim
   end-to-end. Today's fix (`774b72be`, tip of this branch) is a 9-line config
   change; the CLI's own "runs under plain Node" test suite
   (`tests/cli/electron-free.test.ts`) still exercises only `sparql`/`read`/
   write-path commands that never take a dynamic-import branch. The exact bug
   class — a future dynamically-imported dependency splitting into its own
   Rolldown chunk — is unguarded.
2. **Dialog consolidation (#1888) is a sweep, not a ratchet.** 18 of 32
   `*Dialog.svelte` components now use `ui/Dialog.svelte`; 14 don't
   (`AboutDialog`, `SettingsDialog`, `FindInNotesDialog`,
   `CommandPaletteDialog`, and ten more). Unlike every other convention this
   codebase enforces, there is no fitness function stopping that 14 from
   staying stuck, or a 33rd dialog from being added hand-rolled tomorrow.
3. **The docs generator has no CI enforcement.** `pnpm check:docs` exists and
   runs locally via `predev`/`prebuild`, but no GitHub Actions workflow calls
   it — a hand-edited generated `website/docs/*.html` page that drifts from
   its `_content/*.html` fragment would pass CI silently.
4. **`SourcesPanel.svelte` (1,298 lines) is now the subject of its third
   consecutive architecture review flagging it unsplit**, with zero commits
   against it in the 95-commit window.

No issue found here rises to "the architecture is broken" — the governance
layer is, if anything, unusually good at catching exactly this class of thing
once someone writes the test. The findings above are precisely the shape of
gap that a fitness function would close, which is also the recommendation.

## Current Architecture

### Overview

**Style.** Four eslint-enforced layers — a pure `src/shared` domain library,
`src/main` (Node, ~40 subsystems), `src/preload` (the single `contextBridge`
surface), `src/renderer` (Svelte 5 runes) — plus a fifth, narrowly-enforced
layer, `src/cli` (1,790 lines / 9 files): a headless read-and-propose engine
that deliberately imports `src/main` directly (by design, to reuse the graph/
search/tables/proposal modules) but is lint-blocked from importing
`renderer`, `preload`, or `electron` itself (`eslint.config.mjs:320-340`,
issue #1839).

**Key components.**

- **Main** (`src/main/`). File I/O behind `notebase/fs.ts` (`assertSafePath`);
  the RDF graph as a facade (`graph/index.ts`) over `queries/` (6 families,
  1,381 lines total, largest `sources.ts` at 523), `indexers.ts` (724, now
  coexisting with a partially-extracted `indexers/` directory of 5 files,
  1,718 lines combined), `state.ts` (468), `health-checks.ts` (800); the
  approval engine (`llm/approval.ts`) + `apply-dispatch.ts` (500) +
  proposal-persistence; the LLM **provider factory**
  (`llm/provider/{anthropic,openai,google,index}.ts`, 1,155 lines, one
  `LLMProvider` interface, three implementations); skills (`parse → loader →
  compile → register`); local history (`history/`, now 701 lines across 5
  files: `index.ts`, `store.ts`, `policy.ts`, `settings.ts`,
  `history-events.ts`); sources, compute, publish, search, embeddings,
  substrate; 24 `ipc/register-*.ts` behind a 77-line orchestrator
  (`ipc.ts`).
- **Preload** (`src/preload/preload.ts`, 627 lines) — declarative
  `contextBridge` passthrough, gated by a full-surface snapshot test rather
  than a coverage floor.
- **Renderer** — 123 `.svelte` components, singleton rune stores under
  `stores/*.svelte.ts` (`conversations.svelte.ts` at 1,179 lines is the
  largest), App-ops modules under `lib/app/` (`refactor-ops.svelte.ts` at 827
  is the largest), `lib/ipc/client.ts` (1,288, the single largest `.ts` file
  in the tree, now compile-time linked to the shared IPC contract per
  `dc25f58d`/#1920), `App.svelte` (2,075 lines — down from 2,114 three weeks
  ago, the one file in this review that shrank).
- **Shared** (`src/shared/`) — `channels.ts` (701), `ipc-contract.ts` (725,
  spans every invoke domain), `types.ts` (559 — see Pattern Inconsistencies),
  the tools registry, ontologies. Verified pure by both eslint
  (`no-restricted-imports` banning `main`/`renderer`/`preload`/`node:*`) and
  `no-cycles.test.ts`.

**Design patterns observed.**

- **Proposal/approval (command + memento)** — the Trust Principle;
  `apply-dispatch.ts` applies per payload kind with reverse-order rollback.
- **Pipeline, applied three times** — skills, object types, and local
  history all use `parse/hook → store → policy/compile`.
- **Per-project state slot** — `project-store.ts`, a self-registering
  `Map<rootPath, T>`.
- **Typed IPC contract** — one `ChannelMap`; no handler uses raw
  `ipcMain.handle`.
- **Provider factory** — genuine dependency inversion for the three LLM
  backends.
- **Ambient context via `AsyncLocalStorage`** — now used correctly by
  `history/index.ts`'s `runWithHistorySource` (fixed this cycle); the
  write-guard's `enterLLMContext`/`enterTrustedContext` still uses a
  depth-counted module-global instead of the same primitive (see Design
  Flaws).
- **Store-owns-mutation (#1086)** — lint-enforced at the component boundary;
  see Design Flaws for where "owns" is doing less work than it sounds like.

### Architecture Diagram

```
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  src/shared  (PURE — eslint-enforced: no node:*/electron/main/renderer)   │
   │  channels(701) · ipc-contract(725) · types(559) · tools/registry ·        │
   │  skills/menu-config · logger.ts · ontology-thought.ttl                    │
   └────▲──────────────────────────────────────────────────────────▲──────────┘
        │ typed imports                                typed imports │
 ┌──────┴───────────────────┐   contextBridge    ┌───────────────────┴─────────────┐
 │       RENDERER            │   window.api      │             MAIN                 │
 │                           │   preload(627)     │                                  │
 │ App.svelte (2075)         │── invoke ────────▶│ ipc.ts (77) ─▶ 24 register-*.ts   │
 │  = composition root       │◀── events ────────│   ALL 24 have direct tests now    │
 │  (shrank 39 lines: #1922  │                   │        │                          │
 │   moved Sidebar props     │                   │        ▼                          │
 │   into store reads)       │                   │ ┌──────────────────────────────┐  │
 │                           │                   │ │ graph/index.ts (facade)      │  │
 │ ~26 stores (own api.* +   │                   │ │  queries/ (6 families, 1381) │  │
 │  subscriptions)           │                   │ │  indexers.ts(724)+indexers/  │  │
 │  ⚠ publish.svelte.ts,     │                   │ │   (5 files, partial split)   │  │
 │    review.svelte.ts are   │                   │ │  history/ (5 files, 701,     │  │
 │    pure api.* forwards —  │                   │ │   AsyncLocalStorage-scoped)  │  │
 │    "owner" ≠ "owns state" │                   │ └──────────────▲───────────────┘  │
 │                           │                   │ ┌──────────────┴──────────────┐   │
 │ 123 components             │                   │ │ llm/ approval + apply-      │   │
 │  reads only in theory;     │                   │ │  dispatch + provider/       │   │
 │  ⚠ 14/32 *Dialog.svelte    │                   │ │  {anthropic,openai,google}  │   │
 │    still hand-rolled,      │                   │ └──────────────────────────────┘  │
 │    no ratchet (#1888)      │                   │                                  │
 └────────────────────────────┘                   └──────────────────────────────────┘
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │  src/cli (1790, 9 files)      │
                                              │  imports src/main directly    │
                                              │  by design; lint-blocked from │
                                              │  renderer/preload/electron    │
                                              │  ⚠ built bundle's own smoke   │
                                              │    test never exercises a     │
                                              │    dynamic-import code path — │
                                              │    the exact class that just  │
                                              │    crashed in production      │
                                              └───────────────────────────────┘
```

## Architectural Issues

### Critical Issues

- [ ] **Packaged CLI dynamic-import crash, fixed without a regression test —
      the bug class remains live.** `vite.cli.config.mts` promised (in its own
      docstring) a self-contained single-file `cli.js`; `forge.config.ts`'s
      `copyCliBundle` stages only that one file into the packaged app. But
      `ssr.noExternal` only controls bundling vs. externalizing — it does
      nothing to stop Rolldown from splitting a *dynamically* imported module
      (the AWS SDK pieces pulled in for S3 publish) into its own chunk under
      `.vite/build/assets/`. Per commit `774b72be`'s own message: "The packaged
      CLI has been crashing on its first dynamic import
      (`Cannot find module './assets/rolldown-runtime-...js'`) since #1437
      shipped — nothing had ever run the installed shim end-to-end until
      today." The fix (`output.codeSplitting: false`, `vite.cli.config.mts`)
      is 9 lines and correct, but no test was added asserting the built
      `.vite/build/assets/` directory stays empty, or exercising a command
      that takes a dynamic-import branch. `tests/cli/electron-free.test.ts`
      (the one suite that builds and runs the real bundle under plain Node)
      only drives `sparql`, `read`, and the propose/write path — none of
      which touch a dynamically-imported dependency. The next feature that
      adds a `import('some-heavy-dep')` behind a rarely-hit command will
      reintroduce this exact crash, silently, the same way #1437 did.

### Design Flaws

- [ ] **Store-ownership's documented blind spot, now with concrete instances.**
      `tests/architecture/store-ownership.test.ts` says outright it "CANNOT
      tell a well-designed store from a one-line passthrough." Two real stores
      confirm this isn't hypothetical:
      `src/renderer/lib/stores/publish.svelte.ts` (22 lines) and
      `src/renderer/lib/stores/review.svelte.ts` (18 lines) are both pure
      `api.*` forwards with zero owned `$state` — their own doc comments say
      "Thin passthroughs." Both satisfy the #1086 rule to the letter (the
      mutation is routed through a store) without the store owning any of the
      resulting reactive state; the consuming components (`ProposalsPanel.svelte`,
      `InspectionsPanel.svelte`) do their own read-refresh afterward. This
      isn't broken today — the refresh paths work — but it means "has an
      owner" in this codebase's test suite is a materially weaker claim than
      CLAUDE.md's prose ("the store method owns the api call and updates
      observable state") implies, and nothing currently distinguishes the two.
- [ ] **`graph/indexers.ts` split is half-finished.** The prior review's
      recommendation to split this file landed partially: `graph/indexers/`
      now holds 5 extracted families (`excerpt.ts` 120, `frontmatter.ts` 298,
      `note-files.ts` 111, `source.ts` 162, `tables.ts` 303 — 994 lines total,
      via commit `884dc1e8` among others), but `graph/indexers.ts` itself still
      sits at 724 lines rather than becoming a thin facade the way
      `graph/queries.ts` did (87 lines over `queries/`). It is tracked
      correctly in `file-size-budgets.test.ts` (`724` matches the real file),
      so this isn't drift — it's incomplete work that the budget ratchet
      is faithfully holding steady rather than prompting to finish.

### Pattern Inconsistencies

- [ ] **Dialog consolidation (#1888) has no fitness function.** 18 of 32
      `*Dialog.svelte` components import `ui/Dialog.svelte`
      (`AddPropertyDialog`, `AutoLinkDialog`, `AutoTagDialog`, `ConfirmDialog`,
      `ExportDialog`, `MergeSourcesDialog`, `MineReferencesDialog`,
      `NewNoteDialog`, `OpenTargetDialog`, `PromptDialog`, `PublishDialog`,
      `ResolveStubDialog`, `SafeDeleteBlockerDialog`, `SaveQueryDialog`,
      `ShortcutsDialog`, `SnippetPickerDialog`, `ThoughtbaseProperties`,
      `ToolParamsDialog`, `TypePickerDialog`). 14 have not been migrated:
      `AboutDialog`, `AttachEvidenceDialog`, `AutoLinkInboundDialog`,
      `CollectionPickerDialog`, `CommandPaletteDialog`, `DialogHost`,
      `EditSavedQueriesDialog`, `EditSavedViewsDialog`, `FindInNotesDialog`,
      `GotoLineDialog`, `GotoNoteDialog`, `OcrProgressDialog`,
      `OnboardingDialog`, `SettingsDialog`, `SmartCollectionEditorDialog`,
      `SourcePickerDialog`, `TypeEditorDialog`. No file under
      `tests/architecture/` mentions `ui/Dialog` at all — this is the one
      major UI convention in the codebase with no ratchet test behind it,
      unlike the config-loader, IPC-registrar, and pattern-anti-pattern
      conventions that all got one.
- [ ] **The prop-drilling fix in `Sidebar.svelte` (#1922) is sound but
      unwritten as a reusable pattern.** `Sidebar.svelte:96-105` cut ~40 props
      to 3 by reading `notebase`, `editorStore`, `clipboard`, `dialogs`, and
      `bookmarksStore` directly (all reads, consistent with the existing
      data-flow rule) and grouping the remaining callbacks into two typed
      bags (`SidebarFileOps`/`SidebarPanelOps`). CLAUDE.md documents the
      mutation-routing rule at length but says nothing about this
      complementary "read stores directly to avoid prop drilling" pattern.
      `SourceDetail.svelte` (1,338 lines) still carries roughly a dozen
      callback props (`onNavigate`, `onShowConfirm`, `onShowPrompt`,
      `onDeleted`, `onCreateAboutNote`, `onOpenReference`, `onResolveStub`,
      `onOpenPdf`, `onCreateNoteFromExcerpt`, `onAppendExcerptToCurrent`,
      `onAttachEvidence`, …) in exactly the pre-#1922 shape, and
      `SourcesPanel.svelte`/`QueryPanel.svelte` are comparably heavy. Whether
      #1922's fix generalizes is untested by design — it is a one-off.
- [ ] **Docs generator (#1842) has no CI gate.** `scripts/build-docs.mjs` +
      `scripts/lib/docs-model.mjs` regenerate `website/docs/*.html` (237
      files, ~27,900 lines) from `_layout.html` + `_nav.json` + 118
      `_content/*.html` fragments (7,169 lines). `pnpm check:docs` exists and
      is wired into `predev`/`prebuild`/`prebuild:e2e` (`package.json`), but
      grepping `.github/workflows/*.yml` finds no invocation of it — `ci.yml`
      runs `pnpm lint` (tsc + svelte-check + eslint, confirmed via
      `scripts/lint.mjs`) and `pnpm coverage`, neither of which touches
      `website/`. A hand-edit to a generated HTML page that drifts from its
      source fragment would pass CI silently; only a developer's local
      `pnpm predev`/`pnpm build` run would catch it. (The separate
      `tests/scripts/help-docs-corpus-staleness.test.ts` snapshot-tests the
      LLM help corpus extracted *from* `website/docs/*.html` — a different,
      downstream concern from whether the HTML matches its own fragment
      source.)
- [ ] **Stale (harmless) `file-size-budgets.test.ts` entry.** `BUDGETS`
      includes `'src/shared/types.ts': 559` (line 75), but `THRESHOLD` is 600
      — the file is 41 lines under the line the test's own comment says
      budgeted entries should exist above ("delete it once the file drops
      under THRESHOLD"). The test's `measured()` function deliberately keeps
      measuring anything already in `BUDGETS` regardless of threshold, so this
      doesn't cause a false pass/fail — it's cosmetic, but it's exactly the
      kind of small inconsistency a "keep the ratchet honest" pass should
      clear, since `types.ts` shrank via commit `4e5be78b` (extracting
      `conversation.ts` and `privileged-sites.ts`) and the entry was never
      removed per the test's own stated convention.

## SOLID Principles Assessment

- **Single Responsibility: 4/5.** The last two review cycles' worth of
  splitting (`queries.ts` → 6 families, `indexers.ts` → 5 families,
  `Editor.svelte`/`Preview.svelte` extraction) shows the codebase actively
  correcting SRP violations as they're found, and the file-size-budget
  ratchet makes new ones visible immediately. Points off only because a
  handful of files remain genuinely oversized and un-scheduled for a split
  (`client.ts` 1,288, `App.svelte` 2,075, `conversations.svelte.ts` 1,179,
  `SourcesPanel.svelte` 1,298 for a third review running) — tracked, not
  fixed.
- **Open/Closed: 4/5.** The skills system (add a markdown file, no code
  change), the LLM provider factory, and `apply-dispatch.ts`'s
  self-registering payload-kind registry are textbook OCP. The Dialog
  consolidation gap is the counter-example: the "right" way to add a dialog
  (extend `ui/Dialog.svelte`) exists but isn't enforced, so the codebase can
  still be *extended wrong* — a new dialog can hand-roll its own chrome
  without anything objecting.
- **Liskov Substitution: 4/5.** The three `LLMProvider` implementations
  (`anthropic.ts`, `openai.ts`, `google.ts`) substitute behind one interface
  cleanly, and the factory (`llm/provider/index.ts`) is the only place that
  branches on which one to construct. Not independently stress-tested in this
  review beyond structural inspection, hence not 5/5.
- **Interface Segregation: 4/5.** `window.api` is namespaced by domain
  (`api.notebase`, `api.graph`, `api.publish`, …) rather than one flat surface
  — a component depends on exactly the namespace(s) it calls. `client.ts`
  being the largest `.ts` file in the tree (1,288 lines) is a volume problem
  (an honest catalog of ~30+ namespaces), not a segregation problem — no
  single caller is forced to depend on all of it.
- **Dependency Inversion: 3.5/5** (unchanged from the prior review's own
  score, and for the same reason). This is a functional, registry-driven
  codebase by choice, not a DI-container architecture, and that choice is
  demonstrably working — zero cycles across 788 files, three subsystems
  shipped cleanly in three weeks. The one concrete inversion gap that
  persists: `history/`'s ambient-context fix (module-global var →
  `AsyncLocalStorage`) was applied only to history; `graph/write-guard.ts`'s
  `enterLLMContext`/`enterTrustedContext` still use a depth-counted
  module-global for the same "ambient context across await boundaries"
  problem, unmigrated to the primitive that just proved itself.

## Improvement Plan

### High Priority (Structural Fixes)

1. **Add a dynamic-import regression test for the packaged CLI bundle.**
   Extend `tests/cli/electron-free.test.ts`'s "built CLI runs under plain
   Node" block with either (a) an assertion that `.vite/build/assets/` is
   empty/absent after the build, or (b) a command invocation that forces a
   dynamically-imported dependency to load (stub S3 config is enough to
   reach the AWS SDK import without a real network call). Either closes the
   exact gap that let this ship broken from `#1437` to `774b72be` unnoticed.
2. **Wire `pnpm check:docs` into `ci.yml`.** One line next to the existing
   `pnpm lint` step. Turns "a hand-edited generated page silently drifts"
   into a CI failure instead of a hope that whoever edits it also runs
   `pnpm predev` first.
3. **Add a ratchet test for Dialog.svelte adoption**, mirroring
   `pattern-ratchets.test.ts`'s shape: count `*Dialog.svelte` files that don't
   import `ui/Dialog`, baseline at today's 14, fail if the count goes up. This
   is the one major UI-consistency convention in the codebase with no fitness
   function, and it's a five-minute test to write given the ratchet
   infrastructure already exists.

### Medium Priority (Design Improvements)

4. **Split `SourcesPanel.svelte` (1,298 lines).** Flagged unaddressed across
   three consecutive architecture reviews (2026-08-01, 2026-08-23, this one)
   with zero commits against it in the intervening 95-commit window — the
   longest-standing unaddressed item in this report series.
5. **Write down the #1922 prop-drilling pattern and apply it to
   `SourceDetail.svelte` / `QueryPanel.svelte`.** Add a short CLAUDE.md note
   under Renderer data flow: "a component with >~15 callback props may read
   its stores directly instead (reads are already allowed); group any
   remaining mutation callbacks into a typed ops-bag rather than passing each
   individually," with `Sidebar.svelte:53-105` as the worked example. Then
   apply it to the two named components, which still carry the pre-#1922
   shape.
6. **Finish the `graph/indexers.ts` split** into a thin facade over
   `graph/indexers/`, the same shape `graph/queries.ts` reached — or, if the
   remaining 724 lines are genuinely irreducible glue, say so explicitly in
   a comment the way `queries.ts`'s facade does, so the next reviewer isn't
   left guessing whether this is finished or paused.
7. **Extend `store-ownership.test.ts` (or add a sibling) to flag zero-state
   passthrough stores** — a store file with no `$state`/`$derived` call that
   only forwards to `api.*` doesn't need to be *banned*, but naming it (the
   same "budget, not verdict" pattern as `pattern-ratchets.test.ts`) would
   make "has an owner" and "owns something" two separately-checkable claims
   instead of one conflated one. `publish.svelte.ts` and `review.svelte.ts`
   are the concrete cases to seed the baseline with.

### Low Priority (Consistency)

8. **Drop or re-justify the `src/shared/types.ts: 559` budget entry** —
   currently 41 lines under the 600-line `THRESHOLD`, contrary to the test's
   own documented convention to delete entries once a file drops below it.
9. **Migrate `graph/write-guard.ts`'s depth-counted context globals to
   `AsyncLocalStorage`**, aligning it with the primitive `history/index.ts`
   just adopted for the identical "ambient context across await boundaries"
   problem, closing the DIP gap named above.

## Migration Strategy

### Phase 1: Foundation (~3-4 days, one PR each)

Items 1-3. All three are pure guardrails — no behavior change, and each
protects against a specific, already-observed failure mode (a shipped crash,
a silent doc drift, an unenforced UI convention). Item 1 should go first: it
is the only Critical-severity finding in this report, closing a proven,
recently-live production defect class.

### Phase 2: Core Refactoring (~1.5-2 weeks, one PR each)

Items 4-6. #4 (`SourcesPanel.svelte`) is the highest-value single item in this
phase by virtue of having been deferred three review cycles running — treat it
as the thing to actually schedule this time rather than re-flag. #5 and #6 are
independent of each other and of #4, and can run in parallel.

### Phase 3: Optimization (~2-3 days)

Items 7-9. All three are small, isolated cleanups suited to "attach to
whatever PR next touches the relevant file" rather than a dedicated PR,
per the existing "migrate when you touch one" convention already established
in CLAUDE.md's own migration backlogs.

## Impact Analysis

**Development velocity.** Unaffected in the near term either way — none of
these findings block current feature work, and the codebase's demonstrated
cadence (one focused PR per numbered issue) means Phase 1's three items are
each a half-day-or-less addition to an existing test file, not a redesign.
The compounding risk is specifically item #1: every dynamically-imported
dependency added to the CLI's reachable graph from now until the regression
test lands is a repeat of the exact incident that just happened, and nothing
currently signals it before a user hits it.

**Testing requirements.** Phase 1 needs zero new test *infrastructure* — items
1 and 3 extend existing test files (`electron-free.test.ts`,
`pattern-ratchets.test.ts`'s established shape) and item 2 is a one-line CI
config change. Phase 3's #7 is the only item that adds a genuinely new
fitness-function shape, and it can reuse `store-ownership.test.ts`'s existing
parsing helpers (`renderer-api-surface.ts`) rather than writing a new scanner.

**Risk.** Low across the board. Nothing proposed here changes runtime
behavior — every item either adds a test, adds a CI step, documents an
existing pattern, or splits a file along a seam the codebase has already
demonstrated it knows how to find (six times, for `graph/queries.ts` alone).
The one item worth sequencing carefully is #6 (finishing the `indexers.ts`
split): `graph/**`'s coverage floor (`vitest.config.mts`) is the regression
net, the same one that made the `queries.ts` split safe.

**Performance.** No findings in this review implicate performance. The
`codeSplitting: false` fix for the CLI bundle (item 1's subject) is itself
performance-neutral — it trades a marginally larger single file for a
correctness guarantee the packaged app depends on.

## Recommendations

**Patterns to adopt.**

1. **A fitness function for every UI-consistency sweep, not just code
   conventions.** The codebase already treats config-loader adoption,
   pattern anti-patterns, and IPC-registrar coverage as ratchets; Dialog
   consolidation shows that a component-library convergence effort needs the
   identical treatment or it silently stalls at "however far the original PR
   series got."
2. **`AsyncLocalStorage` as the one answer to "ambient context," applied
   uniformly.** History just validated it fixes a real interleaving hazard;
   the write-guard's older, depth-counted version of the same idea should
   converge onto it rather than the codebase carrying two implementations of
   the same pattern.
3. **Write down "read stores directly" as the sanctioned alternative to prop
   drilling**, not just as an incidental effect of one PR (#1922). The
   renderer data-flow rule already permits component-level reads; naming this
   as the specific technique for cutting an oversized prop list turns a
   one-off fix into a repeatable one.

**Tools.** Nothing new needed — `dependency-cruiser` (already a dependency,
already driving `no-cycles.test.ts`) and the existing ratchet-test pattern in
`tests/architecture/` are sufficient machinery for every recommendation above.

**Documentation needs.**

- CLAUDE.md's Renderer data-flow section should gain the prop-drilling
  guidance from recommendation #3.
- `docs/config-roots.md`-style "this doc is checked against code" treatment
  should extend to the docs-generator/CI gap: either add the check to CI, or
  document explicitly why it's deliberately dev-only (if there's a reason
  this review didn't surface).

**Resist.** Do not turn the file-size budget ratchet into a hard cap, and do
not force `graph/indexers.ts`'s remaining 724 lines down further than the
natural facade split warrants just to hit a round number — the point, stated
in the test's own docstring, is the derivative, not the absolute, and that
discipline is exactly what kept this codebase's debt "fresh, small, and
differently located" cycle over cycle rather than compounding.

## Estimated Effort

| # | Item | Priority | Effort |
|---|---|---|---|
| 1 | CLI dynamic-import regression test | High | 3-4 h |
| 2 | Wire `pnpm check:docs` into CI | High | 0.5 h |
| 3 | Dialog.svelte adoption ratchet test | High | 2-3 h |
| 4 | Split `SourcesPanel.svelte` | Medium | 1-1.5 days |
| 5 | Document + apply #1922 prop-drilling pattern | Medium | 1 day |
| 6 | Finish `graph/indexers.ts` split | Medium | 1 day |
| 7 | Zero-state passthrough-store fitness function | Medium | 0.5 day |
| 8 | Drop stale `types.ts` budget entry | Low | 5 min |
| 9 | Migrate write-guard to `AsyncLocalStorage` | Low | 2-3 h |

- **Total tasks: 9**
- **Critical-fix hours: ~3-4** (item 1 — the one Critical finding, a
  proven-live gap with a cheap close).
- **High-priority hours: ~6-8** (items 1-3, all guardrails).
- **Full plan: ~1.5-2 weeks** (~5-6 engineer-days across items 1-9,
  sequenceable one PR at a time; Phase 1 ≈ 1 day wall-clock, Phase 2 ≈
  1-1.5 weeks with parallel tracks, Phase 3 ≈ 1 day and fully deferrable).

Net: this is the smallest, cleanest finding-set of the three reviews in this
series (9 items vs. the prior review's 12, and none rated above Medium except
the one genuinely proven production defect). The architecture is not
accumulating new debt at the rate it was three weeks ago — the 95-commit
window in between was spent almost entirely paying down exactly what the last
review named. The lesson for the next cycle is narrower than "keep
decomposing god-modules" (that arc is close to finished) and closer to "every
convergence effort — Dialog, prop-drilling, docs generation — needs its
ratchet test written in the same PR that does the sweep, not left for
whoever notices it stalled."
