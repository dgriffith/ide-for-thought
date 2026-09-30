/**
 * `persistGraph → queryGraph` benchmark (#2211, reproducing the perf review's
 * C2). Not run by `pnpm test` — invoke with `pnpm bench`.
 *
 * The gap this fills: nothing measured the cost of a query that follows a
 * persist. `persistGraph` strips every ontology triple out of the store,
 * serializes, then adds them all back — and each of those `removeMatches`/`add`
 * calls goes through the instrumented store wrapper, so the pair walks the N3
 * mirror twice per ontology triple. The review measured a 15× query regression
 * behind it. The existing cold-rebuild bench doesn't see this at all: it pairs
 * an ordinary `indexNote` with a query, and an ordinary save never persists.
 *
 * Persisting is not rare — `proposal-persistence`, `propose-note` and
 * `conversation` all call `persistGraph`, so every approved LLM write pays this
 * before the next query.
 *
 * Run at three vault scales so the shape is visible: the strip is O(ontology
 * triples) regardless of vault size, but the mirror work it triggers is not.
 *
 * Seeding runs as a top-level `await` per scale rather than in `beforeAll` —
 * see `n3-cold-rebuild.bench.ts`'s header for why (vitest's benchmark runner
 * doesn't reliably await an async `beforeAll` before a `bench` starts).
 */

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph, queryGraphRows, persistGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

const SCALES = [500, 2000, 5000];
const QUERY = 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50';

for (const scale of SCALES) {
  const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-persistquery-')));
  const ctx: ProjectContext = projectContext(root);
  await initGraph(ctx);
  for (let i = 0; i < scale; i++) {
    fs.writeFileSync(
      path.join(root, `note-${i}.md`),
      `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`,
    );
  }
  await indexAllNotes(ctx);

  // ── What this fixture must reach (#2383) ───────────────────────────────────
  // `persistGraph` serializes the USER graph out of a store that also holds the
  // bundled ontology (#2209) — so the write has to happen, carry every seeded
  // note, and leave the ontology behind; and the query after it has to match
  // real rows. A persist that wrote nothing (no state, wrong root) would time
  // as a very fast bench.
  {
    const graphTtl = path.join(root, '.minerva', 'graph.ttl');
    fs.rmSync(graphTtl, { force: true });
    await persistGraph(ctx);
    const turtle = fs.existsSync(graphTtl) ? fs.readFileSync(graphTtl, 'utf-8') : '';
    const persisted = (turtle.match(/"note-\d+\.md"/g) ?? []).length;
    assertFixtureReaches(`graph.ttl carries all ${scale} notes' relativePath`, persisted >= scale, persisted);
    assertFixtureReaches(
      'graph.ttl leaves the bundled ontology out (the filter persistGraph applies)',
      !turtle.includes('owl:ObjectProperty') && !turtle.includes('#ObjectProperty>'),
    );
    const rows = await queryGraphRows(ctx, QUERY);
    assertFixtureReaches('the query after the persist matches 50 notes', rows.results.length === 50, rows.results.length);
  }

  describe(`persistGraph → queryGraph — ${scale}-note store`, () => {
    test(`persistGraph + queryGraph at ${scale} notes`, async ({ bench }) => {
      await bench(`persistGraph + queryGraph at ${scale} notes`, async () => {
        await persistGraph(ctx);
        await queryGraph(ctx, QUERY);
      }).run();
    });
  });
}
