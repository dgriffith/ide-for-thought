# Coverage baseline — 2026-08-03

Captured by `pnpm coverage` (vitest 4 + `@vitest/coverage-v8`) on the current
`main`. **5497 tests across 555 files.** Regenerates the stale
`coverage-baseline-2026-04-26.md` (#1599), which predated ~4 months of test
growth and materially understated the tree (it was captured at 1587 tests /
162 files, just after the #353 wiring).

## Headline

| Metric     | Coverage                    |
| ---------- | --------------------------- |
| Statements | **66.77%**  (26827 / 40175) |
| Branches   | **59.41%**  (12867 / 21657) |
| Functions  | **59.20%**  (4848 / 8189)   |
| Lines      | **69.37%**  (21988 / 31695) |

Lines/statements roughly **doubled** since the old baseline (34.67% → 69.37%):
the renderer went from untested UI glue to broadly unit-tested (the bucket A/B
ratchets #1451/#1452 plus the per-file floors on the 1000+-line components,
#1613), and the main-process paths filled in. Branches/functions read *lower*
than the old 81%/79% not because tested code regressed but because the
denominator grew ~5× (4158 → 21657 branches) as the app expanded — the old
percentages were over a much smaller tree.

## Per-area rollup

Bucketed to mirror the threshold globs in `vitest.config.mts`, with each area's
line floor for reference (the floor is the machine-checked gate; these numbers
are the current headroom above it).

```
Area                    | % Stmts | % Branch | % Funcs | % Lines | Lines floor
------------------------|---------|----------|---------|---------|------------
src/shared/**           |   92.8  |   85.6   |   96.0  |   95.6  |   70
src/main/llm/**         |   76.3  |   64.4   |   80.2  |   78.8  |   55
src/main/notebase/**    |   88.8  |   75.5   |   92.4  |   92.0  |   80
src/main/publish/**     |   89.5  |   75.9   |   92.4  |   93.4  |   82
src/main/sources/**     |   87.0  |   75.3   |   91.0  |   89.8  |   80
src/main/graph/**       |   89.6  |   76.3   |   92.7  |   94.1  |   80
src/main/compute/**     |   85.8  |   73.9   |   86.2  |   87.9  |   75
src/main/git/**         |   73.2  |   77.6   |   73.9  |   74.2  |   64
src/main/ipc/**         |   26.2  |    8.1   |   14.6  |   28.5  |   24 (backstop)
src/main/config/**      |   90.5  |   88.2   |  100.0  |   89.2  |   —  (global 45)
src/main/* (other)      |   72.8  |   69.3   |   66.1  |   74.0  |   per-file
src/renderer/**         |   55.4  |   45.6   |   51.0  |   56.2  |   42
src/preload/**          |    2.8  |   70.0   |    0.6  |    2.5  |   —  (snapshot-gated)
------------------------|---------|----------|---------|---------|------------
OVERALL                 |   66.8  |   59.4   |   59.2  |   69.4  |   45 (global)
```

(Some sub-trees under `src/main/*.ts` carry their own per-file floors —
`security.ts`, `security-helpers.ts`, `privileged-sites.ts`, `auto-update.ts`;
see `vitest.config.mts`.)

## Stale rows corrected (vs the 2026-04-26 baseline)

- **`src/main/git` 0% → 74.2% L.** The isomorphic-git push engine + gh/HTTPS-token
  auth (#254) shipped after the old capture, covered by the publish-git / auth /
  push suites. Floor 64 L.
- **`src/main/llm` "~85%" → 78.8% L.** The old row was a hand-waved placeholder;
  the real number is lower as the LLM surface grew (drafts, tool dispatch,
  conversation). Still well above its 55 L floor.
- **`src/renderer` "~5%" → 56.2% L.** The single biggest change — the renderer is
  no longer "UI glue we don't unit-test." Floor 42 L.
- **`src/shared` 76.75% → 95.6% L.** The pure-logic trees are now near-fully
  covered.
- **New areas since:** `src/main/ipc` (28.5% L — deliberately low channel-glue,
  backstop floor 24, #1612), `src/main/config` (89% L, the shared config helper
  #1640).

## Relationship to the live gate

The **hard gate** is the per-area floors in `vitest.config.mts`, enforced by
`pnpm coverage` in CI (a floor breach fails the build). This report is the
human-readable snapshot; the floors are the contract. Every area above sits
comfortably above its floor — and the headroom documented here is exactly what
the Codecov per-PR coverage-delta comment (#1096) is meant to keep visible, so
erosion *within* that headroom shows up per-PR rather than only when a floor
finally breaks.
