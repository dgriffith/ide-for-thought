/**
 * Manual benchmark for the N3 store cache (#334). Not run by `pnpm test` —
 * invoke with:
 *
 *     pnpm vitest run --config vitest.bench.config.ts tests/main/graph/n3-cache.bench.ts
 *
 * (or just port the script body to a one-shot tsx call). Kept here as
 * documentation of the relative cost we paid before vs. after.
 */

import { describe, bench, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';

describe.skip('N3 cache benchmark', () => {
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-n3bench-'));
    await initGraph(root);
    // Plant 500 synthetic notes — roughly the inflection point where
    // the un-cached cost becomes user-visible in panel refreshes.
    for (let i = 0; i < 500; i++) {
      const body = `# Note ${i}\n\n${'lorem ipsum '.repeat(50)}\n\n#tag-${i % 10}\n`;
      await indexNote(`note-${i}.md`, body);
    }
  });

  bench('queryGraph: simple SELECT (cache hit after first call)', async () => {
    await queryGraph('SELECT ?n WHERE { ?n a minerva:Note } LIMIT 50');
  });

  bench('queryGraph: tag filter (cache hit after first call)', async () => {
    await queryGraph(`SELECT ?n WHERE { ?n minerva:hasTag ?t . ?t minerva:tagName "tag-3" }`);
  });
});
