# Coverage baseline — 2026-04-26

Captured by `pnpm coverage` (vitest + @vitest/coverage-v8) immediately
after #353 wiring landed. 1587 tests across 162 files.

## Headline

| Metric     | Coverage          |
| ---------- | ----------------- |
| Statements | **34.67%**  (11031 / 31813) |
| Branches   | **81.50%**  (3389 / 4158)  |
| Functions  | **78.94%**  (735 / 931)   |
| Lines      | **34.67%**  (11031 / 31813) |

Statements/lines look low because the denominator is dominated by
Svelte component bodies — mostly UI glue we don't unit-test today.
Branches and functions show that the code we *do* test is exercised
deeply: ~80% of branches and functions reached.

## Top-level rollup

```
File              | % Stmts | % Branch | % Funcs | % Lines |
------------------|---------|----------|---------|---------|
main              |    6.02 |    83.67 |    38.7 |    6.02 |
main/compute      |   86.38 |    75.43 |   83.78 |   86.38 |
main/formatter    |   51.47 |    76.47 |   55.55 |   51.47 |
main/git          |       0 |        0 |       0 |       0 |
main/graph        |   87.83 |     83.2 |    93.6 |   87.83 |
main/llm          |   ~85   |   ~85    |   ~85   |   ~85   |  (after #342)
main/notebase     |   ~85   |   ~85    |   ~90   |   ~85   |  (after #345)
renderer          |    ~5   |   ~80    |   ~30   |    ~5   |
renderer/lib/ocr  |  100    |   90     |  100    |  100    |  (#343)
shared            |   76.75 |    88.84 |    87.5 |   76.75 |
shared/compute    |   98.33 |    90.38 |    100  |   98.33 |
shared/formatter  |   95.70 |    95.74 |    85   |   95.70 |
shared/refactor   |   96.27 |    90.85 |    100  |   96.27 |
shared/tools      |   60.78 |   100    |    60   |   60.78 |
```

(Some rows simplified; see `coverage/index.html` for the full per-file
breakdown.)

## What's good

- **`src/shared/*`** averages **76.75%** lines, well above the 70%
  soft threshold configured in `vitest.config.mts`. The three
  pure-logic subtrees (`compute`, `formatter`, `refactor`) all sit
  above 95%.
- **`src/main/graph/`** at ~88% lines — the SPARQL engine, parser,
  and N3 cache all have tight test coverage.
- **`src/main/llm/`** went from the QA review's flagged ~15% to ~85%
  after #342's orchestrator integration tests landed.
- **`src/main/notebase/watcher.ts`** and the new `path-dedup.ts` are
  fully covered by #345.
- **`src/renderer/lib/ocr/`** at 100% after #343.

## Where the coverage isn't

- **`src/renderer/`** UI components (~5% lines). These are mostly
  visual glue — testing them well needs Svelte component tests with
  happy-dom (#343 set up the env, follow-ups can extend it).
- **`src/main/`** top-level (~6% lines). This bucket is dominated
  by `ipc.ts` (~1500 lines), `window-manager.ts`, `menu.ts`, and
  `main.ts` — Electron lifecycle code that's hard to unit-test in
  isolation. End-to-end tests (Playwright + Electron) would land
  more value here than unit tests.
- **`src/main/git/`** at 0%. The git wrapper has no tests. Worth a
  follow-up since git operations underpin the project's persistence
  story.

## Threshold policy

Per #353: "don't fetishise the percentage". The configured floor is
**70%** (lines, functions, statements) for `src/shared/**` only — the
place where pure-logic coverage genuinely should stay high. No gate
elsewhere until we've targeted further work; the headline percentage
isn't the metric to chase.

## Re-running

```bash
pnpm coverage          # text + text-summary + html + lcov
open coverage/index.html
```

`coverage/` is gitignored; only this baseline report is committed.
