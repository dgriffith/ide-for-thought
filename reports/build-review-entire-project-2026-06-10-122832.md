# Build System & CI/CD Review — Minerva (entire project)

**Date:** 2026-06-10
**Scope:** Build performance, CI/CD pipeline structure, artifact/distribution, developer-experience caching.
**Method:** Read all build configs; ran real timings on the dev machine (macOS, Apple Silicon, Node 25.9.0, pnpm 10.33.0).
**Relationship to prior reports:** Dependency currency (Electron 35→42, Vite/Vitest/TS bumps, dead `@types`) is owned by the modernization report and only referenced here. The CI test/E2E *gate* (lint + test + parallel Playwright) is owned by the quality report; this report builds on it by mapping pipeline *waste* (caching, redundant installs, serial steps) and the *release/signing/auto-update* surface.

---

## Executive Summary

For a single-developer Electron project, Minerva's build and CI setup is **clean, honest, and correctly scoped** — and the inline comments in `ci.yml`, `forge.config.ts`, `playwright.config.ts`, and `vitest.config.mts` explain *why* each decision was made, which is rare and excellent. Three Vite builds are wired through one forge config; CI gates every PR with lint + test in one job and Electron E2E in a parallel job; concurrency-cancellation is already configured; the pnpm store is cached.

The build is also genuinely **fast**. Measured on this machine:

| Step | Wall time | Notes |
|------|-----------|-------|
| `pnpm lint` (tsc + svelte-check + eslint, serial) | **~29 s** | 44 s user / 165% CPU — runs serially |
| `pnpm test` (vitest run, 2733 tests / 263 files) | **~41 s** | 658% CPU — well parallelized |
| `pnpm package` (3 Vite prod bundles + electron-forge package, no makers) | **~25 s** | warm `node_modules` |

So there is **no build-performance crisis** here. The real gaps are at the two ends of the pipeline that an Electron app eventually needs and this one has not yet built:

1. **There is no release/distribution pipeline at all.** CI runs checks only — `electron-forge make` (the DMG/ZIP makers) never runs in CI, and there is no workflow that produces, signs, notarizes, or publishes a build. The makers exist in `forge.config.ts` but are exercised only by hand on the dev's machine.
2. **No code signing, no notarization, no auto-update.** A DMG produced today is unsigned and un-notarized — on a clean Mac, Gatekeeper will refuse it. There is no `electron-updater` / `setFeedURL` anywhere, so shipped builds cannot self-update.

Neither is a *defect* for a pre-1.0, single-dev tool that isn't distributed yet — but they are the load-bearing work between "it builds on my machine" and "someone else can install it." The remaining findings are small DX/caching wins (Node version unpinned, TS not incremental, lint runs serially).

**Critical: 0. High: 3. Medium: 4. Low: 3.** No invented enterprise problems.

---

## Build System Findings

### Critical
None. The build works, is reproducible from `pnpm install --frozen-lockfile`, and CI gates correctness on every PR.

### High

**B-H1 — No release/distribution pipeline; `make` never runs in CI.**
`.github/workflows/ci.yml` has exactly two jobs (`lint-and-test`, `e2e`) and both stop at *checks*. The DMG/ZIP makers in `forge.config.ts:14-17` are only ever invoked by a human running `pnpm build` locally. Consequences:
- The `make` path is **untested by CI** — a maker regression (e.g. a DMG-build break after an `@electron-forge/maker-dmg` bump) is invisible until release day.
- No artifacts are uploaded anywhere (`actions/upload-artifact` appears nowhere), so there is no way to download a build of a given PR/commit for manual QA.
- There is no tag/version → published-release flow.

This is the single biggest structural gap. Even before signing, a `release.yml` triggered on tag push that runs `pnpm build` and `actions/upload-artifact` (or `softprops/action-gh-release`) would close the "untested make path" and "no downloadable build" holes cheaply.
*Refs:* `.github/workflows/ci.yml:26-85`, `forge.config.ts:14-17`.

**B-H2 — macOS builds are unsigned and un-notarized.**
`grep` for `osxSign`, `osxNotarize`, `notarize`, `hardenedRuntime`, `CSC_*`, `APPLE_*` across `forge.config.ts` and `package.json` returns **nothing**. `packagerConfig` (`forge.config.ts:7-13`) sets only `name` and `extraResource`. A DMG built today:
- is unsigned → Gatekeeper quarantine ("Apple cannot check it for malicious software"), requiring right-click→Open or `xattr -d` gymnastics from every user;
- is not notarized → on current macOS the app is effectively un-launchable for a non-technical recipient without manual override.

