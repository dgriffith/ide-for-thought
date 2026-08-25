/**
 * The embedding model is staged whenever CI runs the gated suites (#1925).
 *
 * Four test files share the same gate shape — `haveModel = fs.existsSync(...)`
 * → `haveModel ? describe : describe.skip` — but only three are actually at
 * risk of the failure mode this issue is about. Precisely measured by
 * simulating a real pre-fix CI checkout (git-tracked fixture files present,
 * only the gitignored `.onnx` weights absent, `pretest` bypassed):
 *
 *  - `wasm-embedder.test.ts` — 4 tests skip (gates on the `.onnx` weights)
 *  - `vector-store.test.ts` — 1 test skips (the `realDescribe` block)
 *  - `help-docs/search.test.ts` — 2 tests skip
 *  - `wordpiece.test.ts` — 0 tests skip. Its gate checks `tokenizer.json`,
 *    which is committed to git ("small tokenizer/vocab/config ARE committed
 *    so the WordPiece ground-truth test runs in CI without a network fetch,"
 *    `.gitignore`), so `haveModel` has always been true there regardless of
 *    whether the `.onnx` weights were ever fetched.
 *
 * **True count: 7, not the 12 first estimated (nor the ~28 a parallel scan
 * suggested).** The original review's per-file counts were each off by one
 * for `vector-store`/`help-docs`, and it credited `wordpiece` with 3 that
 * were never actually gated. The *mechanism* was still exactly right — no
 * `pretest` meant CI's `pnpm install → pnpm lint → pnpm coverage` never
 * fetched the `.onnx` weights — the number just needed the real simulation
 * this file's own assertion below now runs on every CI job.
 *
 * That's the right skip for an offline dev checkout that never ran `pnpm
 * fetch:model` — but skip is silent, and nothing distinguished "chose not to
 * run this" from "should have run this and something broke."
 * `fetch:model` was wired to `predev`/`prebuild`/`prebuild:e2e` only.
 *
 * `package.json` now runs `fetch:model` as `pretest`/`precoverage`, so CI
 * should always have the `.onnx` weights staged before the gated suites run.
 * This file is the backstop for that fix regressing silently: under CI
 * specifically (`process.env.CI`, set by every GitHub Actions runner), verify
 * the model files the fetch script promises are actually on disk and
 * hash-correct — so "the pretest hook stopped firing" or "the fetch script
 * started failing soft" becomes a loud, immediate, named failure instead of
 * the same silent skip this issue exists to fix.
 *
 * Off CI, this file only checks that the four known gate sites still exist
 * and still gate on `haveModel` — an offline dev machine without the model is
 * a legitimate, unremarkable state, and demanding it here would be hostile.
 * That check is the anti-vacuity half: if a gated file were renamed, deleted,
 * or migrated to a different gating variable without updating the list below,
 * the CI assertion would silently stop covering it — exactly the failure mode
 * `ipc-registrar-coverage.test.ts`'s own "a broken scan would pass vacuously"
 * comment names for its own enumeration. `wordpiece.test.ts` stays in the
 * list even though it isn't currently at risk — it shares the gate pattern,
 * and would become a real risk again if its committed fixture were ever
 * dropped in favor of the fetched weights.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { modelDir } from '../../src/main/embeddings/embedder';
// @ts-expect-error -- plain JS build-time module, no .d.ts (see tests/scripts/fetch-embedding-model.test.ts)
import { FILES, fileHasSha } from '../../scripts/fetch-embedding-model.mjs';

const files = FILES as { rel: string; sha256: string }[];
const hasSha = fileHasSha as (p: string, expected: string) => boolean;

const GATED_TEST_FILES = [
  'tests/main/embeddings/wasm-embedder.test.ts',
  'tests/main/embeddings/vector-store.test.ts',
  'tests/main/embeddings/wordpiece.test.ts',
  'tests/main/help-docs/search.test.ts',
] as const;

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('embedding model gate (#1925)', () => {
  it('the known gate sites still exist and still gate on haveModel', () => {
    for (const rel of GATED_TEST_FILES) {
      const abs = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(abs), `expected a gated test file at ${rel}`).toBe(true);
      const src = fs.readFileSync(abs, 'utf-8');
      expect(src, `${rel} no longer gates on haveModel — update this list`).toMatch(/haveModel/);
    }
  });

  it.runIf(process.env.CI)(
    'the model is staged and byte-correct in CI — a skip here would be silent (#1925)',
    () => {
      for (const f of files) {
        const abs = path.join(modelDir(), f.rel);
        expect(
          hasSha(abs, f.sha256),
          `${f.rel} is missing or doesn't match its pinned hash under CI. 7 tests across ` +
          'wasm-embedder.test.ts (4), help-docs/search.test.ts (2), and ' +
          'vector-store.test.ts (1, the realDescribe block) would silently skip instead ' +
          'of running. Check that "pnpm fetch:model" (wired as pretest/precoverage in ' +
          'package.json) actually ran and succeeded in this job.',
        ).toBe(true);
      }
    },
  );

  it('is itself running — a scoping mistake here would pass vacuously off CI too', () => {
    // Cheap self-check on the always-on assertion above: if GATED_TEST_FILES were
    // accidentally emptied, the first `it` would pass trivially and this file would
    // stop meaning anything, the same failure mode it exists to catch elsewhere.
    expect(GATED_TEST_FILES.length).toBe(4);
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
});
