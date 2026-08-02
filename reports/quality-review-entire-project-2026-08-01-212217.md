# Quality Assurance Review — Minerva (whole project)

**Date:** 2026-08-01
**Scope:** Entire codebase (`/Users/davegriffith/minerva`)
**Reviewer:** QA review (analysis-only; no source or test files were modified)
**Stack:** Electron + Svelte 5 (runes) + TypeScript; RDF/SPARQL graph; **vitest** for unit/integration, **Playwright + Electron** for e2e. Not Jest/JUnit/pytest, not Selenium/Cypress.

---

## Executive Summary

Minerva has a **mature, above-average QA posture for a solo/desktop project**. The test suite is large and real (542 `*.test.ts` files across a well-organized `tests/` tree), CI enforces meaningful gates rather than rubber-stamping, and the most important architectural invariant — the LLM "propose, human confirms" trust model — is protected by a *purpose-built automated integrity gate* and a *fatal-under-test write guard*. This is genuinely strong; several mechanisms a generic QA review would recommend building **already exist and work well**.

The quality risk is not the tested core — it is **concentrated in a few large, recently-grown UI/orchestration files that carry high blast radius and thin or zero direct tests**:

1. **`src/main/ipc/register-conversation.ts`** (967 lines, the `CONVERSATION_SEND` LLM orchestration + streaming/abort/retry/`ask_user` handler) has **no main-process test**, and `src/main/ipc/**` has **no coverage floor** in `vitest.config.mts`. This is the single highest-value gap: it is the entry point where LLM output meets the approval engine and the write guard.
2. **`src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte`** (1127 lines) contains a **YAML frontmatter round-trip engine** (parse → rows → rewrite) with **zero tests** — a data-loss-shaped surface.
3. **`src/renderer/lib/components/SourceDetail.svelte`** (1365 lines) has **no component render test** (only its extracted `source-actions` logic is covered).

