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
    expect(hits[0].ref).toBe('animals.md');
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
    expect(after[0].ref).toBe(before[0].ref);
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
      `INSERT INTO note_chunks SELECT kind, ref_id || '-old', chunk_index, section_heading, ` +
      `chunk_text, content_hash, 'old-model-v0', embedding, updated_at FROM note_chunks`,
    );
    const hits = await store.searchRelated(ctx(), 'relevant words here', { limit: 10 });
    expect(hits.every((h) => !h.ref.endsWith('-old'))).toBe(true);
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

  it('honours the exclude option', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'a.md', '# A\nshared topic words');
    await store.indexNote(ctx(), 'b.md', '# B\nshared topic words');
    const hits = await store.searchRelated(ctx(), 'shared topic words', { limit: 5, exclude: { kind: 'note', ref: 'a.md' } });
    expect(hits.every((h) => h.ref !== 'a.md')).toBe(true);
    expect(hits.some((h) => h.ref === 'b.md')).toBe(true);
  });

  it('relatedToNote ranks other notes by nearest chunk, excluding the source', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'src.md', '# Source\nfeline animals purr and hunt');
    await store.indexNote(ctx(), 'near.md', '# Near\nfeline animals that purr');
    await store.indexNote(ctx(), 'far.md', '# Far\nquarterly earnings and revenue');
    const hits = await store.relatedToNote(ctx(), 'src.md', { limit: 5 });
    expect(hits.every((h) => h.ref !== 'src.md')).toBe(true);
    expect(hits[0].ref).toBe('near.md');
    expect(hits[0].score).toBeGreaterThan(hits[hits.length - 1].score);
  });

  it('embeds notes, sources, and excerpts together and can filter by kind (#839)', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'note.md', '# Note\nphotosynthesis converts sunlight to energy');
    await store.indexSource(ctx(), 'arxiv-9999', '# Paper\nphotosynthesis in marine algae and sunlight');
    await store.indexExcerpt(ctx(), 'arxiv-9999-abc', 'photosynthesis sunlight chlorophyll');

    const all = await store.searchRelated(ctx(), 'photosynthesis sunlight', { limit: 10 });
    expect(new Set(all.map((h) => h.kind))).toEqual(new Set(['note', 'source', 'excerpt']));

    const onlyExcerpts = await store.searchRelated(ctx(), 'photosynthesis sunlight', { limit: 10, kinds: ['excerpt'] });
    expect(onlyExcerpts.length).toBeGreaterThan(0);
    expect(onlyExcerpts.every((h) => h.kind === 'excerpt')).toBe(true);

    // embeddedRefs is per-kind.
    expect((await store.embeddedRefs(ctx(), 'source')).has('arxiv-9999')).toBe(true);
    expect((await store.embeddedRefs(ctx(), 'note')).has('arxiv-9999')).toBe(false);
  });

  it('relatedToNote spans kinds and can be scoped to one', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'q.md', '# Q\nquantum entanglement and superposition');
    await store.indexSource(ctx(), 'src-q', '# Src\nquantum entanglement experiments');
    await store.indexNote(ctx(), 'other.md', '# Other\nquantum superposition states');

    const all = await store.relatedToNote(ctx(), 'q.md', { limit: 10 });
    expect(all.some((h) => h.kind === 'source' && h.ref === 'src-q')).toBe(true);

    const notesOnly = await store.relatedToNote(ctx(), 'q.md', { limit: 10, kinds: ['note'] });
    expect(notesOnly.every((h) => h.kind === 'note')).toBe(true);
  });

  it('relatedToNote returns [] for a note with no embedded chunks', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'other.md', '# Other\nsome content');
    expect(await store.relatedToNote(ctx(), 'missing.md', { limit: 5 })).toEqual([]);
  });

  it('migrates a pre-#839 (note_path) store by rebuilding it', async () => {
    // Hand-create the original note-centric schema, as a store from before #839
    // would have on disk.
    const { DuckDBInstance } = await import('@duckdb/node-api');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const inst = await DuckDBInstance.create(dbPath);
    const conn = await inst.connect();
    await conn.run(`CREATE TABLE note_chunks (note_path VARCHAR, chunk_index INTEGER, ` +
      `section_heading VARCHAR, chunk_text VARCHAR, content_hash VARCHAR, embedding_model VARCHAR, ` +
      `embedding FLOAT[${MODEL.dim}], updated_at TIMESTAMP)`);
    await conn.run(`INSERT INTO note_chunks VALUES ('stale.md', 0, 'h', 't', 'hash', 'old', ` +
      `[${new Array(MODEL.dim).fill(0).join(',')}]::FLOAT[${MODEL.dim}], now())`);
    conn.closeSync(); inst.closeSync();

    // Opening the store must not throw on the old shape; it rebuilds the table.
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    // New-schema writes work, and the stale note_path row is gone.
    await store.indexNote(ctx(), 'fresh.md', '# Fresh\nbrand new content');
    const hits = await store.searchRelated(ctx(), 'brand new content', { limit: 5 });
    expect(hits.some((h) => h.ref === 'fresh.md')).toBe(true);
    expect(hits.some((h) => h.ref === 'stale.md')).toBe(false);
  });

  it('persists across reopen', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    await store.indexNote(ctx(), 'keep.md', '# Keep\ndurable content about turtles');
    await store.dispose(ctx());

    // Reopen the same on-disk DB with a fresh embedder.
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const hits = await store.searchRelated(ctx(), 'durable turtles', { limit: 1 });
    expect(hits[0]?.ref).toBe('keep.md');
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
      expect(hits[0].ref).toBe('cat.md');
      expect(hits[0].score).toBeGreaterThan(hits[1].score);
    } finally {
      await embedder.dispose();
    }
  }, 60_000);
});
