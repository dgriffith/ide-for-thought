# Quality Assurance Review Plan
Generated: 2026-09-27 09:47:31 MDT (HEAD `0546c6a3`)
Scope: Entire project (/Users/davegriffith/minerva)

> Method: everything below was measured in this session, not taken from docs.
> The full suite was run with coverage (`pnpm vitest run --coverage`, output
> directed to the session scratchpad), `svelte-check` was run to completion,
> and CI/issue/PR history came from `gh`. Where a template metric can't be
> measured from the repo, the section says so and names the proxy used.
> Prior reviews in `reports/` (latest `quality-review-entire-project-2026-09-04-100854.md`)
> were read so this one reports deltas and doesn't repeat resolved items.

## Executive Summary

Minerva's in-repo quality apparatus is unusually mature for a solo-maintained
desktop app. The unit/integration suite is green: **8,716 of 8,717 tests pass
across 801 files**. The one skip is a CI-only assertion that correctly skips
locally. The app carries 38 architecture ratchets, per-subsystem coverage floors,
a trust-path write guard that throws under test, zero `svelte-check` warnings
across the whole tree, and a flake-free e2e suite: 0 retries across the 8
sampled CI runs. Since the 2026-09-04 review, three of its open items were
closed: the Python-gated tests now hard-assert under CI, `check:docs` runs in
CI, and full-tree audit is ratcheted. Coverage rose on every axis (lines
73.96% → 76.82%, branches 63.55% → 66.44%).

The remaining risk sits in three places the ratchets don't reach:

1. **Nothing enforces the gates at merge time.** `main` has no branch
   protection and no rulesets (`gh api .../branches/main/protection` → 404).
   All of CI is advisory. 4 of the last 100 merged PRs have a non-green check.
   Main CI runs cancel each other (`cancel-in-progress: true` on
   `ci-${{ github.ref }}`), so 25 of the last 40 main runs never produced a
   result. That is how `3c724d23` turned main red (#2348) from a combination of
   PRs that were each green.
2. **The "human confirms" half of the Trust Principle is the least-tested code
   in the app.** The draft cards where a user accepts LLM output
   (`DeleteDraftCard`, `NoteBodyDraftCard`, `ReorgDraftCard`, `RefactorDraftCard`)
   are at **0%** line coverage and `DraftCards.svelte` is at 13.8%. No e2e test
   clicks Approve: the approve journey calls `window.api.proposals.approve`
   directly.
3. **Two data-integrity defects the suite can't see.** `llm/settings.ts`
   reads a corrupt or unreadable settings file as `{}` and then read-modify-writes
   it, silently erasing every stored provider API key. That is the #1891
   clobber shape, fixed for project config but not here. Separately,
   `assertSafePath` is lexical, so an in-project symlink escapes the root and
   no test covers it.

Performance gating is also currently red-by-design. The scheduled bench has
failed on 4 consecutive Mondays (the latest, 2026-09-21, shows the save path at
7.7–10× baseline), and six benches are `gate:false`. #2331 tracks the re-bless.
Until it lands, the gate carries no signal.

## Quality Assurance Findings

### Critical Issues (Quality Risk)

- [ ] **C1: The CI gates are advisory, because `main` is unprotected and main-branch runs cancel each other.**
  - Evidence:
    - `gh api repos/:owner/:repo/branches/main/protection` returns 404 "Branch not protected", and `rulesets` returns `[]`.
    - Of the last 100 merged PRs, 96 are all-green, 3 have a failing check (#2159, #2160, #2161, all merged with a red e2e; `da32c222` "fix bundle-budget CI failure" #2162 followed), and 1 was cancelled (#2334).
    - `.github/workflows/ci.yml:41-43` sets `concurrency: ci-${{ github.ref }}` with `cancel-in-progress: true`, which also applies to `push: main`. 25 of the last 40 main runs are `cancelled`. On 2026-09-23, 8 of 12 consecutive main runs were cancelled, including `dd299148`, whose interaction with five sibling PRs is exactly what broke main.
  - Why it matters: the ~38 ratchets, the coverage floors and the trust guard are only as strong as the merge gate. Two green PRs can still combine into a red main, and #2348's own write-up names this as a recurring pattern ("a ratchet that inventories a directory is order-dependent against every sibling PR"). If main runs are cancelled, a red main can't be bisected from CI.
  - Fix (small):
    - (a) Add a ruleset on `main` that requires `lint-and-test`, `audit` and `e2e`, and enable "require branches to be up to date". Leave admin bypass on so a solo maintainer can still act in an emergency, but make it deliberate.
    - (b) Change `cancel-in-progress` to `${{ github.event_name == 'pull_request' }}` so every main commit gets a verdict. Extend `tests/architecture/workflow-permissions.test.ts`, or add a sibling test, to pin (b).

- [ ] **C2: The trust principle's human-confirmation UI has almost no test coverage, in unit tests or e2e.**
  - Evidence:
    - Measured line coverage: `conversations/DraftCards.svelte` 13.8% (3.9% branches), `DeleteDraftCard.svelte` 0%, `NoteBodyDraftCard.svelte` 0%, `ReorgDraftCard.svelte` 0%, `RefactorDraftCard.svelte` 0%, `conversations/Composer.svelte` 0%, `ConversationsPanel.svelte` 0%.
    - `tests/e2e/happy-paths.spec.ts:83-117` ("pending proposal → approve") seeds a proposal and then calls `window.api.proposals.approve(u)` directly.
    - `tests/e2e/journeys.spec.ts` has 18 `window.api` calls and 0 clicks.
    - The only e2e test that opens the Proposals panel is the axe scan (`tests/e2e/a11y.spec.ts:221`), and it never clicks Approve.
  - Why it matters: CLAUDE.md calls "the LLM proposes, the human confirms" the most important design decision in the system. The backend half (`src/main/llm/**` at 91.4% lines, `register-proposals.ts` floored at 95/90) is well defended. The half that decides *what the human sees before confirming* is not. A card that renders the wrong diff, labels a delete as a rename, or wires Accept to the wrong proposal URI would pass every current gate.
  - Fix: add component tests for each draft card that assert what is displayed and which callback fires with which URI. Add one UI-driven e2e test that clicks Approve in `ProposalsPanel` and asserts the graph changed. Then add per-file floors in `vitest.config.mts` for the draft-card family, the same way `ReadingQueueSection.svelte` has one.

### High Priority Issues

- [ ] **H1: `llm/settings.ts` can silently erase every stored provider API key.**
  - Evidence:
    - `src/main/llm/settings.ts:104-110` (`readParsed`) wraps `JSON.parse(readFile(...))` in a bare `catch { return {}; }`, which swallows ENOENT, EACCES and parse errors alike.
    - `saveSettings` (`:266-297`) builds `next` from `storedProviders(parsed)` and `writeFile`s the result non-atomically (plain `fs.writeFile`, not `config/json-file.ts`'s `writeJsonFileAtomic`). The migration writer at `:204` does the same.
    - A truncated or corrupt file, which a non-atomic write can itself produce on a crash, therefore reads as "no providers", and the next save persists only the fields in that update.
    - `tests/main/llm/settings.test.ts` has no corrupt-file case.
  - Why it matters: this is the #1891 "patch merged onto a silently-emptied file" defect, fixed for `.minerva/config.json` (`readRawProjectConfig` throws) but still live for the file holding credentials. It is also listed in CLAUDE.md as a "still hand-rolled" config reader (`tests/architecture/config-loader-usage.test.ts:91`), so the ratchet tolerates it by name.
  - Fix: split the read into a lenient reader (for display) and a strict reader (for read-modify-write) that rethrows non-ENOENT errors after `reportConfigError`. Write through `writeJsonFileAtomic`. Add a test that seeds `{not json` and asserts `saveSettings` throws and leaves the file byte-identical.

- [ ] **H2: `assertSafePath` does not stop in-project symlink escapes, and no test covers this.**
  - Evidence: `src/main/notebase/fs.ts:149-166` realpaths the *root* and then does a lexical `path.resolve` plus `startsWith`. The comment says "resolve doesn't follow symlinks anyway, so this canonical-prefix form is enough", but `fs.readFile` and `fs.writeFile` *do* follow symlinks.
  - Impact: `notes/link → ~/.ssh` inside a thoughtbase makes `readFile(root, 'notes/link/id_rsa')` pass the guard. `src/main/llm/tools/read-note.ts:9` routes an LLM tool through this path, so an LLM-requested read can leave the thoughtbase. Thoughtbases arrive from outside through zip import (`notebase/zip-extract.ts`), git and synced folders.
  - Test gap: the symlink tests (`tests/main/notebase/fs.test.ts:28`, `real-root-cache.test.ts:150`) cover only a symlinked *root*.
  - Fix: decide the threat model explicitly. Either realpath the deepest existing ancestor of the resolved path and re-check the prefix, or document that in-project symlinks are trusted. Pin whichever you choose with a test (a symlink to `os.tmpdir()` outside the root, read and write). This is a security *testing* gap even if you choose to keep the behaviour.

- [ ] **H3: The bench regression gate has been red for 4 consecutive scheduled runs, and six benches don't gate.**
  - Evidence:
    - `gh run list --workflow bench.yml` shows scheduled failures on 2026-08-31, 09-07, 09-14 and 09-21. The 09-21 log shows `writeAndReindex` at 7.69× / 10.07× / 10.04× baseline, `indexNote` at 4.91×, and `indexAllNotes 5000` at 3583ms against an 1800ms budget.
    - `tests/main/bench-baseline.json` has 6 of 20 entries at `gate:false` (`persistGraph + queryGraph` ×3, `runAllChecks` ×3).
    - #2331 (open) explains that most of these ratios are deliberately held baselines awaiting a re-bless on CI.
  - Why it matters: this is well-documented intent, but the notification path fixed in #2242 now fires every week on known state. That trains the reader to ignore it, which is the failure #2242 was about. A new regression landing today would be indistinguishable.
  - Fix: finish #2331 this week: dispatch with `update_baseline: true`, arm the six entries, and add `budgetMs` once two runs agree. Then add a ratchet that fails if a `gate:false` entry has no linked open issue.

- [ ] **H4: The CI critical path is nearing its own limits.**
  - Evidence: run 35906944670 took 938s for `lint-and-test`, with "Test + coverage" at **686s**. The job has `timeout-minutes: 20` (`ci.yml`), so it is at 78% of its timeout.
  - `vitest.config.mts`' own note recorded 568s on 2026-09-22 and set a revisit trigger at "~12 min" (720s). The step is at 95% of that trigger.
  - Locally the full suite with coverage now takes 144s, up from 107s on 2026-09-04 (+35% in 3 weeks, with test files up 660 → 801).
  - Fix: take the option the config already names. Run plain `pnpm test` on PRs and `pnpm coverage` on push to main, with an optional nightly as well. Floors still gate main, and PR latency drops by roughly two-thirds. This works best once C1(b) is in, so main runs aren't cancelled. Raise `timeout-minutes` to 30 in the meantime.

- [ ] **H5: The renderer's coverage floor is loose enough to hide a large regression.**
  - Evidence: `vitest.config.mts:595-599` floors `src/renderer/**` at 53% lines / 34% branches. Measured renderer aggregate is **61.7% L / 50.7% B**, so a 16-point branch collapse would pass.
  - The main process sits at 91.5% L / 79.1% B, which leaves the renderer as the least-guarded tree by far.
  - 39 renderer/main files with ≥30 lines have **0%** coverage (2,979 lines). Examples: `App.svelte` 536 lines, `Sidebar.svelte` 237, `ExportDialog.svelte` 140, `EditSavedQueriesDialog.svelte` 122, `right-sidebar/TagsPanel.svelte` 105, `InspectionsPanel.svelte` 73, `editor/view-commands.ts` 76, `voice/transcriber.ts` 62.
  - 62 of 133 `.svelte` files are not imported by any renderer test.
  - Fix: re-ratchet `src/renderer/**` to about 58/46, the same "3–5 below measured" policy #1932 applied to main. Add `src/renderer/lib/components/**` as its own glob, since it is at 50.1% L / 36.8% B while `lib/app` and `lib/stores` sit in the 80s and carry the aggregate. The "a glob cannot fail on account of one file" rule in CLAUDE.md applies here too.

### Medium Priority Issues

- [ ] **M1: The approval engine has no main-side idempotency guard and no concurrency test.**
  - `src/main/llm/approval.ts:101-135` checks `status !== 'pending'`, awaits `applyBundle` (which does file and graph I/O), and only then calls `updateProposalStatus`. Two overlapping calls for one URI both pass the check, and the bundle is applied twice (duplicate notes or rewrites).
  - The only protection is renderer-side and per panel instance (`ProposalsPanel.svelte:76`, `disabled={processing …}` at `:328`).
  - Six main-side callers invoke `approveProposal` directly: `auto-tag.ts:108`, `auto-link.ts:177,424`, `source-properties.ts:61`, `set-properties.ts:74` and `register-conversation-drafts.ts:95`.
  - Fix: add a per-URI in-flight `Map<string, Promise>` inside `approveProposal`, and a test that fires two `approveProposal` calls with `Promise.all` and asserts exactly one apply.

- [ ] **M2: The IPC error-handling backlog in CLAUDE.md is still exactly as listed.** Verified in code:
  - `register-links.ts:117`: `.catch(() => '')` swallows (`LINKS_CITATIONS_FOR_NOTE`).
  - `register-bibliography.ts:124,130`: `fs.unlink(target).catch(() => undefined)` swallows non-ENOENT errors (`CSL_REMOVE_STYLE`/`_LOCALE`).
  - `shared/ipc-contract.ts:274`: `'graph:query'` still returns an in-band `error?`.
  - `register-proposals.ts:24-29`: `withRootPathOr(false, …)` plus `return result.ok`, a boolean overload.
    - The renderer therefore shows "proposal may already be approved/rejected" (`ProposalsPanel.svelte:86`) even when the real cause is "no project".
    - The richer `ApproveResult` is discarded at the IPC boundary.
  - `register-git.ts:15`: `success: true` hardcoded.
  - `pattern-ratchets.test.ts` holds the counts (swallow baseline 49 across 42 files, expression-swallows 31 across 22, boolean-overload 4, in-band-error 1). Nothing is growing, but nothing has shrunk since the list was written.
  - Suggested order: proposals first (trust path), then `graph:query`, since `happy-paths.spec.ts` already asserts on `.results`.

- [ ] **M3: The MCP integration tests can vanish silently.** `tests/helpers/mcp-fixture.ts:35` sets `skipIfNoMcpFixture = mcpFixtureAvailable() ? describe : describe.skip` (an `npx -y` fetch with a 30s timeout). `stdio-integration.test.ts` and `legacy-http-integration.test.ts` skip whenever the registry or network hiccups. Unlike the Python gate (`python-kernel.test.ts:310`) and the embedding gate (`embedding-model-gate.test.ts:82`), there is no `CI`-only hard assertion. Add the same `assertGate` pattern.

- [ ] **M4: The Electron fuses are not configured, and no test pins the choice.**
  - `forge.config.ts` has no `FusesPlugin`. `RunAsNode` is genuinely needed, because the `minerva` CLI shim runs `ELECTRON_RUN_AS_NODE=1` (`src/main/cli-install.ts:60`).
  - `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` are default-open, and nothing records that decision.
  - Fix: add `@electron/fuses` with `RunAsNode` left on (and a comment), flip the rest, and add a packaged-app check in `release.yml` (`npx @electron/fuses read`) or an architecture test on `forge.config.ts`.

- [ ] **M5: The preload bridge is shape-tested, but its bodies aren't executed.** `src/preload/preload.ts` has 0.53% line coverage. `tests/preload/preload-bridge.test.ts` imports it against a mocked `electron` and snapshots the method *names*. Swapped channels between two same-signature methods, or dropped arguments, would pass. `typed-invoke.ts` narrows but does not eliminate this. Fix: a table-driven test that calls every leaf and asserts exactly one `ipcRenderer.invoke/send` with a channel string from `Channels`, plus a hand-written map for the ~20 highest-risk methods (write, rename, approve, delete).

- [ ] **M6: Loose files under `src/main/` have no floors.** `coverage-floor-enrollment.test.ts` checks directories only. As a result `menu.ts` (36.4% L, the native command surface #2233 cares about), `window-manager.ts` (60.9%), `main.ts` (0%) and `src/cli/**` (82.2%, no glob) sit under the 45% global backstop. Give `menu.ts` and `window-manager.ts` per-file floors at their measured values minus 3.

- [ ] **M7: Atomic writes are available but rarely used.** `config/json-file.ts:47` `writeJsonFileAtomic` has 6 importers, while `src/main` has ~103 `writeFile(` sites. Note bodies (`notebase/fs.ts:224`) are written non-atomically. The #1158 history baseline mitigates this for notes, but JSON stores (settings, bookmarks, tabs, menu-config) are not covered. Add a `pattern-ratchets` count for `fs.writeFile` on `*.json` paths outside `json-file.ts`, so the number can only fall.

- [ ] **M8: Fixes are accumulating unreleased.** `v2.0.2` shipped on 2026-09-09. Since then there have been 132 commits including 18 `fix:` commits: a Python-cell execution deadline (#2310), a watcher ignore-list path bug (#2305), health-check state leaking across projects (#2285), and graph claim-query correctness (#2269). The release pipeline is strong (signed, notarized, smoke-booted, tag-version gated), but users are running 18-day-old defects. Consider a cadence rule, such as "cut a patch when ≥5 user-visible fixes are on main or 14 days have passed".

- [ ] **M9: Low-severity hygiene.**
  - 120 `stderr |` blocks in a green run. The top emitters are `mcp-client/stdio-transport.test.ts` (16), `renderer/stores/conversations-store.test.ts` (11) and `main/project-context.test.ts` (10), and expected-error logs aren't silenced with `setTagLevel`. Real warnings are hard to spot in 2,600 lines of output.
  - `(node) Warning: --localstorage-file was provided without a valid path` appears on every run.
  - 31 stale agent worktrees under `.claude/worktrees/` take up **61 GB**. They are excluded from lint (`eslint.config.mjs:74`), vitest and tsconfig, but they pollute ad-hoc `find`/`grep` (this review hit it). Consider `git worktree prune` plus a cleanup script.

## Current Quality Assessment

### Testing Metrics

| Metric | Value (this session) | Δ vs 2026-09-04 | How measured |
|---|---|---|---|
| Unit/integration test files | **801** (main 404, renderer 206, shared 130, architecture 38, scripts 13, cli 6, preload 2, clipper 2) | +141 | `find tests -name '*.test.ts'` |
| Tests | **8,716 passed / 1 skipped** (8,717) | +1,615 | `vitest run --coverage` |
| Test success rate | **100%** of executed (1 intended local skip: CI-only gate) | = | same |
| Suite wall time (coverage, local, M-series) | **144.4s** (2:26 total incl. pnpm) | +37s (+35%) | `time` |
| CI "Test + coverage" step | **686s**; job 938s of a 20-min timeout | +118s vs 568s on 09-22 | `gh api …/jobs` run 35906944670 |
| Line coverage (all `src/`) | **76.82%** (28,396/36,962) | +2.86 | v8 json-summary |
| Branch coverage | **66.44%** | +2.89 | same |
| Functions / Statements | 66.32% / 73.51% | +3.7 / +3.0 | same |
| By process: main | **91.5% L / 79.1% B** (15,632 lines) | n/a | aggregated json-summary |
| By process: shared | 96.0% L / 86.1% B | n/a | same |
| By process: renderer | **61.7% L / 50.7% B** (17,420 lines); `lib/components` 50.1% / 36.8% | n/a | same |
| By process: preload | 4.8% L (shape-snapshot only) | n/a | same |
| E2E (Playwright) | **9 specs / 18 tests**, 0 flaky in 8 sampled CI runs; e2e job 345s | +3 tests | `grep '^test('`, flake-report step logs |
| E2E that drive the UI | 5 of 9 specs click/type. The core journeys (`journeys`, `happy-paths`) are **IPC-driven** | n/a | grep `window.api` vs `.click(` |
| Benchmarks | 8 bench files / 20 baseline entries (6 `gate:false`), weekly | n/a | `tests/main/bench-baseline.json` |
| `.only` / `.todo` / `fixme` | **0** | = | grep |
| Env-gated skips | 13 sites; 12 now have a CI hard-assert, **MCP fixture does not** | improved | grep |
| `svelte-check` | **0 errors, 0 warnings** (3,725 files) | n/a | `svelte-check --output machine` |
| Test LOC : source LOC | 117,310 : 143,023 = **0.82 : 1** | up from 0.69 | `git ls-files … | xargs wc -l` |

### Quality Metrics

- **Defect density:** 46 `bug`-labelled issues all-time over 143 KLOC gives **0.32/KLOC**. The label is under-used, though: `git log` shows 126 `fix:` commits in Apr–Sep 2026 (by month: 8 / 7 / 23 / 16 / 45 / 27), about **0.88 fix commits/KLOC per 6 months**. Treat the fix-commit series as the more honest trend line. It peaked in August alongside v2.0 work.
- **Escaped defects per release (proxy: bug issues filed between releases):** v0.1.1→v0.3.0: 6; v0.3.0→v1.0.0: 0; v1.0.0→v2.0.0: 16; v2.0.0→v2.0.1: 2; v2.0.1→v2.0.2: 0; since v2.0.2 (18 days): 11. This proxy can't separate "found in shipped build" from "found on main before release".
- **MTTR (bug issues, created→closed):** median **24.7h**, p90 **115h**, mean 57h. 0 open `bug` issues.
- **MTTD (worst measured):** 7 weeks for the save-path perf regression (#2242). The notification path is now fixed, but see H3.
- **Main-branch health:** of the last 40 main CI runs, 14 succeeded, 1 failed and **25 were cancelled**. One "unbreak main" commit landed this week (`b0a545da`).
- **Customer issues:** *not measurable from the repo.* There is no telemetry or crash reporting, and GitHub issues are almost entirely maintainer-filed.
- **Code review coverage:** **0 of 300** sampled merged PRs have a GitHub review. That is expected for a solo maintainer. The functional substitute is CI (3 required-in-practice checks) plus the architecture tests. Because there is no branch protection (C1), that substitute isn't enforced either. 1 of the last 300 first-parent commits bypassed a PR (`8aa8b2b1 "reviews"`, which only adds report files).

## Quality Improvement Plan

### Immediate Actions (1-3 days)
- [ ] Add a `main` ruleset with the 3 required checks and "up to date" required, and make `cancel-in-progress` PR-only (C1).
- [ ] Make `llm/settings.ts` read-modify-write strict and atomic, with a corrupt-file test (H1).
- [ ] Complete the #2331 bench re-bless and arm the 6 `gate:false` entries (H3).
- [ ] Raise `lint-and-test` `timeout-minutes` from 20 to 30 as a stopgap (H4).
- [ ] Add a CI hard-assert for the MCP fixture gate (M3).

### Short-term Improvements (1-2 weeks)
- [ ] Add component tests for the 5 draft cards and `DraftCards.svelte`, plus one UI-driven Approve e2e test (C2).
- [ ] Decide and pin the symlink threat model in `assertSafePath` (H2).
- [ ] Split PR CI (plain test) from main CI (coverage) (H4).
- [ ] Re-ratchet `src/renderer/**` and add a `lib/components/**` glob and draft-card per-file floors (H5).
- [ ] Add a per-URI in-flight guard in `approveProposal` with a `Promise.all` test (M1).
- [ ] Migrate `PROPOSAL_APPROVE/REJECT` off the boolean overload and return `ApproveResult` (M2).

### Long-term Transformations (2-6 weeks)
- [ ] Add property-based tests (fast-check) for the pure transformation layer (see Innovation).
- [ ] Run a scoped mutation-testing spike on the trust and security core.
- [ ] Configure Electron fuses and add a release-time fuse assertion (M4).
- [ ] Add a behavioural preload bridge test (M5).
- [ ] Start a Linux CI lane for main-process unit tests only, as groundwork for #2200/#2197 (see Cross-Platform).

## Testing Strategy Enhancement

### Testing Pyramid (ASCII, with ACTUAL current distribution vs target)

```
                ACTUAL (tests)                          TARGET (6 wks)
                                                    
          /\   E2E: 18 (0.2%)                         /\   E2E: ~28
         /  \  - 5 UI-driven specs                   /  \  - +1 UI approve journey
        /    \ - journeys are IPC-driven            /    \ - +draft-card review via UI
       /------\                                    /------\ - +axe on 3 more surfaces
      / comp.  \ Renderer: 2,406 (≈28%)           / comp.  \ Renderer comp.: +150
     / (Svelte  \ components 50% L / 37% B       /          \ components ≥60% L / ≥45% B
    /  + stores) \ 62/133 .svelte untested       /            \ draft cards ≥85%
   /--------------\                             /--------------\
  /  main + shared \ 4,412 + 1,248 = 5,660 (≈65%) /  main+shared \ hold ≥90% L main
 /  unit + integ.   \ main 91.5% L / 79% B     /  + property tests \ +fast-check on 5 pure
/  (real temp FS,    \ shared 96% L           /  + mutation spike   \ modules
/   DuckDB, python)   \                       /                      \
+----------------------+                     +------------------------+
 Architecture ratchets: 38 files / 214 tests (shape, not behaviour), beside the pyramid
 Other: scripts 281, cli 120, clipper 12, preload 11 (per-file counts from the run log)
 Bench: 20 entries weekly (6 ungated)          Bench: 20 gated, green baseline
```

The shape is healthy for an Electron app. The imbalance is *within* the
middle layer: the renderer, which is where the user reviews and approves LLM
output, is carried by `lib/app` and `lib/stores` (80s), while the components
that render the decision surface sit in the 0–50% range.

### Test Coverage Goals

| Area | Measured | Floor today | Goal |
|---|---|---|---|
| `src/main/**` (aggregate) | 91.5 L / 79.1 B | per-subsystem | hold; no floor drop |
| `src/main/llm/**` | 91.4 L / 78.0 B | 81 / 66 | re-ratchet to 87 / 74 |
| `src/renderer/**` | 61.7 L / 50.7 B | **53 / 34** | 58 / 46 now, 65 / 52 in 6 wks |
| `src/renderer/lib/components/**` | 50.1 L / 36.8 B | none (inherits renderer) | new glob at 47 / 33, then 60 / 45 |
| Draft-card family (5 files + `DraftCards`) | 0–13.8 L | none | ≥85 L / ≥75 B per file |
| `src/main/menu.ts` | 36.4 L | backstop 45 (global) | per-file 33 now, 60 after tests |
| `src/main/formatter/**` | 57.7 L (orchestrator) | 50 / 34 (recorded weakness) | 70 / 55 |
| `src/preload/preload.ts` | 0.5 L | none | 80 L via behavioural test |

## Test Automation

### Automation Priorities
1. **UI-driven trust journey (C2).** Seed a proposal with `__minervaE2E.seedProposal()`, open the Proposals tab, click the item, click `.action-btn.approve`, and assert the graph query result. This reuses existing helpers in `tests/e2e/helpers/launch.ts` and the `a11y.spec.ts:221-257` navigation.
2. **Draft-card component tests.** Use `@testing-library/svelte` (already used by 58 renderer test files). Mock the conversations store module per the #1944 convention.
3. **Config clobber tests** for `llm/settings`, `clipper-config` and `menu-config-store`, the three named hand-rolled readers. One parametrized test can seed corrupt JSON and assert "throws or reports, never clobbers".
4. **Approval concurrency test** (M1).
5. **Symlink escape test** (H2).

### Framework Selection
No changes needed. vitest 4/5, `@testing-library/svelte`, Playwright-Electron and `axe-core` all fit the app. Two additions are worth considering:
- **fast-check** (dev dep, about 1 MB, no runtime cost) for property tests.
- **StrykerJS** with the vitest runner, used *only* in a manually dispatched workflow scoped to a few files. It is too slow for the PR loop at 8.7k tests, so it doesn't belong there.

## Quality Gates

### CI/CD Gates

What exists and works (strengths):
- `pnpm lint`: tsc, svelte-check (0 warnings) and eslint in parallel, including the data-flow, `waitFor`, console and menu-import rules.
- `pnpm coverage`, which enforces about 50 per-glob and per-file floors.
- `check:docs` and `lint:fonts`.
- `audit:prod` (blocking) and `check-audit.mjs` (baseline-ratcheted).
- Playwright e2e with a flake report.
- SHA-pinned actions, least-privilege tokens, an unconditional lockfile gate, and an `.nvmrc` LTS check.
- A pre-push `pnpm lint`.

Gaps:
- [ ] Gates aren't *required* anywhere (C1).
- [ ] The e2e flake budget is unset. After 8+ runs with 0 flakes there is now history to set one, so consider `--max-failures`, or failing the job if flaky > 1.
- [ ] The bench gate is red-by-design (H3).
- [ ] There is no gate for the renderer draft-card family (C2/H5).

### Deployment Criteria

`release.yml` already enforces:
- the tag equals `v`+`package.json` version (checked before the build),
- signing and notarization,
- `codesign --verify --deep --strict`,
- a packaged-app smoke boot (`smoke.spec.ts -g "packaged app"`),
- artifact size budgets (`build/artifact-size-budget.json`),
- `audit:prod`.

Recommended additions:
- [ ] A release checklist item or script that verifies main's last CI run for the tagged SHA was **success** (not cancelled). Today a tag can be cut on a SHA whose main run was cancelled.
- [ ] A fuse assertion on the packaged `.app` (M4).
- [ ] A patch-cadence rule (M8).

## Defect Prevention

### Root Cause Analysis

Recent escapes and near-misses group into four causes:

| Cause | Instances | Existing prevention | Missing piece |
|---|---|---|---|
| Semantic merge conflicts between green PRs | #2348 (6 ratchet inventory drifts), #2159-2161 → #2162 | ratchets catch it *after* merge | required "up-to-date" checks, uncancelled main runs (C1) |
| Silent notification or skip paths | #2242 (7 weeks), #1925 embedding skips, #2056 Python skips | CI hard-asserts added per gate | MCP gate (M3); bench always-red (H3) |
| Per-project state leaking across projects | #2240/#2285 health-check maps | `project-state-registered.test.ts` (5 `KNOWN_UNREGISTERED` remain, `compute/python-kernel.ts` flagged "the one worth looking at next") | shrink the list |
| Tolerant readers masking corruption | #1891 (project config) | `config-loader-usage.test.ts` | `llm/settings.ts` still clobbers (H1) |

The strongest pattern in this repo's history is that each defect class gets a
ratchet. The gap is that ratchets are enforced by *someone looking at CI*, and
C1 removes the guarantee that anyone must.

### Shift-Left Practices
Already in place: the pre-push lint, the typed IPC `ChannelMap` (compile-blocking), lint rules for architecture, the trust guard throwing under test, the Node-version skew warning, and a skill-eval golden-file harness.

Add:
- [ ] Extend the pre-push hook to optionally run `vitest related --run` on changed files (opt-in via env var, so the hook stays fast).
- [ ] A PR template checklist line: "touches renderer UI for proposals/drafts → component test added".
- [ ] For directory-inventory ratchets (docs parity, architecture-ratchets doc), have the test print the exact missing entry text, so the fix after a merge race is a paste.

## Test Data Management

### Data Strategy
Strengths:
- `tests/fixtures/sample-project/` has hand-authored sources and excerpts, with gitignore allowlisting explained in `.gitignore`.
- The temp-project-fixture ratchets (`graph-tests-use-temp-project-fixture`, `llm-tests-use-temp-project-fixture`) apply.
- A dedicated skill-eval thoughtbase exists.
- `test-isolation.test.ts` exists.
- TZ is pinned to `America/Phoenix` (`vitest.config.mts`).

Gaps:
- [ ] There are no adversarial fixtures: a thoughtbase containing symlinks, a corrupt `llm-settings.json`, non-UTF-8 note bytes, or a very long path. Add a small `tests/fixtures/hostile/` generator (created at test time, since symlinks don't survive git on every platform).
- [ ] Bench fixtures have already mis-measured twice (#2211's `note-0.md` seeding, #2330's missing `modified` frontmatter). Add an assertion inside each bench's setup that the fixture reaches the code path under test, for example a counter via the existing `_derivationCountsForTests` pattern.

### Environment Management
- CI runs on `macos-latest` only (by design, for fsevents semantics). Python packages are installed per run, and the embedding model is fetched via `pretest`.
- The local environment has 31 stale worktrees taking up 61 GB (M9).
- `forks` + `isolate: true` is the deliberate default (`vitest.config.mts`). The reporter suggests `isolate:false` would save about 16s, which the config already rejects with reasoning. Agreed.

## Performance Testing

### Test Scenarios
What exists:
- 8 bench files: full-index, graph-index, n3-cache, n3 cold rebuild, persist+query, health-checks, the write pipeline and embeddings pooling.
- The bundle-budget e2e test (`bundle-budget.spec.ts`).
- Artifact size budgets.
- Count-based perf regression tests: `menu-rebuild-io.test.ts`, `link-resolve-cache.test.ts`, `window-first-paint.test.ts`, `startup-window-not-gated.test.ts`.

The count-based style is the right choice for CI noise.

Gaps:
- [ ] There is no **app startup time** measurement on a packaged build. The #2223 work is structural and count-based; a time-to-first-paint number from the packaged smoke boot, recorded as a trend rather than gated, would catch drift from lazily loaded modules going eager again. `lazy-boot-modules.test.ts` holds the structure, not the time.
- [ ] There is no **renderer** perf scenario: typing latency in a large note, or preview re-render with many citations. The preview debounce (120ms) and the #2226 config memo point at this path.
- [ ] Benches run weekly only. Consider running the 6 fastest count-style benches on PRs that touch `src/main/graph/**` or `src/main/notebase/**` (path filter).

### Performance Targets
Use the `budgetMs` ceilings already in `tests/main/bench-baseline.json` as the targets, for example `indexAllNotes` at 500/2000/5000 notes ≤ 220/750/1800 ms on CI. They are currently exceeded; see H3. Add:
- Save path (`writeAndReindex`, 2000 notes) ≤ 2× the post-#2331 re-blessed baseline.
- Packaged first-paint to `ready-to-show`: record the baseline, and alert on a +30% change.

## Security Testing

### Security Checks
Strengths:
- `security.test.ts`, `window-security-flags.test.ts`, `security-helpers.test.ts` and `register-shell` tests.
- `contextIsolation`, `sandbox` on and `nodeIntegration` off, asserted.
- CSP injection (`security.ts:52`).
- A sandboxed HTML preview e2e test (`html-preview.spec.ts`).
- A `sandbox-exec` integration test with a CI gate (`sandbox-integration.test.ts`).
- A network guard for Python (`network-guard.test.ts`).
- `assert-safe-path-coverage.test.ts`, which checks that the guard is *called*.
- The trust write guard and integrity query (`trust-integrity.test.ts`).
- Both audit gates, SHA-pinned actions and least-privilege tokens.

Gaps:
- [ ] In-project symlink escape (H2).
- [ ] Electron fuses (M4).
- [ ] **LLM-read exfiltration surface.** The write side is gated by the approval engine, but read tools (`read_note`, `read_source`, `query_graph`, `mcp_call`, which per project notes has "no write-confirmation gate by design") have no adversarial prompt-injection tests. Add a small corpus of injected-instruction notes to the skill-eval harness and assert that no tool call targets a path outside the project and that no `propose_*` is auto-approved.
- [ ] Credential-store corruption behaviour (H1).

### Compliance
- Licence retention in the packaged app is tested (`tests/scripts/package-prune.test.ts`, per CLAUDE.md #2243).
- The audit baseline tracks advisory IDs, not counts, which is good.
- Nothing further applies: there is no personal-data processing beyond the local machine and no telemetry. GDPR/SOC-type controls are not applicable to this repo.

## Accessibility Testing

### Coverage Areas
Strengths:
- `svelte-check` reports **0 a11y warnings**.
- Real-browser axe scans include color-contrast on 4 surfaces: welcome, workspace, source viewer and proposals (`tests/e2e/a11y.spec.ts`), with serious/critical allowlists.
- Focus-trap e2e for the command palette.
- `tests/renderer/a11y/dialogs.test.ts` (5 tests).
- A dialog-shell adoption ratchet (`ui-dialog-adoption.test.ts`).

Gaps:
- [ ] `scrollable-region-focusable` is allowlisted on the workspace and proposals surfaces (`a11y.spec.ts:26,45`). Fix it and empty the sets, which would make these zero-tolerance.
- [ ] Unscanned surfaces: the conversation panel (streaming LLM output), Settings dialog, Query panel, graph/argument map and PDF viewer.
- [ ] Live regions: only 3 `aria-live` usages exist in `src/renderer`. Streaming responses, proposal arrival and background indexing status are likely silent to screen readers. Add an assertion in the e2e conversation journey that a live region receives the response.
- [ ] Keyboard-only journeys: add one e2e test that creates a note, links it, and approves a proposal without a pointer. "Stay out of the way / prefer keyboard" is a stated product principle.

### Testing Tools
Keep `axe-core` (already a dependency) with the Playwright helper `tests/helpers/axe-playwright`. No new tools are needed. Optionally do a macOS VoiceOver manual pass per minor release, recorded as a checklist in `docs/releasing.md`.

## Cross-Platform Testing

### Platform / Runtime Coverage

| Target | Status | Evidence |
|---|---|---|
| macOS arm64 | Built, signed, notarized, smoke-booted, and tested in CI | `release.yml`, `ci.yml` on `macos-latest` |
| macOS x64 / universal | **Not built** (deferred) | #962 open, `forge.config.ts:196` |
| Windows | **Not built, not tested** | epic #2197 open |
| Linux | **Not built, not tested** | epic #2200 open |
| Chromium | Pinned by Electron `^44.0.0`, with a single renderer engine | `package.json` |
| Node | 24 LTS via `.nvmrc`, asserted | `node-version.test.ts` |

Only 2 `process.platform === 'win32'|'linux'` branches exist in `src/`, so
Windows/Linux support is untested in practice rather than coded and untested.
Before #2197/#2200:
- [ ] Add an **ubuntu main-process unit lane** (no coverage, no e2e, `continue-on-error: true` initially). Most of `tests/main` and `tests/shared` has no macOS dependency, and it would surface path-separator and case-sensitivity assumptions early. The watcher tests already document different Linux timing. Mark those with a platform gate plus a CI hard-assert, per the established pattern.
- [ ] Add a Rosetta smoke boot of the arm64 build on an x64 runner (`macos-13`) as a cheap early warning for #962.

### Device / Display Testing
- No HiDPI/scale-factor, window-size or high-contrast theme tests exist. Project notes record that `--bg-titlebar` + `--text` fails in the contrast theme, which the axe scans would catch only if they ran under that theme.
- [ ] Parametrize `a11y.spec.ts` over each shipped theme (at least dark and contrast).
- [ ] Add one run at a 1024×700 window to catch sidebar overflow.

## Monitoring and Metrics

### Quality Dashboard
Codecov upload is wired (`ci.yml`, non-blocking). Beyond that, a lightweight dashboard for a solo maintainer could be a weekly scheduled workflow, reusing the #2242 notify-by-issue pattern, that updates one pinned issue with:
- main CI result distribution (success/failure/cancelled),
- the `Test + coverage` step duration trend,
- the e2e flaky count,
- bench status,
- coverage by process (main/renderer/shared),
- ratchet baseline totals (swallows 49 → ?, `KNOWN_UNREGISTERED` 5 → ?, package cycles),
- `fix:` commits since the last release.

### Key Indicators

| Indicator | Now | Target |
|---|---|---|
| Main CI runs cancelled | 25/40 | 0 (non-cancelling main) |
| PRs merged with non-green checks | 4/100 | 0 (required checks) |
| Renderer branch coverage | 50.7% | ≥ 55% in 6 wks |
| Draft-card family coverage | 0–14% L | ≥ 85% L |
| CI Test+coverage step | 686s | ≤ 300s on PRs (after split) |
| Consecutive red scheduled benches | 4 | 0 |
| `gate:false` benches | 6 | 0 |
| Pattern-ratchet swallow total | 49 + 31 expr | trend down ≥ 10% per month |
| Days since last release with ≥5 unreleased fixes | 18 | ≤ 14 |

## Risk-Based Testing

### Risk Assessment

| Area | Likelihood | Impact | Current test strength | Risk |
|---|---|---|---|---|
| Approval UI (draft cards, proposals panel) | Med | **High** (wrong thing approved = unwanted graph/note mutation) | **Weak** (0–14%, no UI e2e) | **High** |
| LLM credentials store | Low-Med (needs corrupt or partial file) | **High** (keys silently lost) | Weak (no corrupt test) | **High** |
| File-system sandbox (`assertSafePath`) | Low (needs symlink) | **High** (read/write outside root, LLM-reachable) | Medium (called everywhere; symlink leaf untested) | **Med-High** |
| Merge integrity of main | **High** (recurring) | Med | Weak (no required checks) | **High** |
| Graph indexing and save perf | Med | Med | Gate currently not informative | Med |
| Approval double-apply | Low | Med | None | Med |
| Main-process subsystems (graph, notebase, llm) | Med | High | **Strong** (80–99%) | Low |
| Packaging and release | Low | High | **Strong** (verify, smoke, size, tag gates) | Low |

### Test Prioritization
1. Trust UI (C2) and the credentials clobber (H1). Both have high impact and are cheap to test.
2. Merge-gate configuration (C1). This is not a test, but everything else depends on it.
3. The symlink and approval-concurrency edge cases (H2, M1).
4. Renderer floor re-ratchet (H5) and menu/window-manager floors (M6).
5. Cross-platform groundwork and mutation spike (long-term).

## Continuous Improvement

### Retrospectives
- This is the seventh whole-project quality review in `reports/`. Previous ones produced high follow-through: Python gates, `check:docs`, audit ratchet, coverage floor enrollment and the `waitFor` lint rule were all closed since 2026-09-04.
- Recommendation: convert this report's C/H items into issues with `tasks-from-plan`. Add a `quality-review` label so the next review can compute closure rate directly instead of re-deriving it.
- The `bug` label covers 46 issues against 126 `fix:` commits in 6 months. Label fix-driving issues consistently, or have a script classify `fix:` PRs, so defect-density trends are measurable.

### Innovation
- **Property-based testing (fast-check).** Good fits are pure, input-rich modules where hand-picked examples miss the edges:
  - `src/main/skills/template.ts` (render/escape round-trips, never throws on arbitrary input),
  - wiki-link resolution plus `link-rewriting.ts` on rename (a rename followed by resolve should hit the new target, and unrelated links should stay byte-identical),
  - `injectSparqlPrefixes` (idempotent, never duplicates a declared prefix, case-insensitive),
  - frontmatter parse/serialize round-trip,
  - `path-dedup.ts`,
  - `assertSafePath` (for arbitrary `relativePath`, the result is under root or it throws).
- **Mutation testing, scoped.** Run Stryker over `llm/approval.ts`, `llm/apply-dispatch.ts`, `graph/write-guard.ts` and `notebase/fs.ts` only, via manual dispatch. CLAUDE.md already describes hand-injected defects for #2214 ("all six defect injections verified to fail"). Stryker automates exactly that for the trust core.
- **Contract-derived tests.** Generate a per-channel "handler exists + preload method invokes that channel" test from `ChannelMap` (369 entries), replacing the name-only preload snapshot (M5).

## Team Development

### Training Plan
Solo maintainer plus AI agents, so "training" here means keeping the knowledge in the repo:
- Add a short "writing a draft-card / renderer component test" section to `docs/development.md`, with a worked example once C2 lands. Today the worked examples are almost all main-process.
- Add the H1 lesson to CLAUDE.md's *Config files* section: "a tolerant reader must never feed a writer", generalizing #1891.
- For agents: the existing CLAUDE.md sections work well as agent instructions. Add a checklist line under *Code Review Checklist for LLM/Graph PRs*: "Does the UI that shows this proposal to the user have a component test?"

### Quality Culture
The culture here is strong and explicit: every ratchet carries its rationale, measurements precede changes, and the docs are parity-tested against the code. The two cultural risks are:
1. **Enforcement by attention.** Everything depends on someone reading a red run (C1, H3).
2. **Asymmetry between processes.** The main process gets near-exhaustive rigour while the renderer inherits a loose backstop, even though the renderer is where the trust decision is displayed.

## Estimated Impact

| Change | Effort | Impact |
|---|---|---|
| Ruleset + non-cancelling main (C1) | ~1 hour | Eliminates merge-race red mains; every main SHA gets a verdict |
| Settings strict read + atomic write (H1) | ~0.5 day | Removes a silent credential-loss path |
| Draft-card tests + UI approve e2e (C2) | 2–3 days | Covers the human half of the Trust Principle; renderer components gain ~+4 pts |
| Bench re-bless (H3) | ~0.5 day + 2 CI runs | Restores a meaningful perf signal; ends the weekly false alarm |
| PR/main coverage split (H4) | ~0.5 day | PR latency from ~15.6 min to ~6–7 min (lint 157s + tests ~250s est.) |
| Renderer floor re-ratchet (H5) | ~1 hour | Renderer regressions >5 pts fail CI instead of >16 |
| Symlink decision + test (H2) | 0.5–1 day | Closes or documents a FS-sandbox gap |
| fast-check on 5 modules | 2–3 days | Edge-case discovery in parsers/rewriters |
| Mutation spike | 1–2 days | Measures test strength on the trust core |

## Implementation Roadmap

### Week 1-2: Foundation
- [ ] C1: add the ruleset, `cancel-in-progress` for PRs only, and a workflow test pinning it.
- [ ] H1: harden `llm/settings.ts` and add the corrupt-file test. Evaluate `clipper-config` and `menu-config-store` for the same shape.
- [ ] H3: close #2331 and arm the gated entries.
- [ ] H4: stopgap timeout, then split PR tests from main coverage.
- [ ] M3: MCP gate hard-assert.
- [ ] C2 (part 1): component tests for `DraftCards` and the four 0% cards.

### Week 3-4: Automation
- [ ] C2 (part 2): UI-driven approve e2e, and per-file floors for the draft cards.
- [ ] H5: renderer re-ratchet and a `lib/components/**` glob.
- [ ] H2: symlink decision plus test.
- [ ] M1: approval in-flight guard plus a concurrency test.
- [ ] M2: `PROPOSAL_APPROVE/REJECT` returns `ApproveResult`, and `graph:query` becomes a union.
- [ ] M6: floors for `menu.ts`, `window-manager.ts` and `src/cli/**`.
- [ ] Weekly quality-dashboard issue (reusing the `bench.yml` notify pattern).

### Week 5-6: Excellence
- [ ] fast-check on template, link-rewriting, SPARQL prefix injection, frontmatter and `assertSafePath`.
- [ ] Stryker spike on the trust core; record the score as a baseline.
- [ ] M4: fuses plus a release assertion. M5: behavioural preload test.
- [ ] Ubuntu main-process unit lane (non-blocking) as groundwork for #2200.
- [ ] Axe on conversation, settings and query surfaces, per theme; clear the `scrollable-region-focusable` allowlist.
- [ ] Cut a patch release with the accumulated fixes (M8).

## Success Metrics

| Metric | Baseline (2026-09-27) | 6-week target |
|---|---|---|
| Tests passing | 8,716 / 8,717 (1 intended skip) | 100% of executed; ≥ 9,200 total |
| Line / branch coverage (all `src`) | 76.82% / 66.44% | ≥ 79% / ≥ 69% |
| Renderer line / branch | 61.7% / 50.7% | ≥ 65% / ≥ 55% |
| Draft-card family line coverage | 0–13.8% | ≥ 85% each |
| UI-driven e2e journeys through the approval UI | 0 | ≥ 1 |
| Main CI runs cancelled (last 40) | 25 | 0 |
| PRs merged with non-green checks (last 100) | 4 | 0 |
| PR CI wall time | ~15.6 min | ≤ 8 min |
| Consecutive failing scheduled benches | 4 | 0; `gate:false` entries 0 |
| E2E flaky tests per run | 0 (8 runs) | 0, with a budget enforced |
| svelte-check warnings | 0 | 0 |
| Pattern-ratchet swallows (stmt + expr) | 49 + 31 | ≤ 70 total |
| Bug MTTR (median / p90) | 24.7h / 115h | hold median; p90 ≤ 72h |
| Days fixes wait for release | 18 (and counting) | ≤ 14 |
| Mutation score (trust core) | not measured | baseline recorded |