For a not-yet-distributed tool this is correctly deferred, but it is the **prerequisite for B-H1 to produce anything usable**, and it's the classic Electron blind spot — flagging it explicitly. The work: `osxSign` + `osxNotarize` in `packagerConfig` driven by `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` (or App-Store-Connect API key) secrets, plus a Developer ID Application cert in the runner keychain.
*Refs:* `forge.config.ts:7-13`.

**B-H3 — No auto-update mechanism.**
No `electron-updater`, `autoUpdater`, or `setFeedURL` anywhere in `src/` or `package.json`. Once builds ship, every update is a manual re-download. `MakerZIP` for `darwin` (`forge.config.ts:15`) is actually the right substrate for Squirrel.Mac auto-update, so the maker choice already anticipates this — but nothing consumes it. Lower urgency than B-H1/B-H2 (you can ship manual builds first), but it's the third leg of the distribution stool and worth deciding on before 1.0.
*Refs:* `forge.config.ts:15`; absence across `src/`.

### Medium

**B-M1 — CI installs dependencies twice with no cross-job sharing.**
`lint-and-test` and `e2e` are independent jobs that each run `actions/checkout` → `pnpm/action-setup` → `setup-node` → `pnpm install --frozen-lockfile` (`ci.yml:32-47` and `ci.yml:63-77`). The pnpm **store** is cached via `cache: pnpm` (`ci.yml:44`, `ci.yml:73`), so downloads are deduped, but the *install/link* step (and `node_modules` materialization for a 1.6 GB tree) runs twice in full on every PR. On `macos-latest` runners (the more expensive minute-multiplier) this is real wall time and real cost. Options: (a) accept it (the jobs *should* stay parallel for latency), or (b) add a `node_modules` cache keyed on the lockfile hash so the second job's install is a near-no-op. Don't merge the jobs — parallelism is the right call (the comment at `ci.yml:56-58` correctly justifies keeping E2E out of the unit loop).
*Refs:* `.github/workflows/ci.yml:46-47, 76-77`.

**B-M2 — Node version is unpinned and drifts (dev 25, CI 24).**
CI pins `node-version: 24` (`ci.yml:43`, `ci.yml:73`) but this machine runs **Node 25.9.0**, and there is **no `engines` field, no `.nvmrc`, no `.node-version`, no `volta`/`packageManager` pin** (confirmed: all absent). Dev-builds-on-25 / CI-builds-on-24 is exactly the "works on my machine" surface the modernization report (M-recommendation) also flagged. Native deps (`@duckdb/node-api`, `fs-xattr`, `macos-alias` in `pnpm.onlyBuiltDependencies`) are the ones most likely to behave differently across Node majors. Fix is trivial and high-value: add `"engines": { "node": ">=24" }` + an `.nvmrc`, and align the dev machine. (Pin owned jointly with modernization — cross-referenced, not double-counted.)
*Refs:* `package.json` (no `engines`); `ci.yml:43, 73`; observed `node -v` = v25.9.0.

**B-M3 — `tsc`/`svelte-check` are not incremental, and lint runs serially.**
`pnpm lint` = `tsc --noEmit && svelte-check --threshold error && eslint .` (`package.json:9`) — three full passes, **serial**, ~29 s wall locally (44 s user; CPU is mostly idle waiting on the `&&` chain). `tsconfig.json` sets **no** `incremental`/`tsBuildInfoFile`/`composite` (confirmed absent), so every `tsc --noEmit` is a cold typecheck. Two cheap wins:
- Add `"incremental": true` + a `tsBuildInfoFile` to `tsconfig.json` so local re-runs are fast (CI is always cold, so this is a DX win, not a CI win).
- `tsc` and `svelte-check` partially overlap (both typecheck), and `eslint` is independent of both — running the three with a concurrency runner (or at least `eslint` in parallel with the type passes) would cut the local lint wall time. Keep them `&&`-chained in CI if you want fail-fast ordering, but locally the serial chain is the slowest interactive loop.
*Refs:* `package.json:9`; `tsconfig.json:2-17` (no incremental).

