# Refactoring Review Plan
Generated: 2026-07-04-083009
Scope: Entire project (/Users/davegriffith/minerva)

## Executive Summary

Minerva is a **mature, disciplined codebase**. Objective hygiene signals are excellent:
zero `TODO`/`FIXME`/`HACK` comments in source, zero `as any` casts, only 12 lint/ts
suppressions (all justified — Vite `?raw` imports and `require-await` on interface-conforming
async stubs), no nesting deeper than 5 levels anywhere in `src/`, and a large test suite
(434 test files) that covers most hotspots. Svelte 5 runes conventions are followed
consistently; the intentional IPC 5-step pattern and the propose/approve indirection are
respected and are *not* flagged here.

The refactoring debt that exists is almost entirely **mechanical repetition**, not
architectural rot or hidden complexity. Three themes dominate:

1. **The "draft type" fan-out** — a family of ~10 conversation draft/result kinds is
   hand-expanded across at least 7 files (channels → preload → client → register-conversation
   → store subscriptions → panel filter helpers). Adding one draft type today means editing
   6+ files with copy-paste boilerplate. This is the single highest-leverage structural theme.
2. **Guard-clause and UI-idiom duplication** — the IPC `rootPath` guard is copy-pasted 153×;
   the context-menu dismissal idiom is copy-pasted across 11 components; the `setTimeout(...150)`
   "wait for the file watcher" hack recurs 7× in one file.
3. **A handful of monolithic functions** — `menu.ts:rebuildMenu` (742 lines, 83 click handlers),
   `Preview.svelte:handleClick` (~168 lines, 10+ branches), and `Preview.svelte` fence renderer
   (~115 lines) are genuinely large single bodies worth decomposing.

None of this is urgent; the app works and is well-tested. These are quality-of-life
improvements that reduce future edit cost and error surface. Most of the large *files*
(App.svelte, Preview.svelte, the store closures) are large-but-cohesive and should NOT be
split just for line count.

## Code Quality Metrics

**Codebase size:** ~153k lines tracked under `src/` (excludes large data assets:
`assets/ocr/eng.traineddata` 29.7k lines, CSL styles ~20k lines, `ontology-thought.ttl` 1.2k).

**Largest real code files (lines):**
| Lines | File |
|------|------|
| 2747 | src/renderer/lib/components/Preview.svelte |
| 2157 | src/main/llm/tools.ts |
| 2108 | src/renderer/lib/components/ConversationsPanel.svelte |
| 2001 | src/renderer/App.svelte |
| 1364 | src/renderer/lib/components/SourceDetail.svelte |
| 1362 | src/renderer/lib/components/Editor.svelte |
| 1317 | src/renderer/lib/components/SourcesPanel.svelte |
| 1239 | src/renderer/lib/components/SettingsDialog.svelte |
| 1238 | src/main/graph/indexers.ts |
| 1213 | src/main/graph/queries.ts |
| 1180 | src/renderer/lib/stores/conversations.svelte.ts |
| 1035 | src/renderer/lib/stores/editor.svelte.ts |
| 1016 | src/renderer/lib/ipc/client.ts |
| 957  | src/main/ipc/register-conversation.ts |
| 909  | src/main/llm/approval.ts |
| 859  | src/main/menu.ts |

**Complexity hotspots (genuinely long single-body functions, not factory closures):**
- `src/main/menu.ts:34` `rebuildMenu` — 742 lines, 83 `click:` handlers, 65 `gate({…})` wraps.
- `src/renderer/lib/components/Preview.svelte:1236` `handleClick` — ~168 lines, 10+ `closest()` branches.
- `src/renderer/lib/components/Preview.svelte:362` fence renderer — ~115 lines, 6+ fence-type branches.
- `src/renderer/lib/components/Preview.svelte:544` `hydrateTransclusions` — ~108 lines.
- `src/renderer/lib/stores/conversations.svelte.ts:228` `ensureSubscriptions` — ~128 lines, 12 near-identical subscription blocks.
- `src/main/llm/tools.ts:949` `executeNotebaseTool` — 21-case dispatch switch.
- `src/main/llm/approval.ts:577` `dispatchApply` — 9-case switch, two cases 20+ lines.

