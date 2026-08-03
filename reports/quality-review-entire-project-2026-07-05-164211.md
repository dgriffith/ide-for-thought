# Quality Assurance Review Plan
Generated: 2026-07-05 16:42:11
Scope: entire project (/Users/davegriffith/minerva)

---

## Executive Summary

Minerva has a **mature, above-average QA posture for a solo-developed desktop
application** — notably stronger than most Electron apps of its size. The
project ships a real testing pyramid (416 test files against 571 source files,
a ~0.73 test-to-source ratio), a coverage tool that is *configured and gating*
(v8 with per-area thresholds enforced on every PR), and several genuinely
sophisticated defect-prevention mechanisms that go well beyond box-checking.

The standout is a set of **invariant-enforcing tests** rather than mere
behavioral tests. The LLM write guard
(`src/main/graph/write-guard.ts`) is *fatal under the test runner*: any
LLM-originated graph write that bypasses the approval engine throws and fails
CI (`tests/main/graph/write-guard.test.ts`). The preload contextBridge is
locked with a snapshot test (`tests/preload/preload-bridge.test.ts`). The
19-module IPC registration surface is contract-tested against a stubbed
`ipcMain` (`tests/main/ipc/registration.test.ts`). Accessibility is verified in
a *real Chromium renderer* with axe, using a regression-allowlist pattern that
fails only on new violations (`tests/e2e/a11y.spec.ts`). This is the work of
someone who understands that the highest-value tests protect architectural
decisions, not just functions.

The primary weaknesses are **breadth, not depth**: (1) the coverage floors gate
only seven backend areas and leave the entire renderer (93 Svelte components,
114 tests) and preload ungated — the largest UI surface has no coverage gate;
(2) the e2e layer is very thin (4 Playwright specs) for an app whose value is
end-to-end flows; (3) CI runs on `macos-latest` only, with no dependency/SAST
scanning and non-gating benchmarks that let scale regressions slip; and (4)
several substantial main-process modules (`menu.ts` 878 LOC, `auto-update.ts`,
`session.ts`, `security.ts`) have little or no direct coverage.

**Overall QA grade: B+ (strong foundation, breadth gaps).** The trust-critical
paths are genuinely well-protected. The improvement plan below is about
extending the same rigor outward to the renderer, e2e, and supply-chain layers.

---

## Quality Assurance Findings

### Critical

**C1. The renderer and preload are excluded from coverage gates.**
`vitest.config.mts` sets thresholds only for `src/shared`, `src/main/llm`,
`src/main/notebase`, `src/main/publish`, `src/main/sources`, `src/main/graph`,
and `src/main/compute`. The entire `src/renderer` tree (93 `.svelte`
components, `App.svelte` at 2046 LOC, both reactive stores) and `src/preload`
have **no coverage floor**. A PR that deletes renderer tests or ships an
untested component passes the gate. Given this is a UI-first product, the
largest user-facing defect surface is the least-gated. The 114 renderer tests
that exist are good — they're just not *protected* from regression.

**C2. End-to-end coverage is minimal relative to the app's value proposition.**
Only 4 Playwright specs exist (`smoke.spec.ts`, `happy-paths.spec.ts` [2
flows], `a11y.spec.ts`, `bundle-budget.spec.ts`), single-worker, ~518 LOC
total. The two happy-path flows (write→reindex→SPARQL, and
proposal→approve→graph) are excellent and cover the safety-critical approval
path for real. But major user journeys have **no e2e coverage**: source
ingestion (PDF/web clipper), publish/export, the conversation UI, git
operations, refactor/rename with link rewriting, and search. The e2e comment
itself concedes "Single test today (#394 smoke); add cases per 'the app stopped
working entirely' incident" — a reactive, not proactive, strategy.

### High

**H1. Several large main-process modules have thin or indirect coverage.**
`src/main/menu.ts` (878 LOC) is referenced by 40 test files but has no
dedicated test — it's exercised incidentally. `src/main/auto-update.ts` (208
LOC, update-electron-app integration) has 1 reference. `src/main/security.ts`
and `security-helpers.ts` (Electron context-isolation / privileged-sites
config — a genuine security boundary) have 4 and 2 references. `session.ts`,
`window-manager.ts`, `app-icon.ts` are near-zero. None of these sit behind a
coverage floor, so their state is invisible to CI.