**B-M4 — No git hooks / pre-commit gate.**
No `.husky` dir, no `prepare` script, no `lint-staged` (all confirmed absent). Given the PR-per-change workflow and a fast lint (~29 s) + test (~41 s), a pre-push hook running `pnpm lint` would catch the obvious failures before they burn a CI run on `macos-latest`. This is a *preference*, not a defect — the CLAUDE.md philosophy is "stay out of the way," and CI already gates merges — but it's the cheapest way to shorten the red-CI feedback loop. Pre-*push* (not pre-commit) keeps commits frictionless.
*Refs:* absence of `.husky`, `package.json` `prepare`, `lint-staged`.

### Low

**B-L1 — Coverage `lcov` is generated but never consumed.**
`vitest.config.mts:36` emits `lcov` "for future CI integrations (Codecov, etc.)" but CI runs `pnpm test` (not `pnpm coverage`), so coverage is never computed *in CI* and lcov is never uploaded (the config comment is honest about this). Either wire it (Codecov upload step) or drop the `lcov` reporter until you do — generating an artifact nobody reads is mild waste. Low because it costs nothing on the `vitest run` path (coverage only runs under `pnpm coverage`).
*Refs:* `vitest.config.mts:30-37`.

**B-L2 — Packaged app is 275 MB; no bundle-size visibility.**
`out/Minerva-darwin-arm64/Minerva.app` is **275 MB**. That's not abnormal for an Electron app carrying `pdfjs-dist`, `tesseract.js`, `mermaid`, `@duckdb/node-api`, and three IBM Plex font families — but it's large, it's never measured in CI, and the renderer ships several >500 KB chunks (`pdfjs`, `mermaid.core`, `wardley`, the main `index`). The heavy renderer deps (PDF.js, Mermaid, Tesseract, KaTeX) are good candidates for confirmed dynamic-`import()` code-splitting so they don't sit in the main renderer chunk. Low priority (desktop app, not a web payload), but worth a one-time audit and a size guardrail if distribution matters.
*Refs:* measured `out/.../Minerva.app` = 275 MB; `.vite/renderer/.../assets/*` chunks >500 KB.

**B-L3 — Three near-identical Vite configs duplicate the `@shared` alias.**
`vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.mts`, and `vitest.config.mts` each independently declare `resolve.alias['@shared'] = '/src/shared'`. Harmless, but four copies drift independently. A tiny shared helper (or a single base config spread in) would DRY it. Cosmetic.
*Refs:* `vite.main.config.ts:4-8`, `vite.preload.config.ts:4-8`, `vite.renderer.config.mts:6-10`, `vitest.config.mts:23-27`.

---

## Current State Analysis

### Build Tools
- **Packager:** electron-forge 7.x (`@electron-forge/cli` + `plugin-vite` + `maker-dmg` + `maker-zip`). One forge config (`forge.config.ts`) drives three Vite builds: `main` (`vite.main.config.ts`), `preload` (`vite.preload.config.ts`), `renderer` (`vite.renderer.config.mts`).
- **Bundler:** Vite 6 / Rollup. Main config marks `canvas` and `@duckdb/node-bindings*` external (`vite.main.config.ts:23-26`) with an excellent comment explaining the linkedom try/catch-collapse and the `.node` binary issue — this is exactly the kind of native-dep handling that breaks silently elsewhere.
- **Typecheck/lint:** `tsc --noEmit` + `svelte-check --threshold error` + `eslint .` (flat config `eslint.config.mjs`). `tsconfig.eslint.json` widens the typecheck program to tests + config files for ESLint.
- **Test:** Vitest 2 (`vitest.config.mts`) — 263 files, 2733 tests, v8 coverage with a soft 70% floor on `src/shared/**` only. Playwright 1.59 (`playwright.config.ts`) for a single Electron smoke E2E, single worker.
- **Skills bundling:** `import.meta.glob('./stock/*.md', { query: '?raw', eager: true })` in `src/main/skills/loader.ts:29` embeds 43 stock skill markdown files into the main bundle at build time. This is **efficient** — eager raw-string inlining, no filesystem packaging, no per-file I/O at runtime; the build cost is negligible (43 small text files).
- **Package manager:** pnpm 10, `node-linker=hoisted` (`.npmrc`), `pnpm.onlyBuiltDependencies` correctly scoped to the four native modules.

