# Modernization Review
Generated: 2026-06-10 12:22:15
Scope: entire project (/Users/davegriffith/minerva)
Reviewer focus: stack currency, deprecated APIs, dependency freshness/EOL, build tooling, outdated coding patterns (complements the prior architecture & quality reviews — does not re-cover structure or test design)

## Executive Summary

**This codebase is genuinely modern.** It is not a modernization target in the
usual sense — there is no legacy debt to retire, no dead framework to escape, no
deprecated-API minefield to clear. The most valuable output of this review is a
short, honest list confirming that and an accurate dependency-currency picture.

Measured facts that matter:

- **Zero forbidden Svelte 4 patterns.** `export let`, `on:click`/`on:*`
  directives, `$:` reactive labels, `createEventDispatcher`, event modifiers
  (`|self`), and `<slot>` all return **0 hits** across `src/**/*.svelte`. The
  CLAUDE.md Svelte-5-runes mandate is fully honored. (verified by `rg`)
- **Zero deprecated Electron/Node APIs.** No `@electron/remote`,
  `enableRemoteModule`, `new Buffer()`, `url.parse()`, `punycode`,
  `XMLHttpRequest`, CommonJS `require()`/`module.exports`, TS `namespace`, or TS
  `enum` anywhere in `src`. (each verified at 0 hits)
- **Strict TypeScript, modern module resolution.** `tsconfig.json` has
  `strict: true`, `moduleResolution: "bundler"`, `module/target: ESNext`,
  `isolatedModules: true`. Node builtins use the `node:` protocol in **141**
  import sites with **0** bare `fs`/`path`/`child_process` imports.
- **Secure Electron defaults.** Every `BrowserWindow` uses
  `contextIsolation: true` + `nodeIntegration: false`
  (`window-manager.ts:70-71`); the privileged-site and PDF-render windows
  additionally set `sandbox: true` (`privileged-sites.ts:176`,
  `note-pdf/electron-render.ts:37`).
- **Sophisticated, type-aware ESLint flat config** with `recommendedTypeChecked`
  + the full `no-unsafe-*` family + `no-floating-promises` all promoted to
  `error` (`eslint.config.mjs:62-116`).

The **only critical, time-sensitive** finding is **dependency currency, led by
Electron**: the app runs **Electron 35.7.5** while **42.4.0** is current.
Electron supports the **latest three stable majors**; with 42 current, the
supported window is roughly **40–42**, so **Electron 35 is past its
security-supported window** and no longer receives Chromium security backports.
That is the one upgrade worth treating as security-relevant rather than
cosmetic. Everything else is routine version drift (Vite 6→8, Vitest 2→4,
TypeScript 5→6, vite-plugin-svelte 5→7) — worth doing, but breaking-change-bounded
and not urgent.

Two trivially-removable deprecated/redundant dev deps round it out
(`@types/dompurify`, `@types/katex`).

## Current Technology Stack

### Languages & Frameworks (verified versions)

| Layer | Technology | Installed | Source |
|---|---|---|---|
| Runtime shell | Electron | **35.7.5** | `package.json:83`, lock `electron@35.7.5` |
| UI framework | Svelte 5 (runes) | 5.55.0 | `package.json:91` |
| Language | TypeScript | 5.9.3 | `package.json:94` (range `^5.7.0`) |
| Build/bundler | Vite | 6.4.1 | `package.json:96` (range `^6.0.0`) |
| Packager | electron-forge (`cli`+`plugin-vite`+makers) | 7.11.1 | `package.json:68-71` |
| Svelte/Vite glue | @sveltejs/vite-plugin-svelte | 5.1.1 | `package.json:74` |
| Test runner | Vitest + @vitest/coverage-v8 | 2.1.9 | `package.json:81,97` |
| E2E | @playwright/test | 1.59.1 | `package.json:73` |
| Lint | ESLint 10 + typescript-eslint 8 + eslint-plugin-svelte 3 | 10.2.1 / 8.59.0 / 3.17.1 | `package.json:84,95,85` |
| Graph/SPARQL | @comunica/query-sparql-rdfjs / n3 / rdflib | 5.1.3 / 2.0.3 / 2.3.6 | `package.json:25,46,48` |
| LLM SDK | @anthropic-ai/sdk | 0.90.0 | `package.json:21` |
| PDF / OCR | pdfjs-dist / unpdf / tesseract.js | 5.6.205 / 1.6.0 / 7.0.0 | `package.json:47,53,50` |
| DB (compute) | @duckdb/node-api | 1.5.2-r.1 | `package.json:26` |
| Package manager | pnpm | 10.33.0 | `pnpm -v` |
| Dev Node | Node | v25.9.0 (local); CI pins **24** | `node -v`; `.github/workflows/ci.yml:43,73` |

