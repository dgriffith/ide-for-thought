# Developer Experience / Tooling Review — Minerva

**Date:** 2026-08-02
**Scope:** Entire project — developer ergonomics (onboarding, inner loop, IDE
setup, custom scripts/CLI, contributor docs). Analysis-only; no source or config
files were modified.
**Repo root:** `/Users/davegriffith/minerva`

> **Framing.** Minerva is a **single-developer, local-first desktop app**
> (Electron + Svelte 5 + TypeScript, pnpm + electron-forge + Vite, Vitest,
> Playwright-Electron). This review deliberately ignores large-team/server DX
> tropes (containers, monorepo tooling, developer portals, metrics dashboards)
> except to mark them Not Applicable at the end. Test coverage/gates, release/
> signing, and architecture were covered by prior reviews (QA, deployment,
> architecture) and are referenced, not re-derived.

---

## Executive summary

Minerva's DX is **strong and unusually deliberate for a solo project.** The
setup story is genuinely one-command (`pnpm install` → `pnpm dev`), the inner
loop is fast, and there is real, purpose-built custom tooling: a headless
`pnpm cli` (SPARQL/SQL/search/MCP), a golden-file skills-eval harness, a
benchmark regression gate (`bench-check.mjs`), a font-literal lint guard
(`lint:fonts`), and an auto-fetch of the embedding model + help corpus so first
run "just works." Documentation (`README.md`, `CONTRIBUTING.md`, `CLAUDE.md`,
`docs/`) is thorough and honest.

The gaps are small and mostly **quick wins**: no shared editor config for a
project that lives or dies on Svelte-5-runes + strict-TS tooling (there is a
gitignored `.idea/`, but nothing shared — no `.vscode/`, no `.editorconfig`), no
single-source pin for the pnpm version (three copies of `version: 10` in CI, a
prose "pnpm 10" in docs, and no `packageManager` field), and a couple of small
doc-drift items (`CLAUDE.md` still describes `lint` as tsc+svelte-check when it
is now tsc+svelte-check+**eslint**; the pre-push hook comment says "~30s" but it
measures ~50s here). None of these are urgent; all are cheap.

---

## Tooling Inventory (real, from `package.json`)

### Runtimes / package manager
| Item | Value | Source |
|---|---|---|
| Node | `>=24` (`engines`), pinned to `24` | `package.json:6-8`, `.nvmrc` |
| Package manager | pnpm 10 (by convention; **not** pinned in `packageManager`) | `CONTRIBUTING.md:34`, `.github/workflows/ci.yml:38` |
| node linker | `node-linker=hoisted` (flat `node_modules`, cacheable directly) | `.npmrc` |

### Scripts (actual, `package.json:18-47`)
| Script | Command | Purpose |
|---|---|---|
| `dev` | `electron-forge start` | Dev server, Vite HMR |
| `predev` / `prebuild` / `prebuild:e2e` | fetch embedding model + build help corpus | first-run bootstrap (auto) |
| `lint` | `tsc --noEmit && svelte-check --threshold error && eslint .` | **3-stage** type + template + lint gate |
| `lint:eslint` / `:fix` | `eslint .` / `--fix` | eslint alone |
| `lint:fonts` | `! grep -rnE "SF Mono|Fira Code|…" src/renderer …` | guard against hardcoded mono-font literals |
| `test` / `test:watch` | `vitest run` / `vitest` | unit/integration |
| `coverage` | `vitest run --coverage --test-timeout=30000` | the CI gate (per-area floors) |
| `bench` / `bench:json` | `vitest bench …` | microbenchmarks |
| `bench:check` / `bench:baseline` | `bench-check.mjs` compare / `--update` | perf regression gate |
| `build:e2e` / `test:e2e` | forge package + `playwright test` | Electron e2e |
| `build` / `package` | `electron-forge make` / `package` | distributable / unpackaged |
| `cli:build` / `cli` | build `.vite/build/cli.js` then run | headless thoughtbase CLI |
| `release:tag` | `scripts/tag-release.mjs` | release tagging |
| `build:clipper` / `package:clipper` / `typecheck:clipper` | `clipper/*.mjs`, tsc | browser clipper build |
| `fetch:model` / `fetch:help-corpus` | `scripts/*` | manual bootstrap steps |
| `prepare` | `git config core.hooksPath .githooks \|\| true` | installs the pre-push hook |

