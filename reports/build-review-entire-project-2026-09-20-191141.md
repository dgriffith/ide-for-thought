# Build System Review Plan
Generated: 2026-09-20T19:11:41Z
Scope: entire project

## Executive Summary

Minerva's build and CI/CD system is, on the whole, **better engineered than the
typical Electron project** — and materially better than this review expected
going in. The workflows are not boilerplate: `ci.yml`, `release.yml`, and
`bench.yml` carry ~180 lines of load-bearing comments that record *why* each
decision was made (why macOS-only runners, why `audit:prod` blocks and
`audit:all` doesn't, why `spctl` on the DMG was tried and dropped in favor of
`stapler validate`). Concurrency cancellation is configured. The `node_modules`
cache is keyed correctly and deliberately shared across all three workflows. The
release job independently re-runs lint + audit rather than trusting that the
tagged commit passed CI. Signing material is decoded to `$RUNNER_TEMP`, never
echoed, and cleaned up with `if: always()`. The DMG-and-ZIP presence check
(`release.yml:221-229`) exists specifically because a ZIP-only regression would
silently break auto-update. Most projects have none of this.

So this review is not a list of things that are broken because nobody thought
about them. It is mostly a list of things that were thought about carefully and
then drifted, plus two structural gaps in how build *artifacts* are assembled.

The headline finding is uncomfortable: **the `Bench` regression gate has failed
seven consecutive scheduled runs** — every Monday from 2026-08-03 through
2026-09-14 — and nothing in the system notifies anyone, so seven weeks of
"REGRESSED" verdicts accumulated in workflow runs nobody opened. This is worse
than a gate that doesn't exist, because the gate *worked*: the benchmarks it
flagged (`indexNote` 3.70×, `writeAndReindex` 3.76×) are precisely the code
paths the concurrent performance review independently rediscovered by
inspection (its C2, H2, M6). CI detected the regression seven weeks before a
human did. The defect is in the notification path, not the gate.

