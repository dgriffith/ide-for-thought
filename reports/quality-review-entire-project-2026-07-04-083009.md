# Quality Assurance & Testing Review — Minerva

**Date:** 2026-07-04
**Scope:** Entire codebase (`/Users/davegriffith/minerva`) — Main, Preload, Renderer, Shared
**Reviewer role:** QA / testing / quality-gates (companion to concurrent architecture & refactoring reviews — this report stays in the testing lane)
**App type:** Desktop Electron IDE (Electron + Svelte 5 runes + TypeScript, RDF graph + git). **Not** a web service — web-specific QA dimensions are marked N/A with a reason rather than fabricated.

---

## Executive Summary

Minerva has a **genuinely mature, well-architected test suite** — one of the stronger ones I have reviewed for a project of this size. The headline numbers (measured, not estimated):

- **~399 test files** under `tests/` (vitest `.test.ts` + 2 Playwright `.spec.ts`).
- **~3,670 test cases** across **~853 `describe` blocks** (measured via `grep -rE "^\s*(it|test)\("` and `describe(`).
- **3 CI-enforced coverage floors** wired into `vitest.config.ts` for the trust and security paths.
- **A layered gate**: pre-push lint hook → CI `lint-and-test` (tsc + svelte-check + eslint + `pnpm coverage` with floors) → CI `e2e` (electron-forge package + Playwright).
- **Two standout design decisions** that put this codebase above the median:
  1. **The approval/trust invariant is enforced *as a test*, not merely documented.** The LLM write guard is *fatal under vitest* (throws) but a warning in dev/prod. `tests/main/graph/write-guard-wired.test.ts:57-105` proves the guard is wired into the real `parseIntoStore`/`removeMatchingTriples` paths, so any regression that bypasses the approval engine fails CI. This is a textbook example of encoding an architectural invariant into an executable check.
  2. **The preload contextBridge is snapshot-locked** (`tests/preload/preload-bridge.test.ts` + `__snapshots__/preload-bridge.test.ts.snap`), catching the class of "renderer silently loses an API method" regression that unit tests and svelte-check can't see.

The suite is deep on **pure logic** (formatter rules, graph indexers, skills pipeline, sources/ingest, publish exporters, approval/LLM tooling) and thin — by deliberate and largely defensible choice — on **Electron process glue** and **full Svelte component rendering**. The main genuine gaps are: (1) **IPC registration wiring** (`src/main/ipc/register-*.ts`, 19 modules, none directly tested), (2) **Svelte component render coverage** (92 components, 17 component test files — though much component *logic* is extracted and tested separately), and (3) **a single-case e2e smoke suite** that is intentionally minimal. None of these is alarming; all are addressable incrementally.

**Overall QA maturity: Strong (B+/A-).** The team clearly practices shift-left testing and treats tests as the enforcement mechanism for invariants. The recommendations below are about widening a strong base, not rescuing a weak one.

---

## QA Findings by Severity

### Critical
*None.* No evidence of a broken quality gate, a disabled invariant check, or an untested data-loss path. The highest-risk paths in the app (fs sandbox, write pipeline, rename/merge link rewriting, the LLM approval gate) are the *most* heavily tested areas.

### High

**H1 — IPC registration layer has no direct test coverage.**
All 19 `src/main/ipc/register-*.ts` modules lack a dedicated test (verified: each `register-*` basename has no matching file under `tests/`). These modules are the contract surface between renderer and main — they wire channel names to handlers, unwrap/validate args, and shape return values. The *underlying* operations (fs, graph, sources, publish) are well tested, and `tests/main/menu-accelerators.test.ts` covers menu wiring, but the registration glue itself — argument marshalling, error propagation, channel-name correctness — is exercised only indirectly and via the single e2e smoke boot. A renamed channel or a dropped `ipcMain.handle` would pass `lint` and the unit suite. Risk is bounded by the preload snapshot test (which locks the *renderer-facing* shape) and by `src/shared/channels.ts` being the shared constant source, but the main-side handler registration is a real blind spot.

