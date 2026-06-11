# Quality Assurance Review
Generated: 2026-06-10 12:16:24
Scope: entire project (/Users/davegriffith/minerva)
Reviewer focus: QA / testing strategy (complements the prior architecture review)

## Executive Summary

Minerva has **genuinely strong test discipline for a single-developer project** —
this review starts from that premise and does not manufacture enterprise-team
problems. Measured facts:

- **263 test files** (vitest), against **380 source files** — a ~0.69 test-file-
  to-source-file ratio that is high for a solo project.
- **Zero `.skip` / `.only` / `.todo`** anywhere in `tests/` (verified). No
  silently-disabled tests, no accidental focus leaks. This is rare and excellent.
- **Three-tier test pyramid actually exists**: pure-unit (`tests/shared`, 82),
  real-fs integration (`tests/main`, 144, of which **88 use `fs.mkdtempSync`** for
  real file/graph I/O), renderer-logic (`tests/renderer`, 37), plus a **Playwright
  Electron E2E smoke** (`tests/e2e/smoke.spec.ts`).
- **CI is real and gated**: `.github/workflows/ci.yml` runs `pnpm lint`
  (tsc + svelte-check + eslint) and `pnpm test` on every PR, plus a parallel E2E
  job. Concurrency cancellation is configured.
- **Coverage tooling is installed and partially enforced**: `@vitest/coverage-v8`
  with a 70% line/function/statement floor on `src/shared/**`
  (`vitest.config.mts:56-62`).

The prompt's framing under-sold this setup: E2E (Playwright) and coverage
tooling are **present**, not absent. The real QA gaps are narrower and more
interesting:

1. **The single most important guarantee in the system — the Trust Principle —
   is the least-tested critical path.** The "write guard" test
   (`tests/main/graph/write-guard.test.ts`) only exercises a context counter; it
   explicitly does **not** prove a direct write is blocked (its own comment admits
   `guardedAdd` is internal and untested, and the "logs warning" test asserts
   nothing). And the documented **established-node escalation rule does not exist
   in the source at all** — there is no test because there is no code.
2. **Coverage is collected but only enforced on `src/shared`.** The two largest,
   highest-risk modules (`ipc.ts` 2,717 lines, `graph/index.ts` 2,717 lines) and
   the entire preload bridge have **no direct unit tests** and no coverage floor.
3. **One known-flaky test** (`tests/main/publish/tree-markdown.test.ts`, Chicago
   bibliography via citeproc) has no mitigation — no `retry`, no per-test timeout
   bump, no isolation. Default vitest config has no retry policy.

This is a fix-the-load-bearing-tests-and-the-known-flake exercise, not a rebuild.

## Quality Assurance Findings

### Critical

**Q-C1 — The Trust Principle write guard has a test that proves nothing.**
`tests/main/graph/write-guard.test.ts` has 5 tests, all green, but every one of
them only checks the `enterLLMContext`/`exitLLMContext` *counter*
(`write-guard.test.ts:10-39`). The one test named "logs warning when direct write
attempted in LLM context" (`:41-51`) **never asserts a warning is logged** — its
own comment says "The `guardedAdd` function is internal, but we can verify the
context flag is correctly set" and then only asserts `isInLLMContext()`. There is
no test that calls a graph mutation while in LLM context and asserts it is
blocked/warned. The CLAUDE.md LLM/Graph review checklist explicitly asks for
"tests that verify the approval gate cannot be skipped," and the prior
architecture review (D2) flagged the same gap. The current test gives **false
confidence**: it is green, named as if it covers the guard, but the guard's
actual behavior (`guardedAdd` in `src/main/graph/index.ts`) is uncovered.

**Q-C2 — The documented established-node escalation is unimplemented and
untested.** CLAUDE.md states: "Nodes with `thought:hasStatus thought:established`
automatically escalate to `requires_approval` regardless of operation type." A
full-source grep finds **no `established` reference in `src/main/llm/` at all**,
and `proposeWrite` computes its tier purely from `getApprovalTier(write.operationType)`
(`src/main/llm/approval.ts:166`) with no node-status lookup. So an `autonomous`
operation (`tag_addition`, `staleness_flag`) on an *established* claim is applied
silently, contrary to the documented trust guarantee. There is no test because
the behavior does not exist. This is the highest-severity correctness gap: a
documented safety invariant that neither code nor tests uphold.

