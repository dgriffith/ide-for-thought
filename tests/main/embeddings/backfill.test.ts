import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runBackfill, abortBackfill, isBackfilling } from '../../../src/main/embeddings/backfill';
import * as store from '../../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../../src/main/embeddings/vector-store';
import { MODEL } from '../../../src/main/embeddings/embedder';
import { projectContext } from '../../../src/main/project-context-types';

function fakeEmbedder(delayMs = 0): ChunkEmbedder {
  return {
    dim: MODEL.dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return texts.map((t) => {
        const v = new Float32Array(MODEL.dim);
        for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) {
          let h = 0;
          for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % MODEL.dim] += 1;
        }
        const n = Math.hypot(...v);
        if (n > 0) for (let i = 0; i < MODEL.dim; i++) v[i] /= n;
        return v;
      });
    },
  };
}

let root: string;
const ctx = () => projectContext(root);

async function writeNote(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-backfill-'));
  await store.init(ctx(), { dbPath: path.join(root, '.minerva', 'vectors.duckdb'), embedder: fakeEmbedder() });
});
afterEach(async () => {
  abortBackfill(root);
  await store.dispose(ctx());
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runBackfill', () => {
  it('embeds the whole corpus and reports progress', async () => {
    await writeNote('a.md', '# A\nalpha content');
    await writeNote('topics/b.md', '# B\nbeta content');
    await writeNote('topics/c.md', '# C\ngamma content');

    const ticks: { done: number; total: number; running: boolean }[] = [];
    const res = await runBackfill(ctx(), { onProgress: (p) => ticks.push({ ...p }) });

    expect(res).toMatchObject({ embedded: 3, aborted: false });
    expect((await store.embeddedNotePaths(ctx())).size).toBe(3);
    // Progress is monotonic and ends with a running:false tick.
    expect(ticks.at(-1)).toEqual({ done: 0, total: 0, running: false });
    expect(ticks.some((t) => t.done === 3 && t.total === 3)).toBe(true);
  });

  it('resumes — a re-run skips already-embedded notes', async () => {
    await writeNote('a.md', '# A\nalpha');
    await writeNote('b.md', '# B\nbeta');
    // Simulate a prior partial run: a.md already embedded.
    await store.indexNote(ctx(), 'a.md', '# A\nalpha');

    const res = await runBackfill(ctx());
    expect(res.embedded).toBe(1); // only b.md
  });

  it('a no-op re-run embeds nothing', async () => {
    await writeNote('a.md', '# A\nalpha');
    await runBackfill(ctx());
    const second = await runBackfill(ctx());
    expect(second.embedded).toBe(0);
  });

  it('force clears and re-embeds everything', async () => {
    await writeNote('a.md', '# A\nalpha');
    await writeNote('b.md', '# B\nbeta');
    await runBackfill(ctx());
    const forced = await runBackfill(ctx(), { force: true });
    expect(forced.embedded).toBe(2);
  });

  it('ignores ONE unreadable note instead of failing the whole pass', async () => {
    await writeNote('good.md', '# Good\ncontent');
    // A path the walker won't find but we inject so the read fails.
    const res = await runBackfill(ctx(), {
      listNotes: async () => ['good.md', 'missing.md'],
    });
    expect(res.embedded).toBe(1);
    expect((await store.embeddedNotePaths(ctx())).has('good.md')).toBe(true);
  });

  it('can be aborted mid-run and resumed', async () => {
    for (const n of ['a', 'b', 'c', 'd']) await writeNote(`${n}.md`, `# ${n}\nbody ${n}`);
    // Abort after the first note completes.
    const res = await runBackfill(ctx(), {
      onProgress: (p) => { if (p.running && p.done === 1) abortBackfill(root); },
    });
    expect(res.aborted).toBe(true);
    expect(res.embedded).toBeLessThan(4);

    // A fresh run finishes the rest.
    const rest = await runBackfill(ctx());
    expect((await store.embeddedNotePaths(ctx())).size).toBe(4);
    expect(rest.aborted).toBe(false);
  });

  it('does not start a second concurrent run', async () => {
    await writeNote('a.md', '# A\nalpha');
    // Reopen the store with a deliberately slow embedder so the first run stays
    // in flight while we fire the second.
    await store.dispose(ctx());
    await store.init(ctx(), { dbPath: path.join(root, '.minerva', 'vectors.duckdb'), embedder: fakeEmbedder(40) });
    const first = runBackfill(ctx());
    // While the slow first run is in flight, a second call no-ops.
    expect(isBackfilling(root)).toBe(true);
    const second = await runBackfill(ctx());
    expect(second).toMatchObject({ embedded: 0 });
    await first;
  });
});
