/**
 * @vitest-environment node
 *
 * `tests/main/graph/` stays on the shared temp-project fixture (#1902).
 *
 * Before #1902, 51 of the 56 files in this directory hand-rolled the same
 * `fs.mkdtempSync(...) → projectContext → initGraph → afterEach rm`
 * boilerplate `tests/helpers/temp-project.ts` (#678) exists to collapse. That
 * got fixed in one pass because nothing stopped it from drifting back — this
 * is that stop. A new file in this directory that reaches for `mkdtempSync`
 * directly instead of `useGraphProject()` / `makeGraphProject()` /
 * `useTempDir()` fails here rather than quietly reintroducing the pattern one
 * file at a time.
 *
 * Five files are deliberately exempt — the fixture's per-test `beforeEach`/
 * `afterEach` lifecycle doesn't fit their shape, not because they were missed:
 *   - `full-index.bench.ts`, `graph-index.bench.ts`, `n3-cache.bench.ts`,
 *     `n3-cold-rebuild.bench.ts` — vitest benchmarks seed a temp dir ONCE per
 *     scale as top-level `await` (see `n3-cold-rebuild.bench.ts`'s header: a
 *     `beforeAll` doesn't reliably complete before a `bench`'s iterations
 *     start in this vitest version). They already use the dedicated
 *     `tests/helpers/bench-temp-dirs.ts` fixture built for that lifecycle.
 *   - `tutorial-thoughtbase-staleness.test.ts` — uses `beforeAll`/`afterAll`
 *     to index the bundled tutorial thoughtbase ONCE for the whole file (an
 *     expensive real-content index, not a per-test throwaway), and copies a
 *     fixed source tree into the temp dir before `initGraph` — a step none of
 *     the three fixture shapes has a seam for.
 *
 * This list may only SHRINK: if one of these five is ever restructured to fit
 * the per-test lifecycle, delete its entry rather than leaving it here
 * unused. Adding a new entry to work around this check is not the intended
 * way to change this file — converting the new test to the fixture is.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRAPH_TESTS_DIR = path.join(ROOT, 'tests', 'main', 'graph');

const EXEMPT: readonly string[] = [
  'full-index.bench.ts',
  'graph-index.bench.ts',
  'n3-cache.bench.ts',
  'n3-cold-rebuild.bench.ts',
  'tutorial-thoughtbase-staleness.test.ts',
];

function filesHandRollingMkdtemp(): string[] {
  return fs
    .readdirSync(GRAPH_TESTS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => fs.readFileSync(path.join(GRAPH_TESTS_DIR, name), 'utf-8').includes('mkdtempSync'));
}

describe('tests/main/graph/ temp-project fixture adoption (#1902)', () => {
  it('no file outside the documented exceptions hand-rolls mkdtempSync', () => {
    const offenders = filesHandRollingMkdtemp().filter((name) => !EXEMPT.includes(name));
    expect(
      offenders,
      `${offenders.length} file(s) in tests/main/graph/ call mkdtempSync directly instead of using ` +
        `useGraphProject() / makeGraphProject() / useTempDir() from tests/helpers/temp-project.ts:\n\n` +
        offenders.map((f) => `  − ${f}`).join('\n') +
        `\n\nEither adopt the fixture, or — if its per-test lifecycle genuinely doesn't fit — add the file ` +
        `to EXEMPT here with a one-line reason, matching the existing five.`,
    ).toEqual([]);
  });

  it('EXEMPT names only files that still exist and still need the exemption', () => {
    const stillHandRolling = new Set(filesHandRollingMkdtemp());
    const stale = EXEMPT.filter((name) => !stillHandRolling.has(name));
    expect(
      stale,
      `These EXEMPT entries no longer hand-roll mkdtempSync (or no longer exist) — delete them from the ` +
        `list in this file:\n\n${stale.map((f) => `  − ${f}`).join('\n')}`,
    ).toEqual([]);
  });
});