**H2. Benchmarks are non-gating with no regression thresholds.**
`bench.yml` runs `*.bench.ts` (graph index/query latency, embedding
throughput) only on manual dispatch or a weekly cron, and the numbers are read
from the job log by a human. There is **no assertion** that, e.g., graph query
latency stays under a budget as the KB grows. The deliberate choice to avoid
PR-flapping on noisy runners is defensible, but the current design means a 3x
scale regression would not fail anything — it would sit in a Monday log nobody
reads. The `bundle-budget.spec.ts` e2e is the only performance *gate* that
exists.

**H3. No supply-chain / dependency / SAST scanning in CI.**
`ci.yml` runs lint + coverage + e2e, but there is no `pnpm audit`, no
Dependabot/Renovate config, and no static application security testing. For an
Electron app that bundles a large native/WASM dependency surface (onnxruntime,
duckdb, pdfjs, tesseract, sql.js, isomorphic-git) and executes LLM-proposed
content, an unpatched transitive CVE would go unnoticed until manual
inspection.

**H4. Codecov trend tracking is configured but inert.**
The `codecov/codecov-action@v5` step in `ci.yml` is `fail_ci_if_error: false`
and gated on a `CODECOV_TOKEN` that (per the comment) isn't set yet. So the
only coverage signal today is the *floor* (pass/fail), with no visible trend,
no PR coverage delta comment, and no way to see erosion within the headroom
above the floors. Numbers can silently drift down toward the floor.

### Medium

**M1. Accessibility baseline carries tolerated (unfixed) violations.**
`a11y.spec.ts` allowlists `color-contrast` and `scrollable-region-focusable`
for the workspace surface (CodeMirror oneDark theme + link-badge decorations).
These are tracked for follow-up but remain real WCAG AA failures in the editor,
the app's primary surface. The regression-guard pattern is correct; the debt is
real.

**M2. Single-platform CI.**
`ci.yml` runs exclusively on `macos-latest` (documented rationale: dev-machine
parity + chokidar fsevents semantics + darwin Electron bundle). The
`electron-forge` config ships a `maker-dmg` + `maker-zip`. If Windows/Linux are
ever targeted, there is zero cross-platform test signal, and even today the
fsevents-specific watcher tests are unverified on other filesystems.

**M3. No mutation testing or assertion-density check.**
Coverage measures *execution*, not *verification*. There's no Stryker or
equivalent to confirm the assertions actually catch injected faults. With
strong line coverage on the trust path, a mutation pass would reveal whether the
approval-gate tests genuinely fail when the gate is weakened.

**M4. E2e has no flake/retry policy.**
`playwright.config.ts` sets `workers: 1` and 60s timeouts but no `retries`.
Electron-boot e2e is inherently flaky; a single transient boot failure fails the
`e2e` CI job with no automatic retry, which erodes trust in the signal and
encourages re-run-until-green habits.

**M5. `App.svelte` (2046 LOC) shell is untested at the component level.**
The pattern of extracting logic into `tests/renderer/app/*-ops.test.ts`
(conversation-ops, note-ops, refactor-ops, source-ops, template-ops, nav-view,
text-helpers) is good and testable. But the 2046-line component shell itself —
wiring, effects, dialog orchestration — has no component-level render test, so
integration bugs between those ops modules and the DOM are only caught by the
thin e2e layer.

---

## Current Quality Assessment

### Testing Metrics

| Metric | Value | Source / Notes |
|---|---|---|
| Source files | 571 (`.ts` + `.svelte`) | `find src` |
| Source LOC | ~99,652 | `wc -l` |
| Test files | 416 (`.test.ts` / `.spec.ts`) | `find tests` |
| Test-to-source file ratio | ~0.73 | Strong for a desktop app |
| Unit + integration (vitest) | 410 files | main 197, renderer 114, shared 97, preload 2 |
| E2E (Playwright) | 4 specs | `tests/e2e/` |
| Benchmark suites | 3 (`*.bench.ts`) | graph-index, n3-cache, pooling |
| Coverage tool | **v8, configured + gating** | `@vitest/coverage-v8`, `pnpm coverage` in CI |
| Disabled tests (`.skip`/`.only`) | 0 permanent | all `.skip` are conditional build guards, no `.only` |

