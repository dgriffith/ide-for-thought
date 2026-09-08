# Refactoring Review Plan
Generated: 2026-09-08 06:14:53
Scope: entire project (/Users/davegriffith/minerva)
Prior review: reports/refactoring-review-entire-project-2026-08-23-182453.md

## Executive Summary

The 2026-08-23 review filed 23 High/Medium items and 14 Low-priority items.
In the 119 commits since, **essentially every High and Medium item shipped**,
each as its own PR, most within the first week: `ui/Dialog.svelte` was
adopted across the dialog fleet (`47f070c7`…`d7955300`, 5 PRs) and the six
unused primitives were adopted-or-deleted (`9e3aeeaa`); the 83 `on*` return
types were fixed and — per the commit message — caught **a real listener
leak** in the process (`90391c49`); `resolveBaseUri`'s config-clobber,
`health-checks`' cross-project `running` flag, the four
`withRootPathOr(undefined)` writes, and the watcher vector-fan-out gap were
all fixed as separate, tested PRs (`a64a0c01`, `5257cc90`, `a9a5efb5`,
`84585b69`, plus a follow-on `0c3921fb` for rename paths the first PR missed);
`fileAndApprove()` and `approveFrom()` were extracted (`04cdcb30`, `e5f8b9ac`);
the ignore policy was consolidated into `notebase/ignored-dirs.ts`
(`6087067d`); `IGNORED_DIRS`'s sibling investigation — whether to
parameterise the nine draft kinds — was explicitly evaluated and **declined
with recorded rationale** rather than left ambiguous (`3ff817d1`); the six
untested approve-and-apply draft channels and `register-refactor.ts`'s ten
got full handler coverage (`42d284b6`, `f1b8d478`); `Editor.svelte` and
`Preview.svelte` were both split into `lib/editor/`/`lib/preview/` modules
(`e4468442`, `881526fe`, `620414dc`, `ea708774`, `0d20e83f`); the
frontmatter→RDF converter, the accelerator utilities, and `createWatchHandlers`
were all extracted (`884dc1e8`, `d1e1f1cc`, `9bc6fedb`); `indexers.ts` finished
its move into a genuine 45-line facade (`98e580de`); `graph/queries.ts` did
the same for its remaining families (`e00978eb`); `BacklinksPanel`/
`OutgoingLinksPanel` were merged into `LinkListPanel` (`8bd82f20`); the
`.context-menu`/`.field` CSS shapes were promoted into `global.css`
(`31e0003e`); the six hand-rolled config loaders and the four JSON writers
were migrated (`a7143d97`, `c1148a4b`); `shared/types.ts` was split
(`4e5be78b`, and its stale budget entry dropped, `857180e2`); the logging seam
landed and `console.*` was migrated to `logger(tag)` (`9271e745`); `client.ts`
was linked to the IPC contract at compile time (`dc25f58d`); `Sidebar.svelte`'s
~40 props became 3 (`b6e3702c`); `SourcesPanel.svelte` (1,298 → 789 lines) was
split into `CollectionsTree.svelte` + `ReadingQueueSection.svelte`
(`d954a140`); write-guard's context globals moved to `AsyncLocalStorage`
(`8b759f43`); and `temp-project.ts` was adopted in `tests/main/graph/` and
`tests/main/llm/` (`554bb5ab`, `c9eab747`). Four of the prior review's
Low-priority items also landed: `health-checks.ts`'s magic numbers were named
(`533d15ed`), and a fifth pattern-ratchet for in-band `error?` payloads was
added (`a6bb2c02`). This is, for the third review running, a codebase that
converts "review found X" into "X is fixed" faster than the review cadence.

