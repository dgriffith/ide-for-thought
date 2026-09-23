import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../../src/main/embeddings/vector-store';
import { MODEL, modelDir } from '../../../src/main/embeddings/embedder';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

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

// ── Incremental row persistence (#2217) ──────────────────────────────────────
//
// `indexChunks` used to DELETE every row of a ref and re-INSERT all of them on
// every call — and its caller is the 1-second autosave. The two things that
// matter about the fix are tested separately below, because they fail in
// opposite directions:
//
//  - **Correctness first.** A diff that writes too little is a silently wrong
//    semantic index: a deleted paragraph keeps matching searches, or a hit is
//    labelled with a heading its text no longer sits under. The round-trip test
//    is the gate — whatever sequence of edits you take to get there, the stored
//    rows must be *exactly* what a from-scratch reindex of the final content
//    would have written.
//  - **Then the counts.** Gates are on row and statement counts, never on
//    timing (#2229): "an edit that changes one chunk writes one row" either
//    holds or it doesn't, on any machine, at any load.

/** What one `indexNote` call actually wrote, counted from the live SQL. */
interface WriteCounts {
  transactions: number;
  /** Rows named by a scoped `chunk_index IN (…)` delete. */
  rowsDeleted: number;
  /** True if a delete-the-whole-ref statement ran (the pre-#2217 shape). */
  fullRefDeletes: number;
  /** Prepared-statement executions — one per inserted row. */
  rowsInserted: number;
  /** Total bytes of SQL text handed to DuckDB. */
  sqlBytes: number;
  /** Floats pulled back into JS by reads. */
  floatsRead: number;
}

/**
 * Wrap the live connection and count what store work does to the database.
 *
 * Installed once, right after `init` and BEFORE any indexing: the INSERT
 * statement is prepared lazily and then cached on the store state for the life
 * of the connection, so a probe attached later never sees the `prepare()` call
 * and cannot count the row inserts that reuse it. (Learned the hard way — the
 * first version of this helper reported zero inserts for every test that
 * indexed something during setup.)
 *
 * Statement *shape* is deliberately part of the gate: if the diff ever
 * regresses to deleting the whole ref, `fullRefDeletes` catches it even though
 * the resulting table contents would be identical.
 */
function probeStore(c: ProjectContext) {
  const conn = store._connectionForTest(c) as unknown as Record<string, unknown>;
  let counts: WriteCounts = blankCounts();
  const note = (sql: string) => {
    counts.sqlBytes += sql.length;
    if (/^\s*BEGIN/i.test(sql)) counts.transactions++;
    if (/^\s*DELETE/i.test(sql)) {
      const inList = sql.match(/chunk_index IN \(([^)]*)\)/);
      if (inList) counts.rowsDeleted += inList[1]!.split(',').length;
      else counts.fullRefDeletes++;
    }
    // A concatenated multi-row INSERT literal (the pre-#2217 shape) would land
    // here; the prepared path shows up as `rowsInserted` instead.
    if (/^\s*INSERT/i.test(sql)) counts.rowsInserted += sql.match(/now\(\)/g)?.length ?? 0;
  };
  // `runAndReadAll` delegates to `run`, so only the outer call is counted.
  const origRun = (conn.run as (...a: unknown[]) => unknown).bind(conn);
  const origReadAll = (conn.runAndReadAll as (...a: unknown[]) => Promise<unknown>).bind(conn);
  const origPrep = (conn.prepare as (...a: unknown[]) => Promise<unknown>).bind(conn);
  let inReadAll = false;
  conn.run = (...a: unknown[]) => { if (!inReadAll) note(String(a[0])); return origRun(...a); };
  conn.runAndReadAll = async (...a: unknown[]) => {
    note(String(a[0]));
    inReadAll = true;
    try {
      const res = await origReadAll(...a) as { getRowObjectsJS(): Record<string, unknown>[] };
      for (const row of res.getRowObjectsJS()) {
        for (const v of Object.values(row)) if (Array.isArray(v)) counts.floatsRead += v.length;
      }
      return res;
    } finally { inReadAll = false; }
  };
  conn.prepare = async (...a: unknown[]) => {
    const st = await origPrep(...a) as Record<string, unknown>;
    const origStRun = (st.run as (...x: unknown[]) => unknown).bind(st);
    st.run = (...x: unknown[]) => { counts.rowsInserted++; return origStRun(...x); };
    return st;
  };
  return {
    /** Run `fn` and report only what it did. */
    async measure(fn: () => Promise<void>): Promise<WriteCounts> {
      counts = blankCounts();
      await fn();
      return counts;
    },
  };
}

