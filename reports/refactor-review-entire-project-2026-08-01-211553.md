# Refactoring Review Plan
Generated: 2026-08-01-211553
Scope: entire project (/Users/davegriffith/minerva)

## Executive Summary

Minerva is a large, mature Electron + Svelte 5 + TypeScript codebase (~120k lines of
`.ts`/`.svelte` under `src/`). Overall quality is high: type escapes are almost
nonexistent (2 `as any`, 7 `@ts-ignore`, 5 `eslint-disable` in all of `src/`), the
renderer data-flow rule from CLAUDE.md is respected (no direct mutation `api.*` calls
found in components, no banned native `confirm`/`alert`/`prompt`), factory patterns are
used well (e.g. `formatting.ts` builds its 40+ editor commands from `makeInlineToggle` /
`makeLinePrefixToggle` / `makeInsertFence` helpers), and App.svelte has already been
decomposed into ops clusters (#1084). Test coverage is broad — 557 test files, including
~30 graph-index suites and dedicated `health-checks`, `write-guard`, and `trust-integrity`
tests.

The refactoring opportunities are therefore not systemic rot but concentrated hotspots:
a handful of oversized files where a single function or component accreted many
responsibilities, and recurring copy-paste in fan-out code (per-draft-kind handlers,
per-check inspection builders, per-frontmatter-field patch helpers). Two findings are
**latent correctness bugs surfaced by the review**, not style issues:

1. **`TypeEditorDialog` silently drops every property's `label`** on save (data loss for
   the object-type editor, #1585) — verified.
2. **A source-detail excerpt subscription is never torn down** (listener leak on remount).

Additionally, `note-ops` bypasses the editor store's own rename method, so a paste/move
rename does not re-persist the session.

Prioritized below are ~24 concrete opportunities. The highest-leverage, lowest-risk wins
are consolidating duplicated literals/helpers (tab runtime, failure-list formatter,
inspection builder) and extracting the two clear god-components (`Editor.svelte`
context-menu + 40-prop surface; `SettingsDialog.svelte`'s 8 inline panels).

## Code Quality Metrics

**Largest source files (lines):**
- `src/renderer/lib/components/Preview.svelte` — 2185 (script ends at 980; ~1100 lines are CSS)
- `src/renderer/App.svelte` — 2011 (already decomposed; mostly template/wiring)
- `src/main/graph/indexers.ts` — 1665
- `src/renderer/lib/components/Editor.svelte` — 1475
- `src/renderer/lib/components/SettingsDialog.svelte` — 1423
- `src/renderer/lib/components/SourceDetail.svelte` — 1365
- `src/main/graph/queries.ts` — 1267
- `src/renderer/lib/stores/editor.svelte.ts` — 1155
- `src/renderer/lib/stores/conversations.svelte.ts` — 1132
- `src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte` — 1127
- `src/main/ipc/register-conversation.ts` — 967

**Very long functions found (>~100 lines, single responsibility violated):**
- `CONVERSATION_SEND` handler — `register-conversation.ts:233-413` (~180 lines, untested)
- `indexNote` — `indexers.ts:565-741` (~176 lines)
- `buildFileMenu` — `menu.ts:202-408` (~206 lines)
- `citationsForNote` — `queries.ts:1152-1253` (~101 lines)
- `findExternalInboundLinks` — `queries.ts:731-826` (~95 lines)
- Editor context menu template — `Editor.svelte:1091-1315` (~225 lines)
- SettingsDialog inline panels — `SettingsDialog.svelte:505-1019` (~500 lines)

**Notable duplication (counts verified):**
- `TabRuntime` literal (~24 fields) inlined at 3 sites despite `blankTabRuntime` helper (only 2 of 5 sites use it) — `conversations.svelte.ts`
- 9 byte-identical `discard*Draft` functions — `conversations.svelte.ts:766-966`
- `slice(0,5).map(...) + "…and N more"` failure formatter copied 6× across `note-ops.ts`, `refactor-ops.svelte.ts`, `App.svelte`
- Query→`Inspection` `.map((r,i)=>({...}))` builder repeated across 10 checks — `health-checks.ts`
- Conversation provenance URI string `https://minerva.dev/ontology/thought#conversation/…` hardcoded 6× — `register-conversation.ts` (verified)
- `const first = (pred) => store.statementsMatching(...)[0]?.object.value` defined twice — `queries.ts:893` and `:1049` (verified)
- Day-in-ms literal `86400000` hardcoded at 3 sites while `DAY_MS = 86_400_000` already exists in `queries.ts:940`
- 8 inline SPARQL `PREFIX` blocks in `health-checks.ts` that `queryGraph`'s auto-injection (`injectSparqlPrefixes`, `queries.ts:225`) makes redundant

**Key issues:** 2 latent bugs (label drop, listener leak) + 1 state-sync bug (rename not
re-persisted) + ~21 pure-cleanliness refactors. Dead/commented-out code is negligible
(the 65 `TODO`s are almost all inside bundled CSL citation-style XML, not app code).

## Refactoring Opportunities

### High Priority (Quick Wins)

1. **Fix the property-`label` drop in `TypeEditorDialog` (data loss).**
   `src/renderer/lib/components/TypeEditorDialog.svelte:28-34` (`Row` type), `:41-49`
   (seed), `:74-83` (`buildProperties`). `PropertyDef.label` is a real persisted field
   (`type-def.ts:22-23`, written by `write.ts:12/45`, read by `card.ts` as
   `pd.label ?? pd.name`), but `Row` has no `label`, rows aren't seeded from `p.label`,
   and `buildProperties()` never emits it. Editing any type — or "Save Note as Object
   Type" — strips all per-property labels. **Action:** thread `label` through `Row`, the
   seed map, and `buildProperties`. Add a round-trip test (none exists; the existing
   `TypeEditorDialog.test.ts:52` edits a label-less `book`).

2. **Route paste/move rename through the store's own method.**
   `src/renderer/lib/app/note-ops.ts:378-385` (`handleMove`) and `:423-430`
   (`handlePaste`) mutate `editor.tabs[i].relativePath`/`fileName` directly instead of
   calling `editor.applyRenameTransitions([{old,new}])` (`editor.svelte.ts:540`). The
   store method also fixes the tab `ext` for unsupported files and calls
   `schedulePersistTabs()`, so today a rename-via-paste/move does not re-persist the
   session. **Action:** replace both inline mutations with `applyRenameTransitions`.

3. **Use `blankTabRuntime` at all 5 tab-construction sites.**
   `src/renderer/lib/stores/conversations.svelte.ts` — the helper (`:663`) is called at
   only `:595` and `:723`; `init()` (`:315-340`), `openFreeform()` (`:411-436`), and
   `openConversationTab()` (`:479-504`) still inline the full ~24-field literal. Its own
   doc-comment claims it backs all sites. With 18 `…Drafts`/`…DraftResults`/`…DraftState`
   fields per tab, drift is expensive (the `parent` field in #1587 was just such a risk).
   **Action:** replace the 3 inline literals with `blankTabRuntime(conv, extraTools)`.

4. **Extract a shared failure-list formatter.**
   `slice(0,5).map(...) + "…and N more"` is copy-pasted at `note-ops.ts:277-278`,
   `:456-458`, `:461-463`; `refactor-ops.svelte.ts:474-476`, `:598-600`; `App.svelte:1596`.
   **Action:** add `formatFailureList(items, render, cap=5)` to
   `src/renderer/lib/*/text-helpers.ts` and call from all six; promote the repeated
   `{path,error}` failure shape to a shared type.

5. **De-duplicate the conversation-provenance strings.**
   `register-conversation.ts` builds `conversationUri` and `proposedBy` from the literal
   `https://minerva.dev/ontology/thought#conversation/${convId}` in 6 draft-file handlers
   (verified count 6). A namespace change means 6 edits today. **Action:** extract
   `conversationProvenance(convId): { conversationUri, proposedBy }` and a
   `fileAndAutoApprove(ctx, {operationType, payloads, note, convId})` helper.

6. **Introduce a `DAY_MS` import and a `MAX_FRONTMATTER_DEPTH` constant.**
   `DAY_MS = 86_400_000` already exists at `queries.ts:940` but the literal `86400000` is
   re-hardcoded at `health-checks.ts:82`, `:271`, and `approval.ts:74`. Export it and
   reuse. Likewise replace the bare `if (depth > 8)` recursion guard at `indexers.ts:234`
   with a named `MAX_FRONTMATTER_DEPTH`.

7. **Collapse the 9 identical `discard*Draft` functions.**
   `conversations.svelte.ts:766-966` — each is `findTab(tabId)` then
   `tab.X = tab.X.filter(d => d.draftId !== draftId)`, differing only by array name.
   **Action:** `discardFrom(tabId, key: keyof TabRuntime, draftId)` reduces 9 functions to
   one-liners.

8. **Hoist the two duplicated CodeMirror themes / font-size logic in Editor.**
   `Editor.svelte:315-319` and `:523-527` define the identical hidden-line-numbers
   `EditorView.theme(...)` (a comment at :524 even flags the repeat) — hoist to a
   module-level const. `getFontSize`/`changeFontSize`/`resetFontSize`/`setFontSize`
   (`:270-303`) each repeat the `localStorage.setItem` + `reconfigure` pair — extract one
   `applyFontSize(px)` and make the exports thin wrappers.

### Medium Priority (Structural Improvements)

9. **Split the `CONVERSATION_SEND` god handler.**
   `register-conversation.ts:233-413` (~180 lines, no unit coverage) does abort wiring,
   message mapping, system-prompt assembly, a ~35-line `streamCallbacks` object, web
   overrides, and two near-identical `completeWithTools({...})` calls (`:346-361` and
   `:378-387`, the retry only swaps `messages` and drops `initialContainerId`).
   **Action:** extract `buildStreamCallbacks(win, convId, controller)` and
   `runCompletionWithContainerRecovery(...)`; move `stripCodeExecutionTurns` /
   `CONTAINER_REQUIRED_MARKER` to module scope. Add a unit test before/with this.

10. **Decompose `indexNote`.**
    `indexers.ts:565-741` — extract the cohesive blocks the comments already delimit:
    `indexNoteCoreTriples` (title/filename/paths/modified/folder/project, `:626-646`),
    `indexTags` (`:648-662`), `indexDomainType` returning `declaredProps` (`:664-681`),
    `indexAliases` (`:683-698`), `indexWikiLinks` (`:700-709`), leaving `indexNote` an
    orchestrator. Well-tested → safe.

11. **Extract `Editor.svelte`'s context menu and shrink its prop surface.**
    The hand-built nested menu at `Editor.svelte:1091-1315` (~225 lines) should become an
    `EditorContextMenu.svelte` taking a menu model + single `onAction` dispatch. It exists
    only to fan out ~40 one-shot callback props declared at `:75-178` and re-guarded as
    `{#if onX}<button onclick={() => handleMenuAction(() => onX?.())}>`. **Action:** group
    the refactor/metadata/bookmark forwarders into one ops object (or route through the
    existing App ops cluster) so the surface is a handful of props.

12. **Extract the 8 remaining inline panels in `SettingsDialog`.**
    `SettingsDialog.svelte:505-1019` (~500 lines) still inlines `editor`, `appearance`,
    `behaviors`, `notes`, `formatter`, `web`, `sources`, `clipper` — while 6 siblings are
    already extracted + tested (`AiSettings`, `ComputeSettings`, …, imported `:51-56`).
    Follow the established pattern; also collapse the 4 byte-identical `patch*` helpers
    (`:146-167`) into a `makePatch(get, set)` factory (or fold into each panel).

13. **Move `Preview.svelte`'s rendered-markdown CSS into an imported stylesheet.**
    `Preview.svelte:1094-2185` is CSS; the ~1000 lines of `.preview :global(...)`
    content styles (h1/code/blockquote/wiki-link/transclusion/object-card/typed-link) are
    not component chrome. The file already imports `styles/hljs-minerva.css`. **Action:**
    move to `styles/preview-content.css`; keep only tooltip/menu chrome scoped. Halves the
    file.

14. **Extract + test PropertiesPanel's YAML round-trip engine.**
    `PropertiesPanel.svelte:124-346` (~220 lines: `parseFrontmatter`, `detectShape`,
    `mutate`, `keyToString`, `commit*`/`setKeyValue*`) is pure, edge-case-heavy (CRLF,
    date coercion, wiki-link detection, empty-map deletion) and **has no test**. **Action:**
    move to `src/renderer/lib/refactor/frontmatter-rows.ts` (beside the already-tested
    `property-shape.ts` it imports) and add a unit suite.

15. **Consolidate the 10 `Inspection`-builder maps in `health-checks.ts`.**
    Ten checks repeat `query → (results.results as Record<string,string>[]).map((r,i)=>({id,type,severity,nodeUri,nodeLabel,message,suggestedAction}))`.
    **Action:** extract `toInspections(results, buildFn)` (or a small builder) and a
    `queryRows(ctx, sparql)` helper that owns the repeated
    `as Record<string,string>[]` cast (appears 11× in this file alone). Also drop the 8
    redundant inline `PREFIX` blocks — `queryGraph` auto-injects. Well-tested → safe.

16. **Parameterize the object-type "spread every optional field" pattern.**
    The `...(t.icon ? {icon:t.icon} : {})` cascade over icon/color/cover/card/parent/
    template appears in `ObjectTypesSettings.svelte:30-37` (`openEdit`) and `:57-66`
    (`duplicate`), `TypeEditorDialog.svelte:92-102` (`save`), and `type-def.ts:100-114`
    (`toTypeInfo`). **Action:** add `typeInfoToSaveInput(t)` in `type-editor-value.ts`
    (or shared/objects) and reuse — this is exactly where the `parent` field would have
    been missed in #1587.

17. **Fold the two bulk-summary reporters and share the bulk-frontmatter loop.**
    `refactor-ops.svelte.ts:464-479` (`reportBulkTagSummary`) and `:588-603`
    (`reportBulkPropertySummary`) differ only by noun/confirm-key. The four handlers
    (`handleAddTag`/`handleRemoveTag`/`handleAddProperty`/`handleRemoveProperty`) share the
    guard→targets→confirm→read/transform/write→sync→summary skeleton (remove-variants also
    share the union-of-keys pre-pass `:381-401` vs `:543-562`). **Action:**
    `reportBulkSummary({verb,subject,key})` + `runBulkFrontmatterEdit(targets, transform)`.

18. **Thread a `RollbackData` type param through the apply-dispatch handlers.**
    `apply-dispatch.ts` re-asserts the rollback payload with `const data = rollbackData as {…}`
    at 9 sites — a real type hole (an apply/rollback shape mismatch is invisible today).
    **Action:** give `PayloadHandler<K>` a second `RollbackData` type param so `apply`'s
    return type flows into `rollback`. Extract the duplicated
    `try { deleteFile } catch {}` (note + excerpt handlers, `:148` & `:173`) into
    `safeDeleteFile(ctx, path)`. (The `register<K>` registry itself is a clean design — do
    not disturb it.) Thin coverage here → add an `applyBundle`/rollback test first.

### Low Priority (Nice-to-Have)

19. **Promote `firstObjectValue` in `queries.ts`.** The local
    `const first = (pred) => store.statementsMatching(subject, pred)[0]?.object.value ?? null`
    is defined identically at `:893` and `:1049`; the bare
    `statementsMatching(x,p)[0]?.object.value` idiom recurs dozens of times. A module-level
    `firstObjectValue(store, subject, pred)` removes the noise and repeated casts.

20. **De-duplicate `indexers.ts` frontmatter-edge helpers.**
    `frontmatterValueToEdge` (`:325-374`) and `coerceDeclared` (`:384-430`) both re-declare
    `type Term`, `const plain`, the whole-value-wikilink block (`:347-364` vs `:417-426`),
    and the date-shape regexes. **Action:** extract `resolveWholeWikiLink(...)`; lift
    `ISO_DATE_RE`/`ISO_DATETIME_RE`/`YEAR_RE` to named constants.

21. **Split `citationsForNote` / extract inline-citation counting.**
    `queries.ts:1152-1253` does four jobs; extract `countCitationOccurrences(content)`
    (the `RE`/bibliography-strip block `:1187-1199`) and `buildCitedSourceSet(...)`; give
    the `` `${kind}:${id}` `` occurrence-key scheme a tiny helper.

22. **Extract `buildFileMenu`'s inline Print-to-PDF handler.**
    `menu.ts:301-340` embeds ~40 lines of dialog + `printToPDF` + file-write inside a menu
    entry's `click`. **Action:** `printFocusedWindowToPdf()` named function. (`buildViewMenu`
    `:467-568` and `buildQueryMenu` `:689-801` are similarly long — same extraction shape;
    menu builders are lightly tested, so refactor cautiously.)

23. **SourceDetail list rows + Editor small dups.**
    `SourceDetail.svelte` renders 4 near-identical clickable lists — aboutNotes (`:693-703`),
    references (`:709-720`), backlinks (`:729-744`) share one "title+meta, click-to-navigate"
    row; extract `<NavList>`/`<SourceLinkRow>`. Minor.

24. **Standardize IPC snapshotting + remove leftover debug log.**
    `conversations.svelte.ts` mixes `$state.snapshot(x)` (`:753`, `:856`) and
    `JSON.parse(JSON.stringify(x))` (`:899`, `:932`, `:957`, `:997`). Standardize on one
    `plainSnapshot(x)` helper (the JSON round-trip is the safe one for dynamic-key
    payloads — see MEMORY: structured-clone rejects reactive Proxies). Remove the
    `console.log('[conv] approvePropertyDraft sending', …)` diagnostic at `:900-907`. Also
    the two `getXStore()`-convention outliers (`objectTypesStore`, `savedViewsStore`) may be
    aligned for consistency.

## Risk Assessment

### Safe Refactorings (Low Risk)
Backed by tests, or pure mechanical extraction with no behavior change:
- #3 `blankTabRuntime` (covered by `conversations-store.test.ts`, 642L)
- #4 failure-list formatter, #5 provenance helper, #6 constants, #7 `discardFrom`, #8 Editor theme/font hoists
- #10 `indexNote` decomposition (~30 graph-index suites incl. `frontmatter-indexing`, `sources-index`, `heading-rename`)
- #15 `health-checks` builder (covered by `health-checks.test.ts`, `source-health-checks.test.ts`)
- #19–#21 query/index helper extractions (covered by `citations-for-note`, `anchor-links`, `parser` suites)

### Moderate Risk
Behavior-adjacent or in files whose *component shell* is untested (logic helpers are tested):
- #1 label fix — corrects behavior; **add the round-trip test with the change** (current tests can't catch it)
- #2 rename routing — changes persistence/`ext` side-effects; verify against `note-ops.test.ts` (663L) and session-persist
- #9 `CONVERSATION_SEND` split — ~180 lines with **no unit coverage**; add a test first
- #11/#12/#14 component extractions — no direct component tests (helper modules are tested); rely on `pnpm lint` (svelte-check) + manual verify
- #16 type-info helper — touches the object-type save path (#1584-1588); covered by `ObjectTypesSettings.test.ts`/`typed-objects.test.ts`
- #17 bulk-edit consolidation — `refactor-ops.test.ts` (653L) covers, but confirm-key/summary text assertions may need updating

### High Risk
- #13 Preview CSS move — `:global` selector scope + specificity can shift; visual regression risk, no visual tests. Move in one commit, verify rendered notes (headings, callouts, wiki-links, object cards, typed links, transclusions) manually.
- #18 apply-dispatch typing + `safeDeleteFile` — sits on the LLM approval/rollback path (the Trust Principle). Thin coverage; a rollback-ordering test is required first, and any change must keep the write-guard/approval invariants (`write-guard.test.ts`, `trust-integrity.test.ts`) green.
- #22 menu builders — `menu.ts` construction is largely untested (only `menu-accelerators.test.ts`); regressions surface only at runtime.

## Implementation Strategy

Sequence to front-load value and de-risk:

1. **Correctness pass first (own PR).** Fix #1 (label drop, with a new round-trip test), #2
   (rename routing), and remove the SourceDetail listener leak (move
   `sourceData.onExcerptsChanged` at `SourceDetail.svelte:309-311` into `onMount` and
   return the unsubscribe). Small, high-value, each with a test.
2. **Mechanical duplication cleanup (one PR per cluster).** #3, #7, #24 in the
   conversations store; #4 + #5 + #6 as a "shared helpers/constants" PR; #15 in
   health-checks; #19/#20/#21 in queries/indexers. All test-backed, low review cost.
3. **God-function decomposition (one PR each, test-first where uncovered).** #10 `indexNote`
   (safe), then #9 `CONVERSATION_SEND` (add test first). Keep each behavior-preserving with
   the suite green.
4. **Component extractions (one PR each).** #12 `SettingsDialog` panels (lowest risk,
   established pattern), #11 `EditorContextMenu` + prop-surface reduction, #14
   PropertiesPanel engine (+ new test), then #13 Preview CSS (isolated, manual visual
   verify).
