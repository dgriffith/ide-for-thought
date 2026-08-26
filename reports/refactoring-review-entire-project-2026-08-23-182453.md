# Refactoring Review Plan
Generated: 2026-08-23 18:24:53
Scope: /Users/davegriffith/minerva (entire project)

## Executive Summary

Minerva is, by a wide margin, the best-governed codebase I have reviewed against its own
conventions. Six architecture fitness functions in `tests/architecture/` are green
(verified: `npx vitest run tests/architecture` → 6 files / 18 tests passed), and they cover
the failure modes most codebases discover only in a review like this one: file-size
derivatives (`file-size-budgets.test.ts`), swallowed errors and `withRootPathOr(null, …)`
(`pattern-ratchets.test.ts`), import cycles (`no-cycles.test.ts`), store ownership of
mutations (`store-ownership.test.ts`), IPC-registrar test coverage
(`ipc-registrar-coverage.test.ts` — `KNOWN_UNTESTED` is now **empty**), and config-root
documentation (`config-roots-doc.test.ts`). The typed-IPC migration is complete
(`UNMIGRATED_DOMAINS = new Set([])` in `tests/shared/ipc-contract-ratchet.test.ts:43`).
The classic review findings — magic numbers, deep nesting, `any` leakage, dead `TODO`s —
are essentially absent: 2 TODO/FIXME markers, 5 `eslint-disable`, 6 `: any`, 2 `as any`,
7 `@ts-expect-error` across 768 source files.

So this review deliberately goes after what the ratchets **cannot** see. Three themes:

1. **Abstractions that exist but were never adopted.** `src/renderer/lib/components/ui/Dialog.svelte`
   is a complete, documented 165-line dialog primitive with **zero importers**, while 30
   components hand-roll its scaffolding. `tests/helpers/temp-project.ts` was written
   because "~90 main-process test files repeat the same boilerplate" — 175 test files
   still hand-roll `mkdtempSync` and 6 import the helper. `discardFrom` was extracted in
   the conversations store; its mirror `approve*Draft` family (9 near-identical bodies)
   was not. These are the highest-yield, lowest-risk items in the report because the
   design decision is already made and reviewed. The sharpest case is
   `UnlinkedMentions.svelte`: 163 lines wired to nothing, kept green by a 105-line test that
   renders it directly, beside a test comment still describing an embedding that no longer
   exists.

