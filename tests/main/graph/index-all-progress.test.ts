/**
 * `indexAllNotes` reports determinate progress (#1814).
 *
 * "Rebuild All Indexes" is the longest thing in the File menu and had no
 * affordance at all. A counter is only useful if its total is right and it
 * actually reaches it, so these check the shape of what's reported rather than
 * merely that something was.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as graph from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';

let root: string;

afterEach(async () => {
  if (root) await fsp.rm(root, { recursive: true, force: true });
});

async function seed(files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf-8');
  }
}

describe('indexAllNotes progress', () => {
  it('counts up to a total that matches the notes indexed', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-index-progress-'));
    await seed({
      'a.md': '# A\n',
      'b.md': '# B\n',
      'sub/c.md': '# C\n',
      'sub/deep/d.md': '# D\n',
    });
    const ctx = projectContext(root);
    await graph.initGraph(ctx);

    const seen: [number, number][] = [];
    const indexed = await graph.indexAllNotes(ctx, {
      onProgress: (done, total) => seen.push([done, total]),
    });

    expect(seen).toHaveLength(4);
    // Monotonic 1..4, and every frame agrees on the total — a total that grew
    // as the walk went would make the bar jump backwards.
    expect(seen.map(([done]) => done)).toEqual([1, 2, 3, 4]);
    expect(new Set(seen.map(([, total]) => total))).toEqual(new Set([4]));
    // The last frame lands exactly on the total, so the bar completes.
    expect(seen.at(-1)).toEqual([4, 4]);
    // Sources/excerpts also count toward the returned tally, but there are
    // none here, so the note count and the return value agree.
    expect(indexed).toBe(4);
  });

  it('counts every indexable extension, not just markdown', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-index-progress-ext-'));
    await seed({
      'note.md': '# Note\n',
      'data.csv': 'a,b\n1,2\n',
      'facts.ttl': '@prefix ex: <http://example.org/> .\n',
      'helper.py': 'x = 1\n',
      // Not a note: must not inflate the total the user watches.
      'README.txt': 'ignore me\n',
    });
    const ctx = projectContext(root);
    await graph.initGraph(ctx);

    const totals: number[] = [];
    await graph.indexAllNotes(ctx, { onProgress: (_done, total) => totals.push(total) });

    expect(new Set(totals)).toEqual(new Set([4]));
  });

  it('is optional — a rebuild without a listener behaves exactly as before', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-index-progress-none-'));
    await seed({ 'a.md': '# A\n' });
    const ctx = projectContext(root);
    await graph.initGraph(ctx);

    await expect(graph.indexAllNotes(ctx)).resolves.toBe(1);
  });
});