**Coverage percentages (honest assessment):** A coverage tool *is* configured
and runs in CI, but this review did not execute `pnpm coverage` (analysis-only,
and the suite requires the embedding model + a 30s-timeout full run). The
per-area floors and the measured-at-floor-time numbers documented in
`vitest.config.mts` give the best available estimate:

| Area | Floor (lines) | Measured-at-floor (per config comments) |
|---|---|---|
| `src/main/notebase` | 80% | ~89% L |
| `src/main/publish` | 82% | ~93% L / 75% B |
| `src/main/sources` | 80% | ~89% L / 75% B |
| `src/main/graph` | 80% | ~90% L / 73% B |
| `src/main/compute` | 75% | ~86% L / 70% B |
| `src/main/llm` | 55% | ~74% L / 51% B |
| `src/shared` | 70% | not annotated |
| **`src/renderer`** | **none** | **not measured / ungated** |
| **`src/preload`** | **none** | **snapshot-tested but ungated** |
| **`src/main/{menu,session,security,auto-update,embeddings,skills,git,...}`** | **none** | **not measured / ungated** |

The trust path (`llm`) has the *lowest* floor (55% L / 45% B) — appropriate
given branch complexity, but it's also the highest-risk path, so the branch
gap (~49% untested branches) is the single most important number to watch.

### Quality Metrics

| Metric | Status |
|---|---|
| Lint gate (tsc + svelte-check + eslint) | Enforced in CI + pre-push hook |
| Type coverage | Full — `tsc --noEmit` strict, `svelte-check --threshold error` |
| Coverage gate | 7 backend areas gated; renderer/preload ungated |
| Defect-escape tracking | Not measured / not applicable (no issue-triage metrics) |
| Mean time to detect regression | Fast for gated backend; slow/none for renderer + scale |
| Flaky-test rate | Not tracked; no retry policy |
| Static security scan | **None** (no `pnpm audit`, no Dependabot, no SAST) |
| a11y automated | Yes — axe in jsdom (unit) + real Chromium (e2e) |

---

## Quality Improvement Plan

### Immediate (this sprint)

1. **Add a renderer + preload coverage floor (addresses C1).** Set a
   conservative floor (e.g. `src/renderer/**` lines 55%, `src/preload/**` lines
   80%) in `vitest.config.mts`, measured below current numbers with headroom.
   This closes the single biggest gate gap without new tests.
2. **Add `pnpm audit --audit-level=high` as a non-blocking CI step, plus a
   Dependabot config (addresses H3).** Start non-fatal to establish a baseline,
   then promote to gating once the tree is clean.
3. **Enable Codecov (addresses H4).** Set `CODECOV_TOKEN` and turn on the PR
   coverage-delta comment so erosion above the floors becomes visible.
4. **Add `retries: process.env.CI ? 2 : 0` to `playwright.config.ts`
   (addresses M4).** Cheap flake resilience for Electron-boot e2e.

### Short-term (1–2 sprints)

5. **Expand e2e to the top 4 untested journeys (addresses C2):** source
   ingestion, publish/export, a conversation round-trip (seeded via the existing
   `MINERVA_E2E` hook), and rename-with-link-rewrite. Reuse the
   `launchWithProject` harness already in `happy-paths.spec.ts`.
6. **Add regression *budgets* to the benchmark suite (addresses H2).** Convert
   the read-the-log benches into `bench` assertions with a tolerance envelope,
   or add a nightly job that fails on >Nx regression vs a checked-in baseline.
7. **Cover the neglected main modules (addresses H1):** dedicated tests for
   `menu.ts` (menu-config application is pure logic — highly testable),
   `auto-update.ts` (mock `update-electron-app`), and `security.ts` /
   context-isolation config.

### Long-term (quarter)

8. **Mutation testing on the trust path (addresses M3).** Run Stryker over
   `src/main/llm/approval.ts` + `write-guard.ts` to prove the approval-gate
   tests fail when the gate is weakened. This is the highest-value place to
   verify assertion quality.
9. **Fix the a11y editor debt (addresses M1)** — retune/replace the CodeMirror
   oneDark theme colors to reach AA, then remove `color-contrast` from the
   workspace allowlist so it becomes a hard gate.
10. **Decide the cross-platform posture (addresses M2).** If v2.0 targets
    Windows/Linux, add matrix runners; if macOS-only stays the intent, document
    it as an explicit product constraint.

---

## Testing Strategy Enhancement

