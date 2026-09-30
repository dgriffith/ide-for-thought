/**
 * Graph query-latency benchmark for the N3 store cache (#334, #1004). Not run
 * by `pnpm test` (that includes only `*.test.ts`) — invoke with `pnpm bench`.
 *
 * Measures SPARQL query cost once the N3 mirror is warm (cache hit) — the
 * common case behind panel refreshes — documenting the cost the cache buys and
 * guarding a regression in it.
 *
 * Seeding runs as a top-level `await`, ahead of the `describe`/`bench` calls,
 * rather than inside `beforeAll` (perf #1109 finding): vitest's benchmark
 * runner does not reliably await an async `beforeAll` before starting a
 * `bench`'s iterations — confirmed empirically (a `beforeAll` here never
 * completed before `bench` began running against still-`undefined` state,
 * so every iteration failed immediately and silently, well under a second for
 * what should have been a 500-note seed + real queries). Top-level `await` is
 * a plain module-evaluation order guarantee, so it isn't subject to that gap.
 */

import { describe, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph, queryGraphRows } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { trackTempDir } from '../../helpers/bench-temp-dirs';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

const root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3bench-')));
const ctx: ProjectContext = projectContext(root);
await initGraph(ctx);
// Plant 500 synthetic notes — roughly the inflection point where the
// un-cached cost becomes user-visible in panel refreshes.
for (let i = 0; i < 500; i++) {
  const body = `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`;
  await indexNote(ctx, `note-${i}.md`, body);
}

const SIMPLE_SELECT = 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50';
const TAG_FILTER = `SELECT ?n WHERE { ?n minerva:hasTag ?t . ?t minerva:tagName "tag-3" }`;

// ── What this fixture must reach (#2383) ─────────────────────────────────────
// A query that matches nothing is cheap for reasons that have nothing to do
// with the cache: Comunica short-circuits an empty join. Both queries have to
// return real rows — and the tag query exactly the 50 notes tagged `tag-3`,
// or a change to how tags are modelled would quietly turn it into that empty
// join. Running each once here is also the "first call" the names refer to.
{
  const simple = await queryGraphRows(ctx, SIMPLE_SELECT);
  assertFixtureReaches('the simple SELECT returns its full LIMIT of 50 notes', simple.results.length === 50, simple.results.length);
  const tagged = await queryGraphRows(ctx, TAG_FILTER);
  assertFixtureReaches('the tag filter matches the 50 notes tagged tag-3', tagged.results.length === 50, tagged.results.length);
}

describe('N3 cache query benchmark', () => {
  test('queryGraph: simple SELECT (cache hit after first call)', async ({ bench }) => {
    await bench('queryGraph: simple SELECT (cache hit after first call)', async () => {
      await queryGraph(ctx, SIMPLE_SELECT);
    }).run();
  });

  test('queryGraph: tag filter (cache hit after first call)', async ({ bench }) => {
    await bench('queryGraph: tag filter (cache hit after first call)', async () => {
      await queryGraph(ctx, TAG_FILTER);
    }).run();
  });
});