function blankCounts(): WriteCounts {
  return { transactions: 0, rowsDeleted: 0, fullRefDeletes: 0, rowsInserted: 0, sqlBytes: 0, floatsRead: 0 };
}

/**
 * Every column the store writes, ordered — the full observable state of the
 * table. `updated_at` is deliberately excluded: an incremental write leaves an
 * untouched row's timestamp alone, which is the honest answer and by design not
 * something a from-scratch index can reproduce.
 */
async function dumpRows(c: ProjectContext): Promise<string> {
  const reader = await store._connectionForTest(c).runAndReadAll(
    `SELECT kind, ref_id, chunk_index, section_heading, chunk_text, content_hash, ` +
    `embedding_model, embedding FROM note_chunks ORDER BY kind, ref_id, chunk_index`,
  );
  // DuckDB hands BIGINT columns back as `bigint`, which `JSON.stringify` throws
  // on — the replacer keeps this readable whatever a column's declared width is.
  return JSON.stringify(reader.getRowObjectsJS(), (_k, v) => (typeof v === 'bigint' ? `bigint:${v}` : v));
}

describe('vector-store incremental persistence (#2217)', () => {
  let dir2: string;
  const ctx2 = () => projectContext(dir2);
  beforeEach(() => { dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-vec2-')); });
  afterEach(async () => { await store.dispose(ctx2()); fs.rmSync(dir2, { recursive: true, force: true }); });

  const V1 = [
    '# Field notes', '',
    '## Alpha', 'alpha body text', '',
    '## Beta', 'beta body text', '',
    '## Gamma', 'gamma body text', '',
    '## Delta', 'delta body text',
  ].join('\n');
  // Every later revision changes the shape in a way the diff has to survive.
  const V2 = V1.replace('## Alpha', '## Preface\npreface body text\n\n## Alpha');  // indexes shift +1
  const V3 = V2.replace('## Gamma\ngamma body text\n\n', '');                      // indexes shift back, note shrinks
  const V4 = V3.replace('# Field notes', '# Field notes, revised')                 // every breadcrumb goes stale
    .replace('beta body text', 'beta body text, amended');                          // one body edit on top

  /** Apply `versions` in order to `dir`'s store, index the last one alone into a
   *  virgin store, and require the two tables to be identical. The unrelated
   *  note is there so a diff that ignores `ref_id` scoping can't pass. */
  async function expectRoundTrip(versions: string[]): Promise<string> {
    const OTHER = '# Other\nan unrelated note that must not be disturbed';
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    await store.indexNote(ctx(), 'other.md', OTHER);
    for (const version of versions) await store.indexNote(ctx(), 'doc.md', version);

    await store.init(ctx2(), { dbPath: path.join(dir2, '.minerva', 'vectors.duckdb'), embedder: fakeEmbedder() });
    await store.indexNote(ctx2(), 'other.md', OTHER);
    await store.indexNote(ctx2(), 'doc.md', versions.at(-1)!);

    const incremental = await dumpRows(ctx());
    expect(incremental).toBe(await dumpRows(ctx2()));
    return incremental;
  }

  it('index shifts alone round-trip: the table matches a from-scratch reindex', async () => {
    // THE correctness gate, and the one the issue calls out: "the diff must
    // correctly handle `chunk_index` shifts". Both edits here move existing
    // chunks to new indexes while changing no text, so a diff keyed on
    // `content_hash` sees every hash still present, writes nothing, and leaves
    // the whole note's rows at their old positions.
    //
    // Deliberately no heading rename and no body edit in this sequence. An
    // earlier version of this test ended with a revision that renamed the H1 —
    // which invalidates every breadcrumb and therefore rewrites every row,
    // *healing* the drift the earlier steps introduced. It passed under a
    // hash-keyed diff. Verified by reintroducing exactly that defect.
    const withPreface = V1.replace('## Alpha', '## Preface\npreface body text\n\n## Alpha');
    const minusGamma = withPreface.replace('## Gamma\ngamma body text\n\n', '');

    const rows = await expectRoundTrip([V1, withPreface, minusGamma]);
    expect(rows).toContain('preface body text');   // not vacuously equal
    expect(rows).not.toContain('gamma body text'); // the removed section is really gone
  });

  it('a mixed sequence of shifts, a deletion and a rename round-trips too', async () => {
    const rows = await expectRoundTrip([V1, V2, V3, V4]);
    expect(rows).toContain('beta body text, amended');
    expect(rows).not.toContain('gamma body text');
  });

  it('editing one chunk writes exactly one row', async () => {
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const probe = probeStore(ctx());
    await store.indexNote(ctx(), 'doc.md', V1);

    const counts = await probe.measure(() =>
      store.indexNote(ctx(), 'doc.md', V1.replace('beta body text', 'beta body text EDITED')));

    expect(counts.rowsInserted).toBe(1);
    expect(counts.rowsDeleted).toBe(1);
    expect(counts.fullRefDeletes).toBe(0);
    expect(counts.transactions).toBe(1);
    // No vector needs carrying over — the changed chunk's text is new — so no
    // embeddings come back across the boundary at all.
    expect(counts.floatsRead).toBe(0);
  });

  it('a save that changes nothing opens no transaction and writes no row', async () => {
    // The autosave's steady state while the user pauses: this used to cost a
    // full 5-row delete + re-insert, and on a 60-section note, 191 KB of SQL.
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const probe = probeStore(ctx());
    await store.indexNote(ctx(), 'doc.md', V1);

    const counts = await probe.measure(() => store.indexNote(ctx(), 'doc.md', V1));

    expect(counts.transactions).toBe(0);
    expect(counts.rowsInserted).toBe(0);
    expect(counts.rowsDeleted).toBe(0);
    expect(counts.fullRefDeletes).toBe(0);
    expect(counts.floatsRead).toBe(0);
  });

  it('shortening a note deletes the orphaned rows rather than stranding them', async () => {
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const probe = probeStore(ctx());
    await store.indexNote(ctx(), 'doc.md', V1);
    expect(await store.searchRelated(ctx(), 'delta body text', { limit: 1 })).toHaveLength(1);

    const shorter = V1.replace('\n\n## Delta\ndelta body text', '');
    const counts = await probe.measure(() => store.indexNote(ctx(), 'doc.md', shorter));
    expect(counts.rowsDeleted).toBe(1);
    expect(counts.rowsInserted).toBe(0); // nothing moved, so nothing is rewritten

    const hits = await store.searchRelated(ctx(), 'delta body text', { limit: 5 });
    expect(hits.every((h) => !h.chunkText.includes('delta body text'))).toBe(true);
  });

  it('carries a vector over by hash when a chunk only moves, without re-embedding', async () => {
    const embedder = fakeEmbedder();
    await store.init(ctx(), { dbPath, embedder });
    const probe = probeStore(ctx());
    await store.indexNote(ctx(), 'doc.md', V1);
    const before = await dumpRows(ctx());

    embedder.calls.length = 0;
    // Inserting a section at the top shifts every following chunk's index. The
    // bodies are unchanged, so nothing may reach the model — but the rows still
    // have to be rewritten at their new positions.
    const counts = await probe.measure(() => store.indexNote(ctx(), 'doc.md', V2));
    expect(embedder.calls.flat()).toHaveLength(1);       // only the new section
    expect(counts.rowsInserted).toBe(5);                  // 4 shifted + 1 new
    expect(counts.floatsRead).toBe(4 * MODEL.dim);        // 4 vectors carried over

    // …and carried over byte-exactly: the moved rows' embeddings are unchanged.
    const vecOf = (dump: string, text: string) =>
      (JSON.parse(dump) as Record<string, unknown>[]).find((r) => r.chunk_text === text)?.embedding;
    expect(vecOf(await dumpRows(ctx()), '## Beta\nbeta body text'))
      .toEqual(vecOf(before, '## Beta\nbeta body text'));
  });

  it('replaces rows left behind by a previous embedding model', async () => {
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const probe = probeStore(ctx());
    await store.indexNote(ctx(), 'doc.md', V1);
    // Re-stamp this ref's rows as another model's, the way a model swap leaves
    // them. Re-indexing identical content must replace every one — a diff that
    // filtered stale-model rows out of its read would leave them beside the new
    // ones, doubling the ref in every search.
    await store._connectionForTest(ctx()).run(
      `UPDATE note_chunks SET embedding_model = 'old-model-v0' WHERE ref_id = 'doc.md'`);

    const counts = await probe.measure(() => store.indexNote(ctx(), 'doc.md', V1));
    expect(counts.rowsDeleted).toBe(5);
    expect(counts.rowsInserted).toBe(5);

    const reader = await store._connectionForTest(ctx()).runAndReadAll(
      `SELECT DISTINCT embedding_model FROM note_chunks WHERE ref_id = 'doc.md'`);
    const models = (reader.getRowObjectsJS() as Record<string, string>[]).map((r) => r.embedding_model);
    expect(models).toEqual([MODEL.name]);
  });

  it('recovers from a store holding two rows at the same chunk_index', async () => {
    // Not something this module can produce, but a pre-#2217 store, a partially
    // applied transaction or a hand-edited DB can. The incremental delete is
    // keyed on `chunk_index`, so the plan falls back to replacing the whole ref.
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const probe = probeStore(ctx());
    await store.indexNote(ctx(), 'doc.md', V1);
    await store._connectionForTest(ctx()).run(
      `INSERT INTO note_chunks SELECT kind, ref_id, chunk_index, section_heading, ` +
      `'duplicate row', content_hash, embedding_model, embedding, updated_at ` +
      `FROM note_chunks WHERE ref_id = 'doc.md' AND chunk_index = 2`);

    const counts = await probe.measure(() => store.indexNote(ctx(), 'doc.md', V1));
    expect(counts.fullRefDeletes).toBe(1);
    expect(counts.rowsInserted).toBe(5);

    await store.init(ctx2(), { dbPath: path.join(dir2, '.minerva', 'vectors.duckdb'), embedder: fakeEmbedder() });
    await store.indexNote(ctx2(), 'doc.md', V1);
    expect(await dumpRows(ctx())).toBe(await dumpRows(ctx2()));
  });

  it('reuses one prepared statement instead of building INSERT text per row', async () => {
    // The other half of #2217: 384 floats per row went through `toString` into a
    // SQL literal DuckDB then had to lex back. The gate is that no INSERT text
    // reaches the connection at all — `rowsInserted` counts prepared executes,
    // and a regression to the literal form shows up as a big `sqlBytes`.
    await store.init(ctx(), { dbPath, embedder: fakeEmbedder() });
    const probe = probeStore(ctx());
    const counts = await probe.measure(() => store.indexNote(ctx(), 'doc.md', V1));
    expect(counts.rowsInserted).toBe(5);
    // Five 384-float literals alone would be ~15 KB; the whole statement stream
    // here is a few hundred bytes of DDL-free SQL.
    expect(counts.sqlBytes).toBeLessThan(2000);
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