(Note: the raw "longest function" scan also surfaces `getEditorStore` (907), `registerConversation`
(780), `createRefactorOps` (584), etc. — these are **store/registration factory closures** whose
span is the sum of many small inner functions. That is the idiomatic pattern here and is NOT debt.)

**Duplication estimate (measured, not eyeballed):**
- `rootPathFromEvent(e)` guard: **153 occurrences** across `src/main/ipc/**` (87 throw `No project open`, the rest use `{ ok:false, error }` or no guard).
- Context-menu dismissal idiom `setTimeout(() => window.addEventListener('click', close), 0)`: **11 component files**.
- `setTimeout(() => ctx.openSource(...), 150)`: **7 occurrences** in `source-ops.ts`.
- "Draft type" concept: **~560 mentions of `Draft`** across the conversation stack (269 in the store, 162 in the panel, 50 in client.ts, 30 in channels.ts, 29 in register-conversation.ts, 21 in preload.ts).
- 12 `*DraftSubscribed` boolean flags + 10 near-identical subscription handlers in the conversations store.
- ~15 near-identical `xxxDraftsAt(tab, i)` / `xxxResultsAt(tab, i)` filter helpers in ConversationsPanel.

**Key issues count:** 15 distinct findings (5 high, 6 medium, 4 low). No correctness or security
issues surfaced by this pass (that is the concurrent architectural/security review's remit).

## Refactoring Opportunities

### High Priority (Quick Wins)

**H1 — Extract the `setTimeout(…, 150)` "wait for the file watcher" hack into a named helper.**
`src/renderer/lib/app/source-ops.ts:44,63,100,201,211,351,366`. Seven identical
`setTimeout(() => ctx.openSource(id), 150)` calls encode a race-condition workaround
(open the source tab only after the watcher's `indexSource` pass lands, per the comment at
line 62-64). The magic `150` is undocumented at 6 of 7 sites and duplicated. Extract
`const WATCHER_SETTLE_MS = 150` plus a single `openSourceAfterIndex(id)` helper. (Ideal
follow-up: replace the timer with awaiting an index-complete signal — see M6.) Low risk,
covered indirectly by existing behavior; ~15 min.

**H2 — Extract the context-menu dismissal idiom into one utility.**
Repeated verbatim in **11 files**: BookmarksPanel, Editor, FileTree, PdfViewer, Preview,
QueryPanel, Sidebar, SourceDetail, SourcesPanel, TabBar, TablesPanel
(e.g. `Editor.svelte:340-342`, `Preview.svelte:1503-1505`, `SourceDetail.svelte:295-297`,
`BookmarksPanel.svelte:90-91`). Each is:
`const close = () => { menu = null; window.removeEventListener('click', close); };`
`setTimeout(() => window.addEventListener('click', close), 0);`
Extract `installDismissOnClickOutside(onDismiss)` in a shared util. Removes ~22 lines and
guarantees consistent timing/cleanup. Low risk; ~30 min.

**H3 — Introduce a `withRootPath` handler wrapper for IPC registration.**
`src/main/ipc/register-*.ts` — `rootPathFromEvent(e)` appears **153×**, followed 87× by
`if (!rootPath) throw new Error('No project open')`. Every new handler copies this guard, and
the error string is phrased inconsistently. A higher-order wrapper
`withRootPath((rootPath, ...args) => …)` collapses the throw-style handlers cleanly. Note the
nuance: some handlers return `{ ok:false, error:'No project open' }` instead of throwing
(e.g. `register-graph.ts:20-21`) — provide a second `withRootPathResult` variant rather than
forcing one convention. High value (removes ~150 lines, one place to change), but touches many
files, so land it incrementally per register file. Moderate effort; ~2-3 h.

**H4 — Collapse the 10 conversation-store subscription handlers.**
`src/renderer/lib/stores/conversations.svelte.ts:228-355`. Ten `onXxxDraft` subscriptions
(lines 238-340) plus 12 `*Subscribed` flags (194-205) follow an identical shape: find tab,
compute `afterMessageIndex`, append to `tab.xxx`. Only the compute case (287-304) legitimately
differs (state seeding). A `registerDraftSubscription(flag, subscribe, appendTo)` factory
collapses ~100 lines to ~10 declarative registrations and removes the "forgot to set the flag"
foot-gun. Medium risk (this store has **no direct unit test** — see Risk); ~1-2 h.

**H5 — Collapse the ~15 `xxxDraftsAt(tab, i)` / `xxxResultsAt(tab, i)` filter helpers.**
`src/renderer/lib/components/ConversationsPanel.svelte:572-696`. Fifteen one-line helpers
(`draftsAt`, `sourceDraftsAt`, `noteResultsAt`, `propertyDraftsAt`, `claimsDraftsAt`,
`refactorDraftsAt`, `reorgDraftsAt`, `deleteDraftsAt`, `noteBodyDraftsAt`, …) each do
`tab.<array>.filter(d => d.afterMessageIndex === i)`. Replace with a single
`atMessage(tab, key, i)` or a `keyOf(key)` factory. Low risk (pure functions, easy to eyeball);
~30 min. **Note:** H4 and H5 are two faces of the same "draft type fan-out" — see M-STRUCT.

### Medium Priority (Structural Improvements)

**M-STRUCT — Introduce a single draft-type registry (the headline structural theme).**
The ~10 draft/result kinds are hand-expanded across at least 7 files: `channels.ts` (30
`Draft` refs), `preload.ts` (21), `client.ts` (50), `register-conversation.ts` (29 — see
the `onDraft`/`onSourceDraft`/… block at lines 231-276 and the per-kind file handlers), the
store (269), and the panel (162). Each new kind is a multi-file ritual. A central table
mapping `kind → { channel, draftType, fileHandler, appendTo }` would let the store
subscriptions (H4), the panel filters (H5), and much of the IPC wiring be *generated* from one
source of truth. This is the most valuable long-term refactor but the highest-blast-radius one;
approach it after the localized quick wins prove the shape, and do it kind-by-kind. High effort;
~1-2 days.

**M1 — Decompose `rebuildMenu` into per-menu builders.**
`src/main/menu.ts:34-776` — 742 lines, 83 `click:` handlers, 65 `gate({…})` calls. It is
mostly a declarative tree, but a single 742-line function is hard to scan and to test a section
in isolation. Extract `buildFileMenu()`, `buildEditMenu()`, `buildViewMenu()`,
`buildQueryMenu()`, etc. (top-level labels are at lines 115, 305, 386, 572, …), each returning
its submenu array, with `gate`/`send`/`mkItem` shared. Keeps behavior identical; makes the
menu structure legible. Tested indirectly by `tests/main/menu-accelerators.test.ts`. Moderate
effort; ~2-3 h.

**M2 — Table-drive `executeNotebaseTool`'s 21-case switch.**
`src/main/llm/tools.ts:949-999`. Most cases are `case 'x': return delegate(...)`. A
`Record<string, handler>` dispatch map removes the switch scaffolding and makes the tool set
enumerable. (Contrast: `approval.ts:dispatchApply` at 577 has genuinely divergent per-case
undo/rollback logic — see M3, don't map-ify that one.) Low-moderate risk; well tested under
`tests/main/llm/`. ~1 h.

**M3 — Extract `dispatchApply` case bodies into named `applyXxx` helpers.**
`src/main/llm/approval.ts:577-687`. The `note-refactor` (610-637) and `note-rewrite` (652-671)
cases are 20+ lines of filesystem+graph+rollback logic inline in the switch. Keep the switch
(the cases really differ) but extract each body to `applyNoteRefactor(ctx, p)` etc. so the
dispatcher reads as a routing table. This module IS covered by `tests/main/llm/approval.test.ts`,
so this is low risk. ~1 h.

**M4 — Extract the Preview `handleClick` dispatch.**
`src/renderer/lib/components/Preview.svelte:1236-1404` — ~168 lines routing 10+ click targets
(task checkbox, cite/quote/wiki links, transclusion, tag, compute menu, output image, fence
toolbar, YouTube, DOI, anchor) via sequential `el.closest()` checks. Replace with a
`[selector, handler]` table iterated once, and move each branch to a named function. Improves
testability of individual interactions. Moderate risk (Preview has tests under
`tests/renderer/preview/` but not for the full click matrix); ~2 h.

**M5 — Extract the Preview fence renderer per fence-type.**
`src/renderer/lib/components/Preview.svelte:362-477` — ~115 lines, one function branching on
output/mermaid/vega/youtube/runnable with inline HTML generation. Split into
`renderOutputFence`/`renderVegaFence`/… dispatched by a small map. Same test caveat as M4;
~1-2 h.

**M6 — Extract source rename/delete/tag handlers into a shared `source-actions` module.**
`SourceDetail.svelte:116-140,187` and `SourcesPanel.svelte:200-244`. The delete-confirm string
is byte-identical (`Delete source "${label}"? Any excerpts…`) and the rename/prompt flow is
duplicated; they differ only in post-mutation refresh (SourceDetail calls `load()`, SourcesPanel
relies on the `SOURCES_CHANGED` broadcast). Extract `renameSource`/`deleteSource`/`addSourceTag`
taking a post-mutation callback. Consolidates the confirm copy and API calls. Moderate risk;
~1-2 h.

### Low Priority (Nice-to-Have)

**L1 — Name magic panel-height bounds.**
`src/renderer/lib/stores/conversations.svelte.ts:451` — `Math.max(120, Math.min(1200, …))`.
Extract `MIN_PANEL_HEIGHT`/`MAX_PANEL_HEIGHT` and note the CSS hard-min they mirror. ~5 min.

**L2 — Factor a `sparqlWithThoughtPrefix()` helper.**
`src/main/llm/approval.ts:235,384,413,442` re-inline `PREFIX thought: <${THOUGHT}>` in four
queries. A one-line helper de-duplicates the prefix. Very low risk; ~15 min. (Scope check: the
graph query layer already auto-injects standard prefixes per CLAUDE.md — verify these
approval-local queries aren't already covered before touching.)

**L3 — Rename opaque single-letter row variables.**
`src/main/llm/approval.ts:461,479-492` — `const r = rows[0]` used across 15+ lines; rename to
`firstRow`. Trivial; ~5 min.

**L4 — Name the Turtle-highlight regexes in Preview.**
`src/renderer/lib/components/Preview.svelte:780-796` — three chained `.replace()` calls with
inline regex literals. Hoist to `TTL_COMMENT_RE`/`TTL_DIRECTIVE_RE`/`TTL_IRI_RE` consts for
readability. Trivial.

### Explicitly NOT recommended (already clean / acceptable pragmatism)

- **`graph/indexers.ts` (1238 lines)** — 109 `store.add/removeMatches` calls are model-specific
  triple assertions, not duplication. The two-phase walk (collect aliases, then index) is
  purposeful. Clean.
- **`graph/queries.ts` (1213)** — the six `LINK_TYPES` loops (186/511/614/637/703/733) each
  apply different filters and produce different shapes; extracting a "common" loop would add
  indirection without clarity. Leave as-is.
- **The IPC 5-step pattern across channels/preload/client** — intentional and documented
  (CLAUDE.md). It is mechanical but not error-prone in isolation; the snapshot test
  (`tests/preload/preload-bridge.test.ts`) guards drift. No change beyond H3's guard wrapper.
- **App.svelte (2001), Editor.svelte (1362), the store closures** — large but cohesive; do NOT
  split by line count. App.svelte's `onMount` menu-listener block (943-1175, ~233 lines) could
  optionally become a `[event, handler]` config loop, but that's cosmetic — leave unless it's
  being touched anyway.
- **Svelte 5 snippets** (e.g. ConversationsPanel message blocks) — correct idiom, not debt.

## Risk Assessment

### Safe Refactorings (Low Risk)
- **H1** (source-ops 150ms constant) — mechanical, behavior-preserving.
- **H2** (menu-dismissal util) — pure extraction; each call site is identical.
- **H5** (ConversationsPanel filter helpers) — pure functions, trivial to review.
- **M3** (approval `dispatchApply` extraction) — **directly covered** by
  `tests/main/llm/approval.test.ts`.
- **M2** (tool dispatch map) — **directly covered** by `tests/main/llm/` and `tests/shared/tools/`.
- **L1-L4** — naming/constants, no logic change.

### Moderate Risk
- **H3** (`withRootPath` wrapper) — touches 19 register files and ~150 call sites; two guard
  conventions must be preserved. `register-conversation.ts`, `register-sources.ts`, and
  `register-graph.ts` (the biggest) have **no dedicated handler-level tests**, so verify via
  the app / integration paths. Land incrementally per file.
- **M1** (`rebuildMenu` decomposition) — only `tests/main/menu-accelerators.test.ts` covers
  menu output; extract mechanically and diff the produced template to confirm parity.
- **M4/M5** (Preview handleClick / fence renderer) — Preview has partial tests
  (`tests/renderer/preview/{cite-meta,compute-output-render,image-paths,text}.test.ts`) but not
  the full click/fence matrix. Manual verification of each interaction needed.
- **M6** (shared source-actions) — the two call sites differ in refresh mechanism; the callback
  seam must be right. `note-ops` has tests; source panels are lightly covered.

### High Risk
- **M-STRUCT / H4** (draft-type registry and store subscription collapse) — the conversations
  store (`conversations.svelte.ts`) and `register-conversation.ts` have **no direct unit
  tests**, and this is the propose/approve-adjacent draft pipeline. Behavior is subtle
  (`afterMessageIndex` anchoring, per-kind seeding, lazy subscription flags). Do H4 first as a
  contained proof, add characterization tests for the store, THEN attempt the cross-file
  registry. Highest blast radius in this report.

## Implementation Strategy

1. **Land the trivially-safe quick wins first (one PR):** H1, H2, H5, L1-L4. All are
   local, behavior-preserving, and either well-covered or trivially reviewable. This clears the
   most visible duplication with near-zero risk and establishes the helper modules (dismiss
   util, constants) that later work reuses.
2. **Test-backed medium refactors (separate PRs):** M2 and M3 (both sit on solid LLM tests),
   then M1 (menu, diff-verified). These decompose the genuinely-large functions where a safety
   net already exists.
3. **UI decomposition (separate PRs, with manual verification):** M4, M5, M6. Extract behind the
   existing Preview/source tests plus a manual click-through of each interaction.
4. **IPC guard wrapper (incremental):** H3 — one register file per commit, smallest first,
   preserving both guard conventions; run `pnpm lint` + preload snapshot after each.
5. **Draft-type consolidation (last, gated on new tests):** Add characterization tests for the
   conversations store, do H4, then evaluate M-STRUCT kind-by-kind. Do not start this until the
   store has a test net.

Throughout: run `pnpm lint` (pre-push hook enforces it) and `pnpm test` after each change; each
change ships via its own PR per the project's PR workflow (never commit to `main`).

## Estimated Effort

**Total distinct tasks:** 15 (5 high, 6 medium, 4 low), plus the umbrella M-STRUCT theme.

**Quick-win bucket (~4-5 h total):** H1 (~15m), H2 (~30m), H5 (~30m), L1 (~5m), L2 (~15m),
L3 (~5m), L4 (~10m), plus M2 (~1h) and M3 (~1h) which are quick because tests already exist.

**Structural / larger bucket (~2-3 days total):** H3 (~2-3h), H4 (~1-2h), M1 (~2-3h),
M4 (~2h), M5 (~1-2h), M6 (~1-2h), and M-STRUCT (~1-2 days, do incrementally).

**Bottom line:** roughly a half-day of low-risk cleanup captures most of the readable-duplication
wins; the draft-type registry (M-STRUCT) is the only multi-day item and should be deferred behind
new store tests. This is a healthy codebase — treat these as continuous-improvement items, not a
remediation backlog.