### Build / test / lint toolchain (devDependencies)
- **Build:** electron-forge 7 (`@electron-forge/*`), Vite 8, `@sveltejs/vite-plugin-svelte` 7, esbuild 0.28. Separate Vite configs per process (`vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.mts`, `vite.cli.config.ts`).
- **Type/lint:** TypeScript 6, svelte-check 4, ESLint 10 + `typescript-eslint` 8 + `eslint-plugin-svelte` 3 (`eslint.config.mjs`, flat config, 14 KB — includes the renderer `no-restricted-syntax` data-flow rule).
- **Test:** Vitest 4 + `@vitest/coverage-v8`, `@testing-library/svelte`, happy-dom + jsdom, Playwright 1.62 (`@playwright/test`), axe-core.

### Custom scripts (`scripts/`)
`bench-check.mjs` (perf gate), `build-help-corpus.mjs`, `fetch-embedding-model.mjs`, `deploy-to-gh-pages.sh`, `tag-release.mjs`, plus `scripts/lib/`.

### CI (`.github/`)
`ci.yml` (lint-and-test + audit + e2e, macos-latest), `bench.yml`, `release.yml`, `dependabot.yml`. (Release/deploy covered by the deployment review — not re-reviewed here.)

---

## Measured speed (real numbers)

| Task | Result | How measured |
|---|---|---|
| `pnpm lint` (tsc + svelte-check + eslint) | **~50s** real (49.99s wall, 77.95s user) | `/usr/bin/time -p pnpm lint`, warm caches |
| svelte-check pass | 3536 files, **0 errors**, 20 warnings, 6 files with problems | lint output |
| single test file (`tests/main/auto-update.test.ts`, 10 tests) | **~1.3s** real (651ms Vitest duration) | `/usr/bin/time -p pnpm vitest run <file>` |
| Full `pnpm test` / `pnpm coverage` | **not measured** (541 test files — see below) | avoided to keep this review fast |
| `pnpm dev` cold start / HMR | **not measured** (would require booting Electron + the predev model/corpus fetch) | — |
| `pnpm build` / `test:e2e` | **not measured** (long; covered conceptually by deployment review) | — |

- **Test surface:** `find tests -name '*.test.ts'` = **541** files; e2e is small (**7** `.ts` files under `tests/*e2e*`, one real Playwright smoke journey). The single-file loop being ~1.3s means the watch loop (`pnpm test:watch`) is snappy per-file even though the whole suite is large — a good property for the inner loop.
- **Lint is the slow step of the inner loop at ~50s.** It runs three tools sequentially (`&&`). tsc and eslint both re-parse the whole tree; that's the tax for catching script/template drift that eslint alone misses.

---

## Findings & recommendations (quick wins first)

### QW1 — No shared editor configuration (Effort: S, ~1-2h)
There is **no `.vscode/`** and **no `.editorconfig`**. There *is* a `.idea/`
(JetBrains/WebStorm — `miranda.iml`, committed `codeStyles/`), but `.idea/` is
gitignored (`.gitignore:11`), so **nothing editor-related is shared with a
contributor.** For a project whose whole lint story depends on the Svelte
language server and strict TS, this is the highest-value cheap win:
- Add `.vscode/extensions.json` recommending `svelte.svelte-vscode`,
  `dbaeumer.vscode-eslint`, and `EditorConfig.EditorConfig` so a fresh clone
  prompts the contributor to install the Svelte 5 language server (without it,
  the runes-based components look broken in-editor).
- Add `.vscode/settings.json` enabling ESLint flat-config + format-on-save
  scoping, and pointing the TS SDK at the workspace `typescript` (v6).
- Add `.vscode/launch.json` with an Electron main-process debug config — today
  there is **no shared debugger setup** for either editor.
- Add a root `.editorconfig` (indentation, EOL, final newline) so formatting is
  consistent regardless of editor.

