# Quality Assurance Review Plan
Generated: 2026-09-04 10:08:54
Scope: entire project (/Users/davegriffith/minerva)
Prior reviews consulted: `reports/quality-review-entire-project-2026-08-23-193321.md`,
`reports/architecture-review-entire-project-2026-08-23-080903.md`,
`reports/architecture-review-entire-project-2026-09-04-095131.md`

## Executive Summary

The last full QA review (2026-08-23) filed four findings — an e2e suite that
bypasses the UI it claims to backstop, a `smoke.spec.ts` test that booted
against the developer's real Electron profile, two quality gates
(`fetch:model`, `lint:fonts`) that didn't run where they mattered, and 10-30
points of dead slack in the coverage floors. In the 94 commits since, **every
one of those four was fixed**, several within days: `abe0e153` isolated every
e2e launch from the developer's profile and added
`tests/architecture/e2e-launch-hygiene.test.ts` to keep it that way; `2a3dd396`
wired `fetch:model` into `pretest`/`precoverage` and `tests/architecture/
embedding-model-gate.test.ts` now asserts the staged model is present under CI;
`495b477f` added `pnpm lint:fonts` to `ci.yml`; `b1ec5a92` re-ratcheted every
coverage floor to within 3-8 points of measured. This is the second review in a
row where the codebase converted "review found X" into "X is fixed" faster
than the review cadence itself — the remediation discipline is the strongest
finding in this report, not a footnote to it.

That means this review's job is to find what a codebase already this
disciplined about closing gaps hasn't yet found for itself. Four findings did
that:

1. **A proven production crash shipped with zero regression test, and it's
   still true today.** The packaged CLI crashed on its first dynamically
   imported dependency (AWS SDK pieces for S3 publish) from `#1437` until
   `774b72be` fixed it same-day — a 9-line `codeSplitting: false` config
   change. No test asserts `.vite/build/assets/` stays empty or exercises a
   command that takes a dynamic-import branch. This is also a **process** gap,
   not just a code gap: `docs/development.md:182-183` states "bug fixes should
   come with a test that fails before the fix and passes after, when that's
   practical" — and here it plainly was practical (a build-then-run
   assertion), yet the fix commit shipped without one.
2. **A security-documented IPC handler is 42.85% covered, hidden inside a
   94.65% aggregate.** `src/main/ipc/register-shell.ts` carries an explicit,
   commented security invariant — `SHELL_OPEN_EXTERNAL` only allows `http:`/
   `https:` "so don't let anyone (or the LLM) coerce us into opening `file://`,
   `javascript:`, etc" — that has **zero test references anywhere in the
   suite**. `SHELL_OPEN_IN_TERMINAL`'s Windows and Linux spawn branches (each
   with its own "explicit args, no shell — can't be metacharacter-injected"
   comment) are untested; the one test that exercises the handler only runs
   whatever platform the suite happens to execute on. This is the identical
   "aggregate hides a per-file gap" shape `vitest.config.mts`'s own comments
   describe for `register-proposals.ts`/`helpers.ts`/`register-conversation-
   drafts.ts`/`register-refactor.ts` — just not yet found for this file.