2. **Duplicated policy that has already caused defects.** Three copies of the
   graph/search/vectors re-index fan-out disagree — the watcher path
   (`src/main/window-manager.ts:399-401`) omits `vectors.indexNote` that
   `src/main/ipc/helpers.ts:87` performs, so watcher-driven note edits leave stale
   embeddings. Two writers own `.minerva/config.json`, and one of them
   (`src/main/graph/index.ts:100-110`) writes `{ baseUri }` wholesale over the other's
   fields. Four copies of `IGNORED_DIRS` plus fifteen inline hidden-file skips implement
   the ignore policy CLAUDE.md documents once. The project's own history names this cost
   precisely: commit `de45b7bc` (#1818) says "Thirty components had each hand-rolled the
   same two lines, drifting into four different opacities on the way, which meant 'make it
   lighter' was a thirty-file edit."

3. **Type-surface drift the compiler can't catch because the type is the thing that's
   wrong.** `src/renderer/lib/ipc/client.ts` declares 83 of its 90 `on*` subscription
   methods as returning `void`, while `src/preload/preload.ts` returns an unsubscribe
   function from all 98 `subscribe(...)` calls. Consequently **zero** of the 103
   subscription sites in `stores/` and `lib/app/` capture an unsubscriber — TypeScript
   tells them there is nothing to capture.

Two cross-references, so this report does not re-discover tracked debt: CLAUDE.md's
IPC-error migration backlog entries for `GRAPH_QUERY`'s in-band `error?`
(`src/shared/ipc-contract.ts:240`) and the proposals `APPROVE`/`REJECT` boolean overload
(`src/main/ipc/register-proposals.ts:24,28`) are both still live and correctly described;
they are listed here only as Low priority with adjacent, *unlisted* instances noted. All
27 files over 600 lines are already budgeted, so "this file is big" is not itself a
finding — only "this file has a seam" is.

---

## Code Quality Metrics

Every number below states how it was derived. Nothing is estimated.

| Metric | Value | Derivation |
|---|---|---|
| Source files (`.ts` + `.svelte` under `src/`) | 768 | `find src -type f \( -name '*.ts' -o -name '*.svelte' \) \| wc -l` |
| Total source lines | 127,894 | same `find` piped to `wc -l`, `total` row |
| Lines by layer | main 47,183 · renderer 63,953 · shared 14,297 · preload 645 | per-directory `find … -exec wc -l {} +` tail |
| Files over 600 lines | 27 | `awk '$1>600 && $2!="total"'` over the `wc -l` output |
| …of which budgeted | 27 / 27 | every path in the table matches `BUDGETS` in `tests/architecture/file-size-budgets.test.ts:57-84`; the suite passes, so measured == budget |
| Svelte components | 125 | `find src/renderer -name '*.svelte' \| wc -l` |
| Renderer stores | 27 | `ls src/renderer/lib/stores/*.svelte.ts` |
| IPC registrars | 24 `register-*.ts` (3,667 lines in `src/main/ipc/`) | `wc -l src/main/ipc/*.ts` |
| Test files / lines | 621 `.test.ts` / 83,986 lines under `tests/` | `find tests -name '*.test.ts' \| wc -l`; `find tests -type f -name '*.ts' -exec wc -l {} +` |
| Test-to-source line ratio | 0.66 : 1 | 83,986 / 127,894 |
| TODO / FIXME / HACK in `src/` | 2 | `grep -rn 'TODO\|FIXME\|HACK' src --include='*.ts' --include='*.svelte' \| wc -l` |
| `eslint-disable` in `src/` | 5 | same grep shape |
| `: any` / `as any` / `@ts-expect-error` | 6 / 2 / 7 | same grep shape |
| `console.*` calls in `src/` | 199 (main 107, renderer 88, shared 2, preload 2) | `grep -rn 'console\.' <dir>` per layer |
| …with a `[tag]` prefix | ~105 across 30 distinct ad-hoc tags | `grep -rhoE "console\.(log\|warn\|error)\('\[[a-z-]+\]"` piped to `sort \| uniq -c` |
| Architecture tests | 6 files / 18 tests, all passing | `npx vitest run tests/architecture` |
| `.svelte` lines inside `<style>` | 14,930 of 40,368 (36%) | Python scan tracking `<style>`…`</style>` spans over all `src/renderer/**/*.svelte` |
| `.svelte` lines inside `<script>` | 15,227 of 40,368 (37%) | same scan |
| Components with >250 lines of scoped CSS | 12 | same scan, filtered |
| Cross-file duplicate 12-line windows | 634 groups | Python rolling-hash over whitespace-normalised lines of all `src/**/*.{ts,svelte}`, windows of 12 with ≥11 non-comment lines, reported only when the group spans >1 file |
| Test files calling `mkdtempSync` | 175 files / 211 call sites (103 also call `initGraph`) | `grep -rl 'mkdtempSync' tests` and `\| xargs grep -l initGraph` |
| Test files importing `tests/helpers/temp-project` | 6 (excluding the helper itself) | `grep -rl 'temp-project' tests --include='*.ts'` |

**Longest top-level functions** (Python brace-depth scan over `src/**/*.ts`, top of list):

| Lines | Location |
|---|---|
| 1017 | `src/renderer/lib/stores/editor.svelte.ts:167` `getEditorStore` |
| 767 | `src/renderer/lib/app/refactor-ops.svelte.ts:61` `createRefactorOps` |
| 641 | `src/renderer/lib/app/note-ops.ts:47` `createNoteOps` |
| 497 | `src/main/ipc/register-conversation-drafts.ts:105` `registerConversationDrafts` |
| 402 | `src/renderer/lib/preview/markdown-config.ts:69` `createPreviewMarkdown` |
| 382 | `src/main/ipc/register-notebase.ts:56` `registerNotebase` |
| 268 | `src/main/window-manager.ts:249` `openProjectInWindow` |
| 223 | `src/main/menu.ts:231` `buildFileMenu` |

Caveat, stated because the number is otherwise misleading: most of the top entries are
**factory/registrar** functions whose length is the sum of independent closures or handler
registrations, not a 500-line procedure. `openProjectInWindow` and `buildFileMenu` are the
genuine long-procedure cases. `getEditorStore` at 1017 lines is a genuine god-object.

**Script / template / style split of the largest components** (same span scan):

| Component | Total | `<script>` | template | `<style>` |
|---|---|---|---|---|
| `App.svelte` | 2081 | 1020 | 750 | 311 |
| `Preview.svelte` | 1532 | 1106 | 125 | 301 |
| `SourceDetail.svelte` | 1338 | 413 | 349 | 576 |
| `SourcesPanel.svelte` | 1298 | 620 | 294 | 384 |
| `Editor.svelte` | 1209 | 1054 | 49 | 106 |
| `PropertiesPanel.svelte` | 1157 | 459 | 251 | 447 |
| `Sidebar.svelte` | 991 | 530 | 182 | 279 |

`Editor.svelte` and `Preview.svelte` are TypeScript modules wearing a `.svelte` costume
(87% and 72% script, 4% and 8% template). `SourceDetail.svelte` and `PropertiesPanel.svelte`
are the opposite problem — 43% and 39% scoped CSS.

**Top cross-file clone clusters** (duplicate-window counts from the scan above):

| Windows | Pair |
|---|---|
| 98 | `AddPropertyDialog.svelte` ↔ `PromptDialog.svelte` |
| 75 | `right-sidebar/BacklinksPanel.svelte` ↔ `right-sidebar/OutgoingLinksPanel.svelte` |
| 70 | `NewNoteDialog.svelte` ↔ `PromptDialog.svelte` |
| 66 | `ConfirmDialog.svelte` ↔ `PromptDialog.svelte` |
| 61 | `AddPropertyDialog.svelte` ↔ `ToolParamsDialog.svelte` |
| 56 | `MineReferencesDialog.svelte` ↔ `ResolveStubDialog.svelte` |

**Duplicated pure helpers** (`grep -rhoE '^(export )?function ([a-z]…)'` piped to
`uniq -c`, then each verified by name): `escapeHtml` defined in **15** files,
`slugify`-family in 11, `escapeAttr` in 8, `stripFrontmatter` in 6, `escapeRegex` in 4.

---

## Refactoring Opportunities

### High Priority (Quick Wins)

- [ ] **Adopt `ui/Dialog.svelte`, or delete it.** It has **zero** importers in `src/`
      while 30 components duplicate its overlay/card scaffolding.
      `src/renderer/lib/components/ui/Dialog.svelte:1-165` (verified: `grep -rn "ui/Dialog" src/renderer` → no hits;
      `grep -rl 'var(--scrim-blur)' src/renderer --include='*.svelte'` → 30 files).
      Commit `de45b7bc` (#1818) documents the cost in the project's own words: the last
      backdrop change was "a thirty-file edit" across "four different opacities". Start
      with `PromptDialog.svelte` (124 of its 212 lines are `<style>`) and
      `ConfirmDialog.svelte` (138 of 220).
- [ ] **The rest of the design system is dead too — adopt or delete in the same PR.**
      `Kbd.svelte`, `Stepper.svelte`, `Toggle.svelte` have 0 `src/` importers; `Eyebrow.svelte`
      and `SegmentedControl.svelte` have 1 each; `Chip.svelte` has 2.
      `src/renderer/lib/components/ui/` — 566 lines shipped in #545/#556 and never wired in.
- [ ] **Fix the event-subscription return type: 83 methods declare `void` where preload
      returns an unsubscriber.** `src/renderer/lib/ipc/client.ts:60` (`onRenamed(...): void`)
      and 82 more (`grep -c '^\s*on[A-Z][A-Za-z]*(.*): void;'` → 83; only 7 declare
      `() => void`), against `src/preload/preload.ts:16-20` where `subscribe()` returns
      `() => { ipcRenderer.off(...) }` for all 98 sites. Result: **0 of 103**
      `api.*.on*` calls in `stores/`+`lib/app/` capture the unsubscriber. Pure type change,
      zero runtime effect; `tests/preload/preload-bridge.test.ts` pins the surface.
- [ ] **`resolveBaseUri` clobbers the project config — a data-loss path.**
      `src/main/graph/index.ts:100-110`: `writeConfig` does `JSON.stringify({ baseUri })`
      wholesale over the same `.minerva/config.json` that `src/main/project-config.ts:141-146`
      (`patchProjectConfig`) merges into. `readConfig` at `:94-98` is `catch { return null }`,
      so a **corrupt** config is indistinguishable from a missing one and triggers the
      overwrite — destroying `displayName`, `bibliography`, `onboarding`, `publishTargets`.
      Extract one electron-free `.minerva/config.json` read/patch leaf used by both.
- [ ] **Watcher-driven note edits never update the vector store.**
      `src/main/window-manager.ts:399-401` (`onFileChanged`) and `:430-441` (`onFileCreated`)
      call `graph.indexNote` + `search.indexNote` only, while `src/main/ipc/helpers.ts:87`
      also calls `vectors.indexNote`. Sources and excerpts in the *same file* do get vectors
      (`window-manager.ts:479, 486, 495, 502`), which is what makes this read as an oversight.
      `src/main/embeddings/backfill.ts:121-128` skips notes that already have rows, so it
      never self-heals. One `indexAllFor(ctx, rel, content)` in a non-electron module,
      called from all three fan-out copies.
- [ ] **`health-checks` `running` flag is module-global while its results are per-project.**
      `src/main/graph/health-checks.ts:40-41` (`lastResultsByProject` Map vs `let running = false`)
      and the guard at `:78`. A check running for project A makes a concurrent check for
      project B return `[]` — indistinguishable from "clean". With `armAutoChecks` debouncing
      off every graph write and a 5-minute periodic timer per project, concurrent runs across
      windows are the normal case. Key `running` by `rootPath`.
- [ ] **Four write handlers silently report success when no project is open.**
      `src/main/ipc/register-refactor.ts:112` (`FORMATTER_SAVE_SETTINGS`),
      `src/main/ipc/register-bookmarks.ts:15` (`BOOKMARKS_SAVE`) and `:25` (`TABS_SAVE`),
      `src/main/ipc/register-graph.ts:125` (`GRAPH_EXPORT`) all use
      `withRootPathOr(undefined, …)`. CLAUDE.md rule 2 restricts that fallback to a
      *legitimate* project-less value. The precedent is already written down at
      `src/main/ipc/register-notebase.ts:396-399`: "NOT `withRootPathOr` (#1862). This is a
      write, and the old fallback said 'I replaced 0 occurrences' for a call that never ran."
      Not caught by `pattern-ratchets.test.ts`, whose `NO_PROJECT_NULL` regex matches only
      `withRootPathOr(null`.
- [ ] **Extract `fileAndApprove()` in the drafts registrar — the other half of a prior
      review item that was only half-done.** `src/main/ipc/register-conversation-drafts.ts`
      lines 120-135, 149-158, 181-188, 219-228, 260-276, 334-340 repeat
      `proposeWrite → if (proposal) approveProposal → return { proposalUri, applied: true }`.
      `conversationProvenance()` (`:98`) shipped from the 2026-08-01 review;
      `fileAndAutoApprove` did not. The helper also fixes a live bug: `applied: true` is
      hardcoded at `:133, :158, :188, :228` even when `proposal` is `null` and nothing was
      applied — the same shape as `GIT_COMMIT.success`, already on CLAUDE.md's vestigial list.
- [ ] **Mirror `discardFrom` with an `approveFrom` in the conversations store.**
      `src/renderer/lib/stores/conversations.svelte.ts:864` already collapses the 9 discard
      functions to one-liners (`:871, :884, :898, :914, :930, :966, :990, :1013, :1036`).
      The 9 `approve*Draft` bodies at `:830, :873, :886, :900, :916, :932, :968, :992, :1015`
      still repeat `findTab → plainSnapshot → applyDraft(() => api.conversations.fileXDraft(…)) →
      tab.xDrafts.filter(...)` verbatim, differing only in the API method and the array field.
- [ ] **Consolidate the ignore policy: 4 copies plus 15 inline variants.**
      Identical `const IGNORED_DIRS = new Set(['.git','node_modules','.minerva','.obsidian'])`
      at `src/main/notebase/fs.ts:10`, `src/main/notebase/search-in-notes.ts:15`,
      `src/main/llm/auto-link.ts:26`, `src/main/formatter/orchestrator.ts:16`. A *different*
      inline policy at `src/main/graph/indexers.ts:942` and `:961`,
      `src/main/sources/tables.ts:553` and `:601`, `src/main/search/index.ts:81`,
      `src/main/embeddings/backfill.ts:196`, `src/main/llm/tools/list-notes.ts:22`,
      `src/main/publish/exporters/annotated-reading/index.ts:98`, and 6 more. Highest
      duplication count in `src/main`, and CLAUDE.md states this policy exactly once.
- [ ] **Delete four verified-dead exports.** `disposeSharedEmbedder`
      (`src/main/embeddings/shared-embedder.ts:29` — the *only* cleanup path for the
      process-wide embedder worker, never called: wire it into quit or drop it),
      `getWindowById` (`src/main/window-manager.ts:536`), `KNOWN_FILTERS`
      (`src/main/skills/template.ts:83`), `_isOpen` (`src/main/sources/tables.ts:663`,
      whose comment claims "Exposed for tests" but no test uses it). Each verified by
      `grep -rn '\bNAME\b' src tests` returning only the definition line.
- [ ] **An entire feature is unreachable, and a green test hides it.**
      `src/renderer/lib/components/right-sidebar/UnlinkedMentions.svelte` (163 lines) is
      imported by **no** source file — `RightSidebar.svelte:2-14` wires 13 panels and this
      is not among them, and `RelatedPanel.svelte` does not import it either. Its store
      `src/renderer/lib/stores/link-suggestions.svelte.ts` (21 lines) has exactly one
      consumer: the dead component. Yet `tests/renderer/components/UnlinkedMentions.test.ts`
      (105 lines) renders it and passes, and `tests/renderer/components/right-sidebar/RelatedPanel.test.ts:20`
      carries a now-false comment describing "Embedded UnlinkedMentions (#1074)". ~184
      source lines plus a 105-line test that proves nothing about the shipped app.
      Decide: re-wire it into `RightSidebar` or delete all three, and fix the stale comment
      either way.

### Medium Priority (Structural Improvements)

- [ ] **Six approve-and-apply draft channels have no test reference anywhere.**
      `CONVERSATION_FILE_PROPERTY_DRAFT`, `CONVERSATION_FILE_CLAIMS_DRAFT`,
      `CONVERSATION_FILE_REFACTOR_DRAFT`, `CONVERSATION_FILE_REORG_DRAFT`,
      `CONVERSATION_FILE_NOTE_BODY_DRAFT`, `CONVERSATION_RUN_COMPUTE_DRAFT` /
      `CONVERSATION_INSERT_COMPUTE_DRAFT` return zero hits from
      `grep -rl "<CHANNEL>" tests`. Each files a proposal **and auto-approves it** —
      exactly the path CLAUDE.md's LLM review checklist asks about. `register-conversation-drafts.ts`
      has no dedicated test file; it is reached only via `tests/main/ipc/register-conversation.test.ts:119`,
      which exercises 2 of its 11 handlers (`:268`, `:311`).
- [ ] **`register-refactor.ts`: 10 of its 12 channels are untested, including the LLM apply
      paths.** Only `FORMATTER_LOAD_SETTINGS` (via `no-project-contract.test.ts`) and
      `REFACTOR_AUTO_LINK_APPLY` (via `write-pipeline.test.ts`) appear in `tests/`.
      `REFACTOR_AUTO_TAG_APPLY` and `REFACTOR_AUTO_LINK_INBOUND_APPLY` — named in CLAUDE.md's
      Write Guard section as paths that must wrap themselves in `withLLMContext` — have no
      handler-level test. `ipc-registrar-coverage.test.ts` passes because the registrar is
      *imported*; its own docstring is candid that this "does NOT claim the registrar is
      thoroughly tested". `register-proposals` and `register-templates` are in the same
      import-only position.
- [ ] **Adopt `tests/helpers/temp-project.ts`.** The fixture (#678) exists and its docstring
      says "~90 main-process test files repeat the same boilerplate … at this many
      repetitions the threshold is crossed". Measured today: **175** test files call
      `mkdtempSync` (211 sites), **103** of those also call `initGraph` — the exact shape
      `useGraphProject()` collapses — and **6** files import the helper. This is the
      "refactor later" moment the project's own recorded guidance describes, not premature
      fixture-building.
- [ ] **Extract the remaining CodeMirror assembly out of `Editor.svelte`.** 1054 of its
      1209 lines are `<script>` against 49 lines of template
      (`src/renderer/lib/components/Editor.svelte`). The destination convention is fully
      established — `src/renderer/lib/editor/` already holds 36 modules / 4,699 lines. The
      residual context/gutter-menu state block at `:206-431` and the completion/extension
      blocks at `:645-996` are the seams. Coverage floor exists (`vitest.config.mts`,
      per-file `Editor.svelte` block), so extraction requires retuning it in the same PR.
- [ ] **Same for `Preview.svelte`:** 1106 script / 125 template lines, with
      `src/renderer/lib/preview/` already holding 13 modules (2,150 lines).
- [ ] **Split the frontmatter→RDF converter out of `graph/indexers.ts`.**
      `src/main/graph/indexers.ts:133-401` is one cohesive value-mapping concern that never
      touches orchestration: `recoverYamlEatenWikiLink` (`:133`), `isFrontmatterMap` (`:146`),
      `emitFrontmatterValue` (`:174`), `resolveFrontmatterPredicate` (`:230`),
      `declaredPropertyPredicate` (`:251`), the ISO/wikilink regexes (`:258-264`),
      `resolveWholeWikiLink` (`:277`), `frontmatterValueToEdge` (`:321`), `coerceDeclared` (`:364`).
      ~285 lines → `indexers/frontmatter.ts`; the `indexers/` directory already exists with
      4 modules and `indexers.ts:46-49` already imports from it. The split is half-done.
      Tests already isolate this behaviour (`tests/main/graph/frontmatter-indexing.test.ts`,
      `frontmatter-backlinks.test.ts`, `frontmatter-link-parity.test.ts`).
- [ ] **Move the accelerator utilities out of `menu.ts`.** `src/main/menu.ts:1023-1071`
      (`formatAccelerator`, `collectAcceleratorsByMenu`, `walkInto`) are pure and
      Electron-free — the doc comment at `:1038-1043` says so. The proof they're in the
      wrong file is in the test: `tests/main/menu-accelerators.test.ts:11-15` explains it
      must "mock the entire Electron + project-state surface that `menu.ts` pulls in" to
      reach them. ~50 lines off a budgeted file *and* a test with no mocks.
- [ ] **Extract `createWatchHandlers()` from `openProjectInWindow`.**
      `src/main/window-manager.ts:249-516` is a 268-line procedure whose `:296-506` region is
      a closure factory over `(rootPath, projectCtx, win)`. `onFileChanged` (`:372-412`) and
      `onFileCreated` (`:413-442`) are near-identical — same CSV branch, same
      `.csv.schema.yaml` early return, same read→index→reregister→persist block, differing
      only in a comment. Extraction leaves ~60 lines of lifecycle and makes the handlers
      testable without a `BrowserWindow`.
- [ ] **Follow the existing `install*` convention in `markdown-config.ts`.**
      `src/renderer/lib/preview/markdown-config.ts:69` (`createPreviewMarkdown`, 402 lines)
      already delegates 7 concerns to `installMath` / `installCallouts` / `installDoiAutolink` /
      `installHighlight` / `installWikiLinks` / `installNoteTags` / `installTransclusions`
      (imports at `:21-25`), but keeps the heading/paragraph/list-item/image rules (`:104-256`)
      and six fence renderers (`:258-368`) plus the dispatcher (`:369-460`) inline.
      `installFences(md, deps)` and `installAnchors(md)` finish the job. Well covered by
      `tests/renderer/preview/markdown-config.test.ts` and `hydrate.test.ts`.
- [ ] **Collapse `BacklinksPanel` and `OutgoingLinksPanel` into one direction-parameterised
      component.** `src/renderer/lib/components/right-sidebar/BacklinksPanel.svelte` (219)
      and `OutgoingLinksPanel.svelte` (230) produce an 84-line whitespace-normalised diff,
      and **83** of their style-block lines are byte-identical (`comm -12` over the sorted
      `:136-219` / `:138-230` spans). The script diff is only: `Backlink` vs `OutgoingLink`,
      `b.backlinks` vs `b.outgoing`, and `source`/`sourceTitle` vs `target`/`targetTitle`.
- [ ] **Promote the repeated component chrome into a utility layer, not just tokens.**
      Measured across `src/renderer/**/*.svelte`: a `.context-menu {` rule in **10**
      components (`Editor`, `EditorContextMenu`, `PdfViewer`, `SourcesPanel`,
      `BookmarksPanel`, `Sidebar`, `TabBar`, `FileTree`, `TablesPanel`,
      `right-sidebar/HistoryPanel`); a `.field {` rule in **19**; `background: var(--accent)`
      (the primary-button surface) in **49**. 36% of all `.svelte` lines (14,930 of 40,368)
      live inside `<style>`, and 12 components carry more than 250 lines of scoped CSS
      each — `SourceDetail.svelte` is 576 of 1,338 (43%) and `PropertiesPanel.svelte` 447 of
      1,157 (39%). Tokens in `global.css` already solve *values*; what is missing is a
      shared class layer for the three or four recurring *shapes*. Note the positive
      counter-example: menu positioning was correctly factored into
      `src/renderer/lib/utils/menuClamp.ts` and is imported by 10 files — that is the model.
- [ ] **Give the draft-kind family one parameterised channel pair.** Nine draft kinds are
      spelled out longhand across five layers: 21 constants in `src/shared/channels.ts:528-568`,
      matching `ChannelMap` entries, ~19 methods in `src/preload/preload.ts:285-323`, the
      client interface, 11 handlers in `register-conversation-drafts.ts`, and 9 approve +
      9 discard functions in the conversations store. A shared base already exists
      (`src/shared/conversation-draft-base.ts`), so the discriminant is half-built. Adding a
      tenth kind is currently a seven-file change.
- [ ] **`src/shared/types.ts` (732) is a residual dump, not an honest catalog.** `src/shared/`
      has already been split into ~30 domain modules (`conversation-claims-drafts.ts`,
      `conversation-note-body-drafts.ts`, `conversation-refactor-drafts.ts`, `history.ts`,
      `proposals.ts`, …) — yet every conversation *core* type is still here: `ContextBundle`
      (`:552`), `TurnUsage` (`:581`), `ConversationMessage` (`:588`), `ConversationStatus`
      (`:631`), `Conversation` (`:675`). The tell that it's a dump rather than a barrel:
      `PrivilegedSite` (`:615-630`) — per-machine cookie-partition state — sits *inside* the
      `// ── Conversations ──` section. `shared/conversation.ts` is the missing module.
      (By contrast `channels.ts` and `ipc-contract.ts` genuinely are catalogs; leave them.)
- [ ] **Six more hand-rolled config loaders that CLAUDE.md's "still hand-rolled" list omits.**
      CLAUDE.md names `clipper-config`, `llm/settings`, `menu-config-store` (both confirmed:
      `src/main/clipper/clipper-config.ts:41`, `src/main/llm/settings.ts:106`). Also unmigrated,
      all with the corruption-swallowing `catch`: `src/main/recent-projects.ts:17-24`,
      `src/main/session.ts:15-22`, `src/main/privileged-sites.ts:26-35`,
      `src/main/publish/exporters/static-site/site-config.ts:51-62` (whose comment explicitly
      conflates "missing / malformed"), `src/main/llm/conversation.ts:302-315` (a hand-rolled
      `typeof` ladder where `asBool`/`asString`/`asFiniteNumber` exist), and
      `src/main/graph/index.ts:94-98`. `config-roots-doc.test.ts` passes because it checks
      *location*, not *loader* — update CLAUDE.md's list as part of this.
- [ ] **`session.ts:13` resolves `app.getPath('userData')` at module load** — the exact
      anti-pattern `src/main/recent-projects.ts:7-14` writes a nine-line comment warning
      against ("made merely IMPORTING this file a side effect — which broke every test suite
      that reaches it transitively"). `privileged-sites.ts:20-24` uses the safe lazy form.
      `session.ts` is the odd one out and, unlike its two neighbours, has no test.
- [ ] **`readJsonFileOr` has no write counterpart, and none of the four writers is atomic.**
      `src/main/ipc/read-json.ts:16-25` gets ENOENT-vs-corrupt right for reads. The write half
      (`mkdir recursive` + `writeFile(JSON.stringify(x, null, 2))`) is copy-pasted at
      `src/main/ipc/register-bookmarks.ts:16-18` and `:26-28`,
      `src/main/ipc/register-refactor.ts:113-115`, `src/main/llm/conversation.ts:317-319`.
      No temp-file + rename, so a crash mid-write produces exactly the corruption
      `readJsonFileOr` will then correctly refuse to swallow.
- [ ] **`register-sources.ts` broadcasts change events to the invoking window only.**
      `broadcast(win, Channels.SOURCES_CHANGED)` at `:78, :89, :187, :228, :234, :240, :246,
      :252, :258` (+ `COLLECTIONS_CHANGED` at `:271`) all target `win`, while the established
      pattern in `src/main/ipc/helpers.ts:125-168` (`broadcastRewritten`,
      `broadcastProposalsChanged`, `broadcastHistoryChanged`) fans out via
      `windowsForProject(rootPath)`. Two windows on one thoughtbase: window B's Sources panel
      goes stale. `:225-260` is six handlers of byte-identical shape — a `withSourceMutation(fn)`
      wrapper deletes ~24 lines and fixes the fan-out in one edit.
- [ ] **Hoist the duplicated pure helpers into `src/shared/`.** `escapeHtml` is defined in 15
      files (`src/renderer/lib/preview/text.ts:8` already exports one; the other 14 include
      `markdown/youtube-embed.ts:55`, `markdown/mermaid-renderer.ts:184`,
      `markdown/vega-renderer.ts:382`, `shared/markdown/math-plugin.ts:52`, and 8 publish
      exporters). `stripFrontmatter` in 6, `escapeRegex` in 4, `slugify`-family in 11
      (`src/shared/slug.ts:16` is the canonical one; `src/main/types/write.ts:29`,
      `types/parse.ts:27`, `skills/parse.ts:37` and 3 publish exporters each redefine it).
      Check semantics before merging the slug variants — some are deliberately different.
- [ ] **There is no logging seam.** 199 `console.*` calls, ~105 carrying a bracket tag across
      30 ad-hoc names (`[settings]` 21, `[minerva]` 20, `[conv]` 12, `[conv-panel]` 10, then a
      long tail of singletons like `[quit]`, `[tabs]`, `[tool]`). No level control, no way to
      silence a subsystem, no consistent prefix. A 30-line `logger(tag)` leaf and a codemod
      would make the output greppable and the noise tunable.
- [ ] **Extract session persistence out of the editor store.**
      `src/renderer/lib/stores/editor.svelte.ts:167` (`getEditorStore`, 1,017 lines) is the
      largest single function in the codebase. The tab/layout serialisation block is the
      clean seam — it is pure data mapping over `EditorGroup`/`TabState` with no editor
      behaviour in it. Separately, `getEditorStore()` is **not memoised** and is called at
      18 sites (`grep -rn 'getEditorStore()' src/renderer \| wc -l`); every call rebuilds
      the full closure set over the same module-level `$state`. The state is shared so
      behaviour is correct, but the shape invites the assumption that it is a singleton.
      Well covered (`tests/renderer/stores/editor-store.test.ts` 740 lines +
      `tests/renderer/editor-store.test.ts` 668 lines — themselves worth merging; the
      duplicate-ish names are a navigation hazard).
- [ ] **Nothing links `client.ts` to `ChannelMap` at compile time.**
      `src/renderer/lib/ipc/client.ts` (1,239 lines) hand-restates every signature that
      `src/shared/ipc-contract.ts` already declares and `src/preload/preload.ts` already
      implements — three declarations of one contract, with only the preload↔contract pair
      structurally enforced (via the typed `invoke` wrapper). The 83-method `void`-vs-`() => void`
      drift above is precisely what that missing third link would have caught. A
      `type _Check = Assert<Extends<NotebaseApi, ClientOf<ChannelMap>>>` would make the
      client a derived view rather than a parallel transcript.
- [ ] **`Editor.svelte`'s 196-line `extensions` array literal.**
      `src/renderer/lib/components/Editor.svelte:441-637` is a single array expression mixing
      a11y attributes, markdown/plaintext branching, the frontmatter fold, and ~30 imported
      extensions. It is the natural first extraction toward `lib/editor/build-extensions.ts`
      and would take the component below its coverage floor's blind spot.
- [ ] **`Sidebar.svelte` takes ~40 props.** `src/renderer/lib/components/Sidebar.svelte`
      — the longest parameter list in the renderer, and the reason `App.svelte`'s template
      half (750 lines) is as large as it is. Grouping into 2-3 cohesive prop objects, or
      reading directly from `sidebar-selection`/`notebase` stores where the data already
      lives, is the smaller change.
- [ ] **Turn `health-checks.ts`'s hand-paired dispatch into a registry.**
      `src/main/graph/health-checks.ts:85-98` pairs each check with its inspection type ids,
      then post-filters at `:101` to undo the multi-type checks it just ran — and the same
      pairing exists again in `src/shared/inspections.ts`'s catalog. A
      `CHECKS: Array<{ types: string[]; run(ctx, settings) }>` collapses `:85-101` to a
      filter + `Promise.all` and makes "did we forget to gate the new check?" structurally
      impossible. Inside it, `checkDuplicateSources` (`:396-456`) is two near-identical
      blocks (`:400-425` DOI, `:428-453` URI) differing only in predicate, key, type and
      message.

### Low Priority (Nice-to-Have)

- [ ] **The swallow ratchet misses the expression form.**
      `tests/architecture/pattern-ratchets.test.ts:105` `SWALLOW` matches only block-form
      `catch { return X }`, and only under `src/main`. There are **18** `.catch(() => <empty>)`
      sites tracked by nothing — including the one CLAUDE.md already names,
      `src/main/ipc/register-links.ts:117` (`.catch(() => '')`), plus two fresh ones at
      `src/main/ipc/register-bibliography.ts:117` and `:122`, and
      `src/main/git/publish-git.ts:163, :164, :183`. Adding a second regex is a ~5-line change.
      Extending the scan to `src/renderer` + `src/shared` costs little: only 3 block-form
      sites exist there today (`ComputeDraftCard.svelte` ×1, `src/shared` ×2), so the
      baseline is nearly free to establish now and expensive to establish later.
- [ ] **Two `ok`-shaped returns that are neither a real union nor a plain value, and are not
      on CLAUDE.md's backlog.** `src/shared/ipc-contract.ts:248`
      (`graph:attachExcerptEvidence` → `{ ok: boolean; error?: string; proposalUri?: string }`)
      is both halves of the anti-pattern at once — an undiscriminated `ok: boolean` *and* an
      in-band `error?`. `src/shared/ipc-contract.ts:504` (`sources:applyStubResolution` →
      `{ ok: boolean }`) carries no failure information at all. The backlog correctly lists
      `GRAPH_QUERY` (`:240`) and the proposals booleans
      (`src/main/ipc/register-proposals.ts:24, :28`); these two are adjacent and unlisted.
      `PROPOSAL_EXPIRE` (`:30`, `withRootPathOr(0, …)`) is a third — "expired 0" and "no
      project" are the same answer today.
- [ ] **90 inline `import('…')` type annotations in `client.ts`.**
      `src/renderer/lib/ipc/client.ts` has a top-level import block at `:1-8` and then reaches
      for inline dynamic-import types 90 times (e.g. `:206, :624, :639`). Preload does this
      twice. Purely a readability inconsistency, but it makes the file harder to scan than
      its 1,239 lines already do.
- [ ] **`DAY_MS` defined twice.** `src/main/graph/queries/sources.ts:180`
      (`export const DAY_MS = 86_400_000`, re-exported through `graph/queries.ts:46` and used
      by `llm/approval.ts` and `health-checks.ts`) and `src/main/history/policy.ts:24`
      (`const DAY_MS = 24 * 60 * 60 * 1000`). Import the shared one.
- [ ] **Nine editor commands exported for one in-file consumer.**
      `src/renderer/lib/editor/formatting.ts:583-592` exports `insertVegaLiteBar` …
      `insertVegaLiteFromCell`, all of which are referenced only by the
      `VEGA_LITE_CHART_ITEMS` table at `:598-606` in the same file. Drop the `export`.
- [ ] **`package.json` triplicates a script string.** `predev`, `prebuild` and `prebuild:e2e`
      are the same three-command chain written out three times. Name it once
      (`"prep": "…"`) and have the three delegate.
- [ ] **Unnamed magic numbers in `health-checks.ts`.** `LIMIT 20` (`:149`), `LIMIT 25`
      (`:409`, `:437`), `LIMIT 1000` (`:521`), the `>= 50` soft cap (`:534`),
      `5 * 60 * 1000` (`:761`). The file already knows the right idiom —
      `DEFAULT_CHECK_DEBOUNCE_MS` at `:708`. Note that magic numbers are otherwise **not**
      a problem in this codebase: only ~14 of 42 `setTimeout` sites use a bare literal, and
      most timing constants are already named.
- [ ] **Extract `buildKernelEnv()` from `spawnKernel`.**
      `src/main/compute/python-kernel.ts:102-240` mixes launch planning (including a 36-line
      `env` literal at `:113-158`), the JSON line-protocol handler (`:169-207`) and process
      lifecycle (`:209-237`). `buildKernelEnv(rootPath, rpcSocket, allowNetwork)` is pure;
      today PYTHONPATH ordering, `MPLBACKEND` and `MINERVA_ALLOW_NETWORK` gating can only be
      verified by spawning a real interpreter.
- [ ] **Generate `EventMap`'s menu block.** `src/shared/ipc-contract.ts:626-692` is ~65
      hand-written zero-arg `'menu:*': () => void` entries, mechanically derivable from a
      `MENU_COMMANDS` tuple. Also: `PublishTargetBase` / `GitPublishTarget` / `S3PublishTarget`
      at `:703-720` are domain models in a file whose own header (`:26`) declares it a pure
      IPC-signature module, and the comment at `:701-702` admits they're mirrored in
      `project-config.ts:110`.
- [ ] **Six stores contain no reactive state at all.** `link-suggestions.svelte.ts` (21),
      `publish.svelte.ts` (22), `review.svelte.ts` (18), `saved-queries.svelte.ts` (36),
      `settings.svelte.ts` (66), `source-data.svelte.ts` (58) declare zero `$state` /
      `$derived` / `$effect` (verified by grep over `src/renderer/lib/stores/*.svelte.ts`).
      They exist to satisfy the data-flow rule rather than to own state, which is exactly
      the limitation `tests/architecture/store-ownership.test.ts:22-26` names about itself:
      "It CANNOT tell a well-designed store from a one-line passthrough." Not a defect —
      but worth deciding per store whether the `api` call belongs in an ops module instead,
      and worth remembering when reading that test as a guarantee.
- [ ] **A swallowed error in the renderer, in the same channel CLAUDE.md already flags.**
      `src/renderer/lib/components/right-sidebar/CitationsPanel.svelte:55-57` —
      `api.links.citationsForNote(...).catch(() => { groups = []; })` renders a failed
      citation fetch as "no citations". The main-side half of this call
      (`LINKS_CITATIONS_FOR_NOTE`'s `.catch(() => '')`) is already on CLAUDE.md's swallow
      backlog; the renderer half is not, because no ratchet scans `src/renderer`. Fix both
      together, and it makes the ratchet-scope extension above concrete.
- [ ] **`SettingsDialog.svelte`'s last inline tab.** 8 of its 9 tabs are already separate
      components; the `notes` tab body remains inline. Finishing the pattern drops the file
      under its 779-line budget.
- [ ] **No unused-export tooling.** `knip` / `ts-prune` are absent from `package.json`
      (only `dependency-cruiser@^18.2.0`, used by `no-cycles.test.ts`). My heuristic scan of
      1,604 exported symbols produced ~60 candidates, but most are false positives — same-file
      table consumers and test-only helpers — which is exactly why this needs a real tool
      rather than a grep. Given how well the other ratchets work here, a `knip` baseline in
      the same ratcheted style would fit the codebase's existing idiom.
- [ ] **Do not refactor `src/main/llm/apply-dispatch.ts`.** Recorded deliberately because it
      is 499 lines and will keep showing up on size-sorted lists. `:30-58` is a typed
      `PayloadHandler` registry with rollback-data inference, `:86-123` a clean
      ordered-apply-with-reverse-rollback, `:137-464` ten self-contained handler literals.
      Splitting into `payload-handlers/*.ts` would convert compile-time registration into
      import-for-side-effect ordering — a downgrade.

---

## Risk Assessment

### Safe Refactorings (Low Risk)

Type-only, delete-only, or mechanically verified; the existing gates catch a mistake.

| Item | Why it's safe | What catches a regression |
|---|---|---|
| `client.ts` `on*` → `() => void` | No runtime change; preload already returns the function | `tsc --noEmit` + `tests/preload/preload-bridge.test.ts` snapshot |
| Delete the 4 dead exports | Zero references verified across `src/` + `tests/` | `tsc --noEmit`; `no-cycles` unaffected |
| Drop `export` on the 9 `insertVegaLite*` | Single in-file consumer | `tsc --noEmit` |
| `DAY_MS` de-dup, `package.json` script naming | Value-identical | existing suites |
| `escapeHtml` / `escapeRegex` / `stripFrontmatter` hoist | Pure functions; diff each body before merging | `tests/renderer/preview/text.test.ts`, publish exporter suites (`csl.test.ts` 758 lines, `static-site.test.ts` 490) |
| `fileAndApprove` / `approveFrom` extraction | Behaviour-preserving except the `applied: true` bug, which is the point | `tests/main/llm/conversation-drafts-flow.test.ts`, `tests/renderer/stores/conversations-store.test.ts` (823 lines) |
| `menu/accelerators.ts` move | Pure, Electron-free | `tests/main/menu-accelerators.test.ts` (and it gets simpler) |
| `temp-project.ts` adoption | Test-only; a wrong conversion fails immediately | the converted test itself |
| `IGNORED_DIRS` consolidation | Set-equality is checkable by eye; the 15 inline variants need per-site confirmation that policies really match | `tests/main/notebase/*`, `graph/*`, `search/*` — but see Moderate below |
| Ratchet-scope extensions (`.catch` regex, renderer/shared scan) | Adding a baseline can only fail loudly | the ratchet itself |
| Delete or re-wire `UnlinkedMentions` + `link-suggestions` store | Zero source importers verified; only its own test references it | `tsc --noEmit`, `svelte-check`; deleting the test with it is the point |
| `SettingsDialog` `notes` tab extraction | 8 of 9 sibling tabs already prove the pattern | `svelte-check` + the settings render tests |

### Moderate Risk

| Item | Risk | Mitigation |
|---|---|---|
| `resolveBaseUri` config fix | Touches project bootstrap; a wrong merge could leave `baseUri` unset and break every graph URI | Add a test asserting `displayName` survives a `baseUri` coin *and* a corrupt-config read; `tests/main/project-config.test.ts` covers the safe writer already |
| `withRootPathOr(undefined) → withRootPath` on 4 writes | Callers now get a rejected promise where they got silent success; each renderer call site needs a `catch` | `tests/main/ipc/no-project-contract.test.ts` is the existing template for exactly this assertion (`:163`) |
| `health-checks` `running` per-project | Concurrency semantics; a wrong key reintroduces the cross-project stomp instead of fixing it | `tests/main/graph/health-checks.test.ts` exists but is single-project — add a two-project case first |
| `IGNORED_DIRS` unification across the 15 inline sites | The two policies are **not** identical: `IGNORED_DIRS` names four dirs, the inline form is `startsWith('.') || === 'node_modules'`. Merging naively changes what gets indexed | Land the shared constant first, then convert call sites one at a time, each with its own test |
| `indexers/frontmatter.ts` split | Large move in a coverage-floored tree (`src/main/graph/**`: 80 L / 80 F / 78 S / 62 B) | Pure move with no logic edits; run `pnpm coverage` in the same PR |
| `createWatchHandlers` extraction | Watcher paths are timing-sensitive and partly untested | `tests/main/notebase/watcher.test.ts` covers the watcher, not these handlers — write the handler test as part of the extraction, which is the payoff |
| `withSourceMutation` + multi-window broadcast | Changes observable behaviour (more windows refresh) — that is the fix, but it is a behaviour change | `tests/main/ipc/register-sources.test.ts` (746 lines) |
| `ui/Dialog.svelte` adoption | Visual regression across 30 dialogs if migrated in bulk | Migrate 2-3 per PR starting with `PromptDialog`/`ConfirmDialog`; `tests/renderer/a11y/` + the axe helpers exist; **do not** change any dialog's affordances — CLAUDE.md's UX philosophy (no danger styling, dismissable confirms, "Don't ask again") must survive unchanged |
| `markdown-config.ts` `installFences` | Renderer output is snapshot-adjacent | `tests/renderer/preview/markdown-config.test.ts`, `hydrate.test.ts` (519 lines) |
| Editor-store session-persistence extraction | 1,017-line function with 18 call sites; the `src/renderer/**` aggregate floor plus per-file floors apply | Two large suites already cover it (`editor-store.test.ts` ×2, 1,408 lines combined); merge those first so the safety net lives in one place |
| CSS utility layer for `.context-menu` / `.field` / primary button | Svelte scoping means a global utility class behaves differently from a scoped rule; specificity shifts are easy to miss | Introduce the layer additively, migrate a handful of components per PR, keep `tests/renderer/a11y/` green |
| `Sidebar.svelte` prop consolidation | ~40 props threaded from `App.svelte`; a mis-grouped object is a silent prop-name typo | Run `svelte-check`, not just `tsc` — CLAUDE.md is explicit that it is what catches script↔template drift |

### High Risk

| Item | Risk | Recommendation |
|---|---|---|
| Vector-store fan-out unification | Touches the graph + search + vectors write path from three call sites at once, including the LLM apply path (`apply-dispatch.ts:243-252, :262-271`). A mistake here is silent — stale embeddings look like ordinary "semantic search didn't find it" | Split into two PRs: (1) add `vectors.indexNote` to the watcher handlers with a test, (2) unify the three copies afterwards. Do **not** do both at once |
| `Editor.svelte` / `Preview.svelte` script extraction | 1054 and 1106 lines of stateful CodeMirror/markdown-it wiring; per-file coverage floors in `vitest.config.mts` will move and must be retuned in the same PR; `svelte-check` is the only thing that catches script↔template drift | One concern per PR, budget + floor updated in the same diff, and `pnpm lint` (not just `tsc`) before every push |
| Draft-kind channel parameterisation | Crosses all five layers and touches the approval engine's auto-approve path. The LLM write guard is fatal under test, which helps — but a mis-typed discriminant could route a payload to the wrong `operationType` | Do the six missing draft-channel tests **first**; they are the safety net this refactor needs and are valuable on their own |
| `shared/types.ts` split | 732 lines with wide import fan-out; a careless move can create the import cycle `no-cycles.test.ts` exists to prevent | Move one cohesive group (`shared/conversation.ts`) with re-exports left behind, verify `no-cycles`, then remove the re-exports in a follow-up |

---

## Implementation Strategy

**Phase 0 — extend the nets before moving anything (½ day).**
The ratchets are this codebase's best asset; two cheap extensions make the rest of the work
safer. Add the `.catch(() => <empty>)` regex to `pattern-ratchets.test.ts` and widen its
scan to `src/renderer` + `src/shared` (3 sites today, so the baseline is nearly free).
Establish the baseline *now*, before any refactor churns those files.

**Phase 1 — correctness (2-3 days).**
The four verified defects, smallest blast radius first, each with the test it was missing:
`resolveBaseUri` config clobber → `health-checks` `running` key → the four
`withRootPathOr(undefined)` writes → the vector fan-out (split into two PRs as noted).
None of these is a refactor in the pure sense, but each one's *cause* is duplication, and
fixing the cause is the refactor.

**Phase 2 — adopt what already exists (3-4 days).**
Nothing new gets designed in this phase, which is what makes it cheap. `ui/Dialog.svelte`
(2-3 dialogs per PR), `temp-project.ts` (batch by directory: `tests/main/graph/` first,
it has the most `initGraph` sites), `approveFrom` mirroring `discardFrom`, `fileAndApprove`
finishing the 2026-08-01 review's item 5, and the `IGNORED_DIRS` constant. Delete the four
dead exports, the `ui/` primitives that adoption does not reach, and — once someone decides
whether the feature is wanted — `UnlinkedMentions` and its store.

**Phase 3 — test the trust path (2-3 days).**
The six untested approve-and-apply draft channels and `register-refactor`'s ten. Write
`tests/main/ipc/register-conversation-drafts.test.ts` as a real file rather than leaning on
`register-conversation.test.ts`. This phase is a prerequisite for Phase 5 and stands on its
own merits against CLAUDE.md's LLM review checklist.

**Phase 4 — seams in budgeted files (1 week).**
One extraction per PR, budget lowered in the same diff (the ratchet requires it — a file
that shrinks fails until the number is lowered). Order by payoff-per-risk:
`menu/accelerators.ts` → `indexers/frontmatter.ts` → `installFences` in `markdown-config.ts`
→ `createWatchHandlers` → `LinkListPanel` → `Preview.svelte` → `Editor.svelte`.

**Phase 5 — structural (deferred; scope separately).**
Draft-kind parameterisation, `shared/conversation.ts`, the logging seam, the six config
loaders, the `readJsonFileOr` write counterpart. Each is a design decision, not a cleanup;
each deserves an issue with a stated rationale rather than being folded into a
refactoring sweep.

**Standing rules for every PR here.** Branch first — never commit to `main`. Stage explicit
paths, never `git add -A`. Run `pnpm lint` (the pre-push hook does, but `svelte-check` is
what catches `.svelte` drift and it is easy to skip locally). Any `.svelte` file touched
needs `svelte-check`; any `window.api` surface change needs
`pnpm test tests/preload/preload-bridge.test.ts -u`; any budgeted file needs its `BUDGETS`
entry updated in the same diff; any `website/docs/*.html` edit needs the help-corpus
snapshot regenerated.

---

## Estimated Effort

Ranges assume one engineer familiar with the codebase, and include writing the test that
each item's risk row calls for. "Sessions" ≈ half-days.

| Phase | Items | Effort | Notes |
|---|---|---|---|
| 0 — extend the ratchets | 2 | 1 session | Do this first; it is nearly free and it protects everything after |
| 1 — correctness | 4 (5 PRs) | 4-6 sessions | Config clobber ~1 session incl. test; vector fan-out is 2 PRs |
| 2 — adopt existing abstractions | 6 | 7-9 sessions | Dialog migration dominates (~10 PRs × ~½ session); `temp-project` conversion is mechanical but touches 175 files, so batch it; `UnlinkedMentions` is ~1 hour |
| 3 — trust-path tests | 2 | 4-5 sessions | 16 untested channels; `register-conversation-drafts.test.ts` is the bulk |
| 4 — seams in budgeted files | 11 | 12-15 sessions | `Editor.svelte` (component + extensions array) and the editor store are 2-3 each; coverage-floor retuning adds overhead to every one |
| 5 — structural (deferred) | 7 | 15-20 sessions | Scope as separate issues; draft-kind parameterisation and the CSS utility layer are the largest |
| Low-priority cleanups | 14 | 4-5 sessions | Mostly one-liners; batch several per PR |

**Total for Phases 0-4: roughly 28-36 sessions (~3.5-4.5 engineer-weeks).**
**Phase 5 + low-priority: a further 19-25 sessions, better tracked as issues than as a sweep.**

Highest return per session, if only a few can be funded: Phase 0 (1 session, protects
everything), the `client.ts` subscription-type fix (1 session, unlocks a capability that is
currently unreachable at 103 call sites), the `resolveBaseUri` clobber (1 session, data
loss), the six missing draft-channel tests (3 sessions, trust path), and the
`UnlinkedMentions` decision (~1 hour — it removes a test that is currently lying to you).

---

### Method and limitations

All metrics were produced by commands recorded in the Code Quality Metrics table; every
`file:line` reference in the Opportunities sections points at a line actually opened during
this review. The clone detector is a 12-line rolling hash over whitespace-normalised source,
which finds *copied* code and does not find semantically-equivalent code written differently
— it undercounts. The unused-export scan is a name-based grep heuristic and is reported only
as a reason to adopt a real tool, except for the four cases individually verified. The
longest-function scan is a brace-depth walk and is noted above to conflate factory closures
with long procedures. A parallel deep-dive on `src/renderer/` was still running when this
report was written; its findings were folded in only after independent re-verification,
and two of its claims were **dropped** for failing that check — menu positioning is in fact
already factored into a shared `src/renderer/lib/utils/menuClamp.ts` with 10 importers, and
`adjustSubmenu` turned out to be a 3-line wrapper around it rather than duplicated logic.
Every count in this report is the reviewer's own measurement, not a subagent's.
