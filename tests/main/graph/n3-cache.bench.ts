/**
 * Graph query-latency benchmark for the N3 store cache (#334, #1004). Not run
 * by `pnpm test` (that includes only `*.test.ts`) — invoke with `pnpm bench`.
 *
 * Measures SPARQL query cost once the N3 mirror is warm (cache hit) — the
 * common case behind panel refreshes — documenting the cost the cache buys and
 * guarding a regression in it.
 */

import { describe, bench, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('N3 cache query benchmark', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3bench-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    // Plant 500 synthetic notes — roughly the inflection point where
    // the un-cached cost becomes user-visible in panel refreshes.
    for (let i = 0; i < 500; i++) {
      const body = `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`;
      await indexNote(ctx, `note-${i}.md`, body);
    }
  });

  bench('queryGraph: simple SELECT (cache hit after first call)', async () => {
    await queryGraph(ctx, 'SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50');
  });

  bench('queryGraph: tag filter (cache hit after first call)', async () => {
    await queryGraph(ctx, `SELECT ?n WHERE { ?n minerva:hasTag ?t . ?t minerva:tagName "tag-3" }`);
  });
});
