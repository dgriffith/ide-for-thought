/**
 * Persisted DuckDB vector store + incremental indexer (#835).
 *
 * Per-section embeddings live in `.minerva/vectors.duckdb`, kept current on the
 * existing per-file write seam. Three properties matter:
 *
 *  - **Persisted** — a file-backed DuckDB (not the in-memory CSV tables db), so
 *    embeddings survive a project reopen.
 *  - **Incremental + hashed** — `indexNote` re-embeds only chunks whose text
 *    changed; an unchanged chunk's vector is carried over verbatim, position-
 *    independent (keyed by content hash, not chunk index). Editing one section
 *    of a big note costs one embedding, not N.
 *  - **Offline brute-force KNN** — `array_cosine_distance` is a *core* DuckDB
 *    function (1.5), so exact nearest-neighbour needs no VSS extension and no
 *    network. At thoughtbase scale an exact scan is milliseconds; HNSW is
 *    deferred until a corpus actually grows (#833).
 *
 * Rows carry `embedding_model`, so a model swap leaves old rows detectably stale
 * (re-embedded lazily on next save; bulk backfill is #836).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type { ProjectContext } from '../project-context-types';
import { MODEL } from './embedder';
import { chunkMarkdown } from './chunk';

/** The embedding capability the store needs — satisfied by `EmbedderService`. */
export interface ChunkEmbedder {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface RelatedHit {
  notePath: string;
  sectionHeading: string;
  chunkText: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  score: number;
}

export interface VectorStoreInit {
  /** Override the DB location (tests). Defaults to `<root>/.minerva/vectors.duckdb`. */
  dbPath?: string;
  /** The embedder; production passes the shared worker-backed service. */
  embedder: ChunkEmbedder;
}

interface StoreState {
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  embedder: ChunkEmbedder;
  model: string;
  /** Serializes DB mutations so concurrent saves can't interleave a note's
   *  read-modify-write. */
  lock: Promise<unknown>;
}

const states = new Map<string, StoreState>();
const TABLE = 'note_chunks';

function defaultDbPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'vectors.duckdb');
}

