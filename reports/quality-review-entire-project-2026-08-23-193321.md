# Quality Assurance Review Plan
Generated: 2026-08-23 19:33:21
Scope: /Users/davegriffith/minerva (entire project)

## Executive Summary

Minerva's *quantity* of testing is not in question: 621 vitest files / 6,745 tests, all
passing, in 70 seconds; six architecture fitness functions; a Playwright Electron suite; a
benchmark regression gate; a blocking supply-chain audit. The refactoring review an hour
ago already catalogued the structural debt. This review looked at what a refactoring lens
and a coverage percentage both miss — whether the tests that exist can actually fail,
whether the gates that exist actually run, and whether the layers claimed to cover
something do.

Four findings drive everything below.

**1. There is a hole in the middle of the pyramid, and the documentation papers over it.**
`docs/development.md:184-186` states that "some surfaces (notably `App.svelte`, the
composition root) are covered by the Playwright e2e journeys rather than unit tests." That
is not what the e2e journeys do. `tests/e2e/journeys.spec.ts:4-6` and
`tests/e2e/happy-paths.spec.ts:26` both say plainly that they drive `window.api` inside
`win.evaluate(...)` *instead of* clicking the UI, "rather than simulating CodeMirror
keystrokes / panel clicks, which are brittle and just re-test the component suite." So the
6 journey/happy-path tests exercise the preload bridge and the main-process pipeline —
genuinely valuable — and touch zero App.svelte code paths. Measured: App.svelte is **0%**
(593 executable lines), and **66 of 125 Svelte components (3,418 of 8,760 executable
component lines) are at 0%**. Unit tests cover the *extracted* `lib/app/*-ops` factories;
e2e covers the *bridge below* the UI; nothing covers the UI itself except a11y/focus-trap
clicking a file and opening two panels. `UnlinkedMentions` (#1899) is not an anomaly — it
is the one place the gap became visible, because someone happened to write a test for a
component wired to nothing. The rest of that layer has no test at all, so nothing can
reveal it.

**2. The first e2e test boots against the developer's real Electron profile, and its core
assertion is false on any machine that has used the app.** `tests/e2e/smoke.spec.ts:70`
launches with `args: [projectRoot]` and **no `--user-data-dir`** — the only one of the six
specs' nine launch sites that omits it (the second test in the same file, `:167`, does it
correctly). So it inherits `~/Library/Application Support/Minerva/`, `src/main/session.ts:13`
restores the saved window, and the assertion at `:111` — `expect(getByRole('button', { name:
'Open Thoughtbase' })).toBeVisible()` — fails. Verified on this machine: that profile's
`session.json` contains `rootPath: "/Users/davegriffith/philosophy_of_engineering"`. The
file header at `:19-20` states the premise it depends on ("no project open by default — a
fresh launch yields the 'Open Thoughtbase' shell"), which is true only on a clean CI runner.
This is the exact inverse of the flake everyone worries about: **green in CI, red locally,
and it mutates the developer's real profile while running.** One line fixes it.

**3. Two gates are advertised but do not run where it counts.** `pnpm coverage` in CI never
runs `fetch:model` (the fetch is hooked to `predev`/`prebuild`/`prebuild:e2e` only,
`package.json:48-50`; there is no `pretest`), and `resources/models/**/*.onnx` is gitignored
(`.gitignore:70`), so `haveModel` is false on every CI checkout and **12 tests across 4
files silently skip in CI** — the entire real-inference embeddings surface plus help-docs
semantic search. They report as *skipped*, not failed, and `src/main/embeddings/**` has no
coverage floor of its own, so nothing notices. Separately, `pnpm lint:fonts` runs *only* in
`.githooks/pre-push` and appears nowhere in `.github/workflows/` — a `--no-verify` push, a
fork PR, or a checkout where `pnpm install` never set `core.hooksPath` bypasses it entirely.

**4. The coverage floors have drifted into 10–30 points of dead slack, and the slackest one
guards the trust path.** The floors were set "~10 points below the measured-at-floor-time
numbers" and never re-ratcheted as coverage improved. Measured today: `src/main/llm/**` —
the approval engine, per CLAUDE.md the most important area in the system — sits at **85.1%
lines against a floor of 55**, +30.1 points of headroom, and 70.5% branches against 45.
`src/main/git/**` is +26.8. `src/shared/**` is +25.9 *and has no branch floor at all*
despite measuring 86.1%. A large fraction of the trust-path suite could be deleted and every
gate in the repo would stay green. Note the internal inconsistency: `pattern-ratchets` and
`file-size-budgets` hold *exact* numbers and fail when the count moves in either direction —
the strictly better design, already in this repo — while the coverage floors, which guard
the more important thing, use one-directional soft floors.

What is genuinely strong, stated so the above is read in proportion: the architecture
fitness functions are the best-designed I have reviewed — every one carries an explicit
anti-vacuity test ("a broken scan would pass vacuously",
`ipc-registrar-coverage.test.ts:113`; `no-cycles.test.ts:72`; `pattern-ratchets.test.ts:186`)
and self-documents its own blind spots in the header. The write guard is real, fatal under
test, and covered by both a unit and a wired-integration file. The approval engine's tests
assert rollback, not just success. Snapshot over-reliance does not exist (4 snapshots in
12,837 assertions, all shape-drift). Zero literal `.skip`/`.only`/`.todo`, zero
`test.concurrent`, zero `Math.random`, zero external network calls, zero fixed ports, and
fake-timer restore hygiene is 12-for-12.

---

## Quality Metrics

Every number below was produced by a command run during this review. Nothing is estimated.

### Suite size and execution

| Metric | Value | How measured |
|---|---|---|
| Vitest test files | 621 | `pnpm coverage` summary |
| Vitest tests | 6,745 (all passed, 0 failed, 0 skipped **locally**) | same |
| `pnpm test` wall time | **70.43 s** (`real 71.20`) | `/usr/bin/time -p pnpm test` |
| `pnpm coverage` wall time | **105.10 s** | `/usr/bin/time -p pnpm coverage` |
| Vitest CPU time | 479 s user / 91 s sys across workers | `time` output |
| Playwright e2e specs / tests | 6 files / **15 tests** | `grep -c '^test(' tests/e2e/*.spec.ts` |
| `it`/`test` blocks / `expect()` calls | 6,198 / 12,837 | brace-matching scan over `tests/` |
| Test files by tree | main 301 · renderer 177 · shared 121 · scripts 6 · cli 6 · architecture 6 · preload 2 · clipper 2 | `find tests -name '*.test.ts' \| cut -d/ -f2 \| uniq -c` |
| Test LOC / source LOC | 82,361 / 127,894 (0.64 : 1) | `find … -exec cat {} + \| wc -l` |
| Benchmarks | 6 `*.bench.ts` | `find tests -name '*.bench.ts'` |
| Vitest pool config | **defaults** — pool `forks`, `isolate: true`, `fileParallelism: true`, `testTimeout: 5000` | `vitest.config.mts` sets none of these |

### Coverage — measured, whole repo

`pnpm coverage` completed successfully (exit 0, all floors passed). v8 provider,
`src/**/*.{ts,svelte}`:

```
Statements   : 69.01% ( 29719/43060 )
Branches     : 61.80% ( 14247/23051 )
Functions    : 61.59% (  5585/9068  )
Lines        : 72.34% ( 24238/33503 )
```

Caveat on the local number: measured on a machine where `resources/models` and Python 3 are
present, so it **includes** the 12 model-gated tests and the ~15 Python sandbox tests that
CI skips. The CI figure is lower by an unmeasured amount (Finding C2). I did not reproduce
a modelless run.

### Coverage floors vs. measured — the slack table

Computed by parsing `coverage/lcov.info` and aggregating `LF/LH`, `BRF/BRH`, `FNF/FNH` per
glob, then differencing against `vitest.config.mts`. These are glob aggregates, **not** the
v8 text report's per-directory rows — those exclude subdirectories and read misleadingly
high (`src/main/graph` shows 96.99% as a directory row but 94.2% as the `src/main/graph/**`
glob).

| Glob | Lines % | floor | slack | Branch % | floor | slack | Funcs % | floor |
|---|---|---|---|---|---|---|---|---|
| `src/main/llm/**` | 85.1 | 55 | **+30.1** | 70.5 | 45 | **+25.5** | 86.4 | 58 |
| `src/main/git/**` | 90.8 | 64 | **+26.8** | 80.7 | 66 | +14.7 | 81.1 | 62 |
| `src/shared/**` | 95.9 | 70 | **+25.9** | 86.1 | *none* | — | 96.6 | 70 |
| `src/renderer/**` | 57.8 | 42 | +15.8 | 46.8 | 34 | +12.8 | 50.6 | 40 |
| `src/main/graph/**` | 94.2 | 80 | +14.2 | 75.9 | 62 | +13.9 | 93.2 | 80 |
| `src/main/compute/**` | 87.9 | 75 | +12.9 | 73.9 | 60 | +13.9 | 86.2 | 74 |
| `src/main/notebase/**` | 92.2 | 80 | +12.2 | 76.5 | 65 | +11.5 | 93.6 | 78 |
| `src/main/publish/**` | 93.4 | 82 | +11.4 | 76.2 | 65 | +11.2 | 92.4 | 82 |
| `src/main/history/**` | 93.3 | 82 | +11.3 | 88.1 | 75 | +13.1 | 100.0 | 88 |
| `src/main/ipc/**` | 75.8 | 65 | +10.8 | 61.9 | 51 | +10.9 | 76.5 | 66 |
| `src/main/sources/**` | 89.8 | 80 | +9.8 | 75.3 | 65 | +10.3 | 91.0 | 80 |

The two best-ratcheted areas (`sources`, `ipc`, ~+10) are the two most recently touched.
The rest have drifted.

### The lowest-covered modules that matter

From the v8 text report. Excluding files correctly untested by design —
`src/preload/preload.ts` at 0.27% is deliberate, and `vitest.config.mts` explains why the
full-surface snapshot contract test is its right gate rather than a line floor.

| Module | Stmts | Branch | Note |
|---|---|---|---|
| `src/renderer/App.svelte` | **0** | 0 | 593 executable lines; the composition root |
| `src/main/ipc/helpers.ts` | **6.55** | **0** | owns `withRootPath`/`withRootPathOr` + the reindex fan-out — C3 |
| `src/main/window-manager.ts` | 6.45 | 5.14 | the watcher reindex path |
| `src/main/llm/tools/set-properties.ts` | **1.85** | 0 | an LLM graph-write tool |
| `src/main/llm/tools/propose-compute.ts` | 3.57 | 0 | |
| `src/main/skills/register.ts` | 5.26 | 0 | |
| `src/main/notebase/templates.ts` | 5.88 | 0 | |
| `src/main/llm/tools/ask-user.ts` | 5.55 | 0 | |
| `src/main/llm/tools/query-graph.ts` / `search-notes.ts` | 9.09 | 0 | |
| `src/main/llm/tools/get-properties.ts` | 12.5 | 0 | |
| `src/main/ipc/register-conversation-drafts.ts` | 21.22 | 16.10 | tracked as **#1900** |
| `src/main/graph/queries/notes.ts` | 22.91 | 13.63 | |
| `src/main/ipc/register-proposals.ts` | **25** | **0** | the approval-queue IPC — C1 |
| `src/main/ipc/register-refactor.ts` | 26.78 | 33.33 | tracked as **#1901** |
| `src/main/menu.ts` | 28.08 | 33.33 | the native menu, 983 lines |
| `src/renderer/lib/voice/**` | 22.54 | 8.65 | |

### Test-quality indicators

| Indicator | Count | Command |
|---|---|---|
| Literal `it.skip` / `describe.skip` / `.only` / `.todo` / `.fails` | **0** | `rg -n "\b(it\|test\|describe)\.(skip\|only\|todo\|fails)\s*\("` |
| Environment-gated `cond ? describe : describe.skip` | 12–13 sites | `rg -n "\?\s*describe\s*:\s*describe\.skip"` |
| `test.concurrent` | **0** | `rg -n "\.concurrent\b" tests` |
| `toMatchSnapshot` / `toMatchInlineSnapshot` | 4 / 0 | `rg -o "toMatchSnapshot("` |
| Bare `toHaveBeenCalled()` vs `toHaveBeenCalledWith(` | 641 / 560 | `grep -ro` per form |
| …in `tests/main/ipc` | 148 / 200 | scoped |
| …in `tests/main/llm` | 11 / 6 | scoped |
| `expect.assertions(n)` / `expect.hasAssertions()` | **0** | `grep -r` |
| Test files using `vi.mock` | 122 of 621 (20%); 378 calls | `grep -rl "vi\.mock("` |
| Svelte components with 0% coverage | **66 of 125** (3,418 / 8,760 exec lines) | lcov parse |
| Component test files | 41 (for 125 components) | `ls tests/renderer/components/*.test.ts` |

### Determinism indicators

| Indicator | Count | Command |
|---|---|---|
| `Math.random` in tests | **1** — and it is a comment saying not to use it | `rg -n "Math\.random" tests` |
| `crypto.randomUUID` in tests | **0** | `rg -n "randomUUID" tests` |
| Fake-timer files not restoring real timers | **0 of 12** | `comm -23` on `useFakeTimers` / `useRealTimers` file lists |
| Tests contacting an external host | **0** (all 9 `fetch` sites are loopback or non-network) | `rg -n "await fetch\(\|fetch\('http" tests` |
| Tests binding a fixed port | **0** (all `port: 0`) | `rg -n "port:\s*[0-9]+" tests \| grep -v "port: 0"` |
| Unit-test writes into the repo tree | **0** (one `beforeAll` runs a real `vite build`) | `rg` for `cwd()`/`__dirname` writers |
| Tests reading the real `~/.minerva/` | **0** — all three production readers take the path as a parameter | `rg -n "os\.homedir" src tests` |
| Real wall-clock sleeps | 16 sites; 6 in `watcher.test.ts`, 4 in `search/index.test.ts` | `rg -n "setTimeout" tests` |
| `waitForTimeout` in e2e | 7, all unconditioned "let it settle" | `rg -n "waitForTimeout" tests/e2e` |
| `vi.stubEnv` (auto-restoring) | **0** — all 11 env mutations are raw assignment | `rg -n "vi\.stubEnv" tests` |
| `TZ` pinned anywhere | **no** | `grep -rn TZ vitest.config.mts package.json .github/workflows/ci.yml` |
| Leaked temp dirs in `$TMPDIR` | **4,065** (3,358 from one file, 1,184 created today) | `ls -d $TMPDIR/minerva-* \| wc -l` |
| Leaked unix sockets from **production** code | 319 | `ls $TMPDIR/minerva-rpc-*.sock \| wc -l` |

---

## Test Coverage Analysis

**Shape, not just level.** Coverage is high where the code is pure and file-backed, and
collapses where the code is glue:

- `src/shared/**` at 95.9% lines / 86.1% branches — excellent; formatter rule trees 96–100%.
- Main-process domain modules (graph, publish, history, notebase, sources) at 89–94% lines,
  mostly through **real-filesystem integration tests**: 184 of 621 test files (29.4%) create
  a temp project. That is the right shape for this app and it is the strongest part of the
  suite.
- The IPC registrar layer is at 75.8% lines / 61.9% branches, and its coverage is *wiring*
  coverage — 16 test files `vi.mock` the helpers module (C3).
- The renderer is at 57.8% lines, but that aggregate is carried by well-tested `lib/`
  helpers (`sources` 98.5%, `refactor` 94.7%, `command-palette` 97.2%). The component layer
  itself is 39.6% (3,465 / 8,760 exec lines), with 66 files at exactly zero.

**Branch coverage is the weaker axis everywhere** — 61.8% repo-wide vs 72.3% lines. Every
per-area floor except `git` sits 10–14 points below measured branches, and `src/shared/**`
has no branch floor at all. Branches are where error paths live, so this is the axis that
corresponds most directly to "did we test the failure case."

**What the numbers do not tell you.** `src/main/graph/health-checks.ts` measures 93.25%
statements and is genuinely well tested — by six *other* files. Its namesake test file is
fake (C4). Coverage cannot distinguish those, which is the argument for the next section.

---

## Testing Pyramid — actual shape

| Layer | Files | Tests | Assessment |
|---|---|---|---|
| Pure unit (`tests/shared`) | 121 | — | Strong. 95.9% lines on `src/shared`. |
| Main-process integration (real temp fs) | 184 across the suite | — | Strong, and the right choice for a local-first file app. |
| Main-process wiring (mocked IPC registrars) | 24 registrar tests, 16 mocking `helpers` | — | Verifies channel→module wiring, not the wiring's semantics (C3). |
| Renderer store/ops | 177 files incl. 41 component | — | Ops factories well covered (`source-ops` 99.5%, `note-ops` 91.4%); components 39.6%. |
| Renderer UI / composition | — | — | **Empty.** App.svelte 0%, 66 components 0%. |
| E2E (Playwright + Electron) | 6 | **15** | Real app boot, real IPC, but deliberately **bypasses the UI** via `window.api`. |

This is not a pyramid; it is an hourglass with the waist missing. The 450:1 vitest-to-e2e
ratio is fine — but the layer e2e is supposed to backstop (the UI) is precisely the layer it
declines to touch, and `docs/development.md` asserts otherwise.

The three specs that *do* drive real UI are `a11y.spec.ts` (clicks a file, a source, a
proposal), `focus-trap.spec.ts` (one command-palette Tab-trap test), and `smoke.spec.ts`
(asserts the welcome heading). Between them they are the entire UI-level regression net for
125 components.

---

## Test Quality Assessment

I audited assertion strength directly and via a scan of all 6,198 `it`/`test` blocks and
12,837 `expect()` calls. **The headline is that this suite is much better than the usual
failure modes predict**, and that belongs on the record before the specific criticisms:

- Zero-assertion tests: 15 candidates, **0 genuine** — all assert via `expect.fail()` (the
  architecture ratchets) or via helper assertion functions (`expectNoA11yViolations` in
  `tests/helpers/axe.ts`, `expectMirrorMatchesRebuild` at
  `tests/main/graph/n3-mirror-incremental.test.ts:76`).
- Conditional assertions: 48 candidates, **47 are TypeScript discriminated-union narrowing**
  where the discriminant is asserted first (`tests/main/sources/tables.test.ts:34-37` is the
  model). Exactly one is genuinely vacuous.
- `not.toThrow()`: 33 sites, 30 paired with a positive `toThrow` sibling in the same
  describe. `tests/main/graph/write-guard.test.ts` alternates silent/throws/silent
  deliberately.
- `toBeDefined()`: 67 uses, almost all TypeScript narrowing guards followed by hard
  assertions.
- Snapshots: 4 total, all shape-drift (preload surface, IPC channel set, docs chunk ids, CSL
  output). **No behavioral concern rests on a snapshot alone.**

The four areas CLAUDE.md flags as highest-risk are the *best*-tested parts of the suite.
`tests/main/llm/approval.test.ts` asserts the write is absent until approval and that a
mid-bundle failure rolls back to the pre-image (`:185`, `:252`, `:295`).
`tests/main/graph/write-guard-wired.test.ts` proves the guard is wired into the real
`parseIntoStore`/`removeMatchingTriples`, asserts the trusted-context exemption, and
regex-matches the failure message. `tests/main/graph/n3-mirror-incremental.test.ts` compares
the incremental mirror against an independent from-scratch rebuild — the opposite of
tautological.

The weaknesses are specific rather than systemic: C4 and M1–M4 below.

One systemic softness worth naming: **zero `expect.assertions(n)` across 6,198 tests**,
alongside 199 `waitFor(` sites. An assertion that silently never executes inside a `waitFor`
callback or an unawaited promise branch is not currently detectable. Today's tests appear
clean; this is the mechanism by which a *future* weak test would hide.

---

## Quality Gates — CI vs. local

**Enforced on every PR** (`.github/workflows/ci.yml`, three parallel jobs):

- `pnpm lint` — `tsc --noEmit` ∥ `svelte-check --threshold error` ∥ `eslint .` (parallel,
  `scripts/lint.mjs`); eslint carries the renderer data-flow `no-restricted-syntax` rule.
- `pnpm coverage` — full suite **plus** all per-glob thresholds. Hard gate.
- `pnpm audit --prod --audit-level=high` — **blocking** since #1455.
- `pnpm test:e2e` — `electron-forge package` + Playwright, separate job.
- Implicitly: all 6 architecture fitness functions + `tests/shared/ipc-contract-ratchet.test.ts`,
  since they are ordinary vitest files.

**Not enforced in CI:**

| Gate | Where it runs | Consequence |
|---|---|---|
| `pnpm lint:fonts` | `.githooks/pre-push` **only** | Bypassed by `--no-verify`, `SKIP_HOOKS=1`, fork PRs, or any checkout that never ran `pnpm install`. Zero CI coverage. |
| `pnpm bench:check` | `bench.yml` — `workflow_dispatch` + weekly cron | Perf regressions land unnoticed for up to 7 days, then surface with no bisect signal. Tolerance is **2.0×** — a benchmark may get 99% slower and pass. |
| `pnpm audit` (full tree) | CI, `continue-on-error: true` | Visibility only, by documented design. |
| `pnpm check:docs` | Nowhere | Docs-generation drift is caught only indirectly by `tests/scripts/help-docs-corpus-staleness.test.ts`. |
| `pnpm test` at its own 5 s timeout | Nowhere — CI runs only `pnpm coverage` (30 s) | See M7. |
| Tests at all | Not in the pre-push hook | The hook runs lint only, so a red suite can be pushed. Deliberate, but worth restating: **the local gate does not run tests.** |

**Ratchet gameability.** I probed whether the fitness functions can be trivially satisfied.
Mostly they cannot, and the reason is that their authors already asked the question — every
one carries a vacuity floor. What remains:

- `pattern-ratchets.test.ts` is lexical and **self-documents** its blind spots
  (`catch { const x = null; return x; }` is not counted). Fair.
- `file-size-budgets.test.ts` measures `src/` only. Splitting a 700-line file into two
  349-line files passes and is the *intended* outcome; but nothing budgets `tests/`, where 9
  files already exceed 600 lines (largest: `conversations-store.test.ts` at 823).
- `ipc-registrar-coverage.test.ts` passes on mere import — **already tracked as #1894**. Its
  own header honestly says so.
- `store-ownership.test.ts` cannot distinguish a real store from a passthrough — CLAUDE.md
  already says so.

The gap the ratchets genuinely leave: **CLAUDE.md lists five IPC anti-patterns and
`pattern-ratchets.test.ts` covers two** (H2).

---

## Non-Functional Testing

### Performance

Real, and better than most projects this size: 6 `*.bench.ts` files (graph index/query, save
pipeline, embedding pooling, N3 cache/cold-rebuild) with a **committed baseline**
(`tests/main/bench-baseline.json`) and a diff gate (`scripts/bench-check.mjs`) supporting
both a ratio tolerance and an optional absolute `budgetMs`. The desktop analogue of load
testing — large-thoughtbase indexing — is directly benched: `indexAllNotes` at 500 / 2,000 /
5,000 notes (1,181 ms at 5k).

Two weaknesses, both stated honestly in the workflow's own comments and both real: the gate
runs weekly/on-demand rather than per PR (deliberate — micro-benchmarks flap on shared
runners), and the tolerance is **2.0×**, so a 1.9× slowdown in `indexAllNotes: 5000 notes`
passes. Every `budgetMs` in the committed baseline is `null`, so the absolute-ceiling
mechanism that would catch exactly that is built and unused.

### Security testing

Not a web service, so no DAST/penetration testing — the desktop analogues are present and
mostly in good shape:

- **Path-traversal sandbox** (`assertSafePath`): `src/main/notebase/**` at 92.2% lines, with
  a dedicated `tests/main/notebase/assert-safe-path-coverage.test.ts` that documents why
  `vi.spyOn` can't be used and why the traversal-rejection tests are equivalent.
- **Electron trust boundary**: `security.ts` 100%, `security-helpers.ts` ~100%,
  `privileged-sites.ts` 96.4% — each with its own per-file floor.
- **Python compute sandbox**: `tests/main/compute/sandbox-integration.test.ts` runs real
  Seatbelt profiles and asserts a sandboxed process cannot open a socket, cannot write
  `~/mv_sandbox_evil.txt`, and cannot read `~/.ssh/`. Excellent tests — with two caveats
  (H3 for the silent skip, M6 for the fact that they write into the developer's real
  `$HOME`).
- **The Trust Principle** is gated three ways: the fatal-under-test write guard, the
  `findUnreviewedLLMWrites` integrity query asserted six ways in
  `tests/main/graph/trust-integrity.test.ts`, and the approval-engine rollback tests.
- **Supply chain**: Dependabot (grouped weekly) + blocking `audit:prod`.

Gap: **secret handling is thinly tested.** `src/main/secret-storage.ts` is at 90.5%
statements but `src/main/clipper/lifecycle.ts` is 13.6%, and `clipper-config`'s decrypt +
lazy-secret-upgrade path is one of the three configs CLAUDE.md lists as still hand-rolled.

### Accessibility

Genuinely well handled and better than the norm. Two tiers: jsdom + axe in the unit suite
(`tests/renderer/a11y/dialogs.test.ts`, `color-contrast` disabled since jsdom computes no
layout), and **real-Chromium axe** in `tests/e2e/a11y.spec.ts` across four surfaces (welcome,
workspace, source viewer, proposals panel) with color-contrast *enforced*. The theme is
pinned deterministically before the scan, with a documented reason (`bootDarkTheme`,
`:100-113`). Baselines are per-surface rule-id allowlists that fail on a NEW rule, and three
of four allowlists are empty or hold only the known CodeMirror
`scrollable-region-focusable` quirk. This is the discipline the coverage floors should copy.
The one blemish: 6 unconditioned `waitForTimeout(400-500)` sleeps before the axe scans (M8).

### Compatibility — the desktop analogue of a browser matrix

**Not applicable as written.** No browser matrix: this ships one Chromium, the one bundled
with its pinned Electron. The real analogues:

- **Platform matrix: none.** Every CI job that runs the app is `macos-latest`, for
  documented reasons (the chokidar watcher tests exercise macOS fsevents semantics; the e2e
  job needs a darwin `.app`). Packaging is arm64-only — **tracked as #962**.
- Windows/Linux are untested at every level, and the code knows it:
  `tests/main/compute/python-kernel.test.ts:419` carries
  `process.platform === 'win32' ? it.skip : it`, and `sandbox-integration.test.ts` is
  darwin-only. Whether that is a gap depends on whether those platforms are targets; today
  they are not.
- **Electron/Chromium drift** is covered by the smoke test's stated purpose
  ("Electron-major-bump shape changes, CSP regressions strict enough to block bootstrap")
  and by `tests/e2e/bundle-budget.spec.ts`.

### Load / throughput / concurrency

**Not applicable.** Single-user desktop app; no request rate, no concurrency model beyond
Electron's three processes, no server to saturate. The meaningful analogue — behaviour as a
thoughtbase grows — is the `indexAllNotes` bench series, which is the right substitute and
exists.

---

## Flakiness and Determinism

**Measured stability:** two consecutive full local runs (`pnpm coverage` then `pnpm test`)
both reported 621/621 files and 6,745/6,745 tests passing, identically. Weak evidence — two
runs, one machine — but it is the evidence there is.

**The structural picture is unusually disciplined.** Cross-*file* isolation is sound:
vitest's default `forks` pool with `isolate: true` gives every file a fresh module registry,
so the renderer's module-level store singletons cannot leak between files. `test.concurrent`
is unused, so within a file everything is sequential. Randomness, network, ports, and
repo-tree writes are all clean (see the determinism table above).

The real exposure is in five places:

**1. Process-level state survives `isolate`.** `tests/main/llm/settings.test.ts:53-56`
deletes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY` in `beforeEach`; its
`afterEach` (`:59-61`) removes the temp dir and **never restores them**. Fork workers are
reused across files, so every subsequent file on that worker sees them unset. The codebase
already knows this hazard and documents it — `tests/main/publish-git-auth.test.ts:17-32`
snapshots and restores with the comment *"process.env is worker-global, so snapshot +
restore to avoid leaking the deletions into other test files that share the worker."*
`vi.stubEnv` (which auto-restores) is used **zero** times; all 11 env mutations are raw
assignment.

**2. Fixed wall-clock sleeps on a real filesystem watcher.**
`tests/main/notebase/watcher.test.ts` is the only test driving real chokidar
(no `usePolling`, no `awaitWriteFinish`), has 19 tests, **no timeout override**, and burns
real time three ways: a 50 ms `afterEach` sleep (`:68`) × 19; fixed negative-assertion
sleeps at `:203` (400 ms), `:242` (300 ms), `:451` (400 ms); and a *positive* 200 ms
dependency on a production buffer expiring at `:270`. Its polling helper (`:39-50`,
`waitFor(pred, 4000)`) is the right pattern and the file header at `:11` explicitly
documents that fixed sleeps flaked under parallel load in #344 — but the 4,000 ms default
sits inside vitest's 5,000 ms test timeout, so the test dies before the helper produces its
diagnostic.

**3. Negative assertions after a real sleep — the false-red shape.**
`tests/main/search/index.test.ts:91-92` does `await sleep(DEBOUNCE_MS / 2)` then
`expect(fs.existsSync(indexFilePath(root))).toBe(false)`. If the sleep overshoots the 200 ms
debounce on a loaded runner, the write has landed and the test fails. Same shape twice more
at `:103-109`. (The `:129-130` variant fails safe.)

**4. Wall-clock dates with no TZ pin.** `tests/renderer/source-display.test.ts:20-26`
computes `isoDaysFromNow()` from `new Date()` at setup and `:63` asserts
`isOverdue(isoDaysFromNow(0)) === false`, where `isOverdue` reads the clock again at assert
time — a run straddling local midnight goes red. `:72-76` drives a "omit the year for a
current-year date" assertion off `new Date().getFullYear()` — same class at new year. There
is **no `TZ` pin** in `vitest.config.mts`, `package.json`, or `ci.yml`; only
`tests/renderer/refactor/extract.test.ts:17-27` forces a zone, and it does so correctly.
Only 3 files use `vi.setSystemTime` — the codebase's own good pattern, just not applied
here.

**5. Shared mutable `beforeAll` fixtures.** 25 files have `beforeAll` with no `beforeEach`.
The sharpest is `tests/main/sources/tables-markdown.test.ts`: one DuckDB instance created at
`:20-24` and mutated by every test (`registerMarkdownTable`, `reregisterNoteTables` ×5,
`unregisterNoteTables`, `registerCsv`), plus a module-global `onCsvTableCollision` handler
registered inside the `:91` test and **never unregistered**, so it stays live for `:115` and
anything added later. Table names happen to be disjoint today; nothing enforces that.

**Flake handling is asymmetric and untracked.** Playwright retries twice in CI
(`playwright.config.ts`, `retries: process.env.CI ? 2 : 0`) with the honest rationale that
"Electron boot is inherently flaky," and relies on `reporter: 'list'` printing "retry #N"
lines for visibility — but nothing aggregates them, sets a budget, or fails on repeated
retries. An e2e test could retry on every PR indefinitely and no signal would escape the
log. Vitest has no retry at all — the right default, but the two suites now have opposite
flake policies and neither is measured.

---

## Developer Feedback Loop

A genuine strength; preserve it. 6,745 tests in **70 seconds** is an excellent inner loop
for 128 kLOC, and `pnpm test:watch` on it is interactive. `pnpm lint` runs its three checks
in parallel (`scripts/lint.mjs`). The pre-push hook catches the slow-to-discover class
(type/template drift) locally before burning a macOS runner.

Two asymmetries: the local gate runs lint but not tests (M7), and `pnpm test` / `pnpm
coverage` enforce different timeouts while CI runs only the latter (M7).

---

## Findings

Grouped by severity. Items already filed by the earlier refactoring review are
cross-referenced by issue number and **not** re-filed.

### Critical

- [ ] **C1 — `register-proposals.ts`: the approval gate's own IPC surface is 25% covered
      with 0% branches.** `src/main/ipc/register-proposals.ts` (52 lines: `PROPOSAL_LIST`,
      `_DETAIL`, `_APPROVE`, `_REJECT`, `_EXPIRE`, `_NOTIFY_ARRIVAL`) is imported by exactly
      one test file — `tests/main/ipc/no-project-contract.test.ts:131` — which asserts only
      its no-project behaviour. There is **no test that exercises the approve path through
      the IPC handler**. `PROPOSAL_APPROVE` is the single channel through which a human
      confirms an LLM write; it is the enforcement point of the Trust Principle, and
      `ipc-registrar-coverage.test.ts` reports it as "covered." CLAUDE.md's checklist asks
      "Are there tests that verify the approval gate cannot be skipped?" — the engine has
      them (`tests/main/llm/approval.test.ts`), the channel does not. *(Distinct from #1900,
      which covers the six conversation-draft channels in `register-conversation-drafts.ts`.)*

- [ ] **C2 — 12 tests silently skip in CI because the embedding model is never fetched.**
      `resources/models/**/*.onnx` is gitignored (`.gitignore:70`); `fetch:model` is hooked
      only to `predev`/`prebuild`/`prebuild:e2e` (`package.json:48-50`) and **there is no
      `pretest`**; the CI `lint-and-test` job runs `pnpm install` → `pnpm lint` → `pnpm
      coverage`, none of which trigger it. So `haveModel` is false on every CI checkout and
      these skip silently: `tests/main/embeddings/wasm-embedder.test.ts` (4 tests, whole
      file), `tests/main/embeddings/wordpiece.test.ts` (3),
      `tests/main/help-docs/search.test.ts` (3),
      `tests/main/embeddings/vector-store.test.ts:228` (2, the `realDescribe` block). They
      report *skipped*, not failed. `src/main/embeddings/**` has no coverage floor of its
      own, so it falls under the 45% global backstop and nothing notices. Fix: add a
      `pretest`/`precoverage` hook or a CI step, **and** assert that the gated suites
      actually ran — the anti-vacuity pattern the architecture tests already use.

- [ ] **C3 — `src/main/ipc/helpers.ts` is 6.55% statements / 0% branches; 16 test files mock
      it and one reimplements its semantics.** This module owns `withRootPath` /
      `withRootPathOr` / `withRootPathWin` — the entire #1631 no-project convention that
      `vitest.config.mts` says the `src/main/ipc/**` branch floor exists to protect ("this
      layer owns the `withRootPath` vs `withRootPathOr` decision, so a #1631 no-project
      conflation now regresses into a test failure instead of passing in silence"). It also
      owns `reindexFile` (`:80`), the graph+search+vectors fan-out whose duplication caused
      the stale-embeddings drift the refactoring review found. The aggregate floor is met by
      the *registrars*; the module implementing the policy has zero branch coverage.
      `tests/main/ipc/no-project-contract.test.ts:49-72` mocks the module and re-implements
      `withRootPath`/`withRootPathOr` inside the mock, then asserts against that
      re-implementation — so a bug in the real `rootPathFromEvent` → `winFromEvent` →
      `getRootPath(win.id)` chain is invisible to all 24 registrar tests. Fix: a direct unit
      test of the real wrappers and `reindexFile`, which needs no Electron beyond a fake
      event object.

- [ ] **C4 — `tests/main/graph/health-checks.test.ts` is a fake test file.** All 41 lines, 3
      tests, **zero imports**. It declares array and object literals and asserts on them:
      `const severities = ['info','warning','concern']; expect(severities).toContain('info')`
      and `expect(inspection.id).toBeDefined()` on an object literal declared two lines up.
      It cannot fail. It carries the exact filename of a real production module
      (`src/main/graph/health-checks.ts`, 572+ lines) so it reads as that module's test in
      every listing and every review. *No coverage is lost* — health-checks.ts is at 93.25%
      via six other files — which is precisely why this matters: **no gate in this repo can
      detect it.** Not the coverage floors, not the ratchets, not `ipc-registrar-coverage`.
      Delete it or rewrite it against the module.

- [ ] **C5 — The first e2e test boots against the developer's real Electron profile.**
      `tests/e2e/smoke.spec.ts:70` launches with `args: [projectRoot]` and **no
      `--user-data-dir`** — the only one of the six specs' nine launch sites that omits it
      (the second test in the same file, `:167`, does it correctly, as do all five other
      specs, which `mkdtempSync` a userData dir, seed `session.json`, and `rmSync` in a
      `finally`). Consequences, all verified: (a) `src/main/session.ts:13` restores the real
      saved window, so the assertion at `:111` that the "Open Thoughtbase" button is visible
      **fails on any machine that has used the app** — this machine's profile has
      `rootPath: "/Users/davegriffith/philosophy_of_engineering"`; (b) the run **mutates the
      developer's real profile** (`Preferences`, `DIPS`, `Session Storage/` all carry
      today's timestamp); (c) it is green in CI, so nothing surfaces it. The file header at
      `:19-20` states the premise it depends on ("a fresh launch yields the 'Open
      Thoughtbase' shell") — true only on a clean runner. One line fixes it. Related but
      lower-severity: all six specs pass `env: { ...process.env }`, handing the developer's
      real `ANTHROPIC_API_KEY` / `GH_TOKEN` to the app under test.

### High

- [ ] **H1 — `docs/development.md:184-186` claims a coverage that does not exist.** It says
      "some surfaces (notably `App.svelte`, the composition root) are covered by the
      Playwright e2e journeys rather than unit tests." The journeys explicitly do the
      opposite: `tests/e2e/journeys.spec.ts:4-6` and `happy-paths.spec.ts:26` state they
      drive `window.api` through `win.evaluate` *instead of* the UI. Measured: App.svelte
      **0% / 593 exec lines**; **66 of 125 components at 0%** (3,418 exec lines), including
      `Sidebar.svelte` (225), `QueryPanel.svelte` (140), `ExportDialog.svelte` (128),
      `TagsPanel.svelte` (103), `Composer.svelte` (79), `RightSidebar.svelte` (69). Two
      actions: correct the doc so the gap is visible, and add 3–5 real UI journeys (open
      note → edit → save; open a proposal → approve; run a skill from the menu) that drive
      the actual DOM rather than the bridge. #1899 is the one instance of this class that
      surfaced; the doc is why it was the only one.

- [ ] **H2 — `pattern-ratchets.test.ts` covers 2 of the 5 anti-patterns CLAUDE.md lists, and
      the uncovered ones are growing.** Ratcheted: swallowed `catch → empty` (38 files) and
      `withRootPathOr(null, …)` (1). **Not ratcheted:** the boolean/sentinel overload, the
      in-band `error?`, and the vestigial `success` field. Measured today across `src/main`:
      `withRootPathOr` fallbacks are `[]` ×22 (legitimate), plus **`false` ×3**
      (`register-notebase.ts:412`, `register-proposals.ts:24`, `:28`), **`0` ×1**
      (`register-proposals.ts:30` — "no project" and "expired zero proposals" are the same
      answer), **`''` ×1** (`register-sources.ts:174`), **`{}` ×2** (`register-graph.ts:74`,
      `register-types.ts:51`). CLAUDE.md names the `false` case in its backlog; seven
      instances of the same shape have no executable gate, so the list can grow exactly the
      way the prose backlog did before #1848. The machinery exists — it needs one more regex
      and baseline.

- [ ] **H3 — Environment-gated suites disappear silently, and nothing asserts they ran.**
      12–13 sites use `cond ? describe : describe.skip`. Two are security tests:
      `tests/main/compute/sandbox-integration.test.ts:40` (`canRun()` — darwin +
      `sandbox-exec` + python3; 10 tests of OS-level sandbox enforcement, including the
      socket / `~/.ssh` / home-write escape probes) and
      `tests/main/compute/network-guard.test.ts:38` (5 network-egress tests). They run today
      on `macos-latest`; they are one runner-image change or one missing Python from
      vanishing without a sound. Combined with C2 the root cause is the same: **a skip is
      indistinguishable from a pass in every report this project produces.** The fix is the
      pattern the repo already invented — assert the gated population is non-empty, exactly
      like `ipc-registrar-coverage.test.ts:113` ("a broken scan would pass vacuously").

- [ ] **H4 — Re-ratchet the coverage floors; three areas carry 25–30 points of dead slack.**
      Per the slack table: `src/main/llm/**` is **+30.1** lines / **+25.5** branches over its
      floor, `src/main/git/**` **+26.8**, `src/shared/**` **+25.9 with no branch floor at
      all** despite measuring 86.1%. The trust path — CLAUDE.md's stated top priority — has
      the loosest gate in the repo relative to what it achieves. Set floors 3–5 points under
      measured (the flap margin the config already reasons about), add the missing
      `src/shared/**` branch floor, and consider adopting the *exact-number,
      fails-in-both-directions* discipline that `pattern-ratchets` and `file-size-budgets`
      already use — it is the strictly better ratchet and it lives in the same repo.

- [ ] **H5 — 4,065 leaked temp directories, one file responsible for 3,358 of them.**
      `tests/main/publish/publish-to-git.test.ts:63-64` creates a `minerva-pubroot-` temp dir
      in `beforeEach` and has **no `afterEach` and no `rm` of any kind** (verified: zero
      matches for `afterEach|rmSync|\.rm\(` in the file). 16 tests × ~210 recorded runs.
      **1,184 of those directories were created today.** Five `*.bench.ts` files leak the
      same way at lower volume (`n3-cache.bench.ts:26`, `graph-index.bench.ts:27`,
      `full-index.bench.ts:31`, `n3-cold-rebuild.bench.ts:38`,
      `write-pipeline.bench.ts:39`). Separately, **production** code leaks 319 unix sockets:
      `src/main/compute/rpc-server.ts:219` creates `minerva-rpc-<pid>-<rand>.sock` in
      `os.tmpdir()` and never unlinks it on close — collision-safe, but it pollutes the
      shared namespace indefinitely and is a real-app resource leak that the tests merely
      amplify. Note this is an *adoption* problem, not a design one:
      `tests/helpers/temp-project.ts` hardens teardown correctly via `afterEach` (broader
      adoption is **#1902**).

- [ ] **H6 — `process.env` deletions leak across test files in a reused fork worker.**
      `tests/main/llm/settings.test.ts:53-56` deletes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
      and `GEMINI_API_KEY` in `beforeEach`; `afterEach` (`:59-61`) only removes the temp dir.
      `isolate: true` resets the module registry, not the process, and fork workers are
      reused — so every file scheduled after it on that worker sees those unset. This is a
      genuine cross-file order dependency, and the codebase already documented the fix:
      `tests/main/publish-git-auth.test.ts:17-32` snapshots and restores with the comment
      *"process.env is worker-global, so snapshot + restore to avoid leaking the deletions
      into other test files that share the worker."* `vi.stubEnv` (which auto-restores) is
      used **zero** times across all 11 env-mutation sites.

- [ ] **H7 — `src/main/llm/tools/`: seven LLM tool modules are effectively untested.**
      `set-properties.ts` **1.85%**, `propose-compute.ts` 3.57%, `ask-user.ts` 5.55%,
      `query-graph.ts` 9.09%, `search-notes.ts` 9.09%, `get-properties.ts` 12.5%,
      `describe-graph-schema.ts` 33.3% — all at 0% branches. These are the callable surface
      the model reaches for. `set-properties.ts` in particular is an LLM-originated graph
      write, and the write guard is only fatal on paths that actually execute under test — an
      untested apply path is a guard that never fires. The sibling tools are well covered
      (`propose-notes` 89%, `propose-claims` 87%, `propose-note-body` 98%), so this is a
      handful of gaps rather than a systemic one.

### Medium

- [ ] **M1 — `tests/main/notebase/fs.test.ts:109-116` — the one genuinely vacuous
      conditional, on the sandbox path.** `if (firstFile >= 0 && lastDir >= 0) {
      expect(lastDir).toBeLessThan(firstFile); }` with nothing asserting the guard holds. If
      `listFiles` regressed to returning only directories, only files, or an empty array, the
      "sorts directories before files" test stays green. Two lines fix it.

- [ ] **M2 — Three tests whose assertion under-delivers their name.**
      (a) `tests/shared/sql-format.test.ts:39-46` — titled "falls back to the original text
      on a parser error," asserts only `not.toThrow()`; the stated risk ("a half-typed query
      isn't destroyed") would still pass if the query *were* destroyed. Should be
      `expect(formatSql(input)).toBe(input)`.
      (b) `tests/renderer/markdown/vega-renderer.test.ts:89-94` — the comment states the
      expected result (`[]`, leaf URL below the depth cap) but asserts `not.toThrow()`;
      removing the depth guard entirely leaves this green. It guards a network-egress path.
      `toEqual([])` is the fix.
      (c) `tests/renderer/preview/hydrate.test.ts:105-108` — "returns early when there are no
      un-highlighted code blocks" asserts only `not.toThrow()`; nothing checks the DOM was
      left alone.

- [ ] **M3 — Two literal tautologies.** `tests/shared/flashcards/guid.test.ts:90-92` —
      `expect(guidsOf(persisted)).toEqual(guidsOf(persisted))`, identical expression on both
      sides; determinism is already covered at `:20` and the meaningful version (guid
      stability across an edit) exists at `:97`. And
      `tests/main/graph/health-checks.test.ts:20` — `expect(types).toHaveLength(5)` counting
      the test's own array literal (subsumed by C4).

- [ ] **M4 — "No-op" asserted only as "didn't crash," on trust surfaces.**
      `tests/main/ipc/register-compute.test.ts:307-309`: "revoking a thoughtbase that was
      never trusted is a no-op, not an error" asserts only `not.toThrow()`. A handler that
      wiped *all* consent records on an unknown root would pass — a compute-consent failure.
      Same shape at `tests/main/notebase/watcher.test.ts:456`,
      `tests/main/search/minisearch-provider.test.ts:102`,
      `tests/main/compute/python-kernel.test.ts:214`. The good version already exists two
      hundred lines away at `register-compute.test.ts:448`, which follows `not.toThrow` with
      `expect(h.showItemInFolder).toHaveBeenCalled()`.

- [ ] **M5 — Add `pnpm lint:fonts` to CI.** It exists only in `.githooks/pre-push` and
      appears nowhere in `.github/workflows/`. Any `--no-verify` push, `SKIP_HOOKS=1`, fork
      PR, or checkout that never ran `pnpm install` bypasses it. It is a one-line grep;
      adding it to the lint job costs nothing.

- [ ] **M6 — The sandbox-escape test writes into the developer's real `$HOME` and `~/.ssh`.**
      `tests/main/compute/sandbox-integration.test.ts:106-110` does
      `mkdirSync(path.join(os.homedir(), '.ssh'), {recursive:true})` then writes
      `~/.ssh/mv_sandbox_probe` containing `'SECRET'` — cleaned in a `finally`, but it
      **creates `~/.ssh` if the developer doesn't have one**. Lines `:99` and `:120` attempt
      writes to `$HOME/mv_sandbox_evil.txt` and `$HOME/mv_sandbox_child_evil.txt` with **no
      cleanup on either path** — and the entire premise of the test is that the sandbox might
      be broken, in which case it litters real `$HOME`. The test is valuable and should stay;
      it should target a temp `HOME` rather than the real one.

- [ ] **M7 — `pnpm test` and `pnpm coverage` enforce different timeouts, and CI runs only
      one.** `package.json:32` `"test": "vitest run"` (vitest default 5,000 ms);
      `package.json:39` `"coverage": "vitest run --coverage --test-timeout=30000"`;
      `ci.yml:69` runs only `pnpm coverage`. So **CI never validates the 5 s budget**, and a
      test in the 5–30 s band is green on every PR and red the moment a developer types
      `pnpm test`. The most likely candidate is `tests/main/notebase/watcher.test.ts` — 19
      real-chokidar tests with a `waitFor(…, 4000)` helper and no overrides, inside a 5,000 ms
      default. Fix: set `test.testTimeout` in `vitest.config.mts` and drop
      `--test-timeout=30000` from `coverage` so both enforce one contract. Separately,
      consider adding `pnpm test` to the pre-push hook — 70 s is proportionate for pre-push,
      and the hook currently lets a red suite reach CI.

- [ ] **M8 — Timing-sensitive tests that can fail red.** (a)
      `tests/main/search/index.test.ts:91-92` and `:103-109` — `await sleep(DEBOUNCE_MS/2)`
      then `expect(existsSync(...)).toBe(false)`; an overshoot past the 200 ms debounce on a
      loaded runner turns this red. (b) `tests/renderer/source-display.test.ts:20-26,63` —
      `isoDaysFromNow()` reads the clock at setup, `isOverdue` reads it again at assert time;
      a run straddling local midnight fails, and `:72-76` fails at new year. There is **no
      `TZ` pin** anywhere (`vitest.config.mts`, `package.json`, `ci.yml`), so every local-time
      assertion inherits the runner's zone. The repo's own good pattern (`vi.setSystemTime`,
      used in 3 files; `TZ` forced-and-restored in
      `tests/renderer/refactor/extract.test.ts:17-27`) just needs applying here. (c) 7
      unconditioned `waitForTimeout(400-500)` sleeps before axe scans in
      `tests/e2e/a11y.spec.ts:142,154,201,205,249,254` and `smoke.spec.ts:114` — a slow runner
      yields either a spurious violation or a spuriously clean scan.

- [ ] **M9 — Shared mutable `beforeAll` fixtures with no reset.** 25 files have `beforeAll`
      and no `beforeEach`. Sharpest: `tests/main/sources/tables-markdown.test.ts:20-24` — one
      DuckDB instance mutated by every test, plus a module-global `onCsvTableCollision`
      handler registered at `:91` and never unregistered, so it stays live for `:115` and
      anything added later. Table names are disjoint today; nothing enforces it. Milder at
      `tests/main/sources/tables.test.ts:8-13,92`. Related: the renderer store singletons
      (`src/renderer/lib/stores/*.svelte.ts`) export no reset API, so each test file
      hand-rolls one — `tests/renderer/stores/bookmarks.test.ts:17-23` walks only the top
      level, while `right-sidebar/BookmarksPanel.test.ts:15-24` sidesteps it by mocking the
      module (the better pattern). `bookmarks.svelte.ts:12-18` also arms an uncancelled real
      500 ms `setTimeout` per mutation, which fires after the file's tests have finished.

- [ ] **M10 — Tighten the bench gate, or use the mechanism already built.** Tolerance is
      **2.0×** — a 99% slowdown passes — and every `budgetMs` in
      `tests/main/bench-baseline.json` is `null`, so the absolute-ceiling check that
      `scripts/bench-check.mjs` implements is never exercised. Set `budgetMs` on the scale
      benches (`indexAllNotes: 5000 notes` is 1,181 ms at ±<1% per the baseline comment — an
      1,800 ms ceiling would be generous and meaningful) and consider tightening tolerance to
      ~1.3× for the low-variance benches while leaving the noisy ones at 2.0×.

- [ ] **M11 — No flake budget on either suite.** Playwright retries twice in CI with nothing
      aggregating the "retry #N" lines its config relies on for visibility; vitest has no
      retry and no flake detection. A cheap first step: fail the e2e job when any test needed
      a retry, or record retries so the rate is at least visible.

- [ ] **M12 — Zero `expect.assertions(n)` across 6,198 tests, with 199 `waitFor(` sites.** No
      systemic problem today (the assertion audit came back clean), but this is the mechanism
      by which an assertion inside an unexecuted async branch would pass silently. Worth
      adopting in the async component tests specifically, not repo-wide.

- [ ] **M13 — `ipc-registrar-coverage.test.ts`'s header is stale.** It says "four of the
      eleven currently-covered ones are reached only by the shared no-project contract test,"
      written when 11 of 24 were covered. All 24 now are, and the honest caveat it makes is
      more important, not less — it is exactly the C1 failure mode. One-line doc fix.

### Already tracked — cross-references, not new findings

These surfaced again and are correctly described by the existing issues: **#1900** (six
approve-and-apply LLM draft channels untested — corroborated:
`register-conversation-drafts.ts` measures 21.22% stmts / 16.10% branches), **#1901**
(`register-refactor.ts` — corroborated at 26.78% / 33.33%), **#1902** (175 files hand-rolling
`mkdtempSync` vs 6 importing the helper — see H5 for the measured consequence), **#1899**
(`UnlinkedMentions` test against an unwired component — see H1 for why it is a symptom of a
layer-wide gap), **#1894** (`ipc-registrar-coverage` passes on import — see C1 for the
concrete consequence), **#1919** (duplicate editor-store test files), **#962** (arm64-only
packaging — the compatibility-matrix analogue).

---

## Sections deliberately not filled

Kept as headings because the template asks for them, with an honest statement rather than a
fabricated number.

- **Defect density per KLOC / escaped defects per release / MTTR / customer issues per
  month.** Not measured and not meaningfully measurable here. This is a single-developer app
  at `2.0.0-alpha.1` with no issue taxonomy separating "escaped defect" from "feature
  request," no release cadence to normalise against, and no incident timeline. The closest
  honest proxies from `git log --since="90 days ago"`: **739 commits, 84 `fix(…)` commits
  (11.4%), 11 mentioning revert, 62 `test(…)` commits.** Those are raw counts, not a defect
  rate — a `fix:` commit here often means "the UX was wrong," not "a shipped bug."
- **Browser / device matrix.** Not applicable — one bundled Chromium. The desktop analogue
  (platform + arch matrix) is under *Compatibility*: macOS arm64 only, tracked as #962.
- **DAST / penetration testing / OWASP scan.** Not applicable — no server, no network attack
  surface beyond outbound API calls. The analogues that *do* apply (path-traversal sandbox,
  Electron trust boundary, Python sandbox escape probes, supply-chain audit) are under
  *Security testing* and are largely in good shape.
- **Load / stress / throughput (req/sec).** Not applicable — single-user desktop. The
  analogue is large-thoughtbase indexing, which is benched (500/2k/5k notes) and gated, with
  the caveats in M10.
- **Customer satisfaction / NPS / support-ticket metrics.** No user base to measure.
- **Test-case management, QA sign-off, release-readiness checklists, CODEOWNERS, PR
  templates.** None exist (`.github/` has only `ISSUE_TEMPLATE`, `dependabot.yml`,
  `workflows/`). For a single-developer project this is correct, not a gap — the executable
  gates in `tests/architecture/` do the work a process checklist would do on a team, and do
  it better. I am not recommending process ceremony.
- **Mutation testing.** Not present. It is the tool that would have caught C4, M1, M2 and M4
  automatically. Worth *considering* on `src/main/llm` and `src/main/notebase` only — but
  6,745 tests × a mutation runner is a very different feedback loop from 70 seconds, so this
  is a "run it once, act on the report, don't wire it into CI" suggestion, not a gate
  recommendation.

---

### Method and limitations

**What I actually ran** (darwin arm64, this working tree, `main` at `83e35f28`, clean except
the untracked prior report):

- `pnpm coverage` — full suite + v8 instrumentation + all thresholds. Exit 0. 621 files,
  6,745 tests, 105.10 s. Source of every coverage number here.
- `pnpm test` — full suite, no instrumentation. Exit 0. 621/6,745, 70.43 s.
- A Python parse of `coverage/lcov.info` aggregating `LF/LH`, `BRF/BRH`, `FNF/FNH` per glob —
  the slack table and the component zero-coverage counts. I used lcov rather than the v8 text
  report because the text report's directory rows exclude subdirectories and read
  misleadingly high.
- A regex scan of `src/main` for `withRootPathOr` fallback shapes (H2).
- A brace-matching scan over all 6,198 `it`/`test` blocks for zero-assertion and
  single-weak-assertion bodies.
- Direct verification on disk of the five most severe claims: read
  `~/Library/Application Support/Minerva/session.json` (C5), counted
  `ls -d $TMPDIR/minerva-* | wc -l` → 4,065 and `minerva-pubroot-*` → 3,358 and
  `minerva-rpc-*.sock` → 319 (H5), grepped `publish-to-git.test.ts` for any cleanup → none
  (H5), read `settings.test.ts:50-62` against `publish-git-auth.test.ts:15-33` (H6), read
  `health-checks.test.ts` in full (C4).
- Roughly 90 `grep`/`rg`/`wc` counts, each command stated inline next to its number.
- `git log --since="90 days ago"` with `--grep` filters.
- Read in full: `CLAUDE.md`, `vitest.config.mts`, all three `.github/workflows/*.yml`,
  `.github/dependabot.yml`, `.githooks/pre-push`, `playwright.config.ts`, `scripts/lint.mjs`,
  `scripts/bench-check.mjs` (gate logic), all six `tests/architecture/*.test.ts`,
  `tests/shared/ipc-contract-ratchet.test.ts`, `src/main/graph/write-guard.ts`,
  `src/main/ipc/helpers.ts`, `src/main/ipc/register-proposals.ts`,
  `tests/main/graph/health-checks.test.ts`,
  `tests/e2e/{smoke,journeys,a11y,focus-trap}.spec.ts` (headers + assertion lines),
  `docs/development.md` §Tests, and the earlier refactoring review's summary and metrics.
- I did **not** modify any file except this report. No git state was changed.

**What I did not measure, and why:**

- **CI-environment coverage.** Every coverage number is from a machine with
  `resources/models` and Python 3 present. The CI figure is lower by the 12 model-gated tests
  (C2). I did not reproduce a modelless run — it would have meant moving or deleting
  `resources/models`, a working-tree modification.
- **Whether CI is actually green.** I did not query `gh run list`. All statements about CI
  are read from the workflow YAML, not from run history.
- **Real flakiness rate.** Two consecutive local runs is not a flake study. The
  timing-sensitive tests are flagged on structural grounds, not observed failures — I saw
  none. I did not attempt to reproduce C5's local failure by running `pnpm test:e2e`, which
  would have taken an `electron-forge package` build; the claim rests on reading the launch
  args, the session-restore code path, and the real `session.json` contents.
- **`src/main/menu.ts` (28% covered, 983 lines).** A large untested surface I flagged in the
  metrics table but did not investigate. Plausibly a legitimate "hard to unit test, covered
  by the e2e boot" case, or plausibly a real gap; I do not know which.
- **Mutation score.** Not run — far outside this review's budget.
- **The 24 files touching `Date.now`/`new Date`.** I counted them and examined the two
  flagged in M8; I did not audit each for load-bearing clock dependence.

**Claims I am less than fully confident in:**

- **The exact CI-skipped test count (12).** Derived by counting `it(` blocks inside the
  `describe.skip`-gated regions of four files (2 + 4 + 3 + 3). A parallel scan produced ~28
  by counting all `it` blocks in those files including ungated ones; I used the narrower,
  more defensible number. The *mechanism* (C2) is certain — `.gitignore:70` plus the absence
  of any `pretest` in `package.json` is unambiguous — but treat "12" as approximate.
- **"App.svelte is covered by nothing."** Precisely: 0% under v8 in the vitest run, and the
  e2e journeys drive `window.api` rather than the DOM. But `smoke`, `a11y` and `focus-trap`
  *do* boot the real app and click real UI, so some App.svelte code executes there —
  Playwright coverage is not instrumented, so I cannot say how much. The claim I stand behind
  is narrower: **no automated assertion exists about App.svelte's behaviour beyond "the
  welcome screen renders and four surfaces have no new axe violations."**
- **C5's local-failure claim** is an inference from three verified facts (no
  `--user-data-dir`; `session.ts:13` reads `userData/session.json`; that file contains a
  `rootPath`) rather than an observed red run. The *profile-mutation* half is directly
  observed (timestamps on `Preferences`/`DIPS`/`Session Storage/`).
- **The `bare toHaveBeenCalled()` concern is weaker than it first appears** and I
  down-weighted it accordingly — repo-wide 641 bare vs 560 with-args, and in `tests/main/ipc`
  the with-args form actually *dominates* (200 vs 148). Only `tests/main/llm` inverts (11 vs
  6), on a small base. Not filed as a finding; reported in the metrics table as context.
- **M2(b), M2(c) and M9** are judgement calls about what a test *ought* to assert or how much
  shared-fixture coupling is acceptable. All the tests involved pass and guard something
  real; reasonable people could call them adequate.
- Everything in *Sections deliberately not filled* reflects my reading of Minerva as a
  single-developer local-first desktop app. If it is heading toward a team or a user base,
  several become applicable and the answers change.