### CI/CD Pipeline Status
Single workflow, `.github/workflows/ci.yml`, triggers on `push: [main]` and all `pull_request`. Well-structured:
- **`concurrency` cancellation** is configured (`ci.yml:22-24`) — in-flight runs cancel on new commits. (Good; many projects miss this.)
- **Two parallel jobs**, both on `macos-latest` (justified by chokidar fsevents + the darwin Electron bundle, `ci.yml:6-11`):
  - `lint-and-test` (timeout 20 min): checkout → pnpm → node 24 + pnpm cache → `install --frozen-lockfile` → `pnpm lint` → `pnpm test`. Lint and test run **serially within the job** (fail-fast on lint, reasonable).
  - `e2e` (timeout 25 min): same setup → `pnpm test:e2e` (= `build:e2e` package + Playwright).
- **Caching:** pnpm store via `cache: pnpm` (`ci.yml:44, 73`). **Missing:** `node_modules` cache (install runs fully twice — B-M1), Playwright browser cache (N/A — Electron E2E uses the packaged app, not a downloaded browser), Vite/tsc build cache (none exists — B-M3).
- **No matrix** (single OS by design — justified). **No artifact upload.** **No release/publish job** (B-H1). **No make-path coverage in CI** (B-H1).

### Dependencies (brief — see modernization report)
Dependency currency is the modernization report's domain: headline is **Electron 35.7.5 → 42** (past the security-support window), plus Vite/Vitest/TS/eslint minor drift and dead `@types/*` shims. From a *build* standpoint the only additions here: (1) Node pin drift dev-25/CI-24 (B-M2, shared finding), (2) lockfile is fresh and consistent (`pnpm-lock.yaml`, last touched 2026-05-25, installs clean with `--frozen-lockfile`). Native deps (`@duckdb/node-api 1.5.2-r.1`, `fs-xattr`, `macos-alias`) are pinned and correctly listed under `onlyBuiltDependencies`.

---

## Build Performance Metrics

All measured on this machine (Apple Silicon, warm `node_modules`, Node 25.9.0, pnpm 10.33.0). CI numbers will be **slower** (cold cache, GitHub `macos-latest` runners are less powerful than local Apple Silicon).

| Operation | Measured wall | User CPU | Observation |
|-----------|--------------|----------|-------------|
| `pnpm lint` | **29.06 s** | 44.5 s | Serial `&&` chain; CPU under-utilized (165%) — parallelizable |
| `pnpm test` | **41.6 s** | 235.8 s | 658% CPU — vitest parallelism healthy; 2733 tests pass |
| `pnpm package` (Vite ×3 + forge package) | **24.9 s** | 41.5 s | No makers; this is the real "build the app" cost |
| `pnpm build` (`make`, DMG+ZIP) | **not measured** | — | DMG creation adds disk-image assembly on top of package; *estimate* +20–40 s over package |
| Vitest "setup" phase | 70.3 s (cumulative, parallel) | — | Per-file environment init across 263 files; no `setupFiles` exist — this is happy-dom/jsdom env cost, not a shared setup script |
| Packaged `.app` size | **275 MB** | — | pdfjs + tesseract + mermaid + duckdb + 3 font families |
| `.vite` build output | 9.7 MB (build) + 17 MB (renderer) | — | Several renderer chunks >500 KB |

**Reading:** the interactive feedback loops are all sub-minute. The slowest *local* loop is `pnpm test` at ~42 s; the slowest *interactive iteration* pain is the serial `pnpm lint` at ~29 s (B-M3). Nothing here needs heroics.

---

## Improvement Plan (phased)

### Phase 1 — Distribution foundation (the real gap) — ~1–2 days
1. **Add a `release.yml` workflow** triggered on tag push (`v*`): checkout → pnpm + node (pinned) → install → `pnpm build` → `actions/upload-artifact` (and/or `softprops/action-gh-release`). This closes B-H1: the `make` path becomes CI-tested and every release produces downloadable artifacts. *Risk: Low.*
2. **Configure macOS signing + notarization** (B-H2): `osxSign` + `osxNotarize` in `forge.config.ts` `packagerConfig`, driven by `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` (or ASC API key) GitHub secrets and a Developer ID cert imported into the runner keychain. *Risk: Medium (cert/keychain plumbing is fiddly the first time).*
3. **Decide on auto-update** (B-H3): if yes, add `electron-updater` + a Squirrel.Mac feed (the `MakerZIP` darwin target is already the right substrate). Can defer past first manual releases. *Risk: Medium.*