Project topology: three Vite builds wired through one forge config
(`forge.config.ts:18-38`) — `vite.main.config.ts`, `vite.preload.config.ts`,
`vite.renderer.config.mts`. Single root `package.json`; no nested/workspace
packages (verified `find src -name package.json` → empty).

### Legacy Indicators — measured, mostly absent

| Indicator checked | Result | Method |
|---|---|---|
| Svelte 4 `export let` | **0** | `rg` over `*.svelte` |
| Svelte 4 `on:*` directives | **0** | `rg` |
| Svelte 4 `$:` reactive labels | **0** | `rg` |
| `createEventDispatcher` | **0** | `rg` over `src` |
| Event modifiers (`\|self` etc.) | **0** | `rg` |
| `<slot>` (vs Svelte 5 snippets) | **0** | `rg` |
| `@electron/remote` / `enableRemoteModule` | **0** | `rg` |
| `nodeIntegration: true` | **0** | `rg` (all `false`) |
| `new Buffer()` ctor | **0** | `rg` |
| `url.parse()` / `punycode` | **0** / **0** | `rg` |
| `XMLHttpRequest` | **0** | `rg` |
| CommonJS `require()` / `module.exports` in `src` | **0** / **0** | `rg` |
| TS `namespace` / `enum` | **0** / **0** | `rg` |
| Bare `fs`/`path`/`child_process` imports (no `node:`) | **0** | `rg` |
| `as unknown as` casts | **7** | `rg` — low, acceptable |
| Explicit `any` in non-test `.ts` | **5** | `rg` — very low |

The single in-code staleness artifact found is a **comment**, not code: a test
note says "jsdom 26" (`tests/renderer/image-upload.test.ts:10`) while the pinned
dep is `jsdom ^29.1.1` (resolved 29.1.1). Harmless; flag only if it confuses.

## Modernization Opportunities

### Critical (security / EOL — do these)

**M-C1 — Electron 35 → current (42). Past the security-support window.**
Installed **35.7.5**; current **42.4.0** (4 stable majors behind). Electron
security-patches only the latest three stable majors; with 42 stable, ~40–42 are
supported, so **35 receives no further Chromium security backports**. For an app
that renders untrusted/remote content (in-app PDF viewer #100, privileged-site
windows for web ingestion, `@mozilla/readability`/`turndown`/`linkedom` over
fetched HTML), running an unpatched Chromium is the one finding with genuine
security weight. The mitigating factors are real and worth noting — strict
context isolation everywhere, navigation guards
(`window-manager.ts:76 installNavigationGuards`), `sandbox: true` on the
remote-content windows, and DOMPurify on compute output — but they don't replace
Chromium CVE patches. **This is the headline modernization action.**
Breaking-change risk: **High but bounded** — see Migration Plan; each Electron
major can change `BrowserWindow`/`webContents`/`protocol`/menu APIs and bumps the
bundled Node, so step through majors and run the Playwright smoke at each.