5. **Approval-path typing last (#18), gated on a rollback test** and green write-guard /
   trust-integrity suites.

Per CLAUDE.md: every change ships as its own PR off a fresh branch (never commit to
`main`); run `pnpm lint` (pre-push hook) and the relevant `tests/` suites; use `verify` /
`run` to drive UI-affecting changes (#11-14) in the real app; and preserve the approval
engine + write-guard invariants on any LLM/graph path (#18).

## Estimated Effort

| Item | Effort |
|------|--------|
| #1 label fix + test | 1-2 h |
| #2 rename routing + verify | 1-2 h |
| SourceDetail listener-leak fix | 0.5 h |
| #3, #7, #24 conversations cleanup | 2-3 h |
| #4, #5, #6 shared helpers/constants | 2-3 h |
| #8 Editor theme/font hoists | 1 h |
| #15 health-checks builder + prefix drop | 2 h |
| #19, #20, #21 query/index helpers | 3-4 h |
| #10 `indexNote` decomposition | 3-4 h |
| #9 `CONVERSATION_SEND` split (+ test) | 4-6 h |
| #12 SettingsDialog panel extraction | 4-6 h |
| #11 EditorContextMenu + prop reduction | 4-6 h |
| #14 PropertiesPanel engine extract + test | 3-5 h |
| #16, #17 object-type / bulk-edit helpers | 3-4 h |
| #13 Preview CSS move (+ visual verify) | 2-3 h |
| #18 apply-dispatch typing (+ rollback test) | 3-5 h |
| #22, #23 menu + list-row extractions | 3-4 h |

**Totals:** Quick wins (High Priority #1-8 + leak fix) ≈ 1-1.5 days. Medium structural
(#9-18) ≈ 4-6 days. Low priority (#19-24) ≈ 2 days. Full program ≈ 7-9 engineer-days,
best delivered as ~12-15 small PRs so each stays independently reviewable and revertible.