### Phase 2 — CI/DX cheap wins — ~half a day
4. **Pin Node** (B-M2): `"engines": { "node": ">=24" }` + `.nvmrc`; align dev machine to 24 (or bump CI to 25 deliberately — pick one). *Risk: Low.*
5. **Add a `node_modules` cache** keyed on the lockfile hash so the `e2e` job's install is near-instant (B-M1). *Risk: Low.*
6. **Make `tsc` incremental** (B-M3): `"incremental": true` + `tsBuildInfoFile` in `tsconfig.json`; consider running `eslint` in parallel with the type passes locally. *Risk: Low.*

### Phase 3 — Polish — opportunistic
7. Optional pre-push hook running `pnpm lint` (B-M4). 8. Wire or drop lcov (B-L1). 9. Bundle-size audit + dynamic-import the heavy renderer deps + optional size guardrail (B-L2). 10. DRY the `@shared` alias across the four configs (B-L3).

---

## CI/CD Pipeline Optimization (summary)
- **Keep:** the two-parallel-job layout, concurrency-cancellation, `--frozen-lockfile`, pnpm store cache, single-OS-by-design, the explanatory comments. These are right.
- **Add:** `node_modules` cache (B-M1), a tag-triggered release/artifact job (B-H1), Node pin in the workflow matched to `engines` (B-M2).
- **Don't:** merge the jobs (parallelism is correct), add a Linux/Windows matrix (correctly deferred — chokidar fsevents + darwin bundle reasons in `ci.yml:6-11` are sound), or add interstitial gates the philosophy disallows.

## Dependency Management
Defer to the modernization report. Build-relevant only: Node pin drift (B-M2), lockfile fresh and `--frozen-lockfile`-clean, native deps correctly gated via `onlyBuiltDependencies`. Electron 35→42 (modernization M-C1) is the dependency item with the largest *build* blast radius — re-run `pnpm package` after each major bump (native-dep ABI).

## Build Artifact Analysis
- **Makers configured:** `MakerZIP` (darwin/linux/win32) + `MakerDMG` (darwin only) — `forge.config.ts:14-17`. No Squirrel.Windows, no `.deb`/`.rpm`; appropriate for a macOS-first, pre-distribution tool.
- **`extraResource: ['resources']`** correctly stages `resources/python/minerva_kernel.py` next to the bundle (`forge.config.ts:8-12`).
- **Output:** `out/Minerva-darwin-arm64/Minerva.app` = 275 MB, arm64-only (no x64/universal build — fine for now; reconsider if Intel-Mac users appear).
- **Signing/notarization:** none (B-H2). **Versioning:** `package.json` `version: 0.1.0` is the only source of truth; no tag-driven version injection (would come with the release workflow).

## Recommendations & Performance Targets
| Target | Current | Goal |
|--------|---------|------|
| CI: cross-job dependency install | full install ×2 | second install near-instant via `node_modules` cache |
| Release: downloadable, installable build | none | signed + notarized DMG per tag, auto-published |
| `make` path coverage | local-only | exercised in CI on every release |
| Local `pnpm lint` wall | ~29 s serial | <20 s (incremental tsc + parallel eslint) |
| Node parity dev/CI | 25 vs 24, unpinned | pinned + identical |
| Packaged app size | 275 MB | measured in CI; heavy deps dynamic-imported |

## Risk Assessment
- **Highest residual risk:** the *first* signed/notarized release. Cert/keychain/notarization plumbing fails in unobvious ways and there's no CI history to debug against (B-H1+B-H2). Mitigate by landing the unsigned `release.yml` first (proves the `make` path in CI), then layering signing on.
- **Electron 35 (security):** the dependency-side risk that most affects builds — call it out here only because each major bump must be validated with a real `pnpm package` run (native ABI). Owned by modernization.
- **Low-risk, high-confidence:** every Phase 2 item (Node pin, node_modules cache, incremental tsc) is reversible and local.
- **Strengths to preserve:** fast sub-minute loops, honest self-documenting configs, correct native-dep externalization (`vite.main.config.ts:23-26`), efficient skills glob-bundling, concurrency-cancellation, and a green-gated PR workflow. This is a well-run build for its stage — the work ahead is *extending* it to distribution, not fixing it.