**M-C2 — Remove deprecated/redundant `@types/*` shims.**
`pnpm outdated` flags **`@types/dompurify` as `Deprecated`** (`package.json:76`).
Verified: DOMPurify v3 ships its own types
(`node_modules/dompurify/.../purify.cjs.d.ts`; `"types"` in its package.json),
and the only consumer imports the package directly
(`src/renderer/lib/compute-output-sanitize.ts:15`) — the `@types` shim is dead.
Same for **`@types/katex`** (`package.json:77`): katex ships `types/katex.d.ts`.
Neither is referenced in `tsconfig*.json` or any source import. Removing both is
zero-risk cleanup. (Trivial, but it's the only literally-deprecated package in
the tree.)

### Feature (capability-relevant version bumps — moderate risk)

**M-F1 — Vite 6 → 8.** Installed 6.4.1; current 8.0.16 (two majors).
vite-plugin-svelte must move in lockstep (**5.1.1 → 7.1.2**, M-F2). Vite 7/8
raise the minimum Node and Rollup majors and tighten a few config/SSR/env
surfaces. The project's Vite footprint is small and well-isolated (three terse
config files; the only non-trivial bit is the `rollupOptions.external` for
`canvas` + `@duckdb/node-bindings` in `vite.main.config.ts:23-26`, which must be
re-verified after a Rollup-major bump since externalization semantics are the
exact thing that changed historically). Breaking risk: **Medium** — config-shape
churn, not app-logic churn.