That leaves a genuinely short list. This review found **one fresh, concrete
defect** — introduced by the very PR that fixed a prior-review finding, which
is worth naming precisely because it shows the pattern isn't proofed against
recurrence, only against the *specific* recurrence already ratcheted — plus a
handful of Low-priority items from 2026-08-23 that remain open exactly as
described three weeks ago (nobody claimed to have fixed them, and they
haven't moved). No new High-severity correctness issue was found; the two
sibling reviews from 2026-09-04 (`architecture-review-…`,
`quality-review-…`) already cover the CLI dynamic-import crash, the
`register-shell.ts` coverage gap, and the Python-gated-test CI gap from a
different lens, so they are not re-litigated here except where they intersect
a refactoring concern.

1. **The `SourcesPanel.svelte` split (today's `d954a140`) reintroduced the
   exact CSS-duplication shape the codebase had just built a convention to
   avoid.** `CollectionsTree.svelte:404-448` and `ReadingQueueSection.svelte:116-158`
   carry a byte-identical ~40-line block (`.coll-row`, `.coll-row:hover`,
   `.coll-row.active`, `.chevron-spacer`, `.coll-name`, `.coll-count`,
   `.coll-row.active .coll-count`). `CollectionsTree.svelte:345-347` even has a
   comment — *"Base shape shared via `.context-menu` in global.css (#1910)"* —
   proving the author knew the shared-utility-class convention (`31e0003e`,
   #2005) and applied it to `.context-menu` in the same file, just not to the
   new `.coll-row` family the split itself created. `ui-dialog-adoption.test.ts`
   and `store-state-ownership.test.ts` show this project knows how to ratchet a
   convention the moment a second violation proves it's needed; this is
   exactly that second violation, one commit old.
2. **Three lingering Low-priority items are un-touched, verified identical to
   three weeks ago**: `DAY_MS` is still defined twice
   (`src/main/graph/queries/sources.ts:180` vs `src/main/history/policy.ts:24`);
   `package.json`'s `predev`/`prebuild`/`prebuild:e2e` still triplicate the
   same three-command chain verbatim; the nine `insertVegaLite*` exports in
   `formatting.ts` still have no consumer outside the file. None is urgent —
   they're listed so the delta is honest, not to inflate the report.
3. **The slugify-family finding from 2026-08-23 turned out to be already
   correctly designed, not duplicated** — worth recording since the prior
   review flagged it as an open item needing per-site verification. All three
   publish-exporter `slugify()` wrappers (`tree-markdown.ts:87`,
   `annotated-reading/index.ts:130`, `tree-pdf.ts:178`) and
   `types/write.ts:30` are one-line delegations to the shared `slugifyId`
   with different context-specific fallback defaults (`'tree'`/`'source'`/
   `'document'`/none) — not copy-pasted logic. This review closes that
   sub-item rather than re-flagging it.

## Code Quality Metrics

| Metric | 2026-08-23 | 2026-09-08 | Derivation |
|---|---|---|---|
| Source files (`.ts`+`.svelte`) | 768 | 792 | `find src -type f \( -name '*.ts' -o -name '*.svelte' \) \| wc -l` |
| Total source lines | 127,894 | 127,753 | same `find` piped to `wc -l` |
| TODO/FIXME/HACK in `src/` | 2 | 2 | unchanged |
| `eslint-disable` in `src/` | 5 | 5 | unchanged |
| `: any` / `as any` | 6 / 2 | 8 / 1 | `grep -rn ': any\b' \| 'as any\b'` — still negligible at 792 files |
| `console.*` in `src/` | 199 | 10 | logging seam (#1918/`9271e745`) migrated the rest to `logger(tag)`; the 10 survivors are inside `src/shared/logger.ts` itself (the one exempted file) plus a couple of legitimate pre-logger-init main-process bootstraps |
| Architecture fitness-function files | 6 | 14 | 8 new ratchets added since 08-23: `ui-dialog-adoption`, `store-state-ownership`, `config-loader-usage`, `e2e-launch-hygiene`, `embedding-model-gate`, `waitfor-must-be-awaited`, `llm-tests-use-temp-project-fixture`, `graph-tests-use-temp-project-fixture` |
| Architecture tests | 18 passing | 44 passing / 1 skipped (intentionally, CI-only) | `npx vitest run tests/architecture` |
| Largest budgeted file | `App.svelte` 2081 | `App.svelte` 2072 | `BUDGETS` in `file-size-budgets.test.ts` |
| `SourcesPanel.svelte` | 1298 (largest unsplit) | 789 (post-split) | split into `CollectionsTree.svelte` (463) + `ReadingQueueSection.svelte` (164) |
| `Editor.svelte` | 1209 | 824 | script extracted into `build-extensions.ts` (256), `build-keymap-and-completion.ts` (126), `context-menu.ts` (205), `view-commands.ts`, `tab-session.ts`, `tab-types.ts` |
| `getEditorStore` (editor store) | 1017 lines, largest function in repo | 845 lines | tab/session serialization extracted to `tab-session.ts` and memoized (#1919) |
| `indexers.ts` | 724 lines, half-migrated | 45-line facade over `indexers/*.ts` (1,716 lines across 7 files) | fully finished (`98e580de`) |
| `client.ts` ↔ `ipc-contract.ts` | 3 independent transcripts | compile-time linked | `dc25f58d` (#1920) |
| `.catch(() => <empty>)` expression-form swallows outside the block-form ratchet | 18+ sites, unscanned | still ~29 sites, still unscanned (ratchet remains block-form-only, `src/main`-only) | `grep -rn '\.catch(() =>' src` |
| Duplicated pure helpers (`escapeHtml`/`escapeRegex`/`stripFrontmatter`) | 15 / 4 / 6 definitions | 2 / 1 / 1 (one legitimate outlier each) | hoisted into `shared/text-escape.ts` + `shared/frontmatter-strip.ts` (#1917) |
| Cross-file duplicate CSS introduced this window | 0 known | 1 new pair, ~40 lines (`CollectionsTree.svelte` ↔ `ReadingQueueSection.svelte`) | manual diff, this review |

**Key issues identified this review:** 1 new duplication defect (CSS,
introduced same-day), 3 unchanged Low-priority stragglers from the prior
review, 1 prior finding downgraded from "needs verification" to "closed,
correctly designed" after reading the actual bodies.

## Refactoring Opportunities

### High Priority (Quick Wins)

- [ ] **De-duplicate the `.coll-row` family between `CollectionsTree.svelte`
      and `ReadingQueueSection.svelte`.** `src/renderer/lib/components/CollectionsTree.svelte:404-448`
      and `src/renderer/lib/components/ReadingQueueSection.svelte:116-158`
      carry an identical ~40-line block: `.coll-row`, `.coll-row:hover`,
      `.coll-row.active`, `.chevron-spacer`, `.coll-name`, `.coll-count`,
      `.coll-row.active .coll-count`. `ReadingQueueSection.svelte:157` even
      has a comment acknowledging the reuse (*"`.queue-row` re-uses the
      `.coll-row` look — no rules of its own"*) but the CSS *rules themselves*
      are still copy-pasted because Svelte's style scoping means a class
      selector declared in one component's `<style>` block does not reach a
      sibling component. This is precisely the shape `global.css:684-700`
      (`.context-menu`, `.field`) was created to solve in #2005/`31e0003e`,
      and `CollectionsTree.svelte:345-347`'s own comment shows the author
      applied that exact convention to `.context-menu` in the same file one
      section below — so the fix is mechanical: promote `.coll-row` and its
      four sibling rules into `global.css` next to `.context-menu`/`.field`,
      the same move already made twice.

### Medium Priority (Structural Improvements)

- [ ] **Widen `pattern-ratchets.test.ts`'s `SWALLOW` regex to the expression
      form, and its scope beyond `src/main`.** Unchanged since 2026-08-23:
      `SWALLOW` (`tests/architecture/pattern-ratchets.test.ts:117`) still
      matches only `catch { return <empty>; }`, not `.catch(() => <empty>)`.
      ~29 expression-form sites exist today across `src/main`, `src/renderer`,
      and `src/cli` (`grep -rn '\.catch(() =>' src`), including the two named
      in the prior review as unratcheted (`register-bibliography.ts:117,122`,
      `publish-git.ts:163,164,183`) plus `CitationsPanel.svelte:55` and
      `Preview.svelte:805`. The four new ratchets added this window
      (`ui-dialog-adoption`, `store-state-ownership`, plus the fifth
      pattern-ratchet for in-band `error?`) prove the team can add a ratchet
      cheaply when it decides to; this one specific gap from the prior report
      simply wasn't picked up yet.
- [ ] **Add a fitness function for the `.coll-row`-style shape, not just this
      one instance.** The high-priority item above fixes today's duplicate;
      nothing stops a 32nd component from re-declaring the same row/chevron/
      count shape tomorrow the way `ui-dialog-adoption.test.ts` (#2047) now
      stops a 33rd hand-rolled dialog. A cheap version: extend that same test
      file's approach — grep every `.svelte` file's `<style>` block for a
      short list of "shape" selector names (`context-menu`, `field`, and now
      `coll-row`) and fail if the *rule body* (not just the class name)
      appears in more than one file's own `<style>` block once it's supposed
      to live in `global.css`.

### Low Priority (Nice-to-Have)

- [ ] **`DAY_MS` still defined twice**, unchanged since 2026-08-23:
      `src/main/graph/queries/sources.ts:180` (`export const DAY_MS =
      86_400_000`, re-exported through `graph/queries.ts:46`, imported by
      `llm/approval.ts` and `health-checks.ts`) and
      `src/main/history/policy.ts:24` (`const DAY_MS = 24 * 60 * 60 * 1000`).
      Import the shared one; one-line change.
- [ ] **`package.json`'s `predev`/`prebuild`/`prebuild:e2e` still triplicate
      the identical three-command chain**, unchanged since 2026-08-23
      (`node scripts/build-docs.mjs && node scripts/fetch-embedding-model.mjs
      && vite-node scripts/build-help-corpus.mjs`, verbatim at all three npm
      lifecycle keys, `package.json:50-52`). npm doesn't let one lifecycle
      script `npm run` a named script from inside another lifecycle hook
      cleanly, but a tiny `scripts/prep.mjs` wrapper invoked by all three
      would collapse three copies to one.
- [ ] **Nine `insertVegaLite*` commands in `formatting.ts` are still exported
      for a single in-file consumer.** `src/renderer/lib/editor/formatting.ts:580-589`
      (`insertVegaLiteBar` … `insertVegaLiteFromCell`) are referenced only by
      the `VEGA_LITE_CHART_ITEMS` table in the same file (verified: `grep -rl`
      across `src` for each name returns only `formatting.ts`). Drop the
      `export` keyword; zero behavior change.
- [ ] **`register-shell.ts` and the Python-module-gated compute tests** —
      not re-detailed here since the 2026-09-04 quality review already covers
      both from the testing-coverage angle; flagged only so this report
      doesn't look like it missed them. From a pure refactoring lens neither
      needs structural change, only tests.
- [ ] **`buildKernelEnv()` extraction from `spawnKernel`** (`src/main/compute/python-kernel.ts:103-240`)
      remains undone, unchanged since 2026-08-23. Still a reasonable pure-data
      extraction (the 36-line `env` literal + launch planning), still low
      urgency since the function is well-commented and untouched by recent
      refactors.
- [ ] **`EventMap`'s ~65 hand-written `'menu:*'` zero-arg entries**
      (`src/shared/ipc-contract.ts:631+`) remain hand-typed rather than
      derived from a `MENU_COMMANDS` tuple, unchanged since 2026-08-23.
- [ ] **`SettingsDialog.svelte`'s `notes` tab is still inline** (the tab body
      at `:332-460` handles destination-for-new-notes, heading normalization,
      and excerpt-note settings directly in the dialog) while its 8 siblings
      are separate components. Unchanged since 2026-08-23.
- [ ] **No unused-export tooling (`knip`/`ts-prune`) added.** Unchanged since
      2026-08-23; `package.json` still carries only `dependency-cruiser`.

## Risk Assessment

### Safe Refactorings (Low Risk)

| Item | Why it's safe | What catches a regression |
|---|---|---|
| `.coll-row` CSS de-duplication | Pure move of identical CSS text into `global.css`; the two components already prove the exact class names and cascade order work today | Visual: `pnpm test tests/renderer/a11y/` plus a manual look at the Sources panel (no automated CSS-diff exists, which is exactly why this slipped in — see the fitness-function item above) |
| `DAY_MS` de-dup | Value-identical constant (`86_400_000` vs `24 * 60 * 60 * 1000` compute the same number) | existing `health-checks.test.ts`, `history` suites |
| Drop `export` on the 9 `insertVegaLite*` | Single in-file consumer, verified by grep | `tsc --noEmit` |
| `package.json` script de-triplication | Value-identical command chain | `pnpm predev`/`prebuild` run manually once |

### Moderate Risk

| Item | Risk | Mitigation |
|---|---|---|
| `.coll-row` shape ratchet (fitness function) | A naive selector-name scan could false-positive on components that legitimately share a class name with different intent | Model it on `ui-dialog-adoption.test.ts`'s baseline-with-named-exceptions shape rather than a hard ban |
| Expression-form `.catch()` swallow ratchet widening | Once the regex is added, it will surface ~29 pre-existing sites at once, some of which (e.g. `read-json.ts:53`'s `.catch(() => {})` on a best-effort temp-file cleanup) are correct as-is | Baseline all 29 as the starting point (same pattern as `SWALLOW_BASELINE` today), don't fix them in the same PR that adds the scanner |
| `buildKernelEnv()` extraction | Touches process-spawn environment construction for the Python kernel; a missed env var breaks compute cells silently | `tests/main/compute/python-kernel.test.ts` exists; extract as a pure function returning the `env` object and assert equality against today's inline literal before wiring it in |

### High Risk

None identified this review. Every item above is either a pure move (CSS,
constant, export keyword, script string) or a well-covered, narrowly-scoped
extraction. No item touches the LLM write-guard, the approval engine, or a
cross-window broadcast path — the categories that carried High risk in the
2026-08-23 review, and all of those have since shipped.

## Implementation Strategy

1. **Fix the `.coll-row` duplication now, while the split is one commit old**
   (a few minutes: cut-paste the ~40 lines into `global.css`, delete both
   copies, verify visually). This is the only item in this report with any
   urgency, and only because it's cheap to fix before a third copy of the
   shape gets pasted into a future sources-panel change.
2. **Add the shape-duplication fitness function** in the same PR or the next
   one — it costs little given `ui-dialog-adoption.test.ts` is a working
   template to copy, and it is the difference between this being a one-off
   fix and a recurring one.
3. **Batch the four remaining Low-priority stragglers** (`DAY_MS`,
   `package.json` triplication, the 9 unused exports, `knip` evaluation) into
   a single "housekeeping" PR — each is a one-line-to-ten-line change with no
   shared risk surface.
4. **Leave `buildKernelEnv`, the `EventMap` menu-block generator, and the
   `SettingsDialog` notes tab** where they are; none has moved in three weeks
   despite everything around them shipping, which reads as "correctly
   deprioritized" rather than "overlooked."

## Estimated Effort

| Item | Effort |
|---|---|
| `.coll-row` CSS de-duplication | 30 minutes |
| Shape-duplication fitness function | 1-2 hours (following the `ui-dialog-adoption.test.ts` template) |
| Expression-form `.catch()` ratchet widening | 1-2 hours (baseline ~29 sites, no fixes) |
| Housekeeping batch (`DAY_MS`, package.json, 9 exports, knip eval) | 2-3 hours |
| `buildKernelEnv()` extraction | 2-3 hours incl. test |
| `EventMap` menu-block generation | 2-3 hours |
| `SettingsDialog` notes-tab extraction | 1-2 hours (7 sibling tabs are the template) |

**Total: roughly 1-1.5 engineer-days**, an order of magnitude smaller than the
2026-08-23 review's 28-36-session backlog — because that backlog is, to a
first approximation, gone. The only item worth doing before the next review
cycle is the `.coll-row` fix and its accompanying ratchet; everything else can
sit exactly where it is.