### Testing pyramid (current vs target)

```
Current                              Target
         /\  e2e: 4 specs                     /\  e2e: ~12 specs
        /  \  (0.7% of suites)               /  \  (top user journeys)
       /----\ integration:                  /----\ integration:
      /      \ ~150 (many main              /      \ hold + add renderer
     /        \ suites are multi-unit)     /        \ store/IPC integration
    /----------\ unit: ~260               /----------\ unit: hold
```

The *shape* is correct — a fat unit/integration base, a thin e2e cap. The
problem is the cap is too thin for a workflow app and the base has an ungated
hole (renderer). Target: keep the pyramid shape, but (a) gate the base, and (b)
roughly triple the e2e cap to cover the journeys that "the app stopped working
entirely" would break.

### Coverage goals

- **Gate everything that ships.** Every `src/**` directory that produces
  shipped code should sit behind a floor, even a low one. Ungated code is
  untracked code.
- **Trust path first.** Raise the `src/main/llm` *branch* floor incrementally
  (45% → 55% → 60%) as the malformed-bundle / expiry / escalation branches gain
  tests — this is where a silent defect does the most damage.
- **Renderer target:** 55% lines near-term, 65% within the quarter, focused on
  the two stores (`notebase.svelte.ts`, `editor.svelte.ts`) and the
  approval/proposal UI components.

---

## Test Automation

**Strengths:** Fully automated. `pnpm test` (vitest run) is the fast loop;
`pnpm coverage` gates PRs; `pnpm test:e2e` builds the Electron bundle and runs
Playwright; `pnpm lint` runs in both the pre-push hook and CI. The
`tests/helpers/` layer (`axe-playwright.ts`, `axe.ts`, `temp-project.ts`) shows
good fixture reuse, and the `MINERVA_E2E` main-process hook
(`src/main/e2e-hooks.ts`) is a clean pattern for deterministic e2e of
otherwise-nondeterministic LLM flows.

**Gaps:** No parallelization of e2e (single worker — acceptable given cost), no
visual-regression automation (no screenshot diffing despite an Electron
renderer that would support it), and no automated performance-gate feedback on
PRs (benches are out-of-band).

**Recommendation:** Add a Playwright screenshot-diff check for the 2–3 most
stable surfaces (welcome, workspace shell) to catch unintended visual
regressions the axe pass misses.

---

## Quality Gates

| Gate | Where | Blocking? | Assessment |
|---|---|---|---|
| tsc + svelte-check + eslint | pre-push hook + CI | Yes | Strong; local + CI |
| Coverage floors (7 areas) | `pnpm coverage` in CI | Yes | Strong but narrow |
| E2E smoke + happy paths + a11y | CI `e2e` job | Yes | Present, thin |
| Bundle budget | `bundle-budget.spec.ts` | Yes | Good perf gate |
| Benchmarks | `bench.yml` | **No** (log-only) | Weak — no assertion |
| Dependency/CVE scan | — | **Absent** | Missing gate |
| Coverage trend/delta | Codecov | **No** (inert) | Configured, off |

The gate architecture is sound; the two missing gates are supply-chain scanning
and coverage-trend visibility, and the one weak gate is benchmarks (informational
only).

---

## Defect Prevention

This is Minerva's strongest QA dimension and worth calling out explicitly:

