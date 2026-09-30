/**
 * Full-`indexAllNotes` benchmark (perf #1109 — proves the #1106 alias-hoist
 * win). Not run by `pnpm test` — invoke with `pnpm bench`.
 *
 * `graph-index.bench.ts` measures one `indexNote` call's steady-state cost
 * against an already-populated store — useful for catching a per-note
 * regression, but it doesn't exercise `indexAllNotes`'s own scaling
 * characteristic. Before #1106, `indexNote` unconditionally rebuilt the
 * alias map (O(n) in total note count) on every note during the full-index
 * walk, making that walk O(n²); #1106 hoists the rebuild out of the loop.
 * Run at three vault scales so the O(n) result — not a partially-masked
 * O(n²) curve — is directly visible in the numbers, and so a future
 * regression back to per-note rebuilding would show up as a scale cliff here.
 *
 * Seeding runs as a top-level `await` per scale (see the header comment in
 * `n3-cold-rebuild.bench.ts` for why: `beforeAll` doesn't reliably complete
 * before a `bench`'s iterations start in this vitest version's benchmark
 * runner — confirmed empirically).
 *
 * Vitest 5 (#1009): `bench` is a test-context fixture, not a top-level
 * import — `bench(name, options, fn)` registers and `.run()` executes +
 * reports it, called from inside a wrapping `test()`. Bench names (passed to
 * `bench()`, not `test()`) are kept byte-identical to the pre-migration
 * strings so `bench-baseline.json` still matches by name.
 */

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, getAliasMap, queryGraphRows } from '../../../src/main/graph/index';
import { _derivationCountsForTests } from '../../../src/main/graph/note-index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

const SCALES = [500, 2000, 5000];

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-fullidx-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  for (let i = 0; i < scale; i++) {
    const aliasBlock = i % 5 === 0 ? `---\naliases:\n  - alias-${i}\n---\n` : '';
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `${aliasBlock}# Note ${i}\n\n${'lorem ipsum '.repeat(20)}\n\n#tag-${i % 20}\n\n[[note-${(i + 1) % scale}]]\n`,
    );
  }

  // ── What this fixture must reach (#2383) ───────────────────────────────────
  // The scale cliff this bench guards (#1106) lives in alias resolution during
  // the walk, so the walk has to resolve wiki-links against a non-empty alias
  // map: every note indexed, every fifth note's alias registered, every note's
  // `[[note-(i+1)]]` resolved to a real note rather than left dangling.
  {
    const derivationsBefore = _derivationCountsForTests.aliasMap;
    await indexAllNotes(ctx);
    const derivations = _derivationCountsForTests.aliasMap - derivationsBefore;
    assertFixtureReaches('the full-index walk resolves links through the alias map', derivations > 0, derivations);

    const aliases = Object.keys(getAliasMap(ctx)).length;
    assertFixtureReaches(`every fifth note registers an alias (${scale / 5})`, aliases === scale / 5, aliases);

    const counts = await queryGraphRows(ctx, `
      SELECT (COUNT(DISTINCT ?n) AS ?notes) (COUNT(DISTINCT ?t) AS ?targets) WHERE {
        ?n a minerva:Note .
        OPTIONAL { ?n minerva:references ?t . ?t minerva:relativePath ?p }
      }`);
    const row = counts.results[0] as Record<string, string> | undefined;
    assertFixtureReaches(
      `all ${scale} notes are indexed and each one's wiki-link resolves to a real note`,
      Number(row?.notes) === scale && Number(row?.targets) === scale,
      row,
    );
  }

  describe(`full indexAllNotes — ${scale}-note vault`, () => {
    test(`indexAllNotes: ${scale} notes from scratch`, async ({ bench }) => {
      await bench(
        `indexAllNotes: ${scale} notes from scratch`,
        // Default sampling (64), deliberately. This used to pass
        // `{ iterations: 3, … }` as `bench()`'s second argument, to avoid an
        // 11-minute GC-thrashing sample seen before vitest 5 — but vitest 5
        // reads that argument as per-function hooks, so the cap was silently
        // ignored (sampling options go to `.run()`). The gate was blessed on
        // 64-sample means (#2331), and actually applying the cap gave the
        // 2000-note entry a ~37% margin of error over its 3 samples, so the
        // dead argument was removed rather than moved (#2385).
        async () => {
          // indexAllNotes resets and rebuilds the whole store on every call, so
          // it's safe (and necessary, to measure the real full-index cost rather
          // than a warm no-op) to call it fresh on every bench iteration against
          // the same on-disk files.
          await indexAllNotes(ctx);
        },
      ).run();
    });
  });
}