Second: the packaged artifact is **696 MB unpacked, a 239 MB DMG and a 242 MB
ZIP**. The ZIP is the Squirrel.Mac auto-update payload, so every installed app
downloads 242 MB for every point release, with no delta mechanism. A large part
of that is irreducible (DuckDB's `libduckdb.dylib` is 107 MB on its own), but
`forge.config.ts:71-78` copies dependency packages *whole* with
`fs.cpSync(..., { recursive: true })` — no file filter — so the artifact also
ships 638 sourcemaps, an `onnxruntime-web/dist` carrying four mutually-exclusive
WASM builds totalling 80 MB, `@types/node`, and upstream `docs/` directories.

Third, three smaller but real mechanical gaps: lockfile-drift protection is
**silently bypassed whenever the `node_modules` cache hits**; the release
workflow has **no check that the pushed tag matches `package.json`'s version**
(that check exists only in a local helper script a hand-typed `git tag` walks
straight past, and the failure mode — per `tag-release.mjs`'s own docstring — is
that auto-update never offers the build); and the e2e job rebuilds a 46-second
help-docs corpus on every run despite it being a pure function of committed
inputs.

Nothing here blocks shipping. One item (the dark bench gate) has been actively
costing the project information for seven weeks and should be fixed this week.

**Measured CI cost today** (real `gh run` data, not estimates): a PR costs
~9–13 minutes wall-clock, entirely gated by `lint-and-test`, of which 67% is a
single `pnpm coverage` step.

---

## Build System Findings

### Critical Issues

#### C1 — The `Bench` regression gate has been failing every week since 2026-08-03, and nothing notifies anyone

**Verified.** Every scheduled `Bench` run since the 2026-07-27 success has
failed:

| Run date | Event | Conclusion |
|---|---|---|
| 2026-07-27 | schedule | success |
| 2026-08-03 | schedule | **failure** |
| 2026-08-10 | schedule | **failure** |
| 2026-08-17 | schedule | **failure** |
| 2026-08-24 | schedule | **failure** |
| 2026-08-31 | schedule | **failure** |
| 2026-09-07 | schedule | **failure** |
| 2026-09-14 | schedule | **failure** |

(Source: `gh run list --workflow=bench.yml --limit 10`.)

The most recent failure (run `34839318742`, 2026-09-14) reports:

```
writeAndReindex: re-save one note in a 2000-note vault   1.50ms    5.65ms   3.76×  REGRESSED
indexNote: a note (title+tag+wiki-link) into 500-note    501.2µs   1.85ms   3.70×  REGRESSED
writeAndReindex: re-save one note in a 5000-note vault   4.27ms   13.62ms   3.19×  REGRESSED
writeAndReindex: re-save one note in a 500-note vault    681.4µs   2.09ms   3.07×  REGRESSED
indexAllNotes: 5000 notes from scratch                1181.86ms 2109.50ms   1.78×  REGRESSED
indexAllNotes: 2000 notes from scratch                 492.78ms  814.76ms   1.65×  OVER BUDGET
indexAllNotes: 500 notes from scratch                  144.75ms  224.66ms   1.55×  OVER BUDGET
```

**This is not flake.** Three independent lines of evidence:

1. The same benchmark families have failed for seven consecutive weeks. Runner
   noise does not repeat with that shape.
2. In the *same* runs, other benchmarks are clean or faster
   (`queryGraph: simple SELECT` at 1.05×, the cold-rebuild benches at 0.11×), so
   the runs are not uniformly slow — which is exactly the noise mode
   `bench-check.mjs`'s ratio-based design (`scripts/bench-check.mjs:16-22`) was
   built to absorb, and it absorbed it correctly.
3. The failing benchmarks are precisely the code paths the concurrent
   performance review independently identified by code inspection:
   `reports/perf-review-entire-project-2026-09-20-172227.md` §C2 ("`persistGraph()`
   … MEASURED: 15.0× query regression"), §H2 ("rdflib removal is O(K·T); it is
   the dominant term inside `indexNote`"), and §M6 ("History: full file copy plus
   a pretty-printed index rewrite per save" — squarely on `writeAndReindex`'s
   path).

The regression window is also identifiable. Between the last passing run
(2026-07-27) and the first failure (2026-08-03), `git log --since=2026-07-26
--until=2026-08-04 -- src/main/graph src/main/notebase` shows the typed-objects
epic landing (`94413d65` type registry, `14d68832` property model, `1f67f1c8`
typed properties as labeled edges, `afe895a4` subclass inheritance) plus the
per-note history engine (`336eedd3`, #1158) — all of which add per-note indexing
and per-save work.

**The CI/CD defect, distinct from the performance defect:** `bench.yml` has no
notification path whatsoever. There is no `if: failure()` step, no issue-filing
action, no Slack/webhook, no `actions/github-script` fallback. GitHub's only
built-in signal for a failing *scheduled* workflow is an email to the workflow
file's last committer, which is trivially filtered. A gate whose entire output
is a red dot on a page nobody opens is decoration.

Note the relationship to the perf review's C4 ("the gate is disarmed by a stale
baseline"): both findings are true and they are not the same finding. The
baseline is simultaneously *too loose* on some benchmarks (the cold-rebuild
benches run at 0.11–0.14× of baseline — 7–9× of dead headroom) and *correctly
firing* on others. The perf review owns re-blessing the numbers. This review
owns the fact that when the gate fires, nobody hears it.

**Files:** `.github/workflows/bench.yml:49-54` (the gating step, no `if:
failure()` sibling), `scripts/bench-check.mjs:215-220` (the non-zero exit that
lands nowhere), `tests/main/bench-baseline.json`.

#### C2 — The auto-update payload is a 242 MB ZIP, redownloaded in full for every release

**Verified by measurement** of the on-disk build in `out/`:

```
out/make/Minerva-2.0.2-arm64.dmg                 239 MB
out/make/zip/darwin/arm64/Minerva-darwin-arm64-2.0.2.zip   242 MB
out/Minerva-darwin-arm64/Minerva.app             696 MB unpacked
```

`src/main/auto-update.ts:1-22` documents that the app uses
`update-electron-app` against `update.electronjs.org`, which serves the
Squirrel.Mac feed. Squirrel.Mac has **no delta/patch mechanism** — it downloads
the complete `.zip` for every update. So shipping a 2.0.2 → 2.0.3 patch release
costs every installed user a 242 MB download.

`release.yml:225-229` correctly *fails the build* if the ZIP is missing, because
its absence would break auto-update — the risk was understood. What wasn't
budgeted is the ZIP's size.

A meaningful fraction of this is irreducible: `libduckdb.dylib` alone is 107 MB
and DuckDB is a core feature. But the breakdown below (H1) shows roughly
150–170 MB that is not.

This is a **deployment** finding, not a bundle-content finding — it is about what
`forge.config.ts`'s packaging step copies, not about what Rollup bundles. The
perf review's H12 (8.9 MB `main.js`) and M7 (3.25 MB renderer chunk) are
separate concerns; together they account for 24 MB + 43 MB of the app's 381 MB
`Resources/app`, i.e. not the dominant term here.

---

### High Priority Optimizations

#### H1 — `copyExternalDeps` copies packages whole; the artifact ships ~150 MB of files that never execute

`forge.config.ts:71-78`:

```ts
for (const dep of closure) {
  fs.mkdirSync(path.dirname(path.join(buildPath, 'node_modules', dep)), { recursive: true });
  fs.cpSync(
    path.join(root, 'node_modules', dep),
    path.join(buildPath, 'node_modules', dep),
    { recursive: true, dereference: true },
  );
}
```

There is no `filter` option passed to `cpSync`. The entire published tarball of
every package in the transitive closure of `EXTERNAL_DEP_ROOTS`
(`forge.config.ts:25-42`) is copied verbatim.

**Measured composition of `Minerva.app/Contents/Resources/app/node_modules`
(313 MB total):**

| Package | Size | Notes |
|---|---|---|
| `onnxruntime-web` | 138 MB | `dist/` alone is 133 MB |
| `@duckdb/node-bindings-darwin-arm64` | 107 MB | `libduckdb.dylib` 107 MB + `duckdb.node` 422 KB — **irreducible** |
| `sql.js` | 23 MB | `dist/` 23 MB (asm.js + wasm + debug + worker variants) |
| `@mixmark-io/domino` | 8.6 MB | turndown's DOM impl |
| `vega-lite` | 8.0 MB | |
| `vega` | 6.2 MB | |
| `protobufjs` | 3.1 MB | transitive |
| `@types` | 2.7 MB | `estree`, `geojson`, `node` — **type declarations in a runtime artifact** |

**Unambiguously dead weight, verified:**

- **638 `.map` files** ship inside the packaged app
  (`find Minerva.app -name '*.map' | wc -l` → 638). Within `onnxruntime-web/dist`
  alone these total ~15 MB (`ort.all.bundle.min.mjs.map` 3.1 MB,
  `ort.all.min.mjs.map` 3.0 MB, `ort.all.min.js.map` 3.0 MB,
  `ort.webgl.min.mjs.map` 1.8 MB, `ort.webgl.min.js.map` 1.8 MB,
  `ort.bundle.min.mjs.map` 1.5 MB, `ort.min.mjs.map` 1.3 MB,
  `ort.min.js.map` 1.3 MB). Note: the *first-party* bundles are clean — Vite's
  default `build.sourcemap: false` applies and none of the three `vite.*.mts`
  configs override it. Every shipped `.map` comes from an upstream package
  copied whole.
- **`@types/estree`, `@types/geojson`, `@types/node`** (2.7 MB) are `.d.ts`-only
  packages with no runtime code. They enter the closure because `depClosure`
  (`forge.config.ts:45-59`) walks `dependencies` and some upstream packages
  declare `@types/*` there.
- **`onnxruntime-web/docs`** (56 KB) and per-package `README.md` / `AUTHORS` /
  `CONTRIBUTING.md` / `eslint.config.cjs` (visible in `sql.js`'s listing).

**Likely-but-needs-one-verification-run:** `onnxruntime-web/dist` carries four
mutually-exclusive WASM builds —

```
ort-wasm-simd-threaded.jsep.wasm       27 MB   (WebGPU/WebNN)
ort-wasm-simd-threaded.asyncify.wasm   25 MB
ort-wasm-simd-threaded.jspi.wasm       15 MB
ort-wasm-simd-threaded.wasm            13 MB
```

plus `ort.all.mjs`/`ort.all.js` (5.7 MB each) and `ort.webgl.mjs`/`ort.webgl.js`
(3.4 MB each). `wasm-embedder.ts:29` does a bare `await
import('onnxruntime-web')` — the package's default entry — and
`wasm-embedder.ts:31-33` sets `ort.env.wasm.wasmPaths`, so exactly one of those
four `.wasm` files is fetched at runtime. Which one depends on ORT's entry
resolution and is worth confirming with one instrumented run before pruning; I
did not verify it and am not going to assert it. But at most one of the four is
live, so **~50–65 MB of WASM is dead** regardless of which.

**Recommended fix** (one small change, most of the win): add a `filter` to the
`cpSync` call excluding `**/*.map`, `**/*.d.ts`, `docs/`, `test/`, `example*/`,
and markdown, plus an explicit skip for `@types/*` roots in `depClosure`. That
alone removes the 638 sourcemaps and the `@types` tree with no behavioral risk.
Pruning the ORT WASM variants is a second, verification-gated step.

**Guardrail to add alongside it:** an artifact size budget, in the same spirit as
`tests/architecture/file-size-budgets.test.ts` — a committed number the release
job asserts the DMG against, failing when it *grows*. The codebase already has
the pattern (`pattern-ratchets.test.ts`, the `vitest.config.mts` coverage
floors); the artifact is the one large surface with no ratchet on it, which is
exactly how it got to 696 MB unobserved.

#### H2 — Lockfile-drift protection is silently bypassed whenever the `node_modules` cache hits

`ci.yml:49-58` (and the byte-identical block at `release.yml:77-86`):

```yaml
- name: Cache node_modules
  id: node-modules-cache
  uses: actions/cache@v6
  with:
    path: node_modules
    key: node-modules-v1-${{ runner.os }}-${{ runner.arch }}-node-${{ hashFiles('.nvmrc') }}-${{ hashFiles('pnpm-lock.yaml') }}

- name: Install dependencies
  if: steps.node-modules-cache.outputs.cache-hit != 'true'
  run: pnpm install --frozen-lockfile
```

`--frozen-lockfile` is the **only** thing in the entire pipeline that asserts
`pnpm-lock.yaml` is consistent with `package.json`. The cache key hashes
`pnpm-lock.yaml` but **not `package.json`**. So the drift case — someone edits a
version range in `package.json` and does not regenerate the lockfile — produces
an unchanged cache key, a cache hit, a skipped install, and a green CI run
against dependencies that don't match the manifest.

This was confirmed in a real run: `lint-and-test` step 6 "Install dependencies"
shows `skipped` in run `35524773279` (job step API output), with the preceding
cache step succeeding.

The `audit` job doesn't backstop this either — it never installs at all
(`ci.yml:133-157` has no install step; `pnpm audit` reads the lockfile directly).

**Verified as a real mechanical gap; the blast radius is narrow.** A *newly
added* dependency missing from the lockfile would fail `tsc` on the unresolvable
import. What slips through silently is a **version-range change** in
`package.json` with a stale lockfile — CI validates the old versions, and the
drift surfaces on the next contributor's cold install.

**Fix:** add `package.json` to the cache key, or (better, because it also
catches a hand-edited lockfile) add an unconditional
`pnpm install --frozen-lockfile --lockfile-only --dry-run`-style verification
step that runs regardless of cache state.

#### H3 — The release workflow never verifies the tag matches `package.json`'s version

`release.yml:33-34` triggers on `push: tags: ['v*']`. Nothing in the job then
checks that the tag's version equals the version being packaged.

That check exists — in `scripts/tag-release.mjs:23-24, 31-33`, which computes
`tag = \`v${version}\`` from `package.json` and refuses to create a mismatched
tag. But it is a **local convenience script**, and `git tag -a v2.0.3 && git
push origin v2.0.3` bypasses it entirely. The workflow trigger doesn't care how
the tag was created.

The consequence is documented by the script's own docstring
(`scripts/tag-release.mjs:5-9`):

> "The tag (`vX.Y.Z`) must equal the packaged `version`, because release.yml keys
> the build off the tag while update.electronjs.org compares the running app's
> `version` to the release. A mismatch means the updater never offers the 'new'
> build."

So the failure mode is a release that looks completely successful — signed,
notarized, stapled, verified, smoke-booted, drafted, published — and which
**silently never reaches any installed user**. Every other invariant in this
workflow is asserted server-side (`release.yml:168-171` DMG presence,
`release.yml:174-188` signature + staple, `release.yml:221-229` DMG-and-ZIP
pairing). This one is asserted only on the developer's laptop.

It's also the cheapest fix in this report — roughly five lines after checkout:

```yaml
- name: Verify tag matches package.json version
  if: startsWith(github.ref, 'refs/tags/')
  run: |
    pkg="v$(node -p "require('./package.json').version")"
    [ "$pkg" = "${{ github.ref_name }}" ] || { echo "::error::tag ${{ github.ref_name }} != package.json $pkg"; exit 1; }
```

#### H4 — 46 seconds per e2e run rebuilding a corpus that is a pure function of committed inputs

From the e2e job log of run `35524773279`:

```
17:06:35.67  $ pnpm build:e2e && playwright test      ← prebuild:e2e (prep.mjs) starts
17:06:37.96  embedding model ready … (1 file(s) fetched)
17:07:23.96  $ NODE_OPTIONS=… electron-forge package  ← prep.mjs finishes
```

`prep.mjs` (`scripts/prep.mjs:22-26`) runs three steps: `build-docs.mjs`, then
`fetch-embedding-model.mjs`, then `vite-node build-help-corpus.mjs`. The
timestamps localize the cost precisely:

- docs + model fetch: **2.3 s** (the model fetch is fast and SHA-verified;
  `scripts/fetch-embedding-model.mjs:7-9` documents the idempotent skip — good
  design, and it works)
- **help-corpus build: 46.0 s** (17:06:37.96 → 17:07:23.96)

For context, the *entire* `electron-forge package` that follows takes 12 s
(17:07:24 → 17:07:36) and Playwright takes 41 s. So this one prep step is 46% of
the e2e job's real work and is larger than packaging and testing combined.

`scripts/build-help-corpus.mjs:27-32` already implements a local mtime-based
skip, explicitly because "`predev` runs on every `pnpm dev` restart." That skip
works fine on a warm developer tree. It cannot work in CI: `resources/help-docs/`
is gitignored (`.gitignore`, the "Precomputed help-docs corpus" block), so every
runner starts cold.

The inputs are `website/docs/_content/*.html` (119 files, all committed), the
extraction logic, the script itself, and the pinned model revision — all
content-hashable. This is a textbook `actions/cache` candidate:

```yaml
- uses: actions/cache@v6
  with:
    path: resources/help-docs
    key: help-corpus-v1-${{ hashFiles('website/docs/_content/**', 'scripts/build-help-corpus.mjs', 'scripts/lib/extract-docs-corpus.mjs', 'src/main/embeddings/**') }}
```

Recovers ~46 s per e2e run. CI runs on both PR and merge-to-main, so at the
observed cadence (~8 CI runs on 2026-09-20 alone) this is on the order of 6
minutes of macOS runner time per day.

#### H5 — `bench.yml` is the only workflow with no dependency cache

`bench.yml:46-47`:

```yaml
- name: Install dependencies
  run: pnpm install --frozen-lockfile
```

Unconditional, with no `actions/cache` step for `node_modules` — unlike
`ci.yml:49-54` and `release.yml:77-82`, which deliberately share one cache key so
they warm each other (`release.yml:74-76` says so explicitly). `bench.yml` does
keep `cache: pnpm` on `setup-node` (`bench.yml:40-44`), so it gets the pnpm
*store* cache but still pays full linking.

Measured: the 2026-09-14 bench run took 5 m 45 s end to end
(11:39:34 → 11:45:19). The `ci.yml` cache-hit path resolves `node_modules` in
32 s (step 5, run `35524773279`); a cold `pnpm install` is the difference.

It's one copied `actions/cache` block, using the identical key the other two
already share. Low effort, and it makes the three workflows consistent — which
matters more than the seconds, because right now a reader has to notice the
asymmetry to know it's not intentional.

`bench.yml` also lacks a `concurrency:` group, unlike `ci.yml:22-24` and
`release.yml:41-43`. Two overlapping `workflow_dispatch` runs during a
re-blessing session would both benchmark on contended runners and produce
mutually-corrupting numbers.

---

### Medium Priority Issues

#### M1 — `pnpm coverage` is 67% of the critical path, with no pool tuning and no sharding

Step-level timing for `lint-and-test` in run `35524773279` (real, via
`gh api repos/:owner/:repo/actions/jobs/<id>`):

| # | Step | Duration |
|---|---|---|
| 1–4 | Set up job / checkout / pnpm / Node | 36 s |
| 5 | Cache node_modules | 32 s |
| 6 | Install dependencies | *skipped (cache hit)* |
| 7 | **Lint (tsc + svelte-check + eslint)** | **2 m 29 s** |
| 8 | Lint fonts | 1 s |
| 9 | Check generated docs are up to date | <1 s |
| 10 | Install Python packages (pandas/matplotlib/pillow) | 13 s |
| 11 | **Test + coverage** | **8 m 03 s** |
| 12 | Upload coverage to Codecov | 5 s |
| | **Total** | **12 m 05 s** |

`vitest.config.mts` sets `include`, `reporters`, `testTimeout`, `env.TZ`, and a
very thorough `coverage.thresholds` block (491 lines of it, with per-file floors
and written justifications — genuinely excellent work). What it does **not** set
is any execution-strategy config: no `pool`, no `poolOptions`, no `maxWorkers`,
no `isolate`, no `fileParallelism`. Vitest 5 defaults to `forks` with
`isolate: true` — the safest and slowest combination, and the right default for
a suite that touches the filesystem, chokidar watchers, and DuckDB.

Two observations, offered as questions rather than prescriptions:

1. **The defaults may well be correct here.** This suite genuinely has
   filesystem-stateful tests. `isolate: false` would be reckless. I am not
   recommending it.
2. **But 8 minutes is past the point where sharding pays.** `vitest --shard=1/3`
   across three parallel `lint-and-test` jobs would cut the critical path from
   ~12 min to ~6 min. The cost is that v8 coverage thresholds need merging
   across shards (`--coverage.reportOnFailure` plus a merge step, or
   `@vitest/coverage-v8`'s `mergeReports`), which is real work given how
   carefully the per-file floors are tuned — breaking them would be a
   significant regression in a system that is currently a strength.

**Recommendation:** treat this as a deliberate trade-off to revisit when the
suite crosses ~12 min, not as something to fix now. Worth noting in the workflow
comments so the next reader knows it was considered.

*(On the `vitest-pool` worker-startup timeout observed once during the perf
review's benchmarking session: I could not reproduce it and found no config
smell that explains it. `vitest.bench.config.ts:16-27` documents a genuine
related quirk — bench-mode tests hit a hardcoded ~60 s ceiling and
`testTimeout: 0` does **not** disable it, which is why that file sets an explicit
`300_000`. That's a known-and-handled vitest behavior, not the same thing as a
worker-startup timeout. I'd call the observed timeout unexplained rather than
benign; if it recurs, `poolOptions.forks.execArgv` and runner memory pressure
during coverage instrumentation are the places to look.)*

#### M2 — `audit:all` has been `continue-on-error` since #1455; step 2 of its own documented promotion path never happened

`ci.yml:155-157`:

```yaml
- name: audit:all (full tree, high+critical)
  continue-on-error: true
  run: pnpm audit --audit-level=high
```

The comment above it (`ci.yml:124-127`) names this explicitly:

> "STEP 2 of the promotion path: once the full tree is clean, remove
> `continue-on-error` from `audit:all` too (or drop `audit:prod` and gate
> `audit:all`)."

`pnpm-workspace.yaml`'s `overrides` block shows real, sustained work in this
direction — #2154 added seven security overrides with per-entry justifications,
including a genuinely careful one (`plist>@xmldom/xmldom: '>=0.8.15 <0.9.0'`,
pinned *within* the 0.8 line because 0.9 broke `pnpm build` via a real
`parseFromString` API change, discovered by actually running the build rather
than trusting `pnpm audit` going quiet). That is exemplary dependency work.

But the step is still non-blocking, so there is no signal for *when* step 2
becomes possible — the job is green either way, and nobody is prompted to check.
The same asymmetry appears in `release.yml:96-97`, which re-runs only
`audit --prod` and not `audit:all`.

**Recommendation:** either flip `continue-on-error: false` if the tree is now
clean (one CI run answers this), or add an explicit expected-advisory count so
the step fails when the set *grows* — the ratchet pattern this codebase already
uses everywhere else.

#### M3 — `copyCliBundle` shells out to `pnpm` in the middle of packaging

`forge.config.ts:93-102`:

```ts
function copyCliBundle(buildPath: string): void {
  execFileSync('pnpm', ['cli:build'], { stdio: 'inherit' });
  ...
}
```

This runs a full Vite build from inside forge's `afterPrune` hook. The
justification (`forge.config.ts:87-92`) is sound and hard-won — `generateAssets`
runs before the Vite plugin, which then empties `.vite/build` — and the measured
cost is small (1.3 s: `17:07:34.70` → `17:07:36.03` in the e2e log).

Two residual fragilities, neither urgent:

- It hard-codes `pnpm` on `PATH` at package time. `pnpm build` invoked through
  any wrapper that doesn't propagate the shim (a sandboxed builder, a CI image
  with a differently-installed pnpm) fails inside forge's hook rather than at a
  legible top-level step.
- It calls a `package.json` script by name from a config file, creating a
  script→config→script cycle that's easy to break by renaming `cli:build`.

Calling Vite's Node API directly (`import { build } from 'vite'`) with the
config object removes both. Genuinely low priority — the current version works
and is well-documented.

#### M4 — Actions are pinned by mutable major tag, not commit SHA

Across all three workflows: `actions/checkout@v7`, `actions/setup-node@v7`,
`actions/cache@v6`, `actions/upload-artifact@v7`, `codecov/codecov-action@v7`,
`softprops/action-gh-release@v3`, `pnpm/action-setup@v6.1.0`.

Major-version tags are mutable — a compromised or reverted upstream tag changes
what runs. This matters disproportionately for `release.yml`, which is the job
holding Apple signing secrets and `contents: write`.

Real credit where due: `pnpm/action-setup@v6.1.0` is pinned to an exact minor,
and `.github/dependabot.yml` has a `github-actions` ecosystem entry keeping these
current (the 2026-09-14 `dependabot/github_actions/actions-dfc3086b10` PR shows
it working). The remaining gap is mutability, not staleness.

**Recommendation:** SHA-pin at minimum the actions used in `release.yml`.
Dependabot updates SHA pins as readily as tag pins and appends the version as a
trailing comment, so this costs nothing ongoing.

#### M5 — No explicit `permissions:` block in `ci.yml` or `bench.yml`

`release.yml:38-39` correctly declares `permissions: contents: write` with a
comment explaining why. `ci.yml` and `bench.yml` declare nothing.

**Verified mitigating fact:** the repository default is already least-privilege —

```
$ gh api repos/:owner/:repo/actions/permissions/workflow
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
```

So this is **not a live vulnerability**; it's an unpinned assumption. A future
org-level or repo-level settings change would silently widen the token for two
workflows that have no business writing anything. Adding `permissions: contents:
read` to both is two lines and makes the intent local to the file rather than
dependent on a settings page.

A related note on `release.yml:38-39`: `contents: write` is declared at
*workflow* scope. With a single job that's equivalent to job scope, but if a
second job is ever added (a notarization-status reporter, a Linux builder per
epic #2200) it inherits write access it doesn't need. Moving it under
`jobs.build-macos.permissions` costs one line of indentation and makes that
inheritance impossible.

#### M6 — No changelog; release notes are auto-generated from PR titles

`release.yml:258` sets `generate_release_notes: true`, which produces GitHub's
"what's changed" list from merged PR titles. There is no `CHANGELOG.md` in the
repo (verified: no match for `CHANGELOG*`).

For this project this is arguably the *right* call — commit discipline is
excellent (every commit carries a `feat(scope):`/`fix(scope):` prefix and an
issue number), so the auto-generated notes are genuinely readable. The cost is
that there is no curated, user-facing summary distinguishing "we fixed a
DuckDB BigInt serialization bug" from "we shipped local note history."

Worth a decision rather than a default. If auto-generation stays, say so in
`docs/releasing.md` so the absence reads as intentional.

#### M7 — Dev and CI run different Node major versions

`.nvmrc` pins `24`; `package.json:7-9` declares `engines: { node: ">=24" }`. The
development machine this review ran on is on `v25.9.0`.

CI (`ci.yml:38-42`, `release.yml:68-72`, `bench.yml:40-44` all use
`node-version-file: .nvmrc`) therefore validates on Node 24 while local
development — including the pre-push `pnpm lint` gate — runs on Node 25. The
`engines` range permits both, so this is legal, not broken.

The practical consequence is a narrow class of failures the local gate cannot
catch: anything sensitive to a Node 24↔25 behavioral difference passes pre-push
and fails in CI. Given that the pre-push hook exists specifically to "catch an
obvious failure locally instead of burning a slow macos-latest CI run"
(`.githooks/pre-push:4-7`), a version skew between the two erodes exactly the
property the hook is buying.

---

### Low Priority Enhancements

#### L1 — `@types/markdown-it-footnote` is a runtime `dependency`

`package.json:69` lists `"@types/markdown-it-footnote": "^3.0.4"` under
`dependencies`, not `devDependencies`. It is a declarations-only package with
zero runtime code.

Two minor consequences: it's inside the surface `pnpm audit --prod` scans
(`ci.yml:151`), which is supposed to mean "advisories that actually reach
users"; and it's eligible for the `depClosure` walk if anything ever roots
through it. Every other `@types/*` in this project is correctly a devDependency
(`package.json:111-114`), so this reads as an oversight rather than a decision.

#### L2 — `vite.preload.config.mts` is an empty config with no stated policy

The whole file is:

```ts
import { defineConfig } from 'vite';
export default defineConfig({});
```

The defaults are correct (no sourcemaps, minified, externalized builtins), so
nothing is wrong. But `vite.main.config.mts` and `vite.cli.config.mts` both carry
substantial docstrings explaining their externalization decisions, and
`vite.renderer.config.mts:6-24` explains both its `optimizeDeps.entries` scoping
and its `d3-path` dedupe. The preload config is the one build input with no
recorded reasoning, which makes "is this empty on purpose?" unanswerable from
the file.

#### L3 — The pre-push hook runs the full repo lint unconditionally

`.githooks/pre-push:17-27` runs `pnpm lint:fonts` then `pnpm lint` on every
push, regardless of what changed. Measured cost (from `scripts/lint.mjs:1-5` and
corroborated by CI step 7 at 2 m 29 s on a cold runner): ~40 s locally.

**This is correctly scoped and should not be changed.** Scoping `tsc --noEmit`
to changed files is not meaningful — a change in one file breaks types in
another, which is the entire point of running it. `svelte-check` has the same
property. The two escape hatches (`--no-verify`, `SKIP_HOOKS=1`) are documented
in the hook itself. Listed here only to record that it was examined and found
appropriate.

#### L4 — `dependency-cruiser` is a devDependency with no CI script — and that's fine

`package.json:118` has `dependency-cruiser: ^18.2.0` but there is no
`depcruise` script and no `.dependency-cruiser.js` config. It is consumed
programmatically from inside the test suite:
`tests/architecture/no-cycles.test.ts:27` and
`tests/cli/electron-free.test.ts:40`, both calling `cruise()` directly.

That is a *better* arrangement than a separate lint script — the constraint runs
inside `pnpm test`, so it's gated by the same job with the same failure
reporting, rather than being a fourth thing someone has to remember to wire into
CI. Noted as a positive, not a gap.

---

## Current State Analysis

### Build Tools and Configuration

**Toolchain.** pnpm 12.3.4 (pinned via `package.json:6` `packageManager`),
Node 24 (`.nvmrc`), electron-forge 7.11.2, Vite 8.2.2, Electron 44, TypeScript
6.0.3, Vitest 5, Playwright 1.63.

**Four Vite configs**, each with a distinct job:

| File | Target | Notable |
|---|---|---|
| `vite.main.config.mts` | main process (CJS single-file) | `external`: `canvas`, `@duckdb/node-bindings`, `vega`, `vega-lite`, `sql.js`, `onnxruntime-web/-common` (lines 38-53), each with a recorded reason |
| `vite.preload.config.mts` | preload | empty (L2) |
| `vite.renderer.config.mts` | renderer | `optimizeDeps.entries: ['index.html']` to stop the clipper HTML from poisoning the dep scan; `resolve.dedupe: ['d3-path']` for the mermaid/vega d3-path@1-vs-@3 collision (lines 15-25) |
| `vite.cli.config.mts` | headless CLI (`cli.js`) | `ssr.noExternal: true` + `codeSplitting: false` so the CLI is one self-contained file that resolves the same shipped native roots as `main.js` |

All four bake `__APP_COMMIT__`/`__BUILD_DATE__` via `define` at config-eval time,
with a `try/catch` fallback to `'unknown'` for git-less checkouts
(`vite.main.config.mts:8-15`). The renderer build is fast — **4.6 s** for all
production Vite bundles (e2e log, `17:07:24.68` → `17:07:29.24`).

**`forge.config.ts`** — makers are `MakerZIP({}, ['darwin'])` and `MakerDMG`
(lines 178-181), correctly narrowed to match the actual release matrix. The
comment at lines 172-177 records that linux/win32 ZIP makers were *removed* in
#1636 because they implied a cross-platform release that doesn't exist (and
win32 would need `MakerSquirrel`, not `MakerZIP`, plus its own update feed).
That is the right call — an aspirational maker config is worse than none, and
the epic tracking real triple-OS support (#2200 with children #2196/#2197/
#2198/#2199) is where that work belongs.

**Signing and notarization** — genuinely robust, and the review expected worse:

- `forge.config.ts:113-121` gates signing behind `wantSign = isDarwin &&
  (hasNotarizeCreds || OSX_SIGN_IDENTITY)`, so `pnpm build:e2e` on a
  cert-less machine doesn't try to sign and fail.
- `release.yml:105-143` imports the cert into a throwaway keychain with an
  `openssl rand`-generated password, `rm`s the decoded `.p12` immediately, and
  exports only paths/IDs through `$GITHUB_ENV`. Nothing is echoed.
- `release.yml:262-266` cleans up with `if: always() && env.SIGNING_KEYCHAIN !=
  ''`, so material doesn't survive a failed build on a reused runner.
- `forge.config.ts:219-237`'s `postMake` hook separately notarizes and staples
  the **DMG**, because forge staples the `.app` but the DMG wrapper isn't
  stapled by the maker — an un-stapled DMG works online and fails offline. This
  is a subtle bug that most projects ship with.
- `release.yml:161-188` then *independently verifies* the result:
  `codesign --verify --deep --strict`, `spctl --assess --type execute`, and
  `xcrun stapler validate`. The comment at lines 179-186 records that
  `spctl` on the DMG was tried and deliberately dropped as a documented
  false-negative source, with `stapler validate` named as the authoritative
  check. That's a level of rigor worth calling out.

**Does misconfiguration fail loudly?** Traced through: yes. `HAS_SIGNING`
(`release.yml:59`) keys only off `APPLE_CERTIFICATE_P12_BASE64`. If the cert is
present but the API-key secrets are missing, `Prepare macOS signing` runs,
forge's `hasNotarizeCreds` evaluates false (it requires all three), `wantSign`
falls to false, and an **unsigned** app is built — at which point the
`HAS_SIGNING`-gated verify step runs `codesign --verify` against an unsigned
binary and **fails the job**. Partial-credential misconfiguration is caught. The
one quiet path is a fully credential-less local `pnpm build`, which produces an
unsigned DMG with a normal-looking name and prints no warning.

**Resource staging** — `packagerConfig.extraResource: ['resources']`
(`forge.config.ts:159`) stages the whole directory once:

```
resources/models              23 MB   (fetched, gitignored)
resources/help-docs          4.3 MB   (generated, gitignored)
resources/icons              128 KB
resources/python              96 KB   (minerva_kernel.py)
resources/tutorial-thoughtbase 84 KB
                             -----
                              27 MB
```

Verified in the packaged app at `Minerva.app/Contents/Resources/resources` at
exactly 27 MB — **copied once, no duplication**. The Python kernel, ONNX model
weights, and help-docs corpus all land correctly. This part is clean.

**Native modules** — the picture is better than the "native rebuild" framing
suggests, because almost nothing is rebuilt:

- `@duckdb/node-bindings-darwin-arm64` ships a **prebuilt** `duckdb.node`
  (422 KB) plus `libduckdb.dylib` (107 MB). No compilation.
- `onnxruntime-web` is **WASM**, not native — `wasm-embedder.ts:5` records this
  was deliberate ("a few MB of `.wasm`, vs the ~100 MB native
  onnxruntime-node"). `onnxruntime-node` is present in the store but explicitly
  denied a build script (`pnpm-workspace.yaml` `allowBuilds`) and is not in
  `EXTERNAL_DEP_ROOTS`.
- Only three packages in the tree carry a `binding.gyp` at all: `macos-alias`,
  `fs-xattr`, `sharp` — and `pnpm-workspace.yaml`'s `allowBuilds` grants build
  scripts to exactly `electron`, `esbuild`, `fs-xattr`, `macos-alias`.

Measured: forge's **"Preparing native dependencies"** step (i.e. `@electron/rebuild`)
takes **3.9 s** (e2e log, `17:07:29.25` → `17:07:33.18`). There is nothing to
cache because there is nothing being compiled. **For the darwin platform that
actually ships today, this step is efficient, correct, and needs no work.**

The `EXTERNAL_DEP_ROOTS` mechanism itself is well-defended:
`forge.config.ts:66-70` throws if `@duckdb/node-bindings`, the
platform-specific bindings, or `@mixmark-io/domino` are absent from the
computed closure — a missing native binding is treated as a broken build, not a
shrug. And the packaged-app e2e (`tests/e2e/smoke.spec.ts`, the "packaged app
opens a DuckDB-backed project (native binding shipped)" case, passing in 3.4 s)
fails loudly if the list goes stale. That is exactly the right guard.

**pnpm settings** live in `pnpm-workspace.yaml`, not `package.json` — correctly
migrated for pnpm 11/12, with a comment recording why (`nodeLinker: hoisted`,
`allowBuilds`, `blockExoticSubdeps: false` for `@electron/node-gyp`'s git
tarball, and a `minimumReleaseAgeExclude` for the deliberately-recent
`adm-zip@0.6.1`). The `nodeLinker: hoisted` choice is what makes caching
`node_modules` directly safe, and `ci.yml:44-48` says so.

### CI/CD Pipeline Status

**Three workflows, one of them broken.**

| Workflow | Trigger | Runner | Status |
|---|---|---|---|
| `CI` | `push: [main]`, `pull_request` | `macos-latest` ×2, `ubuntu-latest` ×1 | Healthy |
| `Release` | `push: tags: v*`, `workflow_dispatch` | `macos-latest` | Healthy (last used v2.0.2, 2026-09-09) |
| `Bench` | `schedule: '0 6 * * 1'`, `workflow_dispatch` | `macos-latest` | **Failing since 2026-08-03 (C1)** |

**Job graph.** `ci.yml` has **no `needs:` edges** — all three jobs start
simultaneously. Verified in run `35525609245`: `e2e` started 17:21:43, `audit`
17:21:37, `lint-and-test` 17:21:41. This is the right shape: `audit` is a
9-second lockfile read on cheap ubuntu, and serializing it behind anything would
be pure latency. Nothing here is accidentally sequential.

**Concurrency.** `ci.yml:22-24` groups on `ci-${{ github.ref }}` with
`cancel-in-progress: true`, and it demonstrably fires — run `35522029319` shows
all three jobs `cancelled` within 10 seconds when `35522036490` superseded it.
`release.yml:41-43` correctly sets `cancel-in-progress: false` (you do not want
to cancel a half-notarized release). `bench.yml` has no group (H5).

**Caching.** Two-layer, deliberately designed:
1. `setup-node`'s `cache: pnpm` → the pnpm content-addressed store (miss path).
2. `actions/cache@v6` on `node_modules` directly, keyed
   `node-modules-v1-{os}-{arch}-node-{hash(.nvmrc)}-{hash(pnpm-lock.yaml)}` —
   safe only because `nodeLinker: hoisted` makes the tree self-contained, which
   the comment at `ci.yml:44-48` explains. `ci.yml` and `release.yml` use the
   **identical key** so they warm each other (`release.yml:74-76`).

Measured effectiveness: cache restore 32 s (lint-and-test) / 16 s (e2e), with
`Install dependencies` skipped entirely. This is working well. `bench.yml` opts
out (H5); the help-docs corpus is uncached (H3).

**Matrix usage:** none, anywhere. Correct for today — a matrix over one platform
is noise. The relevant expansion is the triple-OS epic (#2200 / #2196), not
something to retrofit now.

**Secrets.** `CODECOV_TOKEN` (`ci.yml:106`, with `fail_ci_if_error: false` so a
missing token is a silent no-op), and five Apple secrets in `release.yml`. All
scoped to the step that needs them via step-level `env:`. No secret is
interpolated into a `run:` string where it could be logged.

**Timeouts.** `lint-and-test` 20 min (actual 12 m), `e2e` 25 min (actual 2.5 m),
`audit` 10 min (actual 9 s), `release` 35 min (raised from 30 with a comment
explaining the notarization budget), `bench` 20 min (actual 5.75 m). All present,
all with headroom. The `e2e` and `audit` budgets are generous relative to actual,
but a timeout is a runaway guard, not a SLO.

**Redundant work across jobs:** the two macOS jobs each restore `node_modules`
independently — unavoidable, they're separate VMs, and a shared cache is exactly
the right mitigation. The `audit` job deliberately skips install entirely.
`release.yml:93-97` re-runs `pnpm lint` and `pnpm audit --prod` that `ci.yml`
already ran — **intentional and correct**, per the comment at `release.yml:88-92`:
a tag can point at any commit, so the release asserts independently rather than
trusting an upstream check that may not have run against that ref.

### Dependencies

**Manifest:** 45 runtime `dependencies`, 36 `devDependencies`. The runtime set is
heavy by nature — three LLM SDKs (`@anthropic-ai/sdk`, `@google/genai`,
`openai`), an RDF stack (`rdflib`, `n3`, `@comunica/query-sparql-rdfjs`), DuckDB,
ONNX runtime, PDF.js, Tesseract, MapLibre, Mermaid, Cytoscape, Chart.js, Vega.
That's the product, not bloat.

**Overrides** (`pnpm-workspace.yaml`), all justified in-file:

| Override | Reason | Still needed? |
|---|---|---|
| `@codemirror/view` 6.43.1, `@codemirror/state` 6.7.1, `@codemirror/language` 6.12.4 | Prevent duplicate-copy tree splits that break `tsc` with "separate declarations" errors | **Yes** — exact pins, matching the project-memory note on CodeMirror dedup |
| `d3-path: ^3.1.0` | mermaid→d3-sankey→d3-shape@1 nests a d3-path@1 inside d3-shape@3's `node_modules`, breaking vega-embed's `import {Path}` | **Yes** — paired with `resolve.dedupe: ['d3-path']` in `vite.renderer.config.mts:24`; both halves are load-bearing |
| `parse-url >=8.1.0`, `tmp >=0.2.6`, `gry >=6`, `sharp >=0.35.4`, `adm-zip >=0.6.1` | #1455 / #2154 security force-patches | Yes (verify on each rdflib/transformers bump) |
| `rdflib>@xmldom/xmldom >=0.9.12` and `plist>@xmldom/xmldom >=0.8.15 <0.9.0` | Two scoped edges, **deliberately not** one global key — 0.9.x's stricter `parseFromString` breaks `@electron/packager`'s `plist` during Info.plist generation | Yes — the comment documents the failed global attempt, which is exactly the kind of thing that gets re-broken without it |
| `fast-uri`, `browserslist`, `baseline-browser-mapping`, `tar >=7.5.21` | #2154 advisory fixes; `tar` is a deliberate cross-major jump verified with a full `pnpm build` | Yes |

**Verdict: the overrides are correctly scoped and well-documented.** The
`plist>@xmldom/xmldom` entry in particular shows the right instinct — narrowing
rather than globalizing after a real build failure, and writing down why.

**Lockfile hygiene:** `--frozen-lockfile` is used in all three workflows, but
conditionally in two of them (H2). `pnpm-lock.yaml` is committed. No
`.npmrc` exists (settings correctly live in `pnpm-workspace.yaml`).

**Automated scanning:** `.github/dependabot.yml` covers both `npm` and
`github-actions`, weekly, with minor+patch grouped into one PR and majors
individual — a sensible noise/review balance. One documented `ignore`:
`@retorquere/bibtex-parser` 10.x, pinned because the published tarball ships no
`.d.ts` files despite advertising them, with a note to re-check on republish.
Dependabot demonstrably works (a `github_actions` PR merged 2026-09-14). Note
that the 2026-09-14 `npm_and_yarn` Dependabot Updates run **failed** — worth a
look, though it's Dependabot's own resolution run rather than repo CI.

---

## Build Performance Metrics

All numbers below are **measured**, from `gh run view` / `gh api
repos/:owner/:repo/actions/jobs/<id>` on run `35524773279` (PR
`feat/1161-provenance-stock-queries`, 2026-09-20) and from `du` against the
`out/` build of v2.0.2, unless marked otherwise.

**CI wall-clock, recent runs:**

| Run | Event | Wall time |
|---|---|---|
| 35525609245 | push → main | 9 m 13 s |
| 35524773279 | pull_request | 12 m 15 s |
| 35524290717 | push → main | 9 m 49 s |
| 35523723552 | pull_request | 10 m 45 s |
| 35522036490 | push → main | 12 m 42 s |

**Per-job (run 35524773279):**

| Job | Runner | Duration | Critical path? |
|---|---|---|---|
| `audit` | ubuntu-latest | **9 s** | No |
| `e2e` | macos-latest | **2 m 27 s** | No |
| `lint-and-test` | macos-latest | **12 m 05 s** | **Yes — sets the whole PR latency** |

**`lint-and-test` internals:** setup+cache 68 s (9.4%) · lint 149 s (20.6%) ·
lint:fonts + check:docs 1 s · pip install 13 s (1.8%) · **coverage 483 s
(66.6%)** · Codecov 5 s.

**`e2e` internals:** setup+cache 38 s · `pnpm test:e2e` 102 s, decomposed from
log timestamps as **prep 48 s** (docs+model 2.3 s, **help-corpus 46 s**) +
**electron-forge package 12 s** (Vite production bundles 4.6 s, native deps
3.9 s, cli:build 1.3 s, finalize ~2 s) + **Playwright 41 s** · artifacts 2 s.

**`bench`:** 5 m 45 s (2026-09-14 run; includes an uncached `pnpm install`).

**`pnpm lint` locally:** ~40 s claimed in `scripts/lint.mjs:1-5` ("measured ~48s
→ ~39s"). **The parallelism is real, not aspirational** — `scripts/lint.mjs:53`
is `await Promise.all(CHECKS.map(run))` over three `spawn`ed children, with
output buffered per-check and printed as labelled blocks so concurrent runs
don't interleave (lines 36-49, 56-62). eslint gets `--max-old-space-size=4096`
(line 26) after it OOMed at ~2 GB in #1789, with the comment correctly noting a
heap ceiling is not a reservation. On CI's colder runner the same work takes
2 m 29 s.

**Artifact sizes (v2.0.2 build in `out/`):**

| Artifact | Size |
|---|---|
| `Minerva.app` (unpacked) | **696 MB** |
| → `Contents/Resources/app/node_modules` | 313 MB |
| → `Contents/Resources/app/.vite/renderer` | 43 MB |
| → `Contents/Resources/app/.vite/build` | 24 MB |
| → `Contents/Resources/resources` | 27 MB |
| → Electron framework + remainder | ~289 MB |
| `Minerva-2.0.2-arm64.dmg` | **239 MB** |
| `Minerva-darwin-arm64-2.0.2.zip` (auto-update payload) | **242 MB** |
| Sourcemaps shipped inside the `.app` | **638 files** |

**Not measurable from config, stated as unknown:**

- **Cold `pnpm build` (full `electron-forge make`) wall time.** Not measured —
  running it would mutate `out/` and tracked `website/docs/*.html` via
  `prebuild`, and this is a read-only review. `docs/releasing.md` puts
  notarization alone at 10–15 min, and `release.yml:48-51` sets a 35-minute
  budget raised from 30 because "30 was tight," which brackets it at roughly
  20–30 min. Treat as an estimate, not a measurement.
- **Cache hit ratio over time.** GitHub's API exposes cache entries but not
  hit/miss history. Observed hits on every run inspected.
- **`pnpm dev` cold startup.** `predev` → `prep.mjs` is a no-op on a warm tree
  (both `fetch-embedding-model.mjs` and `build-help-corpus.mjs` implement
  content/mtime skips, verified in their source), so steady-state dev startup is
  Vite's alone. A genuinely cold first run pays the same 46 s help-corpus build
  plus a 23 MB model download. Not timed here.
- **Per-check breakdown of `pnpm lint`.** `scripts/lint.mjs` prints ✓/✗ per
  check but not durations, and the aggregate is `Promise.all`-bounded by the
  slowest. The script's own comment says TS is the binding constraint.

---

## Improvement Plan

### Immediate Actions (Critical)

1. **Make `Bench` failures reach a human.** Add an `if: failure()` step to
   `bench.yml` that files or updates a GitHub issue (`actions/github-script`,
   or `peter-evans/create-issue-from-file`). This needs `permissions: issues:
   write` on that job and nothing else. Without it, the remaining bench work is
   pointless. **~15 lines.**
2. **Triage the seven-week regression.** The 3.0–3.8× `writeAndReindex` /
   `indexNote` regressions are real and already independently root-caused by the
   perf review (its C2, H2, M6). That work belongs to the perf plan; this review's
   ask is only that the gate isn't re-blessed to green *before* the regression is
   fixed — re-blessing now would permanently bake a 3.7× slowdown into the
   baseline and destroy the only historical record of when it appeared.
3. **Add the tag↔version check to `release.yml`** (H3). Five lines. The current
   failure mode is a fully green release that never reaches users.

### Short-term (1-2 weeks)

4. **Add a `filter` to `copyExternalDeps`'s `cpSync`** (H1) excluding `*.map`,
   `*.d.ts`, `docs/`, `test/`, `example*/`, and markdown; skip `@types/*` roots
   in `depClosure`. Verify with the existing packaged-app e2e, which already
   fails loudly on a missing runtime dependency. **Expected: −20 MB or better,
   zero behavioral risk.**
5. **Close the lockfile-drift bypass** (H2) — add `package.json` to the
   `node_modules` cache key in both `ci.yml:54` and `release.yml:82`, or add an
   unconditional frozen-lockfile verification step.
6. **Cache `resources/help-docs`** keyed on `hashFiles('website/docs/_content/**',
   'scripts/build-help-corpus.mjs', 'scripts/lib/extract-docs-corpus.mjs')` (H3).
   **Recovers ~46 s per e2e run.**
7. **Give `bench.yml` the shared `node_modules` cache and a `concurrency:`
   group** (H5) — copy the block from `ci.yml:49-54` verbatim.
8. **Add explicit `permissions:` to `ci.yml` and `bench.yml`** (M5) and move
   `release.yml`'s to job scope.
9. **Resolve `audit:all`'s promotion** (M2) — one CI run tells you whether the
   full tree is clean enough to flip `continue-on-error: false`.

### Long-term (1+ months)

10. **Determine the minimum ONNX runtime WASM set and prune it** (H1, second
    half). Instrument one run to confirm which `.wasm` the embedder actually
    loads, then ship only that plus the matching JS entry. Potential **−50 to
    −65 MB** off every auto-update download.
11. **Add an artifact size budget to the release job** — a committed number the
    DMG is asserted against, failing on growth, in the same style as
    `tests/architecture/file-size-budgets.test.ts`. This is the missing ratchet
    on the one surface that has none, and it is what keeps H1's win from
    silently eroding.
12. **Revisit test sharding when `pnpm coverage` crosses ~12 min** (M1). The
    blocker is merging v8 coverage across shards without breaking the carefully
    tuned per-file floors — real work, not a config flag.
13. **SHA-pin actions in `release.yml`** (M4).
14. **Triple-OS CI and packaging** — already scoped as epic #2200 (#2196 CI
    signal, #2197 packaging/release, #2198 compute-sandbox parity, #2199 native
    UX). Nothing in this review changes that plan; the one build-specific note is
    that H1's copy-filter work should land *before* the matrix expands, because a
    250 MB-per-platform artifact multiplies badly across three platforms.

---

## CI/CD Pipeline Optimization

### Current Pipeline Analysis

The pipeline is **three fully-parallel jobs with no `needs:` edges**, which is
the right topology. Nothing is accidentally serialized, and the critical path is
a single job rather than a chain:

```
PR opened / commit pushed
   │
   ├── audit          (ubuntu)  ──  9 s    ← pnpm audit --prod (BLOCKING)
   │                                          pnpm audit --all  (advisory)
   ├── e2e            (macos)   ──  2 m 27 s
   │                                 38 s  setup + cache restore
   │                                 48 s  prep  ← 46 s is help-corpus (H3)
   │                                 12 s  electron-forge package
   │                                 41 s  Playwright (1 spec, retries×2 in CI)
   │
   └── lint-and-test  (macos)   ── 12 m 05 s   ◄── CRITICAL PATH
                                     68 s  setup + cache restore
                                    149 s  pnpm lint (3 checks in parallel)
                                     13 s  pip install pandas/matplotlib/pillow
                                    483 s  pnpm coverage  ← 67% of the job
                                      5 s  Codecov upload (non-blocking)

  PR latency = max(9 s, 2 m 27 s, 12 m 05 s) = 12 m 05 s
```

**What's already right:**

- Concurrency cancellation works and is observable (run `35522029319` cancelled
  in 10 s).
- The cache key is correct and *shared across workflows* on purpose.
- `audit` runs on ubuntu, not macOS — a deliberate cost decision
  (`ci.yml:111-112`: "audit reads only the lockfile, so no node_modules install,
  no native binaries, ubuntu is fine"). This detail is the difference between a
  9-second job and a 90-second one.
- Failure-path hygiene: `E2E flake report` and `Upload Playwright report` both
  carry `if: always()` (`ci.yml:212, 216`), so a failed run still produces
  diagnostics.
- `check:docs` (`ci.yml:71-72`) asserts generated pages match their source
  fragments — catching a hand-edit to a generated file that would otherwise only
  surface in someone's local `predev`.
- The Python package install (`ci.yml:85-86`) exists so three compute
  rich-output tests run deterministically instead of silently skipping — with a
  recorded explanation for `--break-system-packages` (Homebrew python3 marks
  itself PEP 668 externally-managed; the VM is discarded, so nothing persists).
  That's the same anti-silent-skip reasoning as the `pretest` model fetch.

**Where the time actually goes:** 67% of the critical path is one `pnpm
coverage` step. Every other optimization in this report is worth seconds to a
minute; only sharding moves this number materially, and it carries real risk to
the coverage-floor system (M1).

### Recommended Improvements

| # | Change | Effort | Saves / Gains |
|---|---|---|---|
| 1 | `if: failure()` issue-filer on `bench.yml` | 15 lines | Restores a dark regression gate (C1) |
| 2 | Tag↔version assertion in `release.yml` | 5 lines | Prevents a silently-undeliverable release (H3) |
| 3 | Cache `resources/help-docs` | 6 lines | ~46 s/e2e run (H3) |
| 4 | Shared `node_modules` cache on `bench.yml` | 7 lines | ~30-60 s/bench run; workflow consistency (H5) |
| 5 | `package.json` in the cache key | 1 line | Closes the drift bypass (H2) |
| 6 | Explicit `permissions:` blocks | 4 lines | Pins least-privilege locally (M5) |
| 7 | Flip or ratchet `audit:all` | 1 line + verification | Completes the documented promotion path (M2) |
| 8 | Vitest sharding ×3 | Substantial | ~12 min → ~6 min PR latency (M1) |

Items 1–7 total well under 50 lines of YAML and address every verified defect
except the artifact size. Item 8 is the only one requiring design work.

---

## Dependency Management

### Current State

**Well-run.** Specifics worth recording:

- **Package manager pinned exactly** — `packageManager: "pnpm@12.3.4"`
  (`package.json:6`), and every workflow's `pnpm/action-setup@v6.1.0` reads the
  version from it rather than hardcoding (comment repeated at `ci.yml:35`,
  `ci.yml:140`, `release.yml:65`, `bench.yml:37`).
- **Node pinned via `.nvmrc`**, consumed by `node-version-file:` in all three
  workflows. (Dev/CI major skew noted at M7.)
- **Every override carries a written reason**, and the pnpm 12 migration
  (#2149) moved them to `pnpm-workspace.yaml` with a comment explaining that
  `package.json`'s `pnpm` key and `.npmrc` are no longer read.
- **`allowBuilds` is an explicit, reasoned allowlist.** The four denied entries
  (`@google/genai`, `onnxruntime-node`, `protobufjs`, `tesseract.js`) are
  documented as *preserving existing behavior* — pnpm 10 already silently
  ignored those build scripts; pnpm 12 turned the same state into a hard error.
  Setting them `true` would be a real behavior change, so the migration
  deliberately didn't. That is exactly the right call during a package-manager
  bump, and the fact that it's written down is why the next person won't
  "helpfully" flip them.
- **Supply-chain guards understood rather than blanket-disabled.**
  `blockExoticSubdeps: false` is scoped-justified (`@electron/rebuild` needs
  `@electron/node-gyp` via a git tarball — Electron's own tooling).
  `minimumReleaseAgeExclude` lists exactly one entry, `adm-zip@0.6.1`, the
  version a security override intentionally pins to.
- **Dependabot + `pnpm audit` are paired deliberately**, with the split
  documented at `ci.yml:108-132`: Dependabot opens the PRs, `audit` makes the
  current advisory state visible on every run, `audit:prod` blocks, `audit:all`
  informs.

**Gaps:**

- `audit:all` is still advisory (M2).
- `@types/markdown-it-footnote` is a runtime dependency (L1).
- Lockfile-drift check is conditional (H2).
- No `pnpm outdated` visibility — Dependabot covers the security axis, but
  nothing surfaces *stale-but-safe* drift. Minor; Dependabot's weekly
  minor+patch group largely handles it in practice.

### Recommendations

1. Close the drift bypass (H2) — highest value here.
2. Move `@types/markdown-it-footnote` to `devDependencies` (L1); it should not
   be inside `audit --prod`'s "shipped surface."
3. Flip `audit:all` to blocking, or ratchet its advisory count (M2).
4. Re-verify the five `@huggingface/transformers`/`rdflib`-rooted security
   overrides on each bump of those two packages — the `ci.yml:117-121` comment
   names them as the reason the overrides exist, so an upstream fix could make
   them removable (or a bump could make them insufficient).
5. On the next CodeMirror bump, remember the pins in `pnpm-workspace.yaml` must
   move together with the direct dependency — the failure mode is a `tsc`
   "separate declarations" error, not a runtime break, so it fails loudly but
   confusingly.

---

## Build Artifact Analysis

### Current Artifacts

| Artifact | Produced by | Size | Consumed by |
|---|---|---|---|
| `Minerva-2.0.2-arm64.dmg` | `MakerDMG` (`forge.config.ts:180`) | 239 MB | Humans, via the website download button |
| `Minerva-mac-arm64.dmg` | `release.yml:209-212` (stable-named copy) | 239 MB | The website's fixed download URL (`/releases/latest/download/…`) |
| `Minerva-darwin-arm64-2.0.2.zip` | `MakerZIP` (`forge.config.ts:179`) | 242 MB | **Squirrel.Mac auto-update** via update.electronjs.org |
| `minerva-macos-arm64` (Actions artifact) | `release.yml:231-236` | ~480 MB | CI inspection |
| `playwright-report` | `ci.yml:215-221` | 6 KB | Flake triage (30-day retention) |
| `bench-baseline` | `bench.yml:62-67` | small | Human re-blessing of `tests/main/bench-baseline.json` |

**The stable-named DMG copy is a nice piece of design** (`release.yml:206-212`):
the versioned filename changes every release, so the website couldn't link to it
directly; the fixed-name copy gives a URL GitHub permanently redirects to
whatever is published. And `prerelease` is derived from the tag rather than a
checkbox (`release.yml:257`, `contains(github.ref_name, '-')`) — with the
comment at lines 245-250 explaining that *both* consumers of the releases list
(`/releases/latest` and the update feed) skip prereleases, so forgetting to tick
the box by hand would break the download link and push an alpha to every
installed app simultaneously. Letting the tag decide removes that failure mode
entirely. Good.

**`if-no-files-found: error`** on the artifact upload (`release.yml:236`) —
correct, and paired with the explicit DMG/ZIP presence checks at lines 221-229.

### Optimization Opportunities

**Verified-dead, safe to remove:**

| Item | Size | Mechanism |
|---|---|---|
| 638 `.map` files (≥15 MB in `onnxruntime-web/dist` alone) | ~20 MB | `cpSync` filter |
| `@types/{node,estree,geojson}` | 2.7 MB | Skip `@types/*` in `depClosure` |
| Upstream `docs/`, `README`, `AUTHORS`, `CONTRIBUTING`, `eslint.config.cjs` | ~1 MB | `cpSync` filter |

**Likely-dead, needs one verification run:**

| Item | Size | Note |
|---|---|---|
| 3 of 4 ORT `.wasm` builds | ~50-65 MB | At most one of jsep/asyncify/jspi/plain is loaded |
| `ort.webgl.{js,mjs}` + `ort.all.{js,mjs}` | ~18 MB | The embedder uses the WASM EP only (`wasm-embedder.ts:29-40`) |
| `sql.js/dist` debug/asm variants | some of 23 MB | Only `sql-wasm.wasm` + its loader are used |

**Irreducible:**

| Item | Size |
|---|---|
| `libduckdb.dylib` | 107 MB |
| Electron framework | ~289 MB |
| `resources/models` (ONNX weights) | 23 MB |

A realistic target after the safe filter plus verified WASM pruning is a
**~150 MB DMG/ZIP, down from 239/242 MB** — roughly a 38% cut in what every user
downloads for every update.

**Confirmed non-issues:** first-party sourcemaps are not shipped (Vite's
`build.sourcemap: false` default is not overridden in any of the four configs);
`resources/` is staged exactly once at 27 MB with no duplication; and the
`EXTERNAL_DEP_ROOTS` closure is guarded by both a hard throw on missing required
roots (`forge.config.ts:66-70`) and a packaged-app e2e that boots a real DuckDB
project.

---

## Recommendations

### Tool and Technology Updates

- **Nothing needs replacing.** electron-forge + Vite + pnpm + vitest +
  Playwright is the right stack for this app, and each is current (Vite 8,
  Vitest 5, Electron 44, TypeScript 6, pnpm 12). There is no "you should migrate
  to X" finding in this review, and manufacturing one would be dishonest.
- **Add:** a `cpSync` filter in `forge.config.ts` (no new dependency), an
  artifact size ratchet (no new dependency), and a failure-notification step in
  `bench.yml` (`actions/github-script`, already a first-party action).
- **Consider later:** `@vitest/coverage-v8` report merging, only if sharding
  (M1) is pursued.
- **Align `.nvmrc` with the dev machine's Node major** (M7), or accept the skew
  deliberately and note it in `docs/development.md`.

### Process Improvements

1. **Every gate needs a notification path, or it isn't a gate.** C1 is the
   lesson: the codebase is full of excellent *detection* (coverage floors, file-size
   budgets, pattern ratchets, IPC registrar coverage, the architecture tests) —
   and all of those run inside `pnpm test`, so they fail a PR and a human sees
   them immediately. `bench.yml` is the single detector that runs *outside* the
   PR loop, and it is the single one that went unheard for seven weeks. That
   correlation is not a coincidence; it's the design principle. **Any future
   scheduled or out-of-band check must ship with its notification path in the
   same PR.**
2. **Assert release invariants server-side.** `tag-release.mjs` is a good
   developer affordance, but the invariant it protects (tag == version, or the
   updater never offers the build) is too important to live only on a laptop
   (H3). The same reasoning `release.yml:88-92` already applies to lint and
   audit — "a tag can point anywhere" — applies here.
3. **Extend the ratchet discipline to artifacts.** This codebase's most
   distinctive strength is committed-number ratchets that fail on *growth*
   (`file-size-budgets.test.ts`, `pattern-ratchets.test.ts`, the coverage
   floors, `config-loader-usage.test.ts`, `ipc-registrar-coverage.test.ts`).
   The packaged artifact is the one large surface with no such number, and it is
   the one that drifted to 696 MB unnoticed. The pattern already exists; it just
   hasn't been pointed at this.
4. **Land the artifact diet before the platform matrix widens.** Epic #2200
   triples the number of artifacts; H1's fix is roughly 3× more valuable
   afterward and roughly free to do first.

### Performance Targets

| Metric | Today (measured) | Target | How |
|---|---|---|---|
| PR wall-clock | 12 m 05 s | < 7 min | Vitest sharding ×3 (M1) |
| `e2e` job | 2 m 27 s | < 1 m 45 s | Cache help-docs corpus (H3) |
| `bench` job | 5 m 45 s | < 4 min | Shared `node_modules` cache (H5) |
| DMG / auto-update ZIP | 239 / 242 MB | < 160 MB | `cpSync` filter + ORT WASM pruning (H1) |
| Sourcemaps in artifact | 638 files | 0 | `cpSync` filter (H1) |
| Weeks a bench regression can go unseen | 7 (observed) | < 1 | Failure notification (C1) |
| `pnpm lint` (local) | ~40 s | unchanged | Already parallel and correctly scoped |
| Native rebuild step | 3.9 s | unchanged | Nothing compiles; already optimal |

---

## Risk Assessment

### Verified problems (observed in this repository, today)

| Risk | Severity | Evidence |
|---|---|---|
| Performance regressions land undetected because the only detector is unheard | **Critical** | 7/7 scheduled `Bench` failures, 2026-08-03 → 2026-09-14, confirmed against run `34839318742`; matches perf review C2/H2/M6 independently |
| 242 MB auto-update payload per release, no delta mechanism | **Critical** | `du` on `out/make/zip/darwin/arm64/Minerva-darwin-arm64-2.0.2.zip`; Squirrel.Mac semantics per `src/main/auto-update.ts:1-22` |
| ~150 MB of never-executed files inside the shipped app | **High** | 638 `.map` files; 133 MB `onnxruntime-web/dist` with 4 mutually-exclusive WASM builds; `@types` in a runtime tree — all traced to the unfiltered `cpSync` at `forge.config.ts:71-78` |
| A mismatched release tag produces a green, signed, notarized release no user ever receives | **High** | `release.yml` has no version check; only `scripts/tag-release.mjs:31-47` (local, bypassable) |
| `package.json`/lockfile drift passes CI silently on a cache hit | **Medium** | `ci.yml:49-58`; "Install dependencies" observed `skipped` in run `35524773279` |
| 46 s/run rebuilding a deterministic, cacheable corpus | **Medium** | e2e log timestamps 17:06:37.96 → 17:07:23.96 |
| `bench.yml` re-installs from cold and has no concurrency guard | **Medium** | `bench.yml:46-47`; no `concurrency:` key in the file |

### Reasoned-but-unverified risks (would bite at larger scale / more contributors)

| Risk | Severity | Reasoning |
|---|---|---|
| A mutable action tag is repointed upstream, executing attacker code in the job holding Apple signing secrets | Medium | All actions tag-pinned (M4). No incident; this is the standard supply-chain argument, and `release.yml` is the high-value target |
| An org/repo settings change widens the default `GITHUB_TOKEN` for `ci.yml`/`bench.yml` | Low | Repo default verified `read` today (M5). The risk is that nothing in the repo pins it |
| PR latency becomes a throughput ceiling as the suite grows | Medium | 12 min is tolerable for 1-2 contributors; at 5+ with a merge queue it isn't. 67% of it is one step (M1) |
| A Node 24↔25 behavioral difference passes pre-push and fails CI | Low | Real skew (M7); no observed instance |
| `pnpm` absent from `PATH` inside forge's `afterPrune` breaks packaging in a non-standard environment | Low | `forge.config.ts:94` (M3). Works everywhere it currently runs |
| Windows/Linux packaging assumptions are untested | — | **Out of scope**, correctly owned by epic #2200 (#2196/#2197/#2198/#2199). `forge.config.ts:172-177` already *removed* the aspirational non-darwin makers rather than leaving them implying a release that doesn't exist — the right call |

### Risks explicitly checked and found absent

Worth recording, so a future reviewer doesn't re-litigate them:

- **Secret leakage in `release.yml`** — decoded to `$RUNNER_TEMP`, `rm`'d after
  import, never echoed, keychain deleted with `if: always()`
  (`release.yml:113-143, 262-266`). Clean.
- **Silent signing misconfiguration** — traced through all four credential
  combinations; a partially-configured secret set produces an unsigned build
  that then fails `codesign --verify` at `release.yml:174`. Fails loudly.
- **First-party sourcemaps shipped to users** — none. Vite's
  `build.sourcemap: false` default stands in all four configs. Every shipped
  `.map` is upstream, copied whole.
- **Resource double-packaging** — `resources/` appears exactly once in the
  `.app`, at 27 MB, matching the source tree. The Python kernel, ONNX weights,
  and help corpus all land once.
- **Native rebuild fragility on darwin** — nothing compiles from source. DuckDB
  ships a prebuilt `.node`, ONNX is WASM, and forge's rebuild step is 3.9 s.
  Guarded by a hard throw on missing roots plus a packaged-app boot test.
- **Serialized CI jobs** — none; all three start within 6 seconds of each other.
- **Missing job timeouts** — all five jobs have `timeout-minutes`.
- **Stale `pnpm.overrides`** — all fourteen entries checked; each is still load-
  bearing, and the two `@xmldom/xmldom` edges are correctly scoped rather than
  globalized.