3. **The Python-module-gated rich-output tests have no CI-ran assertion, and
   `ci.yml` has no Python setup step at all.** `#1931` added an "assert the
   environment gate condition held" test for `sandbox-integration.test.ts` and
   `network-guard.test.ts` specifically because a `describe.skip` can vanish
   silently. `python-kernel.test.ts`'s three `pyModuleAvailable('pandas'/
   'matplotlib'/'PIL')`-gated tests (DataFrame table output, matplotlib
   Figure→image, PIL Image→image — real compute-notebook features) got no such
   backstop, and nothing in `.github/workflows/ci.yml` installs pandas,
   matplotlib, or Pillow. Whether these three features are actually exercised
   in CI today is not knowable from the workflow file; it depends entirely on
   whichever Python happens to ship on the `macos-latest` runner image.
4. **`src/main/clipper/lifecycle.ts`'s concurrency-safety logic has zero
   direct test.** The module's own docstring claims "concurrent project opens
   race harmlessly" via a `starting` promise-dedup pattern — exactly the kind
   of claim a unit test should pin down directly. Measured: 13.63% statements,
   **0% branches, 0% functions**. The two files that reference it
   (`window-manager-watcher-fanout.test.ts`, `register-small.test.ts`) test
   something else and almost certainly mock it out.

None of these four rises to "the suite is unreliable" — the same review that
found them also confirms 660/660 test files passing, 7,101/7,102 tests
passing, zero literal `.skip`/`.only`/`.todo`, and a benchmark regression gate
that's been actively tightened (not just left alone) since the last review.
The findings are specific, verified, and exactly the size this codebase has
shown it can close in a day or two per item.

---

## Quality Assurance Findings

### Critical Issues (Quality Risk)

- [ ] **C1 — Packaged CLI dynamic-import crash shipped and was fixed with zero
      regression test; the bug class is still live.** The CLI's own
      "electron-free" test suite (`tests/cli/electron-free.test.ts`, 248 lines,
      confirmed by direct read) drives the built bundle under plain Node for
      `sparql`, `read`, and the propose/write path — none of which take a
      dynamic-import branch, so the exact class of bug that just shipped to
      production (a future `import('some-heavy-dep')` behind a rarely-hit CLI
      command splitting into its own Rolldown chunk the packaged shim can't
      find) remains completely unguarded. `vite.cli.config.mts`'s
      `output.codeSplitting: false` is the fix; nothing asserts it stays true,
      or that `.vite/build/assets/` stays empty after a build. See the
      2026-09-04 architecture review's Critical finding for the full mechanism
      — this entry adds the QA-specific angle: it is also a violation of this
      project's own documented bug-fix-testing convention
      (`docs/development.md:182-183`), and the fix is cheap: extend
      `electron-free.test.ts` with either an emptiness assertion on
      `.vite/build/assets/` or a command invocation that forces the AWS SDK
      import to actually resolve (a stub S3 config is enough — no real network
      call needed).

### High Priority Issues

- [ ] **H1 — `register-shell.ts`'s security-relevant branches are untested,
      masked by the IPC-registrar aggregate.** Measured today:
      `src/main/ipc/register-shell.ts` at 42.85% statements / **27.27%
      branches** / 62.5% functions, inside an `src/main/ipc/**` aggregate of
      94.65% statements — the file is a genuine outlier that the aggregate
      (and the `vitest.config.mts` per-glob floor of 65/66/64/51, comfortably
      met by the other 23 well-tested registrars) does not surface. Read
      directly: `tests/main/ipc/register-shell.test.ts` (131 lines) is a good,
      focused test of the path-traversal guard (`#1328`) for
      `SHELL_REVEAL_FILE` / `SHELL_OPEN_IN_DEFAULT` / `SHELL_OPEN_IN_TERMINAL`
      — but it:
      - Never invokes `SHELL_OPEN_EXTERNAL` at all. The handler's own comment
        states the security property being enforced ("Only http(s) — don't
        let anyone (or the LLM) coerce us into opening `file://`,
        `javascript:`, etc") and it has no test — not the happy path, not the
        rejection path, not a malformed-URL path.
      - Exercises `SHELL_OPEN_IN_TERMINAL` on exactly one platform (whichever
        `process.platform` the test runs under — darwin on this machine and on
        CI's `macos-latest`). The `win32` (`cmd.exe /c start`) and Linux
        (`x-terminal-emulator` → `xterm` fallback) branches, each carrying its
        own "explicit args, no shell — can't be injected" safety comment, have
        never executed under test.
      - Never exercises `EXPORT_CSV` (save-dialog + file-write handler).
      This is the same shape of gap `vitest.config.mts`'s own comments
      describe for `register-proposals.ts` (the approval gate) and
      `register-conversation-drafts.ts` (six handlers with zero test
      references) before each got a dedicated per-file floor — `register-
      shell.ts` has no such floor yet. Fix: extend the existing test file
      (it already has the `withPlatform` helper needed) to cover all three
      terminal-spawn branches and add `SHELL_OPEN_EXTERNAL` cases (allowed
      `https:`, rejected `file:`/`javascript:`, malformed URL).
- [ ] **H2 — Python-module-gated compute tests have no CI-ran assertion, and
      CI installs no Python packages.** `tests/main/compute/python-kernel.test.ts:299-301`
      gates three tests behind `pyModuleAvailable('pandas'|'matplotlib'|'PIL')`,
      each a real user-facing compute-notebook feature (DataFrame → table
      output, matplotlib `Figure` → image, PIL `Image` → image). `#1931`
      (commit `0c6125f6`) added exactly the right fix for this failure mode —
      an upfront assertion that the environment gate condition held — to
      `sandbox-integration.test.ts` and `network-guard.test.ts` specifically
      because "a critical kernel-level enforcement test... cannot silently
      vanish." The same reasoning applies here and wasn't applied: grepping
      `.github/workflows/ci.yml` for `python`/`pandas`/`matplotlib`/`pip`
      returns nothing — there is no setup step installing any of these three
      packages. Whether they're actually present on GitHub's `macos-latest`
      runner image is not pinned down anywhere in this repo; if they aren't
      (or a runner-image update removes one), these three tests silently
      become `it.skip` with no CI signal, identical to the exact bug `#1925`/
      `#1931` fixed for the embedding-model and sandbox suites. Fix: either (a)
      add the same "assert pyModuleAvailable() returned true under CI" pattern
      used in the two already-fixed files, or (b) add a `pip install pandas
      matplotlib pillow` step to `ci.yml`'s `lint-and-test` job and drop the
      gates entirely for a deterministic CI environment.
- [ ] **H3 — `SourcesPanel.svelte` (1,298 lines, third consecutive
      architecture review naming it, zero commits against it in 95 commits) is
      also a testing gap, not only a size gap.** Its per-file coverage floor
      (`vitest.config.mts`) is 34/32/26/20 — the lowest floor of any of the
      seven per-file renderer gates, and unlike `Editor.svelte`/`Preview.svelte`
      it received no extraction work this cycle to raise it. Cross-referencing
      rather than duplicating the architecture review's structural finding:
      the QA angle is that this is the single largest Svelte component with a
      coverage floor low enough that a regression could silently erase most of
      its test value before the floor would ever fail — the floor exists, but
      it is set near zero, so it is closer to a tripwire for total abandonment
      than a quality gate.

### Medium Priority Issues

- [ ] **M1 — `src/main/clipper/lifecycle.ts` has zero direct unit test.**
      Measured: 13.63% statements, **0% branches, 0% functions**, 15% lines.
      The module owns real concurrency-correctness logic worth testing
      directly: `ensureClipperRunning`'s `starting` promise dedup (so two
      concurrent "open thoughtbase" calls don't race to start two clipper
      servers), the idempotent `stopClipperServer`, and the persisted-secret
      "a stop/start keeps pairing stable" contract its own docstring claims.
      `tests/main/clipper/clipper-ingest.test.ts`, `clipper-config.test.ts`,
      and `clipper-server.test.ts` exist and test the neighboring modules;
      `window-manager-watcher-fanout.test.ts` and `register-small.test.ts`
      reference `lifecycle` only incidentally (almost certainly mocked out —
      neither file's name suggests it's testing lifecycle's own dedup logic).
      This is the same shape of gap `#1926` fixed for `ipc/helpers.ts` (16
      files mocked it out for their own purposes while the module implementing
      the policy sat untested) — just not yet found here.
- [ ] **M2 — Benchmark absolute-ceiling coverage is still thin for the
      highest-profile scale benchmarks, though genuinely improved since the
      last review.** The prior review stated "every `budgetMs` in the
      committed baseline is `null`... built and unused" — that's now
      measurably wrong in the encouraging direction: 4 of 14 benchmarks in
      `tests/main/bench-baseline.json` now carry a real `budgetMs` ceiling and
      a tightened `1.3×` tolerance (`#1945`, `#1473` — e.g. `indexAllNotes:
      5000 notes` at `1800ms`/`1.3×`, two `queryGraph` cache-hit benches at
      `5ms`/`1.3×`). But the other 10 — including `indexAllNotes: 500 notes`
      and `indexAllNotes: 2000 notes`, the two most-quoted large-thoughtbase
      scale numbers in this codebase's own commentary — still rely solely on
      the top-level `2.0×` ratio gate with no absolute ceiling, meaning a
      slowdown from (measured) 144.75ms/492.78ms to just under 2× would still
      pass. The mechanism exists and is demonstrably being adopted
      incrementally; it just hasn't reached the two benchmarks a reader would
      assume it already covers.
- [ ] **M3 — `pattern-ratchets.test.ts` now covers 4 of CLAUDE.md's 5 named
      IPC anti-patterns (up from 2), closing most but not all of the prior
      review's H2.** Confirmed by direct read: swallowed errors, `null`
      no-project↔not-found, boolean overloads (`#1930`, new since last
      review), and `undefined` no-project↔success (also new) all have a
      committed baseline + ratchet. The one CLAUDE.md anti-pattern still
      without a ratchet is the fifth: "in-band `error?` on an otherwise-normal
      payload," which CLAUDE.md's own migration backlog still lists as open
      for `GRAPH_QUERY` (`{ results, columns, error? }`). A fifth ratchet
      mirroring the other four's shape would close the set.

### Low Priority Issues

- [ ] **L1 — A residual skip is anonymous in everyday test output.** `pnpm
      test` reports "7101 passed | 1 skipped (7102)" but vitest's default
      reporter does not name which test skipped, and this review could not
      pin it down within a reasonable search budget (all of the
      Python-module-availability and embedding-model gates were individually
      re-run and passed 100% clean in isolation — `pandas`/`matplotlib`/`PIL`
      and the embedding model are all present on this machine). Despite two
      rounds of work specifically making silent skips loud (`#1925`, `#1931`,
      `embedding-model-gate.test.ts`, the sandbox/network-guard assertions),
      a routine single skip in the default `pnpm test`/`pnpm coverage` output
      is still unidentifiable without re-running with `--reporter=verbose`.
      Low severity because nothing here suggests the skip is a regression —
      only that the observability gap the codebase has been closing
      elsewhere hasn't quite reached "which test, by name" in the default
      output path developers see on every run.
- [ ] **L2 — `tests/e2e/smoke.spec.ts`'s one remaining `waitForTimeout` is
      fine, but is now the only one — worth noting it's a deliberate survivor,
      not an oversight.** The prior review's M8 (six unconditioned
      `waitForTimeout(400-500)` sleeps in `a11y.spec.ts` before axe scans) is
      confirmed fixed — zero hits in `a11y.spec.ts` today. The single
      remaining hit, `smoke.spec.ts:58`, carries its own justifying comment
      ("give async work a beat to surface a late error"). No action needed;
      recorded so a future reviewer doesn't have to re-derive that this one
      is intentional.

---

## Current Quality Assessment

### Testing Metrics (measured this session — `pnpm test` and `pnpm coverage`, both run to completion, exit 0)

| Metric | Value | How measured |
|---|---|---|
| Vitest test files | 660 (660 passed) | `pnpm test` |
| Vitest tests | 7,101 passed / 1 skipped (7,102 total) | `pnpm test` |
| `pnpm test` wall time | 72.74s vitest-reported / **1:13.58** total incl. pnpm overhead | `time pnpm test` |
| `pnpm coverage` wall time | 107.43s vitest-reported / **1:49.41** total | `time pnpm coverage` |
| Playwright e2e specs / tests | 6 files / **15 tests** | `grep -c '^test(' tests/e2e/*.spec.ts` |
| Source files / LOC | 762 (`.ts`+`.svelte`) / **127,556** | `find src` + `wc -l` |
| Test LOC | **87,662** across 660 files | `wc -l` on all `tests/**/*.test.ts` |
| Test:source LOC ratio | 0.69 : 1 | derived |
| `vi.mock` usage | 136 of 660 files (20.6%) | `grep -rl "vi\.mock("` |
| `toMatchSnapshot` | 4 (all shape-drift: preload surface, IPC channels, docs chunk ids, CSL output) | `grep -ro` |
| Literal `it/test/describe.only/todo/fails` | **0** | targeted grep |
| Literal `.skip` outside documented environment gates | **0** | targeted grep (3 hits, all e2e "build not present" skips) |
| Environment-gated `cond ? describe/it : .skip` sites | ~13 (Python + embedding-model gates) | targeted grep |
| Architecture fitness-function files | 12 (`tests/architecture/*.test.ts`) | `ls` |

### Coverage — measured, whole repo (v8 provider)

```
Statements   : 70.48% ( 30344/43048 )
Branches     : 63.55% ( 14527/22858 )
Functions    : 62.60% (  5786/ 9242 )
Lines        : 73.96% ( 24801/33532 )
```

Trend vs. the 2026-08-23 measurement (69.01% S / 61.80% B / 61.59% F / 72.34% L):
**every axis moved up** — statements +1.47, branches +1.75, functions +1.01,
lines +1.62 — over 94 commits and roughly 356 new tests. All per-glob coverage
thresholds in `vitest.config.mts` passed (`pnpm coverage` exit 0). Notably,
those thresholds were re-ratcheted on 2026-08-26 (`#1932`, commit `b1ec5a92`)
to sit 3-8 points below measured, closing the prior review's C4 finding that
10-30 points of dead slack meant the trust-path floors could not fail on a
real regression. Spot-checked: `src/main/llm/**` floor is now 81/58/55/66
(lines/functions/statements/branches) against measured ≈85/86/? /70 — a tight
margin, not the +30-point gap measured three weeks ago.

### Quality Metrics

- **Test pass rate**: 7,101/7,102 (99.99%) locally, 660/660 files clean.
- **CI quality gates** (`.github/workflows/ci.yml`, three parallel jobs):
  `pnpm lint` (tsc + svelte-check + eslint) ∥ `pnpm lint:fonts` (now wired in,
  closing the prior review's C3) ∥ `pnpm coverage` (full suite + all
  thresholds) ∥ `pnpm audit --prod --audit-level=high` (blocking since
  `#1455`) ∥ `pnpm test:e2e` (separate job, Playwright against a packaged
  build).
- **Not enforced in CI** (confirmed unchanged from the last review):
  `pnpm check:docs` (no workflow invokes it — the 2026-09-04 architecture
  review's High #2), `pnpm bench:check` (weekly/manual only, by deliberate
  design to avoid flapping shared runners), `pnpm audit` full-tree
  (`continue-on-error: true`, visibility-only by documented design).
- **Escaped defects (measurable proxy)**: one confirmed production incident
  in the review window — the CLI dynamic-import crash (C1) — caught by a user
  report / manual testing rather than CI, fixed same-day, zero regression
  test added. This is the cleanest available "escaped defect" data point this
  review has, and it is the basis for C1's severity.
- **MTTR (this incident)**: same-day (crash discovered → `774b72be` merged).
  Fast, but "fast fix, no regression test" is a pattern worth watching —
  it optimizes for this incident's resolution time at the cost of the next
  one's prevention.

---

## Quality Improvement Plan

### Immediate Actions (1-3 days)

1. **Close C1**: add a dynamic-import regression assertion to
   `tests/cli/electron-free.test.ts` (assert `.vite/build/assets/` is empty
   post-build, or force a command through the AWS SDK's dynamic-import
   branch with a stub S3 config).
2. **Close H1**: extend `tests/main/ipc/register-shell.test.ts` with
   `SHELL_OPEN_EXTERNAL` cases (allowed `https:`, rejected `file:`/
   `javascript:`/malformed) and `withPlatform('win32'/'linux', …)` cases for
   `SHELL_OPEN_IN_TERMINAL`'s spawn branches — the test file's own
   `withPlatform` helper already exists for the emoji-panel tests, so this is
   additive, not new infrastructure.
3. **Close H2**: add the `#1931`-style "assert the gate condition held under
   CI" check to `python-kernel.test.ts`'s pandas/matplotlib/PIL gates, or add
   a `pip install` step to `ci.yml`.

### Short-term Improvements (1-2 weeks)

4. **Close M1**: write `tests/main/clipper/lifecycle.test.ts` directly against
   `ensureClipperRunning`/`stopClipperServer`/`getClipperInfo`, specifically
   asserting the concurrent-start dedup (two simultaneous calls resolve to the
   same handle, only one server actually starts).
5. **Close M3**: add the fifth pattern-ratchet (in-band `error?` on an
   otherwise-normal payload), seeded with `GRAPH_QUERY` per CLAUDE.md's own
   migration backlog.
6. **Extend M2**: add `budgetMs` ceilings to `indexAllNotes: 500/2000 notes`,
   the two scale benchmarks most likely to be assumed already covered.
7. Raise `SourcesPanel.svelte`'s coverage floor (H3) as part of whatever PR
   finally splits it (already an architecture-review action item) — a QA
   sequencing note, not new work.

### Long-term Transformations (2-6 weeks)

8. Continue the renderer UI-coverage arc the architecture review already
   scoped (Dialog.svelte ratchet, App.svelte / composition-root coverage) —
   this review adds no new recommendation here beyond confirming it's still
   the single largest structural testing gap in the codebase and that the
   documentation (`docs/development.md:184-188`) now honestly describes it
   rather than overclaiming e2e coverage the way it did three weeks ago.
9. Wire `pnpm check:docs` into CI (architecture review's High #2 — flagged
   here too because an undetected docs/code drift is, functionally, an
   escaped-defect risk for anyone following generated documentation).

---

## Testing Strategy Enhancement

### Testing Pyramid — actual shape (confirmed unchanged in shape since 2026-08-23; only the numbers moved)

```
                    ▲
                   / \        Playwright E2E — 6 specs / 15 tests
                  /E2E\        Real Electron boot, real IPC bridge —
                 /-----\       but drives window.api directly, NOT
                /       \      the UI (deliberate: avoids brittle
               / Main-   \     CodeMirror-keystroke simulation).
              /  process  \
             /  wiring     \  IPC registrars — 24/24 have direct
            /  (mocked)     \  tests; src/main/ipc/** now 94.65%
           /-------------------\  stmts (was 75.8% three weeks ago).
          /                     \
         /   Main-process        \  Real-temp-fs integration —
        /    integration (real fs)\  ~184 of 660 files. The
       /--------------------------\  strongest layer; the right
      /                            \ shape for a local-first app.
     /       Pure unit (shared)     \  src/shared/** ~96% lines.
    /------------------------------- \
   /   Renderer store/ops (well-      \  Ops factories 90%+;
  /    tested) + components (weak)     \ components ~40% (66 of
 /----------------------------------------\ 125 files at 0%).
/     Renderer UI / composition — EMPTY     \  App.svelte 0%.
--------------------------------------------
```

Unchanged verdict from the last review, restated because it remains accurate:
this is an hourglass with the waist (renderer UI/composition) missing, not a
pyramid. The e2e layer is real and valuable but is not the UI-regression net
`docs/development.md` used to imply it was — and now correctly says it isn't.
Given this is a desktop Electron app where Playwright-against-a-packaged-build
is expensive (package + boot, ~5-10s per launch, single-worker), the right fix
is **more Svelte Testing Library component tests**, not more Playwright specs
— which the codebase's own `vitest.config.mts` per-file floors for `Editor.
svelte`/`Preview.svelte`/`SourceDetail.svelte`/`SourcesPanel.svelte`/
`SettingsDialog.svelte`/`PropertiesPanel.svelte` already correctly target.

### Test Coverage Goals (recalibrated from measured baselines, not generic round numbers)

- `src/shared/**`: sustain ≥90% lines / ≥80% branches (measured ~96%/86% — the
  strongest tree, keep it there as new pure logic lands).
- `src/main/**` domain modules (graph, publish, history, notebase, sources,
  git): sustain the current 80-95% lines via real-temp-fs integration tests —
  this is the app's core defect surface and its strongest-tested layer; don't
  let it regress toward the renderer's number as new subsystems land.
- `src/main/ipc/**`: the aggregate (94.65%) is no longer the useful number —
  every *new* registrar needs its own floor entry the way `register-
  proposals.ts`/`register-conversation-drafts.ts`/`register-refactor.ts`/
  `register-templates.ts` got, specifically so a `register-shell.ts`-shaped
  gap can't hide inside a healthy aggregate again.
- `src/renderer/**` components: target closing the 66-of-125-at-0% gap
  incrementally via the same render-smoke-test pattern `SourceDetail.test.ts`
  established (#1597) — not a single sweep, a per-PR ratchet the way `file-
  size-budgets.test.ts` already works.
- E2E: hold at "critical user journeys only" — boot, source ingestion, a11y
  across 4 surfaces, focus-trap, bundle-budget. Growing this layer further has
  a worse cost/value ratio than growing component tests for this app shape.

---

## Test Automation

### Automation Priorities (already in the order this codebase has actually pursued them, which is correct for this app shape)

1. **Architecture fitness functions** (`tests/architecture/*.test.ts`, 12
   files) — the highest-leverage automation in the repo. Each encodes a
   convention as a test with an explicit anti-vacuity check; this is more
   valuable per-file than an equivalent count of ordinary unit tests because
   it prevents a whole class of future regression, not one instance.
2. **Real-filesystem main-process integration tests** (~184 of 660 files) —
   correctly prioritized over mocking for a local-first file app; this is
   where the actual defect surface lives.
3. **IPC registrar coverage** (`ipc-registrar-coverage.test.ts`) — complete
   (24/24), a genuine ratchet-driven success story from the last review cycle.
4. **Playwright E2E** — deliberately small (15 tests), scoped to boot +
   critical journeys + a11y, not general regression coverage. Correct choice
   given cost (package + boot per test, single-worker, 60s timeout).
5. **Benchmark regression gate** — real, weekly/manual (not per-PR, to avoid
   shared-runner flap), now with partial absolute-ceiling coverage (M2).

### Framework Selection (what's actually in use — no framework changes recommended)

- **Unit / integration**: Vitest (`vitest.config.mts`), v8 coverage provider,
  `@testing-library/svelte` + `svelteTesting()` plugin for component tests.
  Correct choice; no reason to consider Jest here — Vitest's native Vite
  integration is why component tests can transform `.svelte` imports at all.
- **E2E**: Playwright against a packaged Electron build
  (`playwright.config.ts`, single worker, `retries: process.env.CI ? 2 : 0`).
  Correct for Electron — Selenium/WebDriver would add complexity Playwright's
  Electron support already handles.
- **Architecture / static analysis**: `dependency-cruiser` (driving `no-
  cycles.test.ts`, confirmed zero cycles across 788 files as of the last
  architecture review), plain-Vitest fitness functions for everything else.
  No ESLint plugin ecosystem gap identified — the renderer data-flow rule and
  the `waitFor`-must-be-awaited rule are both hand-rolled `no-restricted-
  syntax` entries, appropriately, since no off-the-shelf rule covers either.
- **Performance**: `vitest bench` + a hand-rolled diff-against-baseline script
  (`scripts/bench-check.mjs`). Appropriately lightweight for a desktop app;
  no case for adopting k6/JMeter here — there's no HTTP service to load-test.
- **API contract**: N/A in the web-API sense; the analogous surface is the IPC
  channel contract, covered by `tests/shared/ipc-contract-ratchet.test.ts` and
  the preload full-surface snapshot (`tests/preload/preload-bridge.test.ts`).

---

## Quality Gates

### CI/CD Gates (as configured today, `.github/workflows/ci.yml` + `bench.yml`)

| Gate | Enforcement | Status |
|---|---|---|
| `tsc --noEmit` / `svelte-check` / `eslint` | Blocking, every PR | ✅ enforced |
| `pnpm lint:fonts` | Blocking, every PR | ✅ enforced (closed since last review) |
| `pnpm coverage` + per-glob thresholds | Blocking, every PR | ✅ enforced, floors re-ratcheted tight |
| `pnpm audit --prod --audit-level=high` | Blocking, every PR | ✅ enforced since `#1455` |
| `pnpm audit` (full tree) | Visibility only | ⚠️ by deliberate design |
| Playwright E2E | Blocking, separate job | ✅ enforced, 2 retries in CI |
| `pnpm check:docs` | **Not invoked anywhere in CI** | ❌ gap (architecture review High #2) |
| `pnpm bench:check` | Weekly/manual dispatch only | ⚠️ by deliberate design (flap avoidance) |
| Pre-push hook (`.githooks/pre-push`) | Local only, runs `pnpm lint` + `pnpm lint:fonts` | Runs lint, **not tests** — bypassable via `--no-verify`/`SKIP_HOOKS=1` |

### Deployment Criteria (release workflow, `.github/workflows/release.yml`, not re-audited line-by-line this session but confirmed present per repo conventions)

- Signed + notarized build (macOS codesign/notarization checks per prior
  reviews' documentation).
- Playwright boot smoke test against the packaged app.
- No separate manual QA gate documented beyond the automated pipeline — for a
  single-maintainer desktop app this is a reasonable trade, but it does mean
  C1's exact failure mode (a packaged-bundle-only crash) has no manual-QA
  backstop either; the fix is the automated regression test recommended above,
  not a new manual step.

---

## Defect Prevention

### Root Cause Analysis — this review's actual defect data point

The one confirmed escaped defect in the review window (C1) has a clear root
cause: **the packaged-bundle behavior (dynamic-import chunk splitting) is
observable only after a full `electron-forge package`, and the CLI's own
"electron-free" test suite runs the built bundle but never exercises a
code path that would trigger the dynamic import.** This is a narrower, more
useful root cause than "insufficient testing" — the test infrastructure to
catch it already exists (`tests/cli/electron-free.test.ts` builds and runs the
real bundle), it just doesn't reach the relevant branch. The same
root-cause shape recurs in H1 (test file exists, doesn't reach all branches)
and H2 (test file exists, gate condition unverified in CI) — **this
codebase's dominant defect-escape pattern right now is "a test file exists
and looks like it covers the area, but a specific branch or environment
condition inside it is untested,"** not "no test exists at all." That's a
more advanced failure mode than most codebases reach, and it calls for a
different prevention tactic than "write more tests": a periodic
branch-coverage audit of files that look well-tested by file-existence but
aren't by branch percentage — exactly the exercise this review performed
manually for `register-shell.ts` and could be partially automated (a "lowest
branch-coverage percentage among files with an existing test file" report,
distinct from the existing "0% coverage, no test file" reports which are
already easy to spot).

### Shift-Left Practices already in place (confirmed, not aspirational)

- **Static analysis before runtime**: `tsc --noEmit` → `svelte-check` → `eslint`
  all run in parallel via `scripts/lint.mjs`, gating every PR and every push
  (pre-push hook).
- **Convention-as-code**: IPC error-handling (`#1631`), config-loading
  (`#1640`), and logging (`#1918`) conventions in CLAUDE.md are each backed by
  at least partial executable enforcement — `config-loader-usage.test.ts`
  (#1913) for config, the `no-restricted-syntax` ESLint rule for bare
  `console.*`, and now 4 of 5 IPC anti-patterns via `pattern-ratchets.test.ts`
  (M3). The IPC error-handling convention's rules 3-5 (discriminated unions,
  per-item outcome catalogs, single-meaning sentinels) remain prose-only
  except where a ratchet exists — this is the natural next automation target
  once the fifth pattern-ratchet (M3's recommendation) lands.
- **Trust-principle enforcement**: the LLM write-guard is fatal under test
  (`checkLLMWriteGuard`), and `tests/main/graph/trust-integrity.test.ts`
  asserts `findUnreviewedLLMWrites` stays empty on every PR — this is
  shift-left applied to the single most important invariant in the system,
  and it is real, not aspirational.

---

## Test Data Management

### Data Strategy (confirmed via direct inspection, unchanged and healthy since last review)

- **Real-filesystem fixtures over mocks for main-process tests**: ~184 of 660
  test files create a real temp project directory rather than mocking the
  filesystem — the right choice for a local-first file app, and it's why
  `src/main/**` domain modules measure 80-95% lines against real behavior
  rather than mocked behavior.
- **`tests/architecture/graph-tests-use-temp-project-fixture.test.ts` and
  `llm-tests-use-temp-project-fixture.test.ts`** (both new since the last
  review) ratchet this practice itself — a new graph or LLM test that doesn't
  use the shared temp-project fixture fails, closing the "test duplication is
  fine until fixtures exist, but once they exist, use them" principle this
  team has documented elsewhere.
- **Committed golden fixtures**: `tests/fixtures/sample-project` (hand-authored
  markdown + Turtle, explicitly excluded from coverage since it's not app
  code), `tokenizer.json`/`tokenizer_config.json`/`config.json` for the
  embedding model (small enough to commit; the `.onnx` weights are gitignored
  and fetched via `pnpm fetch:model`).
- **DuckDB BigInt handling** — a documented past gotcha (integer columns
  deserialize as `BigInt`, crashing `JSON.stringify` if untested) — has good
  coverage breadth: confirmed present in 8 test files spanning main
  (`duck-values.test.ts`, `sql-executor.test.ts`), sources
  (`tables-markdown.test.ts`), LLM tools (`sql-tools.test.ts`), CLI
  (`mcp.test.ts`, `run.test.ts`), and renderer (`editor-store-tabs.test.ts`,
  `vega/data-binding.test.ts`). No new finding here — flagged only to confirm
  the documented gotcha is not a live gap.

### Environment Management

- **CI**: `macos-latest`, single OS/arch target, documented reason (chokidar
  fsevents semantics + darwin Electron bundle requirement for e2e). No
  Windows/Linux CI at any level — a deliberate, stated scope boundary
  (`#962` tracks x64/universal packaging as the actual platform-expansion
  work; this review found no evidence CI testing is blocking that, since it
  isn't attempted).
- **Local dev**: `pnpm dev` via electron-forge + Vite HMR; `pnpm test:watch`
  for the file-watcher loop — standard, no gaps identified.
- **Python sandbox environment**: real, not mocked — `sandbox-integration.
  test.ts` runs actual macOS Seatbelt profiles. Gap: as H2 describes, the
  *presence* of the Python interpreter is now defended (#1931), but the
  *presence of specific modules* (pandas/matplotlib/PIL) used by three other
  tests is not.

---

## Performance Testing

### Test Scenarios (what exists — the desktop analogue of load/stress testing)

- **Scale/load analogue**: `indexAllNotes` benched at 500 / 2,000 / 5,000
  notes (`tests/main/graph/full-index.bench.ts` and siblings) — this is the
  correct desktop equivalent of load testing for a file-indexing app.
  Measured baseline: 144.75ms / 492.78ms / 1,181.86ms respectively.
- **Cache/cold-path analogue**: `n3-cache.bench.ts` / `n3-cold-rebuild.bench.ts`
  — warm vs. cold graph-store rebuild, the desktop equivalent of a
  cache-hit/cache-miss load test.
  - **Save-pipeline latency**: `write-pipeline.bench.ts`.
  - **Embeddings**: `pooling.bench.ts` — cosine similarity against a
    10,000-vector corpus.

### Performance Targets (measured baselines serving as the actual targets, since this app has no SLA-style external target)

- `indexAllNotes: 5000 notes`: **1,800ms hard ceiling** (`budgetMs`) + 1.3×
  tolerance — the tightest-gated benchmark, appropriately, since it's the
  largest realistic thoughtbase size this codebase has benched.
- `indexAllNotes: 500/2000 notes`: no hard ceiling yet (M2) — recommend adding
  one given the 5,000-note benchmark already sets the precedent and the
  infrastructure.
- Regression gate: 2.0× ratio to baseline (default), 1.3× for the four
  benchmarks with demonstrated low variance. **Not per-PR** — weekly/manual
  dispatch only, by explicit, documented, and reasonable design (micro-
  benchmarks flap on shared CI runners; a nightly/weekly baseline-diff catches
  real regressions without false-positiving every PR).

---

## Security Testing

No DAST/penetration testing applies (not a web service); the desktop
analogues are present and, with one new exception (H1), in good shape:

- **Path-traversal sandbox** (`assertSafePath`): `src/main/notebase/**` at a
  solid measured percentage with a dedicated coverage-documentation test
  (`assert-safe-path-coverage.test.ts`, confirmed present, not re-audited line
  by line this session since the prior review already verified it directly).
- **Electron IPC trust boundary**: `security.ts` / `security-helpers.ts` /
  `privileged-sites.ts` each carry their own tight per-file coverage floor in
  `vitest.config.mts` (88-92% lines, 72-88% branches) — genuinely the best-
  gated security surface in the codebase.
- **NEW finding this session (H1)**: `register-shell.ts`'s `SHELL_OPEN_EXTERNAL`
  protocol allowlist — a real defense against a malicious or LLM-coerced
  `file://`/`javascript:` open — has no test coverage at all, and has no
  per-file coverage floor the way its security-adjacent siblings do.
- **Python compute sandbox**: `sandbox-integration.test.ts` runs real macOS
  Seatbelt profiles asserting a sandboxed process cannot open a socket or
  read `~/.ssh/` — confirmed present, now with the `#1931` "assert the gate
  held" backstop.
- **Trust Principle enforcement**: the write guard, `findUnreviewedLLMWrites`
  integrity query, and approval-engine rollback tests are all fatal-under-test
  and asserted on every PR (`tests/main/graph/trust-integrity.test.ts`) — the
  single best-tested invariant in the codebase.
- **Supply chain**: Dependabot (grouped weekly updates) + blocking `pnpm audit
  --prod --audit-level=high` since `#1455`; full-tree audit is
  visibility-only by explicit documented design (remaining advisories live in
  build/dev tooling that never reaches users).
- **Secret handling**: `secret-storage.ts` carries decent statement coverage
  per the prior review; `clipper-config`'s decrypt + lazy-secret-upgrade path
  is one of the three configs CLAUDE.md still lists as hand-rolled (not yet
  migrated to `loadConfigFile`) — this review's new, more specific finding in
  the same subsystem is M1 (`lifecycle.ts`, the module that actually calls
  `ensureClipperSecret()`, has zero test of its own).

---

## Accessibility Testing

Genuinely ahead of most codebases this size, and unchanged in structure since
the last review (confirmed via direct re-inspection):

- **Two-tier approach**: jsdom + axe in the unit suite
  (`tests/renderer/a11y/dialogs.test.ts` — still the only unit-level a11y
  test file, no growth here since the last review) plus **real-Chromium axe**
  in `tests/e2e/a11y.spec.ts` across four surfaces (welcome, workspace, source
  viewer, proposals panel), with color-contrast checking *enforced* (jsdom
  can't do this — it computes no layout — so the e2e tier is where that
  specific check actually lives).
- **Allowlist discipline**: each surface's known-violation allowlist
  (`KNOWN_WELCOME`, `KNOWN_WORKSPACE`, `KNOWN_SOURCE`, `KNOWN_PROPOSALS`) is a
  closed set of rule-ids that fails on any *new* rule appearing — confirmed by
  direct read of `tests/e2e/a11y.spec.ts`. Two of four allowlists carry only
  the documented CodeMirror `scrollable-region-focusable` quirk; this is
  exactly the "fail on regression, name the accepted exceptions" pattern the
  coverage-floor and pattern-ratchet mechanisms use elsewhere in the repo —
  a11y testing is not behind the rest of the suite's rigor here, it's ahead
  of it in this one dimension (real per-surface enforced gates vs. the
  coverage floors' softer aggregate-with-slack shape).
- **Fixed since last review**: the six unconditioned `waitForTimeout(400-500)`
  sleeps before axe scans (prior M8) are gone — confirmed zero hits in
  `a11y.spec.ts` (L2 above).
- **What CLAUDE.md says about a11y ESLint warnings ("not fatal") is
  accurate but incomplete context**: the lint-level a11y warnings are indeed
  non-blocking, but that's not the actual a11y quality gate for this
  codebase — the real gate is the axe-core enforcement described above,
  which *is* blocking (part of the Playwright e2e job in `ci.yml`). A reader
  of CLAUDE.md alone would underestimate this codebase's a11y test maturity;
  worth a one-line cross-reference in CLAUDE.md's a11y-adjacent section
  pointing to `tests/e2e/a11y.spec.ts` so the two facts (lint warnings
  non-fatal, axe gates fatal) sit together.

---

## Cross-Platform Testing

**No browser matrix applies** — this ships one bundled Chromium (whatever
version the pinned Electron release carries), not a website. The desktop
analogues:

### Platform Coverage

- **CI runs macOS only** (`macos-latest`, both the `lint-and-test` and `e2e`
  jobs), for two stated, verified reasons: the chokidar file-watcher tests
  exercise macOS `fsevents` semantics, and the Playwright e2e job needs a
  darwin `.app` bundle.
- **Packaging is arm64-only** (tracked separately as `#962`, x64/universal
  deferred) — this review found no new evidence changing that status.
- **Explicit platform-conditional test code**: `python-kernel.test.ts:429`
  (`process.platform === 'win32' ? it.skip : it`) and
  `sandbox-integration.test.ts` (darwin-only, Seatbelt is macOS-specific) both
  correctly acknowledge the platforms they don't run on rather than silently
  assuming darwin.
- **Windows/Linux are untested at every automated level today** — a scope
  decision, not a defect, since neither is a current release target. If that
  changes, `docs/development.md:198-204` already names the exact place
  (chokidar timing tolerances + a per-platform package target) where
  cross-platform e2e coverage would need to start.

### Device/Resolution Testing

Not applicable in the mobile/tablet sense — this is a desktop-only IDE with
no responsive-breakpoint requirement. No gap identified here; not a dimension
this app needs.

---

## Monitoring and Metrics

### Quality Dashboard (what exists today)

- **Codecov integration**: wired into `ci.yml` (`codecov/codecov-action@v7`,
  `fail_ci_if_error: false`) for trend + per-PR delta visibility. Confirmed
  present; informational only, never blocks a PR — the `pnpm coverage`
  threshold gate remains the hard backstop.
- **Benchmark trend**: `bench.yml`'s weekly run uploads
  `bench-baseline.json` as an artifact for manual review/commit — a
  human-in-the-loop trend mechanism, not an automated dashboard, appropriate
  given the deliberately-not-per-PR cadence.
- **E2E flake rate**: `scripts/e2e-flake-report.mjs` (new since the last
  review per the prior report's mention — confirmed present) aggregates how
  often Playwright's CI retry actually fired, closing the "a test needing a
  retry every run looks identical to one that always passes" blind spot. No
  numeric flake budget is enforced yet (documented as a deliberate,
  not-yet-taken next step — a retry doesn't fail the job today).
- **No dedicated quality dashboard beyond Codecov + GitHub Actions run
  history** — reasonable for a project at this team size; the architecture
  fitness functions effectively serve as a continuously-evaluated dashboard
  of convention health, which is a more actionable substitute than a
  separate metrics UI would be at this scale.

### Key Indicators worth tracking going forward

- **Branch-coverage-vs-file-existence gap** (the pattern this review's H1/H2/
  M1 all instantiate) — recommend a periodic (not necessarily automated)
  check: "files with a test file but branch coverage under 50%," which none
  of the existing fitness functions currently surface (they check "no test at
  all" or "aggregate below floor," not "has a test file that doesn't reach
  most branches").
- **E2E retry rate** (via the new flake-report script) — recommend setting an
  actual numeric budget once a few weeks of data accumulate, per the script's
  own stated next step.

---

## Risk-Based Testing

### Risk Assessment (recalibrated against this session's findings)

| Area | Business criticality | Current test posture | Residual risk |
|---|---|---|---|
| Trust Principle / LLM write guard | Highest — the core safety invariant | Excellent — fatal-under-test, 6-way asserted integrity query | Low |
| Path-traversal (`assertSafePath`) | Highest — file-system safety boundary | Excellent — dedicated coverage-documentation test | Low |
| IPC registrars (23 of 24) | High | Excellent — 94.65% aggregate, most with per-file floors | Low |
| `register-shell.ts` (the 24th) | High (URL/shell-command surface) | **Weak — 27.27% branch, untested security handler** | **Elevated (H1)** |
| CLI packaged-bundle build | Medium-high (ships to every user) | **Weak — proven crash, zero regression test** | **Elevated (C1)** |
| Clipper subsystem | Medium (feature-flagged, defaults off) | Mixed — config/ingest/server tested, lifecycle untested | Elevated but bounded (M1 — off by default limits blast radius) |
| Compute sandbox (Python) | High (arbitrary code execution boundary) | Excellent, with one incomplete corner (module-availability gates, H2) | Low-Medium |
| Renderer UI/composition | Medium (user-visible, but crashes surface immediately in manual use) | Weak — 0% on 66/125 components, documented honestly | Medium (known, tracked, being worked incrementally) |
| Accessibility | Medium | Strong — enforced axe gates on 4 real surfaces | Low |
| Cross-platform (Win/Linux) | N/A today (not a release target) | Untested | N/A — scope decision |

### Test Prioritization

- **Critical**: Trust Principle, path-traversal, approval engine — already at
  full coverage; sustain via the existing fitness functions.
- **High**: `register-shell.ts` and the CLI packaged-build path — this
  review's concrete recommendation is to bring these two up to the same
  standard the other 23 registrars and the rest of the CLI already meet, not
  a new testing initiative.
- **Medium**: clipper lifecycle, benchmark absolute ceilings — bounded blast
  radius (feature-flagged / performance-only), worth closing but not urgent.
- **Low/Scope-excluded**: cross-platform, mobile/responsive — correctly not
  invested in given current release scope.

---

## Continuous Improvement

### Retrospective on this review cycle specifically

The most important continuous-improvement signal in this review is
*process*, not code: the 2026-08-23 review's four findings were **all**
fixed within the following 94 commits, several within the same week, each
with its own new fitness function preventing recurrence
(`e2e-launch-hygiene.test.ts`, `embedding-model-gate.test.ts`, plus the
re-ratcheted coverage floors). That is a functioning continuous-improvement
loop, evidenced rather than asserted. The one place that loop hasn't
(yet) closed a gap is the benchmark tolerance/`budgetMs` finding (M2) — it's
been *partially* addressed (4 of 14 benchmarks tightened) rather than fully,
which is worth naming as the one item that didn't get the same
fix-it-immediately treatment as everything else, possibly because it's a
"good enough, diminishing returns" case rather than a genuine miss.

### Innovation opportunities specific to this codebase's shape

- **Property-based testing** is a plausible fit for the SPARQL/graph-query
  layer and the formatter rule trees (`src/shared/formatter/**`, already at
  96-100% line coverage via example-based tests) — these are exactly the
  "many small pure transformations" shape property-based testing suits, and
  this codebase already has the discipline (fitness functions, ratchets) to
  adopt a new testing style deliberately rather than piecemeal.
- **Mutation testing** (e.g. Stryker) would directly answer the "does a test
  file's existence mean its branches are actually exercised" question this
  review had to answer manually for H1/H2/M1 — worth a spike given how
  precisely that question keeps recurring as this codebase's dominant
  residual defect-escape pattern (see Defect Prevention above).

---

## Team Development

Not independently assessable from the codebase alone (this is a small/
single-maintainer project based on commit authorship patterns observed across
the reviewed git log). The one actionable observation: the CLAUDE.md
convention documentation is unusually rich and consistently kept in sync with
enforcement mechanisms (config-loader migration list, IPC anti-pattern
backlog, coverage-floor rationale comments) — this **is** the training
material a new contributor would need, and it is already better-maintained
than most projects' onboarding docs. No separate training-plan
recommendation is warranted beyond "keep doing this."

---

## Estimated Impact

- **C1 fix** (CLI regression test): closes the single highest-severity
  residual risk — a proven, already-shipped defect class — for an estimated
  3-4 hours of work (matches the architecture review's independent estimate).
- **H1 fix** (register-shell.ts branch coverage): closes a real security-test
  gap for an estimated 3-5 hours, reusing existing test infrastructure
  (`withPlatform` helper already exists in the file).
- **H2 fix** (Python module-gate CI backstop): 1-2 hours, mirrors an existing,
  already-proven pattern (`#1931`) almost verbatim.
- **M1 fix** (clipper lifecycle test): 2-4 hours, standard unit-test work
  against an already-small (78-line) module.
- **Aggregate**: the four highest-priority items in this report total
  roughly **1-1.5 engineer-days**, all independent and parallelizable, none
  requiring new test infrastructure — consistent with this codebase's
  demonstrated cadence of closing a finding like this within a single PR.

---

## Implementation Roadmap

### Days 1-2: Critical + High
- C1: CLI dynamic-import regression test.
- H1: `register-shell.ts` branch coverage (SHELL_OPEN_EXTERNAL +
  cross-platform terminal-spawn cases).
- H2: Python module-gate CI backstop (or `pip install` step).

### Days 3-5: Remaining High + Medium
- H3: sequence `SourcesPanel.svelte`'s coverage-floor increase with its
  already-planned architecture-review split.
- M1: `clipper/lifecycle.ts` unit test.
- M3: fifth pattern-ratchet (`GRAPH_QUERY`'s in-band `error?`).

### Week 2: Medium cleanup + monitoring
- M2: extend `budgetMs` to the two uncapped `indexAllNotes` benchmarks.
- L1/L2: no action required beyond the note that they're understood, not
  regressions.
- Consider a mutation-testing spike (Continuous Improvement) as a longer-term
  investment given how often "test file exists, branch doesn't" recurred in
  this specific review.

---

## Success Metrics

- **C1/H1/H2 closed**: verified by re-running `pnpm coverage` and confirming
  `register-shell.ts` branch coverage rises materially above 27.27%, and
  `tests/cli/electron-free.test.ts` gains an assertion that fails on a
  reintroduced dynamic-import chunk-splitting regression.
- **Coverage floors stay tight**: re-ratchet within 3-8 points of measured at
  the next natural checkpoint (this review confirms the `#1932` ratchet holds
  today; the metric to watch is whether slack re-accumulates over the next
  three weeks the way it did between the 2026-08-01 and 2026-08-23 reviews).
- **Zero net-new anti-pattern instances**: `pattern-ratchets.test.ts` and
  `file-size-budgets.test.ts` continue passing on every PR (already true;
  the metric is sustaining it, not achieving it).
- **Full suite stays green and fast**: `pnpm test` under ~90s wall time (today
  73.58s), `pnpm coverage` under ~2 minutes (today 109.41s) — both have
  comfortable headroom before becoming a developer-experience drag at current
  growth rates (~40 test files / 3 weeks).