**M-F2 — @sveltejs/vite-plugin-svelte 5 → 7.** Couples to M-F1; bump together.
Note `vitest.config.mts:11-19` carries a workaround comment ("under vitest 2 +
vite 6 it explodes inside vite's `PartialEnvironment` constructor") — the Vite/
Vitest bump (M-F1 + M-F3) is the moment to check whether that no-op `style`
preprocessor hack is still needed; newer versions may let it go.

**M-F3 — Vitest 2 → 4 (+ @vitest/coverage-v8 2 → 4).** Installed 2.1.9; current
4.1.8. Two majors of a 263-file suite. Vitest 3/4 changed some config keys,
default pool behavior, and coverage-reporter wiring. The suite is large but the
config is modest (`vitest.config.mts`), and `@vitest/coverage-v8` version must
match the runner exactly. Breaking risk: **Medium** — mostly config/reporter
adjustments; budget time to re-green the full suite and re-confirm the
`src/shared` 70% coverage floor still computes.

**M-F4 — TypeScript 5 → 6.** Installed 5.9.3; current 6.0.3. TS majors
periodically remove long-deprecated flags and tighten inference. With `strict`
already on and only 5 `any`/7 `as unknown as` sites, fallout should be small, but
`typescript-eslint` (currently 8.x) must support the TS 6 line before you bump —
do them together. Breaking risk: **Low–Medium**.

**M-F5 — Routine minor/patch drift (no behavior risk).** Safe to batch:
`@anthropic-ai/sdk` 0.90.0 → 0.104.1 (check changelog — pre-1.0 SDK, minor bumps
can carry small API changes; this one is feature-relevant for the LLM path),
`comunica` 5.1.3 → 5.2.3, `rdflib` 2.3.6 → 2.3.9, `isomorphic-git` 1.37.4 →
1.38.4, `mermaid` 11.14.0 → 11.15.0, `dompurify` 3.4.2 → 3.4.9 (security-adjacent
sanitizer — keep current), `date-fns` 4.1.0 → 4.4.0, `yaml` 2.8.3 → 2.9.0,
`sql-formatter` 15.7.3 → 15.8.1, `katex` 0.16.45 → 0.17.0, plus the eslint/svelte
toolchain minors (`eslint` 10.2.1→10.4.1, `svelte` 5.55→5.56, `svelte-check`
4.4.6→4.6.0, `typescript-eslint` 8.59→8.61, `eslint-plugin-svelte` 3.17→3.19).
Breaking risk: **Low**.

**M-F6 — Deferred majors that carry real breakage (evaluate, don't reflexively
bump).**
- `chokidar` 4 → 5 (`package.json:35`, used only in
  `src/main/notebase/watcher.ts`): chokidar 5 drops older Node and changes some
  options; the file-watcher timing is already the documented reason CI is
  macOS-pinned (per the quality review), so this is the *last* thing to touch and
  only with the smoke + watcher tests green.
- `pdfjs-dist` 5 → 6 (`package.json:47`): pdf.js majors change the worker/module
  entry shape; the in-app PDF viewer (#100) is a direct consumer — defer until
  the viewer has component coverage.
- `@retorquere/bibtex-parser` 9 → 10: parser major; gate on the publish/citeproc
  tests (one of which is the known flake).
- `@duckdb/node-api` 1.5.2-r.1 → 1.5.3-r.3: native `.node` binding, externalized
  in `vite.main.config.ts:24` — patch-level, low risk, but native, so verify the
  packaged app loads on the target arch.

### Performance

No performance-driven modernization is warranted. The graph indexer is already
incremental (named-graph-per-note; covered in the architecture review), and the
stack carries no known perf-regressing legacy dependency. The only perf-adjacent
modernization side-effect is that **Vite 8 / Rollup current build faster** and
**Vitest 4 has a faster default pool** — real but incidental wins from M-F1/M-F3,
not reasons to upgrade on their own.

## Migration Plan (phased, lowest-risk first)

### Phase 0 — Free wins (≈0.5 day, no behavior change)
1. Delete `@types/dompurify` + `@types/katex` (M-C2); run `pnpm lint` + `pnpm
   test` to confirm types still resolve from the packages themselves.
2. Batch all minor/patch bumps (M-F5) in one PR; rely on the existing CI gate
   (tsc + svelte-check + eslint + vitest + Playwright smoke) to validate.
3. Add an **engine pin**: `"engines": { "node": ">=24" }` in `package.json` and a
   `.nvmrc` of `24` to match CI (`ci.yml:43`). Today there is neither, and the
   dev machine runs Node **25** (an odd, non-LTS line) while CI runs 24 — pinning
   removes a "works-on-my-machine" gap. (Low effort, real currency hygiene.)

### Phase 1 — Electron security upgrade (the priority — ≈2–4 days)
4. Upgrade **Electron 35 → 42 one major at a time** (35→36→…→42), running
   `pnpm dev` + the Playwright Electron smoke after each step. The smoke exists
   precisely to catch boot/window regressions (per the quality review) — lean on
   it here. At each major, check release notes for `BrowserWindow`/`webPreferences`
   (M-C1 windows), `webContents` navigation/permission handlers
   (`installNavigationGuards`), `protocol` registration, native menu, and the
   bundled-Node bump (re-run the native-dep load: DuckDB, fs-xattr, macos-alias).
5. Re-confirm the remote-content security posture after landing on 42:
   context isolation, `sandbox: true` on every remote/PDF window, navigation
   guards, CSP. **Opportunity:** the main window
   (`window-manager.ts:68-72`) sets isolation+`nodeIntegration:false` but **not**
   `sandbox: true`, unlike the privileged/PDF windows. The preload imports only
   `electron` + a pure `shared/channels` module and **no Node builtins**
   (verified `src/preload/preload.ts:1-2`), so it is already sandbox-compatible —
   enabling `sandbox: true` on the main window is a low-risk hardening to fold in
   while you're in the Electron upgrade. (Optional, but the cheapest security win
   available.)

### Phase 2 — Build/test toolchain majors (≈2–3 days, do together)
6. Vite 6→8 **+** vite-plugin-svelte 5→7 (M-F1/M-F2) in one PR. Re-verify
   `rollupOptions.external` for `canvas`/`@duckdb/node-bindings`
   (`vite.main.config.ts:23-26`) — the historically breakage-prone spot — and
   re-test whether the vitest `style` no-op preprocessor workaround is still
   required.
7. Vitest 2→4 + coverage-v8 2→4 (M-F3), matched versions; re-green the full
   suite; confirm the `src/shared` 70% floor still enforces
   (`vitest.config.mts:56-62`).
8. TypeScript 5→6 + typescript-eslint to a TS-6-compatible release (M-F4); fix
   the small fallout from the ≤12 `any`/cast sites if any surface.

### Phase 3 — Deferred consumer-coupled majors (only with coverage in place)
9. `chokidar` 4→5, `pdfjs-dist` 5→6, `@retorquere/bibtex-parser` 9→10 (M-F6),
   each in its own PR, gated on the relevant feature tests/smoke. These touch the
   watcher (CI-timing-sensitive), the PDF viewer, and the flaky citeproc path —
   do them last, individually, after the quality review's component/flake fixes
   land.

## Risk Assessment

### High risk to defer / sequence carefully
- **Electron majors (M-C1):** highest-value but each major can break window/
  protocol/menu APIs and bumps Node. Step through majors; smoke at each. (Despite
  the risk, this is the one upgrade you should *not* skip — it's the security
  driver.)
- **chokidar 5 (M-F6):** watcher timing is the documented reason CI is
  macOS-only; a behavioral change here is hard to catch in CI.
- **pdfjs-dist 6 / bibtex-parser 10 (M-F6):** direct feature consumers
  (PDF viewer, citeproc) with thin/flaky test coverage today.

### Medium risk
- **Vite 8 + plugin-svelte 7 (M-F1/M-F2):** config + Rollup-externalization
  churn; isolated to three small config files.
- **Vitest 4 (M-F3):** config/reporter changes across a large suite.
- **TypeScript 6 (M-F4):** inference tightening; small surface given `strict` is
  already on.

### Low risk
- All minor/patch bumps (M-F5), the `@types/*` removals (M-C2), and the
  engine/`.nvmrc` pin (Phase 0.3). The optional main-window `sandbox: true`
  hardening (Phase 1.5) is low-risk given the Node-free preload.

## Compatibility Matrix (real versions)

| Package | Current | Target | Majors | Breaking-change notes |
|---|---|---|---|---|
| electron | 35.7.5 | 42.4.0 | +7 maj* | **Past security-support window.** Chromium+Node bumps per major; `webPreferences`/`webContents`/`protocol`/menu surface can change. Step through majors. |
| @sveltejs/vite-plugin-svelte | 5.1.1 | 7.1.2 | +2 | Must move with Vite; revisit vitest `style` preprocessor hack. |
| vite | 6.4.1 | 8.0.16 | +2 | Higher min-Node + Rollup major; re-verify `rollupOptions.external`. |
| vitest | 2.1.9 | 4.1.8 | +2 | Config keys, pool defaults, coverage wiring; match coverage-v8. |
| @vitest/coverage-v8 | 2.1.9 | 4.1.8 | +2 | Must equal vitest version exactly. |
| typescript | 5.9.3 | 6.0.3 | +1 | Removes deprecated flags, tighter inference; bump typescript-eslint in tandem. |
| chokidar | 4.0.3 | 5.0.0 | +1 | Node-min + option changes; watcher-timing sensitive (CI macOS-pinned). |
| pdfjs-dist | 5.6.205 | 6.0.227 | +1 | Worker/module entry shape; in-app PDF viewer consumer. |
| @retorquere/bibtex-parser | 9.0.29 | 10.0.0 | +1 | Parser API; gates on citeproc/publish tests. |
| @anthropic-ai/sdk | 0.90.0 | 0.104.1 | minor (pre-1.0) | Pre-1.0 — minor bumps may carry small API changes; check changelog. |
| @types/dompurify | 3.2.0 | (remove) | — | **Deprecated**; DOMPurify v3 ships own types. |
| @types/katex | 0.16.8 | (remove) | — | Redundant; katex ships own types. |
| @comunica/query-sparql-rdfjs | 5.1.3 | 5.2.3 | minor | Routine. |
| rdflib / n3 / isomorphic-git / mermaid / dompurify / date-fns / yaml / sql-formatter / katex | (see M-F5) | latest minors | minor/patch | Routine; keep dompurify current (sanitizer). |
| eslint / svelte / svelte-check / typescript-eslint / eslint-plugin-svelte / @electron-forge/* | (see M-F5) | latest minors | minor/patch | Routine toolchain drift. |
| @duckdb/node-api | 1.5.2-r.1 | 1.5.3-r.3 | patch | Native binding (externalized); verify packaged-app load on target arch. |

\* "+7 maj" counts intermediate majors traversed (35→42); current supported
window is ~40–42.

## Testing Strategy

The existing gates are sufficient to drive this safely — no new test
infrastructure is needed for modernization (the quality review owns deepening it):

- **Per-upgrade gate:** `pnpm lint` (tsc + svelte-check + eslint) → `pnpm test`
  (263 vitest files) → `pnpm test:e2e` (Playwright Electron smoke). Run the full
  triad after each Electron major and after each toolchain major.
- **Electron majors specifically:** rely on the smoke (`tests/e2e/smoke.spec.ts`)
  — it was born from a real "black window" boot regression and is the right net
  for window/preload breakage. Manually exercise the remote-content surfaces (PDF
  viewer, web ingestion) once on Electron 42 since those have thin automated
  coverage.
- **Vite/Vitest majors:** re-green the full suite and confirm the `src/shared`
  70% coverage floor still computes; verify the `rollupOptions.external` build
  branch still externalizes `canvas` and DuckDB bindings (the packaged app, not
  just dev, must load).
- **Native-dep majors (DuckDB/chokidar):** run `pnpm build` (electron-forge make)
  and launch the packaged app — these only fail at package/runtime, not in
  `pnpm dev`.

## Benefits Analysis

- **Security (the real driver):** moving off Electron 35 restores Chromium CVE
  patching for an app that renders fetched/remote content — the single most
  consequential outcome of this whole exercise.
- **Currency / maintainability:** staying within the supported Electron window
  and on current Vite/Vitest/TS keeps the project on the well-trodden,
  documented, community-supported path; toolchain bumps unlock newer lint/type
  diagnostics that complement the already-strong eslint config.
- **Hygiene:** removing the deprecated `@types/*` shims and pinning Node/engines
  removes small footguns and "works-on-my-machine" drift (dev Node 25 vs CI 24).
- **Incidental speed:** Vite 8 / Vitest 4 build and test faster — a side benefit,
  not a justification.

## Recommendations

1. **Do the Electron upgrade.** It is the only finding with security weight; it
   is also the only one that is genuinely overdue. Everything else is optional
   hygiene by comparison.
2. **Bump the toolchain in coupled pairs** (Vite+plugin-svelte; Vitest+coverage;
   TS+typescript-eslint) to avoid version-skew failures.
3. **Don't manufacture churn.** The app code is already on the target patterns
   (Svelte 5 runes, ESM, `node:` imports, strict TS, secure Electron defaults).
   There is **nothing to modernize in the source** — only dependencies to keep
   current. Resist rewriting working code in the name of "modernization."
4. **Defer the consumer-coupled majors** (pdfjs 6, chokidar 5, bibtex 10) until
   the quality review's component/flake tests exist to catch their fallout.
5. **Fold in two free hardenings while upgrading Electron:** `sandbox: true` on
   the main window (preload is already Node-free) and an `engines`/`.nvmrc` pin.

## Estimated Effort

| Item | Effort | Risk |
|---|---|---|
| Phase 0 — `@types/*` removal, minor/patch batch, engine pin | 0.5 day | Low |
| Phase 1 — Electron 35→42 (stepwise) + optional main-window sandbox | 2–4 days | High (sequence carefully) |
| Phase 2 — Vite 6→8 + plugin-svelte 5→7 | 1–1.5 days | Medium |
| Phase 2 — Vitest 2→4 + coverage-v8 | 0.5–1 day | Medium |
| Phase 2 — TypeScript 5→6 + typescript-eslint | 0.5 day | Low–Medium |
| Phase 3 — chokidar 5 / pdfjs 6 / bibtex 10 (individually, gated) | 1.5–2.5 days | Medium–High |
| **Total** | **~6.5–10 days**, sequenceable one PR at a time | — |

The Electron upgrade alone delivers the bulk of the value; if effort is
constrained, do Phase 0 + Phase 1 and stop.
