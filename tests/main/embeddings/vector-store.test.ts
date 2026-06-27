import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../../src/main/embeddings/vector-store';
import { MODEL, modelDir } from '../../../src/main/embeddings/embedder';
import { projectContext } from '../../../src/main/project-context-types';

/** Deterministic bag-of-words hashing embedder: shared words → higher cosine,
 *  so ranking is meaningful, and it records what it was asked to embed. */
function fakeEmbedder(): ChunkEmbedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    dim: MODEL.dim,
    calls,
    async embed(texts: string[]): Promise<Float32Array[]> {
      calls.push(texts);
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

let dir: string;
let dbPath: string;
const ctx = () => projectContext(dir);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-vec-'));
  dbPath = path.join(dir, '.minerva', 'vectors.duckdb');
});
afterEach(async () => {
  await store.dispose(ctx());
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('vector-store', () => {
  it('embeds a note\'s sections and finds them by similarity', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'animals.md', [
      '# Animals', '',
      '## Cats', 'Cats are feline predators that purr.', '',
      '## Finance', 'Quarterly revenue and earnings reports.',
    ].join('\n'));

    const hits = await store.searchRelated(ctx(), 'feline predators purr', { limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0].notePath).toBe('animals.md');
    expect(hits[0].sectionHeading).toBe('Animals > Cats');
    expect(hits[0].score).toBeGreaterThan(0.3);
  });

  it('re-embeds ONLY the changed section on re-index (hash skip)', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    const v1 = '# Doc\n\n## A\nalpha text\n\n## B\nbeta text';
    await store.indexNote(ctx(), 'doc.md', v1);
    const callsAfterFirst = embedder.calls.flat().length;
    expect(callsAfterFirst).toBe(3); // preamble-less: A, B headings → 2 sections + the "# Doc" title section = 3

    // Edit only section B.
    embedder.calls.length = 0;
    await store.indexNote(ctx(), 'doc.md', '# Doc\n\n## A\nalpha text\n\n## B\nbeta text CHANGED');
    const reEmbedded = embedder.calls.flat();
    expect(reEmbedded).toHaveLength(1);
    expect(reEmbedded[0]).toContain('CHANGED');
  });

  it('reuses stored vectors verbatim when content is unchanged', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    const md = '# Topic\n\n## One\ncats and dogs\n\n## Two\nstocks and bonds';
    await store.indexNote(ctx(), 'n.md', md);
    const before = await store.searchRelated(ctx(), 'cats and dogs', { limit: 1 });

    embedder.calls.length = 0;
    await store.indexNote(ctx(), 'n.md', md); // identical → nothing re-embedded
    expect(embedder.calls.flat()).toHaveLength(0);

    const after = await store.searchRelated(ctx(), 'cats and dogs', { limit: 1 });
    expect(after[0].notePath).toBe(before[0].notePath);
    expect(after[0].score).toBeCloseTo(before[0].score, 6); // reused vectors identical
  });

  it('does not return rows stored under a different (stale) model', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'cur.md', '# Cur\nrelevant words here');
    // Simulate a row left by a previous model: clone the current row with a
    // different embedding_model so it's detectably stale.
    const conn = store._connectionForTest(ctx());
    await conn.run(
      `INSERT INTO note_chunks SELECT note_path || '-old', chunk_index, section_heading, ` +
      `chunk_text, content_hash, 'old-model-v0', embedding, updated_at FROM note_chunks`,
    );
    const hits = await store.searchRelated(ctx(), 'relevant words here', { limit: 10 });
    expect(hits.every((h) => !h.notePath.endsWith('-old'))).toBe(true);
  });

  it('removes a note\'s chunks on removeNote', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'gone.md', '# Gone\nbody about cats');
    expect(await store.searchRelated(ctx(), 'cats', { limit: 5 })).not.toHaveLength(0);
    await store.removeNote(ctx(), 'gone.md');
    expect(await store.searchRelated(ctx(), 'cats', { limit: 5 })).toHaveLength(0);
  });

  it('drops all chunks when a note becomes empty', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'n.md', '# H\nsome content');
    await store.indexNote(ctx(), 'n.md', '   ');
    expect(await store.searchRelated(ctx(), 'content', { limit: 5 })).toHaveLength(0);
  });

  it('honours excludePath', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'a.md', '# A\nshared topic words');
    await store.indexNote(ctx(), 'b.md', '# B\nshared topic words');
    const hits = await store.searchRelated(ctx(), 'shared topic words', { limit: 5, excludePath: 'a.md' });
    expect(hits.every((h) => h.notePath !== 'a.md')).toBe(true);
    expect(hits.some((h) => h.notePath === 'b.md')).toBe(true);
  });

  it('persists across reopen', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'keep.md', '# Keep\ndurable content about turtles');
    await store.dispose(ctx());

    // Reopen the same on-disk DB with a fresh embedder.
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const hits = await store.searchRelated(ctx(), 'durable turtles', { limit: 1 });
    expect(hits[0]?.notePath).toBe('keep.md');
  });
});

// Real-model end-to-end — needs the bundled weights (skipped without them).
const haveModel = fs.existsSync(path.join(modelDir(), 'onnx', 'model_quantized.onnx'));
const realDescribe = haveModel ? describe : describe.skip;

realDescribe('vector-store with the real WASM embedder', () => {
  it('ranks semantically related notes first', async () => {
    const { createWasmEmbedder } = await import('../../../src/main/embeddings/wasm-embedder');
    const embedder = await createWasmEmbedder();
    try {
      await store.init(ctx(), { dbPath, embedder });
      await store.indexNote(ctx(), 'cat.md', '# Pets\nThe cat is a small domesticated feline that purrs.');
      await store.indexNote(ctx(), 'fin.md', '# Markets\nQuarterly revenue exceeded analyst forecasts.');

      const hits = await store.searchRelated(ctx(), 'a kitten meowing', { limit: 2 });
      expect(hits[0].notePath).toBe('cat.md');
      expect(hits[0].score).toBeGreaterThan(hits[1].score);
    } finally {
      await embedder.dispose();
    }
  }, 60_000);
});
