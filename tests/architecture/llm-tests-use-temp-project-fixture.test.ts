/**
 * @vitest-environment node
 *
 * `tests/main/llm/` stays on the shared temp-project fixture (#1996).
 *
 * Sibling to `graph-tests-use-temp-project-fixture.test.ts` (#1902), which
 * ratcheted `tests/main/graph/` after it was converted from hand-rolled
 * `fs.mkdtempSync(...) → projectContext → initGraph → afterEach rm`
 * boilerplate to `useGraphProject()` / `makeGraphProject()` / `useTempDir()`
 * (`tests/helpers/temp-project.ts`, #678). #1996 did the same conversion for
 * `tests/main/llm/` — the largest of the remaining directories still hand-
 * rolling the pattern. This is the stop that keeps it converted: a new file
 * here that reaches for `mkdtempSync` directly instead of the shared fixture
 * fails rather than quietly reintroducing the boilerplate one file at a time.
 *
 * No files are exempt today — every file in this directory that needed a
 * temp dir fit one of the three fixture shapes. If a future file genuinely
 * can't (mirroring the bench/beforeAll exceptions documented in the graph
 * sibling test), add it to EXEMPT here with a one-line reason instead of
 * working around this check.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LLM_TESTS_DIR = path.join(ROOT, 'tests', 'main', 'llm');

const EXEMPT: readonly string[] = [];

function filesHandRollingMkdtemp(): string[] {
  return fs
    .readdirSync(LLM_TESTS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => fs.readFileSync(path.join(LLM_TESTS_DIR, name), 'utf-8').includes('mkdtempSync'));
}

describe('tests/main/llm/ temp-project fixture adoption (#1996)', () => {
  it('no file outside the documented exceptions hand-rolls mkdtempSync', () => {
    const offenders = filesHandRollingMkdtemp().filter((name) => !EXEMPT.includes(name));
    expect(
      offenders,
      `${offenders.length} file(s) in tests/main/llm/ call mkdtempSync directly instead of using ` +
        `useGraphProject() / makeGraphProject() / useTempDir() from tests/helpers/temp-project.ts:\n\n` +
        offenders.map((f) => `  − ${f}`).join('\n') +
        `\n\nEither adopt the fixture, or — if its per-test lifecycle genuinely doesn't fit — add the file ` +
        `to EXEMPT here with a one-line reason, matching the pattern in graph-tests-use-temp-project-fixture.test.ts.`,
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