**Q-C3 — Two proposal payload kinds can be created but throw at apply time, with
no creation-time guard or test.** `dispatchApply` throws for `source` and
`saved-query` kinds (`src/main/llm/approval.ts:474-475`, and the unreachable
`:504-505`). `proposeWrite` does not validate payload kind, so a skill can file a
`thought:pending` proposal that the user will only discover is broken when they
press approve and it throws. There is no test asserting "creating a proposal with
an unwired kind fails fast" — because creation currently succeeds. This is a
latent footgun on the user-facing approval path (also raised as architecture D5).

### High

**Q-H1 — `notify_only` tier mutates the graph before any review, pinned by tier
tests but not by an immediacy test.** `approval.ts:191-196` applies the bundle
immediately for `notify_only` and persists the proposal as `approved`. The tier
mapping is well-tested (`approval.test.ts:131-147` covers all 7 default ops), but
there is **no test asserting that `notify_only` writes land in the store with no
pending window**, nor one asserting `requires_approval` writes do **not** land
until approved. The policy table is tested; the *enforcement of the table's
consequences on the actual store* is only tested for the approve/reject status
transition (`approval.test.ts:90-128`), not for the "did the graph change yet?"
question that is the whole point of the tiers.

**Q-H2 — The two 2,717-line god-modules and the preload bridge have no direct
tests and no coverage floor.** `src/main/ipc.ts` (2,717 lines, 187 handlers) has
**zero** test files (`find tests -iname '*ipc*'` → empty). `src/preload/preload.ts`
(the entire contextBridge surface, the only thing standing between the renderer
and Node) has **zero** tests (`find tests -path '*preload*'` → empty). Embedded
business logic in `ipc.ts` (`recordComputeProposalRun`, turtle escaping,
`buildComputeProposalNoteBlock`) is therefore untested except transitively. The
coverage floor (`vitest.config.mts:56`) covers only `src/shared/**`, so the
highest-risk main-process surface has no measured or enforced coverage. The E2E
smoke catches gross preload-shape breakage at boot but not per-channel behavior.

**Q-H3 — Known-flaky test has no mitigation and no quarantine.**
`tests/main/publish/tree-markdown.test.ts:126` ("Chicago notes & bibliography")
runs citeproc and is the documented flake that times out under full-suite load
but passes in isolation. `vitest.config.mts` sets **no `retry`, no `testTimeout`,
no pool isolation** (verified — defaults only). A flaky test in a green-gated CI
either causes spurious red PRs or trains the developer to ignore reruns; neither
is acceptable for the project's "every change ships via PR" workflow. The fix is
cheap (per-test `{ timeout }` bump and/or `test.retry`, or splitting the citeproc
case into its own isolated file), but it is currently unaddressed.