This is additive and editor-agnostic; it does not disturb the maintainer's
JetBrains setup.

### QW2 — Pin the pnpm version in one place (Effort: S, ~30m)
The pnpm version lives in **prose** (`CONTRIBUTING.md:34-35` "pnpm 10") and is
**hardcoded three times** in CI (`ci.yml:38`, `:117`, `:148`), but there is **no
`packageManager` field** in `package.json` and no corepack pin. A `.nvmrc`
pins Node but nothing pins pnpm for a fresh contributor. Add
`"packageManager": "pnpm@10.x.y"` (exact) to `package.json` so corepack
provisions the right pnpm automatically and CI can read `packageManager` instead
of repeating `version: 10`. Single source of truth; removes a "works on my
machine" class of drift.

### QW3 — Document the two real DX gotchas contributors will hit (Effort: S, ~30m)
`CONTRIBUTING.md:178-181` already flags the **preload snapshot** gotcha (adding a
`window.api` method needs `pnpm test tests/preload/preload-bridge.test.ts -u`),
which is excellent — lint won't catch it. Two more worth surfacing in the same
spot:
- **`pnpm lint` is three tools, and svelte-check is the one that catches
  script↔template drift** that tsc and eslint miss. A contributor who only runs
  `tsc` locally will be surprised by CI. Say so explicitly.
- The renderer **`no-restricted-syntax`** rule (mutation `api.*` in a component
  fails lint) is documented in `CLAUDE.md`/`CONTRIBUTING.md:93-97` — good; just
  make sure the error message points at the rule so a first-timer knows *why*.

### QW4 — Fix small doc drift (Effort: XS, ~15m)
- `CLAUDE.md` still describes `pnpm lint` as "`tsc --noEmit` … then
  `svelte-check`" — it is now **tsc → svelte-check → eslint** (`package.json:26`;
  `CONTRIBUTING.md:53` is already correct). Update `CLAUDE.md`'s Commands section.
- `.githooks/pre-push:4` comment says the lint gate is "~30s"; measured here it's
  **~50s**. Minor, but the comment is a promise to the next contributor.
- `README.md:154` labels `pnpm lint` as "Type check" — it now also runs eslint;
  a one-word tweak ("Type-check + lint") keeps it honest.

### QW5 — Consider a `pnpm doctor` / `setup` verification step (Effort: S-M, optional)
Setup is already effectively one command (`pnpm install` → `pnpm dev`, with
`predev` auto-fetching the model + corpus). The one place a fresh clone can fail
silently is the **runtime model/corpus fetch** (network-dependent, and the first
`dev`/`build` is "slower than later ones" per `CONTRIBUTING.md:44-46`). A tiny
`scripts/doctor.mjs` (`pnpm doctor`) that checks Node ≥24, pnpm present, the
embedding model downloaded, and native `@duckdb/node-api` loading would turn a
confusing first-run stall into a clear message. Low priority given how good the
current story is — call it a nice-to-have.

---

## What's already good (credit where due)

- **One-command onboarding.** `pnpm install` activates the pre-push hook via the
  `prepare` script (`package.json:19`), and `predev` (`:44`) bootstraps the
  embedding model + help corpus so `pnpm dev` needs no manual fetch step. Node is
  pinned (`.nvmrc`, `engines`), and `CONTRIBUTING.md`'s "Getting set up" +
  "Everyday commands" table is accurate and copy-pasteable.
- **Fast, honest inner loop.** Single-file test ~1.3s; `test:watch` for the loop;
  `pnpm test <path>` documented for one-file runs. The 541-file suite is kept out
  of the inner loop by design.
- **Pre-push, not pre-commit** (`.githooks/pre-push`). Commits stay frictionless;
  the lint gate runs once at push, with real escape hatches (`--no-verify`,
  `SKIP_HOOKS=1`). This is the right call for a solo maintainer and is documented
  in three places consistently.