Good news on the recent object-type work (#1584–#1588): the dialogs a prior refactoring review flagged as untested — `TypeEditorDialog.svelte`, and the type settings/panels — **now have real behavioral tests** (`TypeEditorDialog.test.ts`, `TypePropertiesPanel.test.ts`, `ObjectTypesSettings.test.ts`, `TypeView.test.ts`, plus `tests/main/types/{loader,migrate,write}.test.ts` and `tests/shared/objects/*`). That flag is substantially closed. The one genuinely still-open item from that list is the **note** `PropertiesPanel` YAML engine (distinct from `TypePropertiesPanel`) and the `CONVERSATION_SEND` handler.

---

## QA Findings by Priority

### Critical

**C1 — `CONVERSATION_SEND` LLM orchestration is untested and ungated.**
- File: `/Users/davegriffith/minerva/src/main/ipc/register-conversation.ts` (967 lines).
- The handler owns LLM streaming callbacks, abort handling (`controller.signal`, in-flight `ask_user` prompt rejection on abort, lines ~233–254, 419), a 400-error string-match retry path (~320–386), and it dispatches conversation-draft/refactor/set-properties writes through `approval.proposeWrite` + `approveProposal` (~430–562), including the `graph.withLLMContext` wrap that arms the write guard.
- **No test file targets it.** `grep` for `register-conversation` / `CONVERSATION_SEND` across `tests/main` returns nothing. The renderer-side `tests/renderer/stores/conversations-store.test.ts` exercises the *store*, not this handler.
- `vitest.config.mts` has **no threshold for `src/main/ipc/**`**, so this code has no coverage floor at all — it can regress silently.
- **Why critical:** this is exactly the "LLM meets graph" boundary the CLAUDE.md trust checklist governs. The trust-integrity gate (C-credit below) proves the *approval engine* is honest, but it does not prove *this handler routes through it* on the streaming/abort/retry paths. A regression that dropped a `withLLMContext` wrap or auto-approved the wrong bundle would not be caught by an existing test.
- **Failure scenario:** an edit to the abort path leaves an `ask_user` promise unresolved on a cancelled send → renderer conversation hangs; no test fails.

### High

**H1 — `PropertiesPanel.svelte` YAML round-trip engine has zero tests.**
- File: `/Users/davegriffith/minerva/src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte` (1127 lines).
- Header comment describes the exact risk: *"Edits round-trip through the YAML parser … editor buffer ─parsed→ rows ─UI edits→ rewritten YAML."* It uses `YAML.parseDocument`, handles scalars/seqs/maps, and slices the frontmatter block back into `content` by computed offsets (lines ~89–210).
- **No test imports this file.** `TypePropertiesPanel.test.ts` covers a *different* component (`right-sidebar/TypePropertiesPanel.svelte`).
- **Why high:** frontmatter rewriting is a data-loss surface — a mis-serialized seq, a dropped comment, or a wrong fence offset corrupts the user's note metadata on save. The parse/rewrite logic is pure-ish and highly testable (round-trip property assertions), yet has nothing.
- **Recommended:** extract the pure parse/serialize/offset logic into a `*.ts` module and unit-test round-trips (scalar, list, nested map, comment preservation, empty/malformed frontmatter, non-map document → the `!YAML.isMap` guard at line 140).

**H2 — `SourceDetail.svelte` (1365 lines) has no component render test.**
- File: `/Users/davegriffith/minerva/src/renderer/lib/components/SourceDetail.svelte`.
- Coverage today is indirect only: `tests/renderer/sources/source-actions.test.ts` tests extracted `renameSource`/`deleteSource` logic, and `tests/main/graph/source-detail.test.ts` covers the graph side. The largest source-viewer component itself is unrendered by any test.
- **Why high:** it is the second-largest renderer file, hosts the source Tools menu / `propose_source_properties` surface (a gated LLM write path per CLAUDE.md), and metadata edits here feed `meta.ttl`. Regressions surface only via manual use or the thin e2e smoke.

### Medium

**M1 — No global coverage floor; several trees are ungated.**
- `vitest.config.mts` sets thresholds per glob only (`src/shared`, `src/main/llm`, `src/main/notebase`, `src/main/publish`, `src/main/sources`, `src/main/graph`, `src/main/compute`, three `src/main/security*` files, `src/main/auto-update.ts`, `src/renderer`). There is **no fallback/global threshold**.
- Consequence: `src/main/ipc/**` (C1), `src/main/types/**` (the new object-type compile/parse pipeline), `src/main/git/**` (0% at baseline), and `src/main/formatter/**` land new code with **no floor**. A brand-new untested main module cannot fail the gate unless it happens to sit under a gated glob.
- **Recommended:** add a modest global floor (e.g. lines/functions 30–40%) as a backstop so *new ungated trees* can't ship at 0%, keeping the tuned per-area floors as the real gates.

**M2 — Renderer coverage floor is low (42% L / 34% B) against the largest defect surface.**
- `src/renderer/**` is 110 `.svelte` + 161 `.ts` files and, per the baseline, the biggest and most volatile user-facing surface. The floor is deliberately set below measured (documented as ratcheting: bucket A done #1451, bucket B pending #1452). This is a *reasonable* strategy, but H1/H2 show large individual components slipping under the aggregate floor. Per-file floors on the few 1000+-line components would catch that better than the aggregate alone.

**M3 — Coverage baseline report is stale (2026-04-26, ~3 months old).**
- `/Users/davegriffith/minerva/reports/coverage-baseline-2026-04-26.md` predates a large amount of work (object types, more renderer tests). Its headline (34.67% stmts) understates the current picture and its `src/main/git 0%` / `src/main/llm ~85%` rows may no longer hold. The *live* gate is `vitest.config.mts`; the report should be regenerated (`pnpm coverage`) so the committed narrative matches reality.

### Low / Observations

- **L1 — `src/main/git/**` was 0% at baseline.** Not re-verified live here; if still uncovered it underpins the publish story (#254). Worth a targeted check.
- **L2 — e2e is single-platform (macOS only), by explicit design** (ci.yml comments: fsevents watcher semantics, darwin Electron bundle). Acceptable for a macOS-first app; note it as a known coverage boundary if Windows/Linux ship later.
- **L3 — Test-quality spot-check is positive.** `TypeEditorDialog.test.ts` drives the real form (input, add/reorder/remove property rows, disabled-Create guard) and asserts the exact save payload — behavioral, not shallow. `trust-integrity.test.ts` drives the real approval engine across honest/bypass/pending/human/mixed cases. No evidence of assertion-free "it renders" filler in the sampled files.

---

## Current Quality Assessment

**What's genuinely strong (credit where due — do NOT rebuild these):**

- **Trust-model integrity gate** — `tests/main/graph/trust-integrity.test.ts` promotes the CLAUDE.md "unreviewed LLM writes" SPARQL into an executable gate (`findUnreviewedLLMWrites` in `src/main/graph/integrity.ts`), asserted on every PR with honest-path, bypass, pending-only, human-authored, and mixed-graph cases. Exemplary defect-prevention.
- **Write guard, fatal under test** — `enterLLMContext`/`withLLMContext` + `checkLLMWriteGuard` throw under vitest so an approval-engine bypass fails CI (non-fatal warn in prod). Enforced invariant, not aspiration.
- **Preload contract test** — `tests/preload/preload-bridge.test.ts` snapshots the full `window.api` surface; the config even documents *why* preload gets a snapshot gate instead of a line floor. Correct instinct.
- **Skills-eval golden files** — `tests/skills-eval/*/output/request.json` snapshot each skill's compiled prompt (CI diff catches prompt drift) — ~70 skills covered.
- **Tuned per-area coverage floors** — `vitest.config.mts` gates the trust (`llm`), security (`notebase`, `security*.ts`), and feature trees with headroom-below-measured floors, enforced via `pnpm coverage` on every PR (ci.yml). This is well beyond a single blunt global number.
- **Blocking supply-chain gate** — `audit:prod` (shipped deps, high+critical) is blocking (#1455); `audit:all` visibility-only, with a documented promotion path and `pnpm.overrides` remediation.
- **e2e beyond smoke** — `tests/e2e/` has `smoke`, `happy-paths`, `journeys`, plus `a11y.spec.ts` (axe-core), `focus-trap.spec.ts`, and `bundle-budget.spec.ts` (a size regression gate).
- **Local fast feedback** — pre-push hook runs `lint:fonts` + `pnpm lint` (tsc + svelte-check + eslint) so drift is caught before CI.

**Quality metrics (substantiated only):**

| Metric | Value | Source |
|---|---|---|
| Test files | **542** `*.test.ts` | `find tests -name '*.test.ts'` |
| Test count (baseline) | ~1587 across 162 files | coverage-baseline-2026-04-26.md (now higher) |
| Statement/line coverage (baseline) | 34.67% (skewed low by untested Svelte bodies) | baseline report |
| Branch / function coverage (baseline) | 81.5% / 78.9% | baseline report |
| Live coverage % (current) | **Unknown — baseline is stale; regenerate** | — |
| CI gates | lint, `pnpm coverage` (per-area floors), `audit:prod`, e2e | ci.yml |

---

## Improvement Plan

Ordered by value-to-effort:

1. **(C1) Add a main-process test for `register-conversation.ts`.** Mock the LLM client; assert: (a) a conversation-draft send files a proposal via `proposeWrite` and auto-approves it, (b) the send runs inside `withLLMContext` so a direct-write regression trips the guard, (c) abort resolves/rejects pending `ask_user` prompts, (d) the 400-retry path is taken once. Then add `src/main/ipc/**` to `vitest.config.mts` thresholds.
2. **(H1) Extract + unit-test the PropertiesPanel YAML engine.** Move parse/serialize/offset logic to a pure `*.ts`; assert round-trips and edge cases (non-map doc, comments, empty frontmatter).
3. **(H2) Add a `SourceDetail.svelte` render test** covering metadata display, the read-status/rename/delete actions wired to the store, and the source Tools/propose-properties entry point.
4. **(M1) Add a global coverage floor backstop** so new ungated trees can't ship at 0%.
5. **(M3) Regenerate `pnpm coverage` and refresh the baseline report** to today's tree.
6. **(M2/L1) Per-file floors on the 1000+-line components** and a live check of `src/main/git/**`.

---

## Testing Strategy

- **Shift-left:** already strong — pre-push lint, per-area floors, write-guard-under-test. Extend by *requiring a test with each new `register-*` IPC handler* (add to the LLM/graph PR checklist in CLAUDE.md).
- **Risk-based prioritization:** target the three large high-blast-radius files above before chasing aggregate %. They concentrate data-loss (YAML) and trust-boundary (CONVERSATION_SEND) risk.
- **Golden/snapshot** for prompt + preload contracts is the right tool and is in place; keep it.
- **Continuous testing:** CI runs full `pnpm coverage` + e2e on every PR/push with in-flight cancellation.

### Testing Pyramid — what CI ACTUALLY enforces

- **Static/lint (base):** `pnpm lint` = `tsc --noEmit` + `svelte-check --threshold error` + `eslint .` — run locally (pre-push) and in CI. Also `lint:fonts`.
- **Unit + integration (bulk):** `pnpm coverage` = `vitest run --coverage` with per-area v8 thresholds. 542 test files spanning `tests/{shared,main,renderer,preload,cli,clipper,skills-eval}`.
- **e2e (thin, by design):** `pnpm test:e2e` = electron-forge package + Playwright, macOS-only, 6 specs incl. a11y/focus-trap/bundle-budget.
- **Perf:** `pnpm bench` (vitest bench) with `scripts/bench-check.mjs` baseline comparison (separate `bench.yml`).
- **Supply chain:** `pnpm audit --prod` (blocking) + full-tree audit (visibility).
- **Missing rung:** no global coverage backstop (M1); no main-process test at the IPC-handler layer for the conversation path (C1).

---

## Quality Gates

| Gate | Enforced? | Where |
|---|---|---|
| Type check (tsc) | ✅ blocking | pre-push + ci.yml |
| svelte-check (errors) | ✅ blocking | pre-push + ci.yml |
| eslint (incl. renderer `api.*` mutation rule) | ✅ blocking | pre-push + ci.yml |
| Font-literal lint | ✅ blocking | pre-push |
| Unit/integration tests | ✅ blocking | ci.yml (`pnpm coverage`) |
| Per-area coverage floors | ✅ blocking (llm/notebase/graph/sources/publish/compute/security/renderer/shared) | vitest.config.mts |
| **Global coverage floor** | ❌ **absent** | — (M1) |
| **`src/main/ipc` coverage floor** | ❌ **absent** | — (C1) |
| Preload surface contract | ✅ blocking | preload-bridge snapshot |
| Trust-integrity (LLM writes) | ✅ blocking | trust-integrity.test.ts |
| Prompt drift (skills) | ✅ blocking | skills-eval golden files |
| e2e smoke + a11y + bundle budget | ✅ blocking | ci.yml e2e job |
| Prod dependency CVEs | ✅ blocking | ci.yml audit:prod |
| Codecov upload | ⚠️ non-fatal trend-only | ci.yml |

---

## Defect Prevention

- **Approval engine + write guard + integrity query** form a three-layer defense on the highest-consequence invariant (LLM never writes the graph directly). This is the model to emulate elsewhere.
- **Extend the same discipline to C1:** the guard only fires if the offending write runs in LLM context — so the *test* that proves `CONVERSATION_SEND` enters LLM context is what makes the guard meaningful for that path. That test is the missing prevention control.
- **Encode the "new IPC handler ⇒ test + threshold" rule** into the LLM/Graph PR checklist so ungated handlers stop appearing.

---

## Risk-Based Testing

| Area | Blast radius | Current coverage | Priority |
|---|---|---|---|
| `register-conversation.ts` (CONVERSATION_SEND) | Very high (LLM↔graph, streaming, abort) | None (ungated) | **C1** |
| `PropertiesPanel.svelte` YAML engine | High (note metadata data-loss) | None | **H1** |
| `SourceDetail.svelte` | High (source meta.ttl, gated LLM path) | Indirect only | **H2** |
| Approval engine / graph / notebase / security | High | Strong (gated + integrity) | maintain |
| Object types (#1584–88) | Medium | Now covered (dialogs + main pipeline) | maintain |
| `src/main/git` (publish) | Medium | 0% at baseline; re-verify | L1 |

---

## Template Sections — Not Applicable (honest N/A)

- **Cross-browser matrix (Chrome/Firefox/Safari/Edge):** N/A — desktop Electron app, single Chromium runtime; no browser matrix exists or is needed.
- **JMeter / k6 / Gatling load & throughput targets:** N/A — local single-user desktop app, no server request surface. Perf is covered by `vitest bench` + `bench-check.mjs` instead.
- **Postman / REST API contract collections:** N/A — no HTTP API; the equivalent contract surface is IPC channels, gated by the preload snapshot test.
- **DAST / penetration testing / WAF:** N/A — no exposed web endpoint. The relevant security controls are the fs path-traversal sandbox (`assertSafePath`), the remote-content trust boundary (`src/main/security*.ts`, well-tested), and `audit:prod`.
- **Mobile / responsive device testing:** N/A — desktop only.
- **Selenium/Cypress:** N/A — Playwright-Electron is the e2e tool.

---

## Estimated Impact

- **C1 + H1 + H2** close the three concentrated high-blast-radius gaps for roughly a handful of focused test files — the highest defect-prevention ROI available, disproportionate to effort because the surrounding infrastructure (happy-dom, approval-engine fixtures, testing-library) already exists.
- **M1** (global floor) is a one-line-config backstop that prevents whole new trees from shipping untested.
- Together these convert the current "strong core, a few soft giants" shape into uniformly-gated coverage without chasing the (misleading) aggregate percentage.

---

## Roadmap

- **Now (this sprint):** C1 (conversation handler test + `src/main/ipc` floor), M3 (regenerate coverage baseline).
- **Next:** H1 (extract + test YAML engine), H2 (SourceDetail render test).
- **Then:** M1 (global backstop floor), M2 (per-file floors on 1000+-line components), L1 (git coverage check), continue the documented renderer ratchet (bucket B, #1452).

## Success Metrics

- `src/main/ipc/**` gated with a passing floor; a deliberately-introduced `withLLMContext` regression in `CONVERSATION_SEND` fails a test.
- `PropertiesPanel` YAML round-trip covered by unit tests incl. malformed/empty/comment cases.
- `SourceDetail.svelte` exercised by a render test.
- A global coverage floor exists; no source tree sits at 0% unintentionally.
- Committed coverage baseline reflects the current tree (regenerated).
- Zero regressions in the trust-integrity, write-guard, and preload-contract gates (maintain green).