**H2 — Full end-to-end coverage is a single smoke test (plus one packaging test).**
`tests/e2e/smoke.spec.ts` boots the app and asserts the welcome screen renders with no thrown errors; a second test asserts the *packaged* app opens a DuckDB-backed project (native-binding-shipped check). That is the entire e2e surface. The file's own comment is candid: file-tree interaction is deliberately excluded to keep the smoke fast, "add it once a regression of that shape actually slips through." This is a reasonable posture for a solo/small team, but it means no automated coverage of the *user-visible happy paths* (open project → edit note → save → graph reindex → query; run a conversation → approve a proposal → verify graph mutation). These flows are covered piecewise by unit/integration tests but never assembled end-to-end.

### Medium

**M1 — Svelte component render coverage is partial.**
92 `.svelte` components; 17 files under `tests/renderer/components/`. The gap is smaller than it looks because the team systematically **extracts component logic into testable `.ts` modules** (125 renderer `.ts` files, heavily tested — `tests/renderer/app/*`, `tests/renderer/editor/*`, `tests/renderer/stores/*`). Still, App.svelte is **2,001 lines** and orchestrates most workflows; its logic is tested via `tests/renderer/app/*-ops.test.ts` but the template/reactivity wiring inside the `.svelte` file is not render-tested. Complex interactive components (editor decorations, proposal panels, graph views) rely on their extracted logic being correct, which mostly holds, but leaves rune-level reactivity bugs (stale `$derived`, `$effect` ordering — see the MEMORY notes on Svelte 5 gotchas) discoverable only at runtime.

**M2 — Electron process-boundary glue is untested (mostly by necessity).**
Untested top-level main modules: `src/main/main.ts`, `menu.ts` (partial — accelerators tested), `window-manager.ts`, `session.ts`, `recent-projects.ts`, `privileged-sites.ts`, `security.ts` (CSP/window hardening — note `security-helpers.ts` *is* tested), `app-icon.ts`, `ipc.ts`, `auto-update.ts` *is* tested (`tests/main/auto-update.test.ts`). Most of these are Electron-lifecycle glue that is genuinely hard to unit test and is partially covered by the e2e smoke boot. The one worth flagging: **`security.ts`** (CSP, `webPreferences`, navigation guards) is a security-load-bearing file with no dedicated test asserting the hardening stays in place. A CSP or `contextIsolation` regression would only be caught by the smoke test's console-error assertion, which is indirect.

**M3 — Coverage floors gate only 3 of ~4 source areas.**
`vitest.config.ts` enforces thresholds for `src/shared/**` (70% lines), `src/main/llm/**` (55% lines / 38% branches), and `src/main/notebase/**` (80% lines / 65% branches). These are the correctly-chosen highest-risk areas (trust + security). But large, feature-rich trees — `src/main/publish/**`, `src/main/sources/**`, `src/main/graph/**`, `src/main/compute/**`, and the **entire renderer** — have *no* coverage floor. They are well-tested today, but nothing stops a future PR from adding an untested exporter or ingest adapter and regressing silently. The floors are a regression fence, and large parts of the yard are unfenced.

**M4 — Branch coverage on the LLM trust path is intentionally low (38% floor).**
The `src/main/llm/**` branch floor is 38% (config comment: "measured at floor-time ~46% branch"). For the single most safety-critical module family in the app — the one whose whole point is that the human confirms every mutation — 38% branch coverage as the *gate* is loose. The approval happy-path and the guard-bypass path are well covered (`approval.test.ts` is 511 lines; `write-guard-wired.test.ts`), but error branches, expiry/auto-reject windows, and malformed-proposal handling deserve tighter branch enforcement given the stakes.

### Low

**L1 — Only one benchmark, no performance-regression gate.**
`tests/main/graph/n3-cache.bench.ts` is the sole `.bench.ts`. The bundle-budget e2e test (`tests/e2e/bundle-budget.spec.ts`) is an excellent *startup-size* guardrail, but there is no automated check on graph-index/query latency, embedding throughput, or large-project responsiveness — the things that degrade a knowledge-base IDE as vaults grow. Currently a query-plan regression would only surface as user-perceived lag.

