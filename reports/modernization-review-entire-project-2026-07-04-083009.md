# Modernization Review — Minerva (entire project)

**Date:** 2026-07-04
**Scope:** Dependency freshness, language/tooling versions, deprecated-API usage, build/tooling modernization
**Repo:** `/Users/davegriffith/minerva`
**Reviewer lane:** Modernization only (architecture, refactoring, and QA are covered by concurrent reviews)

---

## Executive Summary

Minerva is a **mature, actively maintained codebase already sitting near the front of the ecosystem.** This is not a legacy-modernization job — it is a "stay-current" review. The measured stack (TypeScript 6.0.3, Electron 42.4.0, Svelte 5.56.3 runes, Vite 7.3.5, Vitest 4.1.8, ESLint 10.4.1, Node 24/25, pnpm 10) is within one major of every upstream latest as of July 2026, and in several cases *is* the latest.

The disciplines that usually generate modernization debt are already in place:

- **Full ESM**, no CommonJS `require()` in source (`src/main/publish/vega-render.ts:16` mentions `require()` only in a comment explaining why dynamic `import()` is used instead).
- **`node:` import prefix used universally** — a grep for bare builtin imports (`from 'fs'`, `from 'path'`, etc.) returns zero hits.
- **Zero Svelte 4 stragglers** — no `export let`, no `on:click`, no `$:` reactive statements, no `|self` modifiers anywhere under `src/`. The runes convention in CLAUDE.md is actually followed.
- **Modern Electron security posture** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every `BrowserWindow` (`src/main/window-manager.ts:78-83`, `src/main/privileged-sites.ts:174-176`); no `@electron/remote`.
- **Deprecated APIs already handled ahead of the curve** — the `url.parse`/DEP0169 warning was deliberately routed around via `isomorphic-git/http/web` (`src/main/git/publish-git.ts:16-21`, #976), and the Electron-34 `File.path` removal was migrated to `webUtils` (`src/preload/preload.ts:160`, `src/renderer/lib/app/source-ops.ts:86`).

**The real, actionable findings are narrow and low-risk:** four one-major dependency bumps (Electron, the Vite/vite-plugin-svelte pair, Vitest, ESLint patch), an opportunity to tighten `tsconfig` beyond `strict: true`, forward-planning for the TypeScript 7 (Go compiler) transition, and an optional consolidation of three coexisting DOM libraries. None are security-critical; none are EOL.

**Overall modernization grade: A-.** The minus is only for the natural drift that accumulates between an aggressive-upgrade project and a fast-moving ecosystem, plus a few strictness flags left on the table.

---

## Current Technology Stack

### Languages & Frameworks (measured versions)

| Area | Component | Installed (measured) | Latest stable (Jul 2026) | Status |
|------|-----------|----------------------|--------------------------|--------|
| Language | TypeScript | **6.0.3** (`node_modules/typescript`) | 6.0.x (TS 7.0 in RC) | Current major |
| Runtime | Node.js (engines) | `>=24` (`package.json:5-7`); `.nvmrc` = `24`; local `v25.9.0` | 24 LTS / 25 current | Current |
| Desktop shell | Electron | **42.4.0** (`node_modules/electron`; `^42.4.0`) | 43 (released 2026-07-02) | 1 major behind, supported |
| UI framework | Svelte | **5.56.3** (runes) | 5.x | Current major |
| Bundler | Vite | **7.3.5** | 8.x | 1 major behind |
| Svelte/Vite bridge | @sveltejs/vite-plugin-svelte | `^6.2.4` | 7.x (requires Vite 8) | 1 major behind (coupled to Vite) |
| Build/packaging | electron-forge (`@electron-forge/*`) | `^7.11.2` | 7.11.x | Current |
| Test runner | Vitest | **4.1.8** (+ `@vitest/coverage-v8` 4.1.8) | 5.x (4.1 security-backported) | 1 major behind, supported |
| Linter | ESLint | **10.4.1** + `typescript-eslint` 8.61 | 10.6.0 | Patch behind |
| E2E | Playwright | `^1.60.0` | 1.6x | Current |
| Package manager | pnpm | 10.33.0 (CI pins `version: 10`) | 10.x | Current |

Framework-level libraries are similarly fresh: CodeMirror 6 (`@codemirror/*` 6.x, `@codemirror/view` pinned `6.43.1`), Mermaid 11, Chart.js 4.5, `@anthropic-ai/sdk` 0.104, `yaml` 2.9, `date-fns` 4, `dompurify` 3.4, `chokidar` 5, `isomorphic-git` 1.38, `onnxruntime-web` 1.27, `pdfjs-dist` 6.

### Build & tooling configuration

- **`tsconfig.json`** (`tsconfig.json:1-23`): `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `isolatedModules: true`, `resolveJsonModule`, `esModuleInterop`, `forceConsistentCasingInFileNames`, incremental build cache (#664). Clipper (`clipper/tsconfig.json`) mirrors this with `noEmit` + explicit DOM libs.
- **ESLint** (`eslint.config.mjs`): flat config, `js.configs.recommended` + `tseslint.configs.recommendedTypeChecked` (type-aware), with `no-floating-promises`, `no-explicit-any`, `restrict-template-expressions`, `restrict-plus-operands` all set to `error`, plus type-aware `no-restricted-imports` guarding the process boundary. This is a strong, modern lint baseline.
- **Vite configs** split per process (`vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.mts`) with well-documented workarounds (d3-path dedupe, scoped `optimizeDeps.entries`).
- **CI** (`.github/workflows/ci.yml`): `pnpm/action-setup@v4`, `actions/setup-node@v4` with `node-version-file: .nvmrc` — versions are single-sourced from `.nvmrc`, so runtime drift between local/CI/engines is structurally prevented.

### Legacy Indicators

Actively searched for; **almost none present.** The complete list of anything that could be read as "legacy":

1. **`var` in `src/main/publish/exporters/static-site/search-script.ts:15+`** — a `SITE_SEARCH_SCRIPT` string literal shipped verbatim into exported static sites. The file header (`search-script.ts:9-11`) states it is intentionally "vanilla JS that works straight off `python -m http.server` or any other static host." The `var`/ES5 style is a **deliberate max-compatibility choice for third-party hosting targets**, not internal debt. (Optional cosmetic modernization only; see Feature Enhancements.)
2. **`.toJSON()` at `src/main/search/minisearch-provider.ts:70`** — MiniSearch's own serialization API, not the deprecated Node `Buffer.toJSON`. Not a finding.
3. **Three coexisting DOM implementations** — `jsdom` ^29 (main-process site handling: `src/main/sources/site-handlers.ts`, `ingest.ts`), `happy-dom` ^20 (renderer test env), `linkedom` ^0.18 (elsewhere). Each is used in a distinct context; this is redundancy, not deprecation. See Feature Enhancements.
4. **Two RDF stacks** — `rdflib` ^2.3.9 (the older, heavier lib; `src/main/graph/*`, `approval.ts`, `import-zotero-rdf.ts`) alongside `n3` ^2.0.3 + `@comunica/query-sparql-rdfjs`. Coexistence is intentional but worth a consolidation review (architecture-adjacent; flagged, not owned here).

No `remote` module, no `nodeIntegration`, no `XMLHttpRequest`, no callback-style `fs.exists`/`fs.rmdir`, no `new Buffer()`, no `.substr()`, no `url.parse` in source, no CommonJS `require()` in source, no `export let`/`$:`/`on:` Svelte 4 syntax.

---

## Modernization Opportunities

### Critical / Security / EOL

**None.** There is no EOL runtime, no unsupported framework major, and no known-vulnerable pinned dependency surfaced by this review.

- **Electron 42 is inside the supported window.** Electron supports the latest three stable majors (41/42/43 as of 2026-07-02); 42 is not EOL and receives security backports. Both 42 and 43 bundle Node 24.x, so the runtime baseline is unchanged. The upgrade to 43 is *recommended maintenance*, not a security emergency — but it should not be allowed to slip to a 2-major gap, at which point it would exit support.
- **Vitest 4.1** still receives backported security/important fixes even though Vitest 5 is the primary line. Not urgent.

### Feature Enhancements (version currency)

| # | Item | Current → Target | Notes |
|---|------|------------------|-------|
| F1 | Electron | 42.4.0 → 43.x | Chromium 150 / V8 15 / Node 24.17. Stay within the 3-major support window. Re-run the signing/notarization + native-binding (DuckDB) smoke path in `forge.config.ts` after bump. |
| F2 | Vite **+** vite-plugin-svelte (coupled) | Vite 7.3.5 → 8.x **and** `@sveltejs/vite-plugin-svelte` ^6.2.4 → ^7.x | These move together: plugin-svelte 7 *requires* Vite 8. Must be done as one PR. Verify the d3-path dedupe and scoped `optimizeDeps.entries` workarounds (`vite.renderer.config.mts`) still hold under Vite 8's resolver. |
| F3 | Vitest + coverage | 4.1.8 → 5.x | Coordinate `vitest` + `@vitest/coverage-v8` version lockstep. Check happy-dom/jsdom env config in `vitest.config.mts` against Vitest 5 defaults. |
| F4 | ESLint | 10.4.1 → 10.6.0 | Patch/minor within the current major; low-risk, do opportunistically. |
| F5 | TypeScript 7 readiness (forward-looking) | 6.0.3 → 7.0 (RC as of 2026-06-18) | TS 7 is the Go-compiler rewrite (~10× faster typecheck). TS 6 already flipped strict/ESM/es2025 defaults and removed legacy options, so the breaking-change surface into 7 is small. Track the RC; plan a spike once 7.0 GA lands. `pnpm lint` (tsc-based) is the main consumer to validate. |
| F6 | Static-site export script style (optional/cosmetic) | ES5 `var` → `const`/`let` in `search-script.ts` | Purely cosmetic; the ES5 style is deliberate for arbitrary static hosts. Only worth doing if a build/minify step is ever added to that export. **Recommend: leave as-is.** |
| F7 | Library consolidation (review) | 3 DOM libs (jsdom/happy-dom/linkedom); rdflib + n3 | Not a version issue — a footprint/consistency one. Evaluate whether one DOM lib can serve main + tests, and whether rdflib can be retired in favor of n3+comunica. Coordinate with the architecture review. |

### Performance (modernization-driven)

- **TS 7 (F5)** is the single biggest performance lever available: a Go-based typechecker roughly 10× faster would materially speed `pnpm lint` and the pre-push hook. This is the one upgrade with a concrete DX/perf payoff rather than pure currency.
- **Vite 8 (F2)** brings incremental dev-server and Rolldown-track improvements; modest but real HMR/build gains.
- No source-level performance modernization is warranted — the code already uses async/await, `for…of`/array iteration, `fetch`, and streaming APIs idiomatically.

### tsconfig strictness (incremental hardening)

`strict: true` is on, but the following opt-in flags are **not** set in `tsconfig.json` or `clipper/tsconfig.json` (verified by grep — none present):

- `noUncheckedIndexedAccess` — highest-value addition; catches unguarded array/record index access.
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noUnusedLocals` / `noUnusedParameters` (ESLint may partially cover, but the compiler flag is stricter and CI-visible)
- `noFallthroughCasesInSwitch`
- `verbatimModuleSyntax` (pairs well with the existing `isolatedModules` + type-aware `no-restricted-imports` import-boundary rules)

Given the codebase already carries only **5 `any` occurrences and 7 `@ts-ignore`/`@ts-expect-error` across all of `src/`**, the remediation cost of enabling these is likely small and the regression-catching value is high. Enable one flag per PR to keep diffs reviewable.

---

## Migration Plan (phased)

**Phase 0 — Quick wins (½ day):**
- F4: ESLint 10.4.1 → 10.6.0.
- Enable `noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch` in `tsconfig.json`; fix fallout (expected small). One PR each per project convention (every change ships via PR).

**Phase 1 — Electron 43 (1–2 days):**
- F1. Bump `electron` to ^43, run full `pnpm test` + `pnpm build:e2e`/`test:e2e`, and exercise `forge.config.ts` signing/notarization + DuckDB native-binding packaging on a real `electron-forge make`. This is the highest-touch upgrade because of the native-binding and code-signing surface.

**Phase 2 — Vite 8 + vite-plugin-svelte 7 (1–2 days):**
- F2 as a single coupled PR. Validate all three Vite configs, HMR in `pnpm dev`, the d3-path/mermaid production-build workaround, and the renderer bundle (vega-embed CSP path per project memory).

**Phase 3 — Vitest 5 (1 day):**
- F3. Version-lockstep `vitest` + coverage. Re-run the full suite incl. the preload contextBridge snapshot test (`tests/preload/preload-bridge.test.ts`).

**Phase 4 — Remaining strictness flags (1–2 days, incremental):**
- Add `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnused*`, `verbatimModuleSyntax` one at a time.

**Phase 5 — TS 7 spike (timeboxed, after 7.0 GA):**
- F5. Branch, install TS 7, run `pnpm lint`, catalog breakage, measure typecheck speedup. Do not adopt until GA + svelte-check/typescript-eslint compatibility confirmed.

**Deferred / optional:** F6 (leave as-is), F7 (fold into the architecture review's remit).

---

## Risk Assessment

| Upgrade | Risk | Rationale / mitigation |
|---------|------|------------------------|
| ESLint patch (F4) | Very low | Same major; run `pnpm lint:eslint`. |
| tsconfig flags (Phase 0/4) | Low | Compile-time only, caught by `pnpm lint`; incremental per-flag PRs bound the blast radius. |
| Electron 43 (F1) | **Medium** | Native bindings (DuckDB `@duckdb/node-bindings-*`, `fs-xattr`, `macos-alias`) and code-signing/notarization are the fragile surface. Chromium 150 could shift renderer behavior. Full e2e + a real signed `make` required. |
| Vite 8 + plugin-svelte 7 (F2) | **Medium** | Coupled majors; resolver changes could disturb the documented d3-path dedupe and vega-embed bundling workarounds. Cannot be split. |
| Vitest 5 (F3) | Low–medium | Config-format and default-env changes possible; the suite itself is the safety net. |
| TS 7 (F5) | Medium (deferred) | Go rewrite; depends on downstream tool (svelte-check, typescript-eslint) compatibility landing. Spike-only until GA. |

**Cross-cutting mitigations:** the pre-push `pnpm lint` hook, type-aware ESLint, the preload snapshot test, and the LLM write-guard (fatal under test) mean regressions from these bumps surface loudly in CI rather than silently. Do upgrades one PR at a time (never batch majors) so a bisect points at a single dependency.

---

## Compatibility Matrix (current → target, with breaking-change notes)

| Component | Current | Target | Breaking-change surface |
|-----------|---------|--------|--------------------------|
| Electron | 42.4.0 | 43.x | Chromium 150 / V8 15 behavior shifts; re-validate hardened-runtime signing + notarization (`forge.config.ts:96-190`) and DuckDB/native rebuilds. Node stays 24.x (no Node API break). |
| Vite | 7.3.5 | 8.x | Resolver/optimizeDeps changes; re-verify `dedupe: ['d3-path']` and scoped `entries` in `vite.renderer.config.mts`. Coupled with plugin below. |
| @sveltejs/vite-plugin-svelte | 6.2.4 | 7.x | Requires Vite 8; must upgrade together. Svelte 5.56.3 satisfies the plugin's `svelte ^5.46.4` floor. |
| Vitest + coverage-v8 | 4.1.8 | 5.x | Possible config/default-env changes; keep runner + coverage in lockstep. |
| ESLint | 10.4.1 | 10.6.0 | None expected (same major). |
| TypeScript | 6.0.3 | 7.0 (RC) | Go compiler; small runtime-surface change since TS 6 already removed legacy options and flipped strict/ESM/es2025 defaults. Gate on svelte-check + typescript-eslint support. |
| Svelte | 5.56.3 | 5.x latest | Patch/minor within Svelte 5; no runes API break. |

---

## Testing Strategy

The project already has the right harness; modernization just needs to lean on it:

1. **Per-upgrade gate:** `pnpm lint` (tsc + svelte-check + eslint) then `pnpm test` (vitest run) on every bump PR — enforced locally by the pre-push hook.
2. **Electron/Vite majors:** additionally run `pnpm test:e2e` (Playwright, `playwright.config.ts`) and a real `pnpm build` (`electron-forge make`) to exercise packaging, native bindings, and signing — the parts unit tests can't reach.
3. **Preload boundary:** re-run and, if needed, `-u` the contextBridge snapshot (`tests/preload/preload-bridge.test.ts`) after any preload-adjacent tooling change (per project memory, lint/targeted tests miss bridge drift).
4. **LLM/graph invariants:** the write-guard is fatal under test; keep the integrity SPARQL (CLAUDE.md) handy after any bump that touches the graph or approval paths.
5. **tsconfig flag PRs:** the compiler *is* the test — a green `pnpm lint` is sufficient sign-off.
6. **TS 7 spike:** dedicated branch; success metric = green `pnpm lint` + measured typecheck-time delta, not merged until GA.

No new test infrastructure is required for any item in this review.

---

## Benefits Analysis

- **Security & support longevity:** keeping Electron within the 3-major window preserves Chromium security backports — the single most important ongoing benefit for a desktop app embedding a browser.
- **DX / build speed:** TS 7 (~10× typecheck) and Vite 8 directly shorten the `pnpm lint` / `pnpm dev` inner loop and the pre-push hook wait.
- **Regression prevention:** the extra `tsconfig` flags (especially `noUncheckedIndexedAccess`) convert a class of latent runtime bugs into compile errors, at near-zero cost given the codebase's already-tiny `any`/`ts-ignore` footprint.
- **Maintenance compounding:** staying one-major-max behind keeps every future upgrade small. The cost of *not* upgrading is that gaps compound into a painful multi-major jump later — exactly the debt this project has so far avoided.
- **Footprint (if F7 pursued):** consolidating three DOM libs / two RDF stacks would shrink `node_modules`, the dependency-audit surface, and cognitive load.

---

## Recommendations

**Do now (low risk, high hygiene):**
1. ESLint → 10.6.0 (F4).
2. Enable `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch` (Phase 0).

**Do soon (scheduled maintenance):**
3. Electron 42 → 43 (F1) — before the gap reaches two majors.
4. Vite 8 + vite-plugin-svelte 7 as one PR (F2).
5. Vitest 4 → 5 (F3).

**Do incrementally:**
6. Remaining strictness flags, one per PR (Phase 4).

**Plan / watch:**
7. TS 7 spike once 7.0 GA + downstream tool support land (F5).
8. Review DOM-library and RDF-library consolidation *with the architecture review* (F7).

**Explicitly do NOT do:**
- Do not "modernize" the ES5 `var` in `search-script.ts` (F6) — it is a deliberate compatibility choice.
- Do not batch multiple major upgrades into one PR — bisectability matters more than PR count here.
- Do not touch the already-modern security posture (context isolation, sandbox, contextBridge), ESM strategy, or Svelte 5 runes usage — all current and correct.

---

## Estimated Effort

| Phase | Work | Est. |
|-------|------|------|
| 0 | ESLint patch + 2 tsconfig flags | ~0.5 day |
| 1 | Electron 43 (+ full e2e/signing/native validation) | 1–2 days |
| 2 | Vite 8 + plugin-svelte 7 (coupled) | 1–2 days |
| 3 | Vitest 5 | ~1 day |
| 4 | Remaining strictness flags (incremental) | 1–2 days spread |
| 5 | TS 7 spike (post-GA, timeboxed) | ~1 day spike |
| **Total (excl. optional F7 consolidation)** | | **~5–8 engineer-days**, none urgent |

Library-consolidation (F7) is deliberately unestimated here — it is architecture-owned and sizing depends on that review's findings.

---

## Sources (upstream version grounding, verified July 2026)

- [Electron releases](https://releases.electronjs.org/release) / [Electron 43 blog](https://www.electronjs.org/blog/electron-43-0) / [endoflife.date/electron](https://endoflife.date/electron) — Electron 43 released 2026-07-02; 42 still supported.
- [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) — 6.0 stable (2026-03-23); TS 7.0 RC 2026-06-18 (Go compiler).
- [What's new in Svelte: July 2026](https://svelte.dev/blog/whats-new-in-svelte-july-2026) / [vite-plugin-svelte releases](https://github.com/sveltejs/vite-plugin-svelte/releases) — plugin-svelte 7 requires Vite 8.
- [ESLint v10.x blog](https://eslint.org/blog/2026/05/eslint-v10.4.1-released/) — ESLint 10.6.0 latest (2026-07-01).
- [Vitest releases](https://github.com/vitest-dev/vitest/releases) — Vitest 5 primary line; 4.1 security-backported.