**Q-H4 — Renderer component behavior is largely untested at the component level.**
There are **67 `.svelte` files** but only **5 renderer tests actually render a
component** via `@testing-library/svelte`
(`callout-plugin`, `math-plugin`, `run-ocr`, `OcrProgressDialog`,
`ui-primitives`). The other 32 renderer tests cover extracted pure logic
(`sidebar-tree-utils`, `wiki-link-resolver`, `refactor/*`, editor command
helpers) — good logic-extraction discipline, but the big interactive surfaces
(`App.svelte` 3,764, `Preview.svelte` 2,585, `ConversationsPanel.svelte` 2,232,
`SettingsDialog.svelte`) have **no component tests**. The approval *UI* — the diff
view where the human actually confirms LLM writes — is verified only by the E2E
smoke (which doesn't open a project). The Trust Principle's human-in-the-loop step
is thus untested end-to-end at the interaction level.

### Medium

**Q-M1 — No shared test fixture infrastructure despite 88 duplicated setups.**
`tests/` contains only **2 non-test `.ts` files** (`smoke.spec.ts`, a `.bench.ts`)
— effectively no helper layer. **88 main-process test files repeat the
`fs.mkdtempSync(...) → projectContext → initGraph → afterEach rm`** boilerplate
(e.g. `approval.test.ts:72-81`). The team has explicitly (and correctly) accepted
test-setup duplication until fixtures are warranted — this review does **not**
flag the duplication as a defect. But at 88 repetitions the threshold the team set
("until fixtures exist") has plausibly been crossed: a single
`withTempProject(fn)` / `makeGraphProject()` helper would (a) cut the boilerplate,
and (b) give one place to harden teardown (see Q-M2). This is now a payoff
opportunity, not a style nit.

**Q-M2 — Teardown relies on `afterEach` rm with no global safety net.** Each
temp-dir test cleans up in its own `afterEach` (`approval.test.ts:79-81`). A test
that throws in `beforeEach` before registering teardown, or one that forgets the
`afterEach`, leaks a tmpdir. There is no global setup/`onTestFinished` sweep. Low
probability, but a centralized fixture (Q-M1) would close it for free.

**Q-M3 — Coverage is reported but the numbers are not tracked over time.**
`vitest.config.mts:36` emits `text`, `text-summary`, `html`, `lcov` reporters, and
the config comment (`:54`) notes "`src/main/llm/` at ~15%" and references issue
#353 ("until we've looked at the numbers"). So coverage is generated but: not
enforced outside `shared`, not uploaded anywhere (lcov is "for future CI
integration"), and not trend-tracked. The one hard number captured in-repo
(llm ~15%) is stale and was the motivation for the now-added llm tests, but
there's no mechanism to prevent regression of the directories that matter most.

**Q-M4 — No accessibility testing.** `axe-core` is not a dependency (verified).
The only a11y-adjacent assertions are `getByRole` lookups in
`ui-primitives.test.ts` and the E2E smoke (`getByRole('heading'/'button')`).
For a keyboard-first professional tool (CLAUDE.md emphasizes keyboard shortcuts
and contextual menus), there is no automated check for focus order, ARIA
correctness, or keyboard-trap regressions in dialogs/command palette. svelte-check
a11y warnings are explicitly **non-fatal** (CLAUDE.md), so they don't gate.

**Q-M5 — No performance regression gate despite an existing benchmark.**
`tests/main/graph/n3-cache.bench.ts` exists (vitest bench), but `pnpm test`
(`vitest run`) does not run benches and CI doesn't invoke `vitest bench`. The
indexing path is the documented performance-sensitive area; the bench is present
but not wired into any gate or trend, so a perf regression in graph indexing would
not be caught.

## Current Quality Assessment

### Testing Metrics (measured)

| Metric | Value | Source |
|---|---|---|
| Test files (vitest) | 263 | `find tests -name '*.test.ts'` |
| Source files | 380 | `find src` |
| `tests/shared` (pure unit) | 82 | measured |
| `tests/main` (integration) | 144 | measured |
| `tests/renderer` | 37 | measured |
| Main tests using real fs (`mkdtempSync`) | 88 | measured |
| E2E specs (Playwright) | 1 (`smoke.spec.ts`) | measured |
| Renderer tests that render a component | 5 of 37 | measured |
| `.svelte` files | 67 | measured |
| `.skip`/`.only`/`.todo` occurrences | 0 | measured |
| Shared test-helper/fixture files | 0 (only 1 bench, 1 e2e) | measured |
| Coverage floor enforced | `src/shared/**` 70% only | `vitest.config.mts:56` |
| Full suite size (reported) | ~2,733 tests / 264 files | per prompt; not re-run here |

Slice run to confirm green: `vitest run tests/main/llm/approval.test.ts
tests/main/graph/write-guard.test.ts` → **24 passed**, 1.74s.

### Test files vs source by main subdirectory (measured)

| Subdir | src `.ts` | test files (approx) | Note |
|---|---|---|---|
| graph | 5 | 36 | Excellent — many regression tests |
| sources | 29 | 28 | Strong |
| llm | 8 | 16 | Good count, but gaps in *what's* asserted (Q-C1/Q-C2) |
| publish | 41 | 21 | Moderate; houses the flaky test |
| skills | 7 | 12 | Strong — full pipeline covered |
| notebase | 13 | 10 | Strong incl. dedicated `assert-safe-path-coverage.test.ts` |
| compute | 9 | 10 | Strong |
| (ipc.ts) | 1 file, 2,717 LOC | **0** | Untested directly (Q-H2) |
| (preload) | 1 file | **0** | Untested directly (Q-H2) |

### Quality Metrics

- **Defect-prevention posture: strong.** Lint gate combines `tsc --noEmit`,
  `svelte-check --threshold error`, and `eslint` (`package.json` `lint` script),
  all enforced in CI on every PR. The E2E smoke (`smoke.spec.ts`) was added in
  response to a real "black window" boot incident (PR #305) — a textbook
  regression-driven test.
- **Flakiness: 1 known flake, unmitigated** (Q-H3).
- **Coverage trend: not tracked** (Q-M3); single in-repo datum (llm ~15%) is stale.
- **Critical-path coverage: uneven.** notebase path-traversal security is
  *well*-tested (dedicated coverage test); the LLM trust gate is *poorly* tested
  relative to its importance (Q-C1, Q-C2).

## Quality Improvement Plan

Prioritized by (risk × how-load-bearing) ÷ effort. Each item cites concrete files.

### Priority 1 — Make the Trust Principle actually tested (the system's keystone)

1. **Replace the no-op write-guard test with a real one** (Q-C1).
   In `tests/main/graph/write-guard.test.ts`: enter LLM context, attempt a direct
   `store.add`/`parseIntoStore` that should be guarded, and assert the warning
   fires (`vi.spyOn(console,'warn')` with a real `toHaveBeenCalled` assertion) or
   that the write is rejected. This requires exposing or invoking `guardedAdd`;
   pair with the architecture review's recommendation to extract the guard into
   `src/main/graph/write-guard.ts` so it's unit-testable in isolation. Effort: 0.5
   day.
2. **Decide and test the established-node escalation** (Q-C2). Either implement the
   documented rule in `proposeWrite` (`approval.ts:166` — look up
   `thought:hasStatus thought:established` for `affectsNodeUris` and override the
   tier to `requires_approval`) and add tests, **or** correct CLAUDE.md if the
   rule is intentionally dropped. Do not leave a documented safety invariant that
   neither code nor test upholds. Effort: 1 day (with impl) / 0.25 day (doc fix).
3. **Validate payload kind at `proposeWrite` time** (Q-C3). Add a creation-time
   check that rejects/flags unwired kinds (`source`, `saved-query`) so a broken
   proposal can't reach the user's approve button; add a test asserting fast
   failure at creation. Effort: 0.5 day.
4. **Add store-effect tests for the tiers** (Q-H1). For each tier, assert what
   actually landed in the graph: `autonomous`/`notify_only` → present immediately;
   `requires_approval` → absent until `approveProposal`, present after. Effort:
   0.5 day.

### Priority 2 — Stop the known flake and close the biggest coverage hole

5. **Quarantine/fix the citeproc flake** (Q-H3).
   `tests/main/publish/tree-markdown.test.ts:126` — give the Chicago case a higher
   per-test `timeout`, or `test.retry(2)`, or split it into its own file that runs
   isolated. Add `retry` only for that case, not globally, to avoid masking other
   flakes. Effort: 0.5 day.
6. **Add a focused test slice for `ipc.ts`'s embedded logic and the preload
   surface** (Q-H2). Don't test all 187 handlers — extract the embedded helpers
   (`recordComputeProposalRun`, turtle escaping) per the architecture review and
   unit-test those; add a preload-shape contract test that asserts `window.api`
   exposes exactly the expected method names (catches bridge drift the E2E smoke
   only catches at boot). Effort: 1–1.5 days.

### Priority 3 — Pay off accumulated test infrastructure debt

7. **Introduce one shared fixture helper** (Q-M1/Q-M2): `withTempProject()` /
   `makeGraphProject()` in `tests/helpers/`. Migrate opportunistically (not a big-
   bang). Centralizes the 88 duplicated setups and gives one hardened teardown.
   Effort: 0.5 day to build, migrate incrementally.
8. **Wire coverage trend + extend the floor incrementally** (Q-M3): upload lcov to
   Codecov (the config already emits it for this purpose), and add a modest floor
   (e.g. 40–50%) to `src/main/llm/**` and `src/main/notebase/**` so the trust and
   security paths can't regress. Effort: 0.5 day.

### Priority 4 — Targeted UI and a11y coverage

9. **Component-test the approval diff UI and command palette** (Q-H4): the
   human-confirm step deserves at least one `@testing-library/svelte` test that
   renders the proposal/diff component, simulates approve/reject keystrokes, and
   asserts the IPC call. Effort: 1 day.
10. **Add `axe-core` + a smoke a11y assertion on dialogs** (Q-M4): one test that
    renders each dialog (`ConfirmDialog`, `PromptDialog`, command palette) and runs
    `axe` for ARIA/role correctness + focus-trap. Effort: 0.5 day.

## Testing Strategy Enhancement

### Current pyramid (measured, healthy shape)

```
        /\        E2E (Playwright Electron): 1 smoke — boot + welcome screen
       /  \       — appropriately thin for a desktop app
      /----\      Integration (tests/main, real fs): 144 files, 88 use mkdtemp
     /      \     — the dominant, correct layer for a file/graph-backed app
    /--------\    Renderer logic + 5 component: 37 files
   /          \   Unit (tests/shared, pure): 82 files
  /____________\
```

The shape is right for an Electron file-backed IDE: heavy real-fs integration,
thin E2E. The gaps are *within* layers (trust-path assertions, component
interaction), not a wrong pyramid. **No new test pyramid layer is needed** —
deepen the existing ones at the cited spots.

### Test data management
- Single fixture project (`tests/fixtures/sample-project`) plus per-test tmpdirs.
  This is appropriate for a solo desktop app — no need for multi-environment test
  data matrices. The one improvement is the shared `withTempProject` helper
  (Q-M1) so generated test data has a single lifecycle owner.

## Quality Gates (current vs recommended)

| Gate | Now | Recommended |
|---|---|---|
| Type check (tsc) | CI + lint | keep |
| svelte-check (error threshold) | CI | keep; a11y stays warn-only (acceptable) |
| eslint | CI | add `no-restricted-imports` boundary rules (per arch review) |
| Unit/integration tests | CI on every PR | keep; quarantine the flake first |
| E2E smoke | parallel CI job | keep; add 1 "open project" path eventually |
| Coverage floor | `src/shared` 70% only | add `llm`/`notebase` floors (Q-M3) |
| Pre-commit hook | **none** (no husky/lefthook) | optional: local `tsc`+changed-test hook to fail fast before CI |
| Coverage upload/trend | none | wire lcov→Codecov (already emitted) |

A pre-commit hook is genuinely optional here — CI already gates PRs and this is a
solo workflow, so the cost/benefit of a local hook is marginal. Noted, not urged.

## Defect Prevention

Strong already: regression-test-on-incident culture (the E2E smoke exists because
of a real boot regression; many tests carry `#NNN` issue tags tying them to the
defect they prevent, e.g. `approval.test.ts:68`). The gap is **invariant tests for
documented guarantees** — the trust tiers, the write guard, the established
escalation. These are the guarantees most likely to silently rot because nothing
fails when they're violated (Q-C1/Q-C2).

## Performance / Security / Accessibility / Cross-Platform

- **Performance:** A bench exists (`n3-cache.bench.ts`) but isn't gated (Q-M5).
  Recommend running it in CI for trend only (non-blocking) on the indexing path.
- **Security:** The actual attack surface for this app is path traversal, and it
  is **well-covered** (`assert-safe-path-coverage.test.ts`, plus traversal
  assertions across notebase tests). The LLM trust boundary is the other security-
  relevant surface and is under-tested (Q-C1/Q-C2) — that's the security testing
  gap that matters here.
- **Accessibility:** Effectively untested (Q-M4); meaningful given the keyboard-
  first design philosophy.
- **Cross-platform:** Intentionally **macOS-only** (CI `runs-on: macos-latest`,
  documented rationale in `ci.yml:6-11` re: chokidar/fsevents timing). For a solo
  dev on darwin this is a reasonable, explicit scoping decision — a cross-browser/
  device matrix does **not** apply to a single-Chromium Electron app. No action
  recommended unless distribution targets expand to Windows/Linux, at which point
  the watcher-timing tolerance is the first thing to revisit.

## Monitoring and Metrics

For a solo project, keep it lightweight: (1) Codecov trend on the lcov already
emitted, (2) CI flake visibility once Q-H3 is fixed (a quarantined-then-fixed
flake shouldn't recur silently). No dashboards/SLOs needed.

## Risk-Based Testing

Highest risk × least covered (where to spend the next test increment):
1. LLM trust gate (write guard + escalation + tiers' store effects) — Q-C1, Q-C2,
   Q-H1. **Top priority.**
2. `ipc.ts` embedded logic + preload bridge contract — Q-H2.
3. Approval *UI* interaction — Q-H4.
Lowest marginal value: more `tests/shared` pure-logic tests (already past 70%
floor and well-covered).

## Continuous Improvement / Team Development

Solo project — formal training plans don't apply. The one durable practice worth
codifying: **when a documented guarantee exists in CLAUDE.md (trust tiers, write
guard), require a test that fails if the guarantee is violated.** The CLAUDE.md
LLM/Graph PR checklist already asks for this; Q-C1/Q-C2 show it isn't being
enforced. Wiring that checklist item into the actual test suite is the single
highest-leverage process change.

## Estimated Impact

| Fix | Effort | Impact |
|---|---|---|
| Real write-guard test (Q-C1) | 0.5d | Closes the keystone false-confidence gap |
| Escalation impl/test or doc fix (Q-C2) | 0.25–1d | Restores a documented safety invariant |
| Payload-kind validation (Q-C3) | 0.5d | Removes user-facing approve-time crash |
| Tier store-effect tests (Q-H1) | 0.5d | Pins the most security-relevant policy line |
| Quarantine flake (Q-H3) | 0.5d | Restores green-CI signal integrity |
| ipc/preload contract tests (Q-H2) | 1–1.5d | Covers the biggest untested surface |
| Shared fixture helper (Q-M1) | 0.5d + incr. | Cuts 88 duplicated setups, hardens teardown |
| Coverage floor on llm/notebase (Q-M3) | 0.5d | Prevents trust/security-path regression |
| Approval-UI + a11y tests (Q-H4, Q-M4) | 1.5d | Covers human-confirm step + dialog a11y |
| **Total** | **~6–7.5 days** | Sequenceable one PR at a time |

## Implementation Roadmap

- **Phase 1 (trust path, ~2 days):** Q-C1, Q-C2, Q-C3, Q-H1. Do these *before* any
  of the architecture review's mega-module refactors so the Trust Principle is
  regression-protected during the moves.
- **Phase 2 (signal integrity + biggest hole, ~2 days):** Q-H3 (flake), Q-H2
  (ipc/preload), Q-M3 (coverage floor).
- **Phase 3 (infra + UI, ~2.5 days):** Q-M1 fixture helper, Q-H4 approval-UI test,
  Q-M4 a11y smoke, Q-M5 bench-in-CI (non-blocking).

## Success Metrics

- Write-guard test asserts an actual block/warning (not just the counter).
- A test fails if `established`-node escalation is removed (or CLAUDE.md is
  corrected and the claim deleted).
- Creating a proposal with an unwired payload kind fails at creation, with a test.
- Zero known-flaky tests in CI (the citeproc case quarantined/fixed).
- Coverage floor active on `src/main/llm/**` and `src/main/notebase/**`.
- `window.api` shape is contract-tested against the preload bridge.

## Genuine Strengths (acknowledged)

- Zero skipped/focused tests — exceptional discipline.
- 88 real-fs integration tests — the right testing model for a file/graph app.
- Dedicated path-traversal security coverage.
- Full skills pipeline tested (parse/loader/compile/template/menu-config).
- 36 graph tests including incremental-index and rename-heuristic regressions.
- CI with lint+test+E2E on every PR; E2E born from a real incident.
- Coverage tooling already installed with a meaningful floor on the pure layer.
- Logic-extraction discipline in the renderer (testable helpers pulled out of
  big components), even where component tests are thin.

The work here is sharpening a good suite at its most load-bearing seam (the trust
gate), not building QA from scratch.