- **LLM write guard, fatal under test** (`src/main/graph/write-guard.ts`,
  `tests/main/graph/write-guard.test.ts` + `write-guard-wired.test.ts`). Per
  CLAUDE.md, any LLM-originated graph write that skips the approval engine
  *throws* under vitest, so the Trust Principle ("the LLM proposes, the human
  confirms") is **enforced by CI, not merely documented**. The tests verify the
  guard behavior itself (does it throw?), the nest-safety of the context
  counters, and the trusted-context bypass — this is invariant-level testing.
- **Preload contextBridge snapshot** (`tests/preload/preload-bridge.test.ts` +
  `typed-invoke-validation.test.ts`). Per project memory, adding a `window.api`
  method requires a snapshot update, so the main↔renderer security boundary
  can't drift silently.
- **IPC registration contract test** (`tests/main/ipc/registration.test.ts`)
  drives the real `registerIpcHandlers()` against a stubbed `ipcMain` to catch a
  renamed/dropped/double-registered channel that lint + unit tests would miss.
- **Integrity SPARQL query** (documented in CLAUDE.md) detects LLM-attributed
  `thought:Component` nodes lacking an approved proposal — a runtime auditor for
  the trust invariant. *Gap: this exists as a dev-run query, not an automated
  test.* Wrapping it in a vitest assertion over a seeded graph would make it a
  continuous gate rather than a manual check.

**Recommendation:** Promote the integrity SPARQL query into an automated test.
It's the one defect-prevention mechanism that's still manual.

---

## Test Data Management

**Current:** A single hand-authored fixture project
(`tests/fixtures/sample-project`, markdown + ttl) is copied per-run in e2e so
tests can't dirty the tracked copy (`fs.cpSync` into a `mkdtemp` dir). The
`tests/helpers/temp-project.ts` helper standardizes temp-project setup for unit
tests. Per project memory, the team's explicit stance is "test duplication is OK
until fixtures exist — don't build bespoke fixture infra pre-emptively," which
is a reasonable, applied philosophy.

**Gaps:** One fixture project limits scenario diversity (no large-KB fixture for
scale tests beyond the benches, no malformed/adversarial-content fixture for the
graph indexer, no fixture with git history for git-op tests). No factory/builder
for `thought:` nodes — proposal/claim test data is constructed ad hoc per test.

**Recommendation:** Add (1) a large synthetic KB fixture generator for scale
and e2e-perf tests, and (2) a small builder for `thought:Proposal` / `Claim`
nodes to reduce the ad-hoc turtle construction repeated across the 32
`tests/main/llm` suites.

---

## Performance Testing

**Current:** Three benchmark suites (`graph-index.bench.ts`, `n3-cache.bench.ts`,
`pooling.bench.ts`) measure the costs that grow with KB size — graph
index/query latency and embedding throughput — run via `pnpm bench` /
`bench.yml` (manual + weekly). Plus a hard `bundle-budget.spec.ts` e2e gate on
renderer bundle size.

**Assessment:** Good instinct (the right things are measured: the operations
that scale with data), but **informational only** — no pass/fail. For a desktop
app, "load testing" in the web sense (concurrent-user throughput) is **not
applicable**; the relevant analog is *scale testing* (does the app stay
responsive at 10k / 100k notes?), which the benches approximate but don't gate.

**Recommendation:** Add a scale envelope (e.g. "graph query over 10k-note
fixture < X ms") as a gating assertion, and track embedding-indexing throughput
against a checked-in baseline with a regression tolerance.

---

## Security Testing

**Current:**
- Path-traversal sandbox is directly tested
  (`tests/main/notebase/assert-safe-path-coverage.test.ts`, `fs.test.ts`) and
  sits behind an 80% line / 65% branch floor — the security-critical fs path is
  the *most* gated area, correctly.
- The preload contextBridge (context-isolation boundary) is snapshot-locked.
- The LLM write guard enforces that untrusted (LLM) content can't mutate the
  graph without human approval — a genuine security control, tested as fatal.

**Gaps (web-app sections adapted for Electron):**
- **No DAST** — not applicable in the web sense; the Electron analog is Electron
  security-config testing. `src/main/security.ts` / `privileged-sites.ts`
  (which control what external content is trusted) have minimal coverage — this
  *is* the app's remote-content boundary and deserves dedicated tests.
- **No SAST / dependency CVE scanning** (see H3) — the most impactful missing
  security-QA control.
- No test asserting `contextIsolation: true` / `nodeIntegration: false` /
  sandbox flags on the BrowserWindow, i.e. the config that makes the preload
  bridge the *only* path — a config regression here would be catastrophic and is
  currently uncaught.

**Recommendation (priority order):** dependency scanning → BrowserWindow
security-flag assertion test → coverage for `security.ts`/`privileged-sites.ts`.

---

## Accessibility Testing

**Current: genuinely strong.** Two-tier:
- **Unit tier:** axe against modal dialogs in jsdom with `color-contrast`
  disabled (jsdom has no layout), `tests/renderer/a11y/` +
  `tests/helpers/axe.ts`.
- **Real-browser tier:** axe against welcome + workspace surfaces in the actual
  Chromium renderer (`tests/e2e/a11y.spec.ts`), where `color-contrast` runs for
  real. Uses a rule-id allowlist so the test fails only on *new* violations —
  the correct regression-guard pattern — and logs tolerated ones so debt stays
  visible. Recent commits (#1005, #1076) show active remediation
  (`--text-faint` lifted to AA; CM content given an aria-label; editor tabs
  de-ARIA'd to plain buttons).

**Gaps:** The workspace allowlist still tolerates `color-contrast` (editor
oneDark theme) and `scrollable-region-focusable` (M1). Coverage is limited to
welcome + workspace + open-editor; dialogs/panels opened deeper in a flow
(proposals panel, source viewer, settings) aren't in the real-browser net,
only jsdom. No keyboard-navigation-path test (tab order, focus trapping in
modals) beyond what axe infers statically.

**Recommendation:** Extend the real-browser axe pass to the proposals panel and
source viewer, and add an explicit focus-trap/tab-order test for the modal
dialogs (the app's keyboard-first philosophy makes this high-value).

---

## Cross-Platform Testing

**Honest assessment for a desktop Electron app:** the web "browser/device
matrix" section does **not apply** — the render target is a single pinned
Chromium (Electron 43). The relevant matrix is *operating systems*, and here
coverage is **single-platform**: `ci.yml` runs only `macos-latest`, and the
maker config produces macOS artifacts (dmg/zip). The rationale is documented
(dev parity, chokidar fsevents semantics, darwin Electron bundle for e2e) and
reasonable *if* macOS is the sole target.

**Risk:** The chokidar watcher tests (#345) exercise macOS fsevents behavior
and are unverified elsewhere; path handling, and native deps (duckdb,
onnxruntime, tesseract) could behave differently on Windows/Linux. This is
acceptable debt *only while macOS-only is an explicit product decision* — which
should be documented as such, not left implicit.

---

## Monitoring and Metrics

**Current:** CI provides pass/fail on lint + coverage-floor + e2e per PR, with
in-flight-run cancellation (concurrency group) to save minutes. Coverage
reporters emit `text`, `text-summary`, `html`, and `lcov`. That's the extent of
QA telemetry.

**Gaps:** No coverage *trend* (Codecov inert, H4), no flaky-test dashboard, no
defect-escape or MTTR tracking, no benchmark-trend history (each weekly run's
numbers live only in that job's log). There is no post-release quality signal
(e.g. Sentry/crash reporting) referenced anywhere in the QA surface — for a
shipped desktop app, in-field crash telemetry is the missing feedback loop.

**Recommendation:** (1) turn on Codecov trend + PR delta; (2) persist benchmark
results to a committed baseline file so week-over-week deltas are diffable; (3)
evaluate crash/error telemetry for released builds (respecting the app's local-
first, privacy-conscious posture — opt-in).

---

## Risk-Based Testing

Mapping test investment to blast radius:

| Risk area | Blast radius | Current coverage | Verdict |
|---|---|---|---|
| Approval engine / trust path | Data integrity + user trust | High floors + fatal write guard + e2e approve flow | **Well matched** |
| fs sandbox (path traversal) | Security | 80/65 floor, direct tests | **Well matched** |
| Preload / IPC contract | Security boundary | Snapshot + contract test | **Well matched** |
| Graph indexing | Core feature | 80% floor, 36 suites | **Well matched** |
| Renderer UI (93 components) | UX / daily use | 114 tests, **ungated** | **Under-protected** |
| Electron window/security config | Catastrophic if wrong | Minimal | **Under-tested** |
| Auto-update | Bricks installs | 1 reference | **Under-tested** |
| Scale (large KB) | Perf degradation | Non-gating benches | **Under-tested** |

The high-consequence *trust and security* paths are correctly the best-tested.
The mismatch is at the edges: UI breadth, Electron config, auto-update, and
scale — all high-blast-radius, low-coverage.

---

## Continuous Improvement

The git history shows a **healthy, iterative QA-strengthening cadence**: #679
(coverage floors), #690 (pre-push hook), #997 (IPC contract test), #998 (happy-
path e2e), #999/#1000 (extending floors + tightening the llm branch floor
38→45), #1004 (benchmarks), #1005/#1076 (real-browser a11y + remediation),
#944 (making the write guard fatal). This is a project that *adds a gate after
finding a gap* — the ideal pattern. The write-guard test comment ("QA #657 /
Q-C1") even shows prior QA-review findings being closed.

**Recommendation:** Keep the cadence but shift from *reactive* ("add a case per
incident," per the e2e comment) to *proactive* for the two areas where an
incident would be most costly: renderer regressions and Electron-config
mistakes. Institutionalize the retro-to-gate habit with a lightweight
"every escaped defect gets a regression test + a gate if possible" rule.

---

## Team Development

Single-developer project (Dave Griffith). The QA practices are effectively
self-imposed engineering discipline, and they're notably rigorous. The
`CLAUDE.md` codifies a **Code Review Checklist for LLM/Graph PRs** (does the
path go through the approval engine? are provenance fields set? is there a
SPARQL integrity check? are there tests the gate can't be skipped?) — this is a
written quality culture, unusual for a solo project and worth preserving as the
team grows.

**Recommendation:** If contributors are added, the highest-leverage onboarding
artifact is already written (the LLM/Graph checklist); extend it with a short
"how to add a coverage-gated area" and "how to add an e2e journey" so the gate
architecture is self-documenting.

---

## Estimated Impact

| Improvement | Effort | Risk reduction | Priority |
|---|---|---|---|
| Renderer/preload coverage floor (C1) | Low | High | **P0** |
| Dependency/CVE scan + Dependabot (H3) | Low | High | **P0** |
| Enable Codecov trend (H4) | Low | Medium | **P0** |
| E2e retries (M4) | Trivial | Medium | **P0** |
| Expand e2e journeys (C2) | Medium | High | **P1** |
| Benchmark regression budgets (H2) | Medium | Medium | **P1** |
| Cover menu/auto-update/security (H1) | Medium | Medium | **P1** |
| Automate integrity SPARQL query | Low | Medium | **P1** |
| BrowserWindow security-flag test | Low | High | **P1** |
| Mutation testing on trust path (M3) | Medium | Medium | **P2** |
| Fix editor a11y contrast debt (M1) | Medium | Low | **P2** |
| Cross-platform decision/matrix (M2) | High | Low (if macOS-only) | **P2** |

Delivering all P0 items (est. 1–2 days total) closes the two most serious gaps
(ungated renderer, no supply-chain scanning) at very low cost and would move the
overall grade from B+ toward A-.

---

## Implementation Roadmap

**Phase 1 — Close the cheap gates (week 1):**
Renderer/preload coverage floors → `pnpm audit` step + Dependabot → Codecov
token + PR delta → Playwright `retries` → automate the integrity SPARQL query
as a test.

**Phase 2 — Extend breadth (weeks 2–4):**
Four new e2e journeys (source ingest, publish, conversation round-trip,
rename+link-rewrite) → dedicated tests for `menu.ts`, `auto-update.ts`,
`security.ts` + a BrowserWindow security-flag assertion → benchmark regression
budgets against a committed baseline.

**Phase 3 — Deepen assurance (quarter):**
Mutation testing over `approval.ts` + `write-guard.ts` → editor a11y-contrast
remediation and removal of the `color-contrast` allowlist → screenshot-diff
visual regression for stable surfaces → explicit cross-platform decision (and
matrix runners if v2.0 targets Windows/Linux).

---

## Success Metrics

- **Every shipped `src/**` directory is behind a coverage floor** (currently 7
  of ~15 top-level areas). Target: 100%.
- **`src/main/llm` branch floor raised 45% → 55%+** with tests for the
  remaining malformed-bundle / expiry / escalation branches.
- **E2e journeys: 4 → ≥10**, covering every "app stopped working entirely"
  surface.
- **Zero high/critical dependencies** in `pnpm audit`, enforced as a gate.
- **Coverage trend visible on every PR** (Codecov delta comment live).
- **Benchmark regressions fail CI** above a defined tolerance (currently
  log-only).
- **Editor `color-contrast` removed from the a11y allowlist** (debt paid, gate
  hardened).
- **Integrity SPARQL query runs as an automated test**, not a manual dev query.

---

*Analysis-only review — no source or test files were modified. All findings are
grounded in files read during this review: `package.json`, `.github/workflows/
{ci,bench}.yml`, `playwright.config.ts`, `vitest.config.mts`,
`vitest.bench.config.ts`, `.githooks/pre-push`, `tests/e2e/{happy-paths,a11y}.spec.ts`,
`tests/main/graph/write-guard.test.ts`, `tests/main/ipc/registration.test.ts`,
and the `tests/` + `src/` directory structure.*