**L2 — No mutation testing or flake-retry policy.**
`vitest.config.ts` and `playwright.config.ts` set no `retry`; there is no mutation-testing tool (Stryker). Given the suite's maturity, mutation testing would be a high-signal way to find assertions that pass vacuously. Absence of retry is arguably *correct* (retries mask flakiness) — noting it, not faulting it.

**L3 — A11y checks are a smoke of modal surfaces only.**
`tests/renderer/a11y/dialogs.test.ts` + `tests/helpers/axe.ts` run axe-core against dialogs with `color-contrast` disabled (jsdom can't compute layout). Good that it exists and is CI-gated; it covers dialogs but not the editor, sidebar, graph view, or the source/PDF viewers. Reasonable scope for a keyboard-first pro tool, but the a11y net is narrow.

---

## Current Quality Assessment (Testing Metrics)

Numbers below are **measured** where labeled *(measured)* and **estimated qualitatively** where labeled *(estimate)* — no coverage run was executed for this review (it is CI-only via `pnpm coverage`; running it locally is slow and unnecessary given the config already documents the floors).

| Metric | Value | Basis |
|---|---|---|
| Test files | ~399 | *(measured)* `git ls-files 'tests/**'` filtered to test/spec |
| Test cases (`it`/`test`) | ~3,670 | *(measured)* grep |
| `describe` blocks | ~853 | *(measured)* grep |
| Source files (main `.ts`) | 179 | *(measured)* |
| Source files (renderer `.svelte` / `.ts`) | 92 / 125 | *(measured)* |
| Source files (shared `.ts`) | 90 | *(measured)* |
| CI-enforced coverage floors | 3 areas | *(measured)* `vitest.config.ts` |
| E2E test cases | 3 (2 smoke/packaging + 1 bundle budget) | *(measured)* |
| Benchmarks | 1 | *(measured)* |

**Coverage-by-module (estimate, from test-file→source-module mapping):**

| Area | Test density | Assessment |
|---|---|---|
| `src/shared/formatter/**` | Very high — ~60 rule test files, one-per-rule | **Excellent.** Table-driven, exhaustive. |
| `src/main/notebase/**` (fs, write pipeline, rename, merge) | Very high, 80% floor | **Excellent.** Security/data-loss path, correctly the best-covered. |
| `src/main/llm/**` (approval, tools, turtle) | High, 55%/38% floor | **Strong** on happy + bypass paths; branch coverage loose (M4). |
| `src/main/graph/**` (indexers, parser, queries) | High — ~35 test files | **Strong.** No floor (M3). |
| `src/main/sources/**` (ingest, adapters, excerpts) | High — ~35 test files | **Strong.** No floor. |
| `src/main/publish/**` (exporters) | High — ~30 test files, snapshots | **Strong.** No floor. |
| `src/main/skills/**` + `src/shared/tools/**` | High — ~25 test files | **Strong.** |
| `src/main/compute/**` (python/sql/sparql executors) | High — ~13 test files | **Strong.** |
| `src/main/embeddings/**` | High — 9 test files | **Strong.** |
| `src/main/ipc/register-*.ts` | **None direct** | **Gap (H1).** |
| Renderer `.svelte` components | Partial — 17/92 render-tested; logic extracted & tested | **Adequate, uneven (M1).** |
| Electron glue (main.ts, window-manager, session, security.ts) | None / smoke-only | **Gap by necessity (M2).** |

**Estimated overall line coverage: high, likely 70-85% across the tested trees**, but this is an *estimate* from density mapping — the only *enforced* numbers are the three floors. The honest summary: the code that *matters most* is the code that is *tested most*, which is the right shape.

---

## Quality Improvement Plan

Prioritized, each tied to a finding:

1. **(H1) Add IPC-registration integration tests.** For each `register-*.ts`, a lightweight test that stubs `ipcMain.handle`, invokes the registrar, and asserts (a) every expected channel from `src/shared/channels.ts` is registered, (b) a representative handler round-trips args → operation → serializable result. A single shared "channel completeness" test that diffs registered channels against `channels.ts` would catch dropped/renamed handlers cheaply.
2. **(H2) Grow the e2e suite by one happy-path per epic.** Add e2e cases for the two flows that define the product: *open project → edit → save → reindex → SPARQL query returns the new note*, and *conversation → proposal → approve → graph reflects it*. Keep the "add on incident" discipline but seed these two now.
3. **(M3) Add coverage floors for `publish`, `sources`, `graph`, `compute`** at conservative levels (set below current, per the existing `#679` convention) so new untested code in those trees fails CI.
4. **(M4) Raise the `src/main/llm/**` branch floor** toward measured (~46%) and add tests for proposal expiry/auto-reject and malformed-bundle error branches.
5. **(M2) Add a `security.ts` assertion test** — a unit test that constructs the window `webPreferences`/CSP and asserts `contextIsolation: true`, `nodeIntegration: false`, and the CSP string shape, so a hardening regression fails a fast unit test, not just the smoke boot.
6. **(M1) Render-test the top 5-10 highest-traffic components** (ProposalsPanel already done; add editor host, sidebar tree, source/PDF viewer) focusing on rune reactivity, per the known Svelte 5 `$derived`/`$effect` gotchas in team memory.

---

## Testing Strategy / Test Pyramid (adapted to Electron)

Minerva's pyramid is **correctly shaped** for a desktop app:

```
        ╱ E2E (Playwright + Electron) ╲        ← 3 cases: boot smoke, DuckDB packaging, bundle budget
       ╱   Integration (main process)   ╲       ← temp-project graph/fs/approval round-trips (helpers/temp-project.ts)
      ╱  Component (Svelte + testing-lib) ╲      ← 17 component files + a11y dialogs
     ╱   Unit (shared/main pure logic)     ╲     ← the broad base: ~3,600 cases
    ╱─────────────────────────────────────────╲
```

- **Base (unit):** dominant and excellent — formatter rules, graph parsing, skills, tools, turtle, sources. Fast (`test:watch` stays sub-second per the config rationale).
- **Integration:** strong via `tests/helpers/temp-project.ts` (`useGraphProject`/`makeGraphProject`/`withTempProject`) which spins a real temp dir + graph and guarantees teardown. This is the right seam for an fs/graph app — real files, real N3 store, no mocking of the core.
- **Component:** present but the thinnest layer relative to component count; logic-extraction compensates.
- **E2E:** deliberately minimal, scoped to "did the app boot and did the native bindings ship." Correct instinct (Electron boot is slow); under-invested for user-flow regressions (H2).

**Recommendation:** keep the shape; thicken the integration→e2e transition with the two happy-path flows in step 2 above. Do **not** invert the pyramid with heavy e2e.

---

## Test Automation

- **Runner:** vitest 4 (`vitest run` / `vitest` watch), v8 coverage provider, Svelte + testing-library plugins wired in `vitest.config.ts`.
- **E2E:** Playwright (`@playwright/test`) scoped strictly to `tests/e2e/`, single worker, 60s timeout — correctly isolated from the unit loop.
- **Fixtures:** a realistic hand-authored `tests/fixtures/sample-project/` (notes, research, `.minerva/` sources/excerpts, CSV, TTL) — good, representative test data.
- **Shared helpers:** `temp-project.ts` (lifecycle + teardown) and `axe.ts` (a11y) — the right level of shared infra, introduced only once duplication was warranted (`#678`, consistent with the team's documented "duplication is OK until fixtures exist" philosophy).
- **Snapshots:** used judiciously — preload bridge, CSL publish output. Not over-used.

**Automation is in good shape.** The one automation gap is a **channel-completeness generator** (H1) and **no scheduled/perf job** (L1).

---

## Quality Gates (the REAL gates)

Three-layer, all verified:

1. **Pre-push hook** (`.githooks/pre-push`, activated by the `prepare` script setting `core.hooksPath`): runs `pnpm lint` (= `tsc --noEmit && svelte-check --threshold error && eslint .`). Fast (~30s), catches type/template/lint failures locally. Bypass: `git push --no-verify` or `SKIP_HOOKS=1`. **This is a lint gate, not a test gate** — it does *not* run vitest, by design (keeps push friction low).
2. **CI `lint-and-test` job** (`.github/workflows/ci.yml:27-81`, macos-latest, 20-min timeout): `pnpm lint` then **`pnpm coverage`** — the full suite with v8 instrumentation *and the three enforced floors*. This is the real test gate. Codecov upload is non-fatal (trend-only). Runs on `push` to main and all PRs, with in-flight cancellation.
3. **CI `e2e` job** (`ci.yml:83-122`, macos-latest, 25-min, parallel): `electron-forge package` + Playwright smoke + bundle-budget.

**Assessment:** the gate design is thoughtful and well-documented in the workflow comments. macos-latest-only is a *justified* choice (comments: chokidar watcher tests exercise macOS fsevents; e2e needs a darwin `.app`). The one structural observation: **the pre-push hook does not run tests**, so a test-breaking change can be pushed and only fails in CI — acceptable given fast CI feedback, but worth knowing.

---

## Defect Prevention

**Strong.** The codebase's defining QA trait is *encoding invariants as tests*:

- **Trust invariant as a fatal test** (`write-guard-wired.test.ts`, `write-guard.test.ts`) — the single best defect-prevention mechanism here. It makes "LLM writes must go through approval" *impossible to regress silently* under CI.
- **Preload bridge snapshot** — prevents API-surface drift (documented in team memory as the gotcha that lint/targeted tests miss).
- **CLAUDE.md LLM/Graph code-review checklist** — a human gate complementing the automated one.
- **Bundle-budget guardrail** — prevents lazy-loading regressions.
- **`assert-safe-path-coverage.test.ts`** — the path-traversal sandbox has a dedicated coverage test.

**Gap:** the `TOOL_CALLBACK_KEYS` allowlist gotcha (from team memory — a new LLM tool needing a renderer surface silently fails if not added) is a known defect class with no automated guard. A test asserting every registered conversation tool with a renderer callback is present in `TOOL_CALLBACK_KEYS` would prevent that recurring foot-gun.

---

## Test Data Management

**Good.** `tests/fixtures/sample-project/` is a single, realistic, git-tracked knowledge base reused across the main suite; the e2e DuckDB test *copies* it before mutating (`smoke.spec.ts`) so runs can't dirty the tracked fixture. `temp-project.ts` generates ephemeral projects with guaranteed teardown. No secrets or PII in fixtures. No test-data staleness concern observed. One minor note: binary fixtures (`original.pdf`, `original.html`) live in git — fine at this scale, watch repo bloat over time.

---

## Performance Testing

**Largely N/A as a formal discipline for a local single-user app** — there is no server to load-test, no concurrency to soak. What *does* apply is client-side responsiveness at scale (large vaults, big graphs, embedding throughput), and that is **under-covered** (L1): a single `n3-cache.bench.ts` and the bundle-budget guardrail. Recommend adding a small set of `.bench.ts` for graph query/index and embedding pooling, run manually or in a non-gating scheduled job. Load/stress/soak testing: **N/A** (no shared backend).

---

## Security Testing

- **DAST / penetration testing of endpoints:** **N/A** — no network-exposed endpoints. The one exception is the clipper local HTTP server (`src/main/clipper/clipper-server.ts`), which *is* tested (`tests/main/clipper/clipper-server.test.ts`) including pairing (`tests/shared/clipper-pairing.test.ts`).
- **What applies and is covered:** path-traversal sandbox (`assert-safe-path-coverage.test.ts`, `security-helpers.test.ts`), the LLM approval/write-guard trust boundary (heavily tested), `python-safety.test.ts` for the compute sandbox.
- **Gap:** `security.ts` (CSP / `webPreferences` / navigation hardening) has no dedicated assertion test (M2). This is the one security-relevant file relying solely on the e2e smoke's console-error check. `contextIsolation` and CSP are the app's real security boundary; assert them directly.

Overall the security-testing posture is appropriate for a local Electron app and better than typical.

---

## Accessibility Testing

axe-core smoke exists and is CI-gated (`tests/renderer/a11y/dialogs.test.ts`), scoped to modal dialogs with `color-contrast` disabled (jsdom limitation, correctly documented). This is a keyboard-first professional tool, so the bar is "no ARIA/role/label/focus-trap regressions," which the dialog smoke enforces for modals. **Gap (L3):** editor, sidebar, graph, and viewers aren't a11y-tested. Color-contrast verification is inherently a real-browser/manual concern — **partially N/A** for automated jsdom tests; recommend a periodic manual axe pass in a real Chromium (or a Playwright-driven axe run in the e2e job, which *can* compute layout).

---

## Cross-Platform / Cross-Browser Testing

- **Cross-browser matrix:** **N/A** — Minerva ships its own Electron/Chromium; there is exactly one rendering engine. No browser matrix applies.
- **Cross-platform (OS):** CI runs **macOS-only**, a documented and justified constraint (fsevents watcher semantics, darwin `.app` for e2e). This is a **real but accepted limitation**: Windows/Linux packaging and watcher behavior are not automatically verified. For a `Road to 1.0` that targets macOS first (per team memory: signing/notarization done), this is defensible. If/when Windows/Linux ship, the watcher tests (`tests/main/notebase/watcher.test.ts`) and e2e will need per-platform runners — the CI comments already anticipate this.

---

## Monitoring & Observability (of quality)

- **Codecov** integration is wired but non-fatal/trend-only (activates when `CODECOV_TOKEN` is set) — the *floors* are the gate, Codecov is the trend view. Reasonable.
- **No test-flakiness dashboard, no CI duration tracking, no coverage-trend alerting** beyond Codecov. At this team size, acceptable. The `text-summary` coverage reporter lands in CI stdout for spot-checks.
- **Recommendation:** once Codecov is live, add a per-area trend view for the *unfenced* trees (M3) so silent erosion is at least *visible* even before floors are added.

---

## Risk-Based Testing

The suite already reflects risk-based prioritization — the two highest-risk boundaries (data loss via fs/rename/merge; trust via LLM→graph) have the highest coverage *and* the only enforced floors. Risk ranking and current state:

| Risk area | Impact | Test state |
|---|---|---|
| Data loss (fs, write pipeline, rename/merge) | Critical | **Best-covered + 80% floor.** Well-managed. |
| Trust bypass (LLM writes graph directly) | Critical | **Fatal invariant test + 55% floor.** Well-managed. |
| Path traversal | High | Dedicated coverage test. Managed. |
| IPC contract drift | High | Preload side locked; **main side gap (H1).** |
| CSP / context-isolation regression | High | **Only smoke-covered (M2).** |
| Graph/query correctness at scale | Medium | Functionally tested; **no perf gate (L1).** |
| Component reactivity bugs | Medium | Logic tested; render partial (M1). |
| Cross-platform behavior | Medium | **macOS-only (accepted).** |

The residual risk concentrates in **IPC wiring (H1)** and **CSP (M2)** — both High-impact, both currently under-gated.

---

## Continuous Improvement

Practices already in place that indicate a healthy improvement loop: floors "set below current with headroom" so refactors don't flap (`#679`); fixtures introduced only when duplication warranted (`#678`); e2e cases added "per incident"; issue-referenced test comments throughout (each test file cites the `#NNN` it addresses, giving excellent traceability). **Keep these.** Add: a lightweight "when you touch an LLM tool, add it to `TOOL_CALLBACK_KEYS` and assert it" checklist item, and periodic review of the *unfenced* coverage trees.

---

## Estimated Impact

Implementing the plan (H1-H2, M1-M4) would:

- Close the two High-severity gaps (IPC wiring, e2e happy-paths), removing the largest silent-regression surfaces.
- Extend regression fences (floors) from ~4 trees to the whole `src/main` feature set, converting "well-tested today" into "can't-regress tomorrow."
- Tighten the trust-path branch gate on the app's most safety-critical code.
- Estimated effort: **~2-3 focused days** for H1 (channel-completeness + per-registrar smoke is mostly mechanical), **~1-2 days** for the two e2e flows, **~0.5 day** for the floors and the `security.ts` assertion. High ROI, low risk — these are additive tests over a stable base.

---

## Implementation Roadmap

**Phase 1 (highest ROI, ~3 days):**
- H1: channel-completeness test (diff registered channels vs `src/shared/channels.ts`) + one round-trip smoke per `register-*.ts`.
- M2: `security.ts` webPreferences/CSP assertion test.
- M3: add conservative coverage floors for `publish`, `sources`, `graph`, `compute`.

**Phase 2 (~2 days):**
- H2: two e2e happy-path flows (edit→save→query; conversation→approve→graph).
- M4: raise LLM branch floor; add proposal-expiry / malformed-bundle branch tests.
- Defect-prevention: `TOOL_CALLBACK_KEYS` completeness test.

**Phase 3 (opportunistic):**
- M1: render-test top interactive components.
- L1: graph/embedding `.bench.ts` in a non-gating scheduled job.
- L3: Playwright-driven axe run over the main workspace in the e2e job.

---

## Success Metrics

- **IPC coverage:** 0 → 19 registrars with a direct/channel-completeness test; channel drift caught pre-merge.
- **Enforced floors:** 3 → 7 source trees fenced.
- **E2E flows:** 1 boot smoke → 3+ user-flow assertions.
- **LLM branch floor:** 38% → ~45% (at measured level), with expiry/error branches covered.
- **Security:** CSP/context-isolation asserted in a fast unit test (not smoke-only).
- **Leading indicator:** every new `register-*` channel and every new LLM tool ships with its guard test in the same PR (enforce via the CLAUDE.md checklist).

---

### What's already strong (do not disturb)

- The **approval/trust invariant as a fatal test** — this is the crown jewel; protect it.
- The **preload contextBridge snapshot**.
- The **temp-project integration harness** with guaranteed teardown.
- The **per-rule formatter test discipline** and issue-referenced traceability.
- The **bundle-budget** and **DuckDB-packaging** guardrails — exactly the "the app stopped working entirely" regressions e2e should catch.
- **Risk-aligned floors** on the two critical paths.

---

## Key File References

- Test config / floors: `/Users/davegriffith/minerva/vitest.config.ts` (thresholds at the `thresholds:` block)
- CI gates: `/Users/davegriffith/minerva/.github/workflows/ci.yml:27` (lint-and-test), `:83` (e2e)
- Pre-push gate: `/Users/davegriffith/minerva/.githooks/pre-push`
- Trust invariant test: `/Users/davegriffith/minerva/tests/main/graph/write-guard-wired.test.ts:57`
- Write-guard unit: `/Users/davegriffith/minerva/tests/main/graph/write-guard.test.ts`
- Approval engine tests: `/Users/davegriffith/minerva/tests/main/llm/approval.test.ts`
- Preload snapshot: `/Users/davegriffith/minerva/tests/preload/preload-bridge.test.ts` (+ `__snapshots__/`)
- E2E smoke + packaging: `/Users/davegriffith/minerva/tests/e2e/smoke.spec.ts`
- Bundle budget: `/Users/davegriffith/minerva/tests/e2e/bundle-budget.spec.ts`
- A11y smoke: `/Users/davegriffith/minerva/tests/renderer/a11y/dialogs.test.ts` + `/Users/davegriffith/minerva/tests/helpers/axe.ts`
- Integration harness: `/Users/davegriffith/minerva/tests/helpers/temp-project.ts`
- Untested IPC layer: `/Users/davegriffith/minerva/src/main/ipc/register-*.ts` (19 modules)
- Untested security file: `/Users/davegriffith/minerva/src/main/security.ts`
- Playwright config: `/Users/davegriffith/minerva/playwright.config.ts`