/** Open (or create) the per-project vector DB and ensure the schema. Idempotent. */
export async function init(ctx: ProjectContext, opts: VectorStoreInit): Promise<void> {
  if (states.has(ctx.rootPath)) return;
  const dbPath = opts.dbPath ?? defaultDbPath(ctx.rootPath);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  await connection.run(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       note_path       VARCHAR NOT NULL,
       chunk_index     INTEGER NOT NULL,
       section_heading VARCHAR NOT NULL,
       chunk_text      VARCHAR NOT NULL,
       content_hash    VARCHAR NOT NULL,
       embedding_model VARCHAR NOT NULL,
       embedding       FLOAT[${MODEL.dim}] NOT NULL,
       updated_at      TIMESTAMP NOT NULL
     )`,
  );
  states.set(ctx.rootPath, {
    instance,
    connection,
    embedder: opts.embedder,
    model: MODEL.name,
    lock: Promise.resolve(),
  });
}

export function isEnabled(ctx: ProjectContext): boolean {
  return states.has(ctx.rootPath);
}

/** Flush + close the project's DB. Idempotent. */
export async function dispose(ctx: ProjectContext): Promise<void> {
  const state = states.get(ctx.rootPath);
  if (!state) return;
  states.delete(ctx.rootPath);
  // Drain any in-flight mutation before closing the connection.
  try { await state.lock; } catch { /* ignore */ }
  try { state.connection.closeSync(); } catch { /* already closed */ }
  try { state.instance.closeSync(); } catch { /* already closed */ }
}

/**
 * Re-index a note's chunks. Re-embeds only chunks whose hash isn't already
 * stored for this note under the current model; carries unchanged vectors over.
 * Replacing the note's rows is transactional. Resilient — a failure logs and
 * leaves the prior rows intact rather than throwing into the write pipeline.
 */
export async function indexNote(ctx: ProjectContext, relativePath: string, content: string): Promise<void> {
  const state = states.get(ctx.rootPath);
  if (!state) return;
  return runLocked(state, async () => {
    try {
      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) {
        await deleteNote(state, relativePath);
        return;
      }

      // Reuse vectors for chunks whose text is unchanged (same hash, same model).
      const existing = await readExisting(state, relativePath);
      const toEmbed = chunks.filter((c) => !existing.has(c.hash));
      const fresh = toEmbed.length > 0
        ? await state.embedder.embed(toEmbed.map((c) => c.text))
        : [];
      const freshByHash = new Map(toEmbed.map((c, i) => [c.hash, fresh[i]]));

      const rows = chunks.map((c) => ({
        chunk: c,
        vec: existing.get(c.hash) ?? freshByHash.get(c.hash)!,
      }));

      await state.connection.run('BEGIN TRANSACTION');
      try {
        await deleteNote(state, relativePath);
        await insertRows(state, relativePath, rows);
        await state.connection.run('COMMIT');
      } catch (err) {
        await state.connection.run('ROLLBACK').catch(() => { /* ignore */ });
        throw err;
      }
    } catch (err) {
      console.warn(`[vectors] indexNote failed for ${relativePath}:`, err);
    }
  });
}

/** The set of note paths that already have chunks under the *current* model —
 *  the backfill's skip set (#836). A note absent here needs embedding (never
 *  indexed, or only has stale-model rows from a previous model). */
export async function embeddedNotePaths(ctx: ProjectContext): Promise<Set<string>> {
  const state = states.get(ctx.rootPath);
  if (!state) return new Set();
  const reader = await state.connection.runAndReadAll(
    `SELECT DISTINCT note_path FROM ${TABLE} WHERE embedding_model = ${lit(state.model)}`,
  );
  const out = new Set<string>();
  for (const r of reader.getRowObjectsJS() as Record<string, unknown>[]) {
    out.add(String(r.note_path));
  }
  return out;
}

/** Wipe every chunk (manual "Rebuild Semantic Index" — force a full re-embed). */
export async function clear(ctx: ProjectContext): Promise<void> {
  const state = states.get(ctx.rootPath);
  if (!state) return;
  return runLocked(state, async () => {
    await state.connection.run(`DELETE FROM ${TABLE}`);
  });
}

/** Drop a note's chunks (deletion / pre-rename). */
export async function removeNote(ctx: ProjectContext, relativePath: string): Promise<void> {
  const state = states.get(ctx.rootPath);
  if (!state) return;
  return runLocked(state, async () => {
    try {
      await deleteNote(state, relativePath);
    } catch (err) {
      console.warn(`[vectors] removeNote failed for ${relativePath}:`, err);
    }
  });
}

/**
 * Rank the chunks nearest to `query` (text → embedded first, or a vector) by
 * cosine similarity. Only rows under the active model are considered, so stale
 * rows never pollute results.
 */
export async function searchRelated(
  ctx: ProjectContext,
  query: string | Float32Array,
  opts: { limit?: number; excludePath?: string } = {},
): Promise<RelatedHit[]> {
  const state = states.get(ctx.rootPath);
  if (!state) return [];
  const limit = opts.limit ?? 10;
  const vec = typeof query === 'string'
    ? (await state.embedder.embed([query]))[0]
    : query;
  if (!vec) return [];

  const where = [`embedding_model = ${lit(state.model)}`];
  if (opts.excludePath) where.push(`note_path <> ${lit(opts.excludePath)}`);
  const sql =
    `SELECT note_path, section_heading, chunk_text, ` +
    `array_cosine_distance(embedding, ${arrayLit(vec)}) AS dist ` +
    `FROM ${TABLE} WHERE ${where.join(' AND ')} ORDER BY dist ASC LIMIT ${Math.floor(limit)}`;

  const reader = await state.connection.runAndReadAll(sql);
  const rows = reader.getRowObjectsJS() as Record<string, unknown>[];
  return rows.map((r) => ({
    notePath: String(r.note_path),
    sectionHeading: String(r.section_heading),
    chunkText: String(r.chunk_text),
    score: 1 - Number(r.dist),
  }));
}

/** Test-only: the live connection, for asserting on raw rows. */
export function _connectionForTest(ctx: ProjectContext): DuckDBConnection {
  const state = states.get(ctx.rootPath);
  if (!state) throw new Error('vector store not initialized');
  return state.connection;
}

/**
 * "Find chunks related to this note" — rank every other note's chunks by their
 * nearest distance to *any* of `notePath`'s own stored chunks. Reuses the
 * already-stored vectors (no re-embedding). Returns chunk-level hits (the caller
 * de-dups to best-per-note); `[]` if the note has no embedded chunks yet.
 */
export async function relatedToNote(
  ctx: ProjectContext,
  notePath: string,
  opts: { limit?: number } = {},
): Promise<RelatedHit[]> {
  const state = states.get(ctx.rootPath);
  if (!state) return [];
  const limit = Math.floor(opts.limit ?? 10);
  const model = lit(state.model);
  const sql =
    `WITH q AS (SELECT embedding FROM ${TABLE} ` +
    `WHERE note_path = ${lit(notePath)} AND embedding_model = ${model}) ` +
    `SELECT t.note_path, t.section_heading, t.chunk_text, ` +
    `MIN(array_cosine_distance(t.embedding, q.embedding)) AS dist ` +
    `FROM ${TABLE} t, q ` +
    `WHERE t.note_path <> ${lit(notePath)} AND t.embedding_model = ${model} ` +
    `GROUP BY t.note_path, t.section_heading, t.chunk_text ` +
    `ORDER BY dist ASC LIMIT ${limit}`;
  const reader = await state.connection.runAndReadAll(sql);
  const rows = reader.getRowObjectsJS() as Record<string, unknown>[];
  return rows.map((r) => ({
    notePath: String(r.note_path),
    sectionHeading: String(r.section_heading),
    chunkText: String(r.chunk_text),
    score: 1 - Number(r.dist),
  }));
}

// ── internals ───────────────────────────────────────────────────────────────

async function readExisting(state: StoreState, relativePath: string): Promise<Map<string, Float32Array>> {
  const reader = await state.connection.runAndReadAll(
    `SELECT content_hash, embedding FROM ${TABLE} ` +
    `WHERE note_path = ${lit(relativePath)} AND embedding_model = ${lit(state.model)}`,
  );
  const out = new Map<string, Float32Array>();
  for (const r of reader.getRowObjectsJS() as Record<string, unknown>[]) {
    out.set(String(r.content_hash), Float32Array.from(r.embedding as number[]));
  }
  return out;
}

async function deleteNote(state: StoreState, relativePath: string): Promise<void> {
  await state.connection.run(`DELETE FROM ${TABLE} WHERE note_path = ${lit(relativePath)}`);
}

async function insertRows(
  state: StoreState,
  relativePath: string,
  rows: { chunk: { index: number; heading: string; text: string; hash: string }; vec: Float32Array }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(({ chunk, vec }) =>
    `(${lit(relativePath)}, ${chunk.index}, ${lit(chunk.heading)}, ${lit(chunk.text)}, ` +
    `${lit(chunk.hash)}, ${lit(state.model)}, ${arrayLit(vec)}, now())`,
  );
  await state.connection.run(`INSERT INTO ${TABLE} VALUES ${values.join(', ')}`);
}

function runLocked<T>(state: StoreState, fn: () => Promise<T>): Promise<T> {
  const run = state.lock.then(fn, fn);
  state.lock = run.then(() => undefined, () => undefined);
  return run;
}

/** Single-quote-escaped SQL string literal. */
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** A `FLOAT[dim]` array literal from a vector. Values are finite normalized
 *  floats, so plain `toString` is exact enough for FLOAT. */
function arrayLit(vec: Float32Array): string {
  return `[${Array.from(vec).join(',')}]::FLOAT[${MODEL.dim}]`;
}