- **Real custom tooling — the standout DX asset:**
  - **`pnpm cli`** (`src/cli/`, `docs/cli.md`) — a headless, Electron-free
    thoughtbase interface: `query`/`sql`/`search`/`semantic`/`read`/`context`/
    `propose-note` + a stdio **MCP server** (`mcp.ts`), reusing the app's core.
    Proposals still route through the approval gate. Excellent leverage.
  - **Skills-eval golden-file harness** (`tests/skills-eval/`, `src/cli/eval*.ts`)
    — packages skill prompts exactly as the app does and snapshots
    `output/request.json`; CI catches prompt drift without a live LLM call.
  - **`bench-check.mjs`** — a committed-baseline perf regression gate
    (`bench:check` / `bench:baseline`), so hot paths can't silently regress.
  - **`lint:fonts`** — a one-line grep guard wired into the pre-push hook that
    blocks hardcoded mono-font literals in favor of `var(--font-mono)`. Small,
    specific, effective.
  - **Skill authoring flow** — contributors can add a Learning/Research/Analysis
    tool by dropping a markdown file, no TypeScript (`docs/authoring-skills.md`,
    `CONTRIBUTING.md:25-27`).
- **CI is thoughtful** (`ci.yml`): parallel lint-and-test / audit / e2e,
  `node_modules` cached against the lockfile+Node (valid because
  `node-linker=hoisted`), in-flight-run cancellation, and a documented,
  partially-blocking `pnpm audit` supply-chain gate. (Deployment/release detail
  deferred to the deployment review.)
- **Documentation depth.** `CLAUDE.md` is a genuine architecture map; `docs/`
  has `cli.md`, `authoring-skills.md`, `releasing.md`, `packaging.md`, plus
  `docs/architecture/` deep-dives. For a solo project this is well above average.

---

## Not Applicable / Not Recommended for a solo desktop app

These generic-template items were considered and **deliberately declined** — they
solve large-team/server problems Minerva doesn't have:

- **Containerize the dev environment (Docker/devcontainer).** N/A. Minerva builds
  a native macOS Electron app and depends on macOS fsevents + a darwin app bundle
  (the CI comment at `ci.yml:6-11` explains why even CI is macos-only). A
  container would fight the platform, not help.
- **Monorepo tooling (Nx/Turborepo/workspaces).** N/A. Single package; the
  clipper is a self-contained sub-build (`clipper/*.mjs`). Multi-package
  orchestration would be pure overhead.
- **Developer portal / internal docs site.** N/A. The existing website/docs +
  `docs/` + `CLAUDE.md` are sufficient for one maintainer plus occasional
  contributors.
- **Video walkthroughs / training materials / onboarding curriculum.** N/A at
  this scale; `CONTRIBUTING.md` + `CLAUDE.md` do the job.
- **Metrics/analytics dashboard for DX** (build-time trends, DORA, etc.). Not
  recommended. `bench.yml` + `bench-check.mjs` already track the one metric that
  matters (perf). A dashboard would be ceremony.
- **Error-tracking / telemetry service (Sentry etc.).** Explicitly out of scope —
  `CONTRIBUTING.md:146-152` makes privacy/no-telemetry a hard non-negotiable.
- **CI/CD-as-deployment review.** Out of scope here by design; `release.yml` and
  signing/notarization are the deployment review's territory.

---

## Prioritized action list

| # | Action | Effort | Value |
|---|---|---|---|
| QW1 | Add shared editor config: `.vscode/{extensions,settings,launch}.json` + `.editorconfig` | S (1-2h) | High — Svelte LS + Electron debug for any new contributor |
| QW2 | Add `packageManager: pnpm@10.x.y` (corepack pin); collapse the 3 CI copies | S (30m) | Med-High — one source of truth for pnpm |
| QW3 | Document "lint = 3 tools; svelte-check catches drift" alongside the preload-snapshot note | S (30m) | Med — prevents CI surprises |
| QW4 | Fix doc drift: `CLAUDE.md` lint desc, pre-push "~30s"→~50s, README "Type check" label | XS (15m) | Low-Med — accuracy |
| QW5 | Optional `pnpm doctor` (Node/pnpm/model/native-dep check) | S-M | Low — first-run failure clarity |

**Bottom line:** the inner loop, custom CLI/eval/bench tooling, and docs are
already excellent. The only real gaps are shared editor config and a single pnpm
pin — a few hours of work, not a project.
