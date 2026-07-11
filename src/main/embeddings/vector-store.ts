/**
 * Persisted DuckDB vector store + incremental indexer (#835, generalized in #839).
 *
 * Embeds three corpora — notes, source bodies, and excerpts — into one table,
 * each row tagged with its `kind` + owning `ref_id` (note relativePath, sourceId,
 * or excerptId) so results route to the right place (open a note / the source
 * viewer / a highlighted excerpt). Properties:
 *
 *  - **Persisted** — file-backed DuckDB at `.minerva/vectors.duckdb`.
 *  - **Incremental + hashed** — re-embeds only chunks whose text changed; an
 *    unchanged chunk's vector carries over, keyed by content hash (position-
 *    independent).
 *  - **Offline brute-force KNN** — `array_cosine_distance` is core DuckDB 1.5, so
 *    exact nearest-neighbour needs no VSS extension and no network.
 *
 * Rows carry `embedding_model`, so a model swap leaves old rows detectably stale.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { MODEL } from './embedder';
import { chunkMarkdown } from './chunk';

export type RefKind = 'note' | 'source' | 'excerpt';
export const ALL_KINDS: readonly RefKind[] = ['note', 'source', 'excerpt'];

/** The embedding capability the store needs — satisfied by `EmbedderService`. */
export interface ChunkEmbedder {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface RelatedHit {
  kind: RefKind;
  /** Owning identity: note relativePath, sourceId, or excerptId. */
  ref: string;
  sectionHeading: string;
  chunkText: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  score: number;
}

export interface VectorStoreInit {
  dbPath?: string;
  embedder: ChunkEmbedder;
}

export interface SearchOptions {
  limit?: number;
  /** Exclude a specific row (kind + ref), e.g. the query note itself. */
  exclude?: { kind: RefKind; ref: string };
  /** Restrict results to these kinds; defaults to all. */
  kinds?: readonly RefKind[];
}

interface StoreState {
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  embedder: ChunkEmbedder;
  model: string;
  lock: Promise<unknown>;
}

// Dispose waits for any in-flight indexing (the per-project lock) to settle,
// then closes the persisted DuckDB. The store removes the state before running
// this hook, so a concurrent call sees the project already gone — preserving
// the original delete-first-then-close ordering.
const store = createProjectStore<StoreState>({
  dispose: async (state) => {
    try { await state.lock; } catch { /* ignore */ }
    try { state.connection.closeSync(); } catch { /* already closed */ }
    try { state.instance.closeSync(); } catch { /* already closed */ }
  },
});
const TABLE = 'note_chunks';

function defaultDbPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'vectors.duckdb');
}

export async function init(ctx: ProjectContext, opts: VectorStoreInit): Promise<void> {
  if (store.has(ctx)) return;
  const dbPath = opts.dbPath ?? defaultDbPath(ctx.rootPath);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();

  // Migration (#839): the original schema keyed rows by `note_path`. A store
  // predating the (kind, ref_id) generalization is dropped and rebuilt — the
  // data is fully reconstructible by the backfill, so this is lossless in
  // practice and avoids a fragile in-place column rename.
  const cols = await connection.runAndReadAll(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${TABLE}'`,
  );
  const colNames = new Set((cols.getRowObjectsJS() as Record<string, unknown>[]).map((r) => String(r.column_name)));
  if (colNames.size > 0 && !colNames.has('kind')) {
    await connection.run(`DROP TABLE IF EXISTS ${TABLE}`);
  }

  await connection.run(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       kind            VARCHAR NOT NULL,
       ref_id          VARCHAR NOT NULL,
       chunk_index     INTEGER NOT NULL,
       section_heading VARCHAR NOT NULL,
       chunk_text      VARCHAR NOT NULL,
       content_hash    VARCHAR NOT NULL,
       embedding_model VARCHAR NOT NULL,
       embedding       FLOAT[${MODEL.dim}] NOT NULL,
       updated_at      TIMESTAMP NOT NULL
     )`,
  );
  store.set(ctx, {
    instance, connection, embedder: opts.embedder, model: MODEL.name, lock: Promise.resolve(),
  });
}

export function isEnabled(ctx: ProjectContext): boolean {
  return store.has(ctx);
}

export async function dispose(ctx: ProjectContext): Promise<void> {
  await store.dispose(ctx);
}

// ── Indexing ────────────────────────────────────────────────────────────────

/**
 * Re-index one ref's chunks. Re-embeds only chunks whose hash isn't already
 * stored for this (kind, ref) under the current model; carries unchanged vectors
 * over. Transactional. Resilient — failures log, leaving prior rows intact.
 */
export async function indexChunks(ctx: ProjectContext, kind: RefKind, ref: string, content: string): Promise<void> {
  const state = store.get(ctx);
  if (!state) return;
  return runLocked(state, async () => {
    try {
      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) {
        await deleteRef(state, kind, ref);
        return;
      }
      const existing = await readExisting(state, kind, ref);
      const toEmbed = chunks.filter((c) => !existing.has(c.hash));
      const fresh = toEmbed.length > 0 ? await state.embedder.embed(toEmbed.map((c) => c.text)) : [];
      const freshByHash = new Map(toEmbed.map((c, i) => [c.hash, fresh[i]]));
      const rows = chunks.map((c) => ({ chunk: c, vec: existing.get(c.hash) ?? freshByHash.get(c.hash)! }));

      await state.connection.run('BEGIN TRANSACTION');
      try {
        await deleteRef(state, kind, ref);
        await insertRows(state, kind, ref, rows);
        await state.connection.run('COMMIT');
      } catch (err) {
        await state.connection.run('ROLLBACK').catch(() => { /* ignore */ });
        throw err;
      }
    } catch (err) {
      console.warn(`[vectors] indexChunks failed for ${kind}:${ref}:`, err);
    }
  });
}

export const indexNote = (ctx: ProjectContext, relativePath: string, content: string) =>
  indexChunks(ctx, 'note', relativePath, content);
export const indexSource = (ctx: ProjectContext, sourceId: string, body: string) =>
  indexChunks(ctx, 'source', sourceId, body);
export const indexExcerpt = (ctx: ProjectContext, excerptId: string, text: string) =>
  indexChunks(ctx, 'excerpt', excerptId, text);

export async function removeRef(ctx: ProjectContext, kind: RefKind, ref: string): Promise<void> {
  const state = store.get(ctx);
  if (!state) return;
  return runLocked(state, async () => {
    try { await deleteRef(state, kind, ref); }
    catch (err) { console.warn(`[vectors] removeRef failed for ${kind}:${ref}:`, err); }
  });
}

export const removeNote = (ctx: ProjectContext, relativePath: string) => removeRef(ctx, 'note', relativePath);
export const removeSource = (ctx: ProjectContext, sourceId: string) => removeRef(ctx, 'source', sourceId);
export const removeExcerpt = (ctx: ProjectContext, excerptId: string) => removeRef(ctx, 'excerpt', excerptId);

/** The refs of `kind` already embedded under the current model — the backfill's
 *  per-kind skip set (#836/#839). */
export async function embeddedRefs(ctx: ProjectContext, kind: RefKind): Promise<Set<string>> {
  const state = store.get(ctx);
  if (!state) return new Set();
  const reader = await state.connection.runAndReadAll(
    `SELECT DISTINCT ref_id FROM ${TABLE} WHERE kind = ${lit(kind)} AND embedding_model = ${lit(state.model)}`,
  );
  const out = new Set<string>();
  for (const r of reader.getRowObjectsJS() as Record<string, unknown>[]) out.add(String(r.ref_id));
  return out;
}

/** Back-compat alias (note-kind skip set). */
export const embeddedNotePaths = (ctx: ProjectContext) => embeddedRefs(ctx, 'note');

export async function clear(ctx: ProjectContext): Promise<void> {
  const state = store.get(ctx);
  if (!state) return;
  return runLocked(state, async () => { await state.connection.run(`DELETE FROM ${TABLE}`); });
}

// ── Querying ──────────────────────────────────────────────────────────────────

export async function searchRelated(
  ctx: ProjectContext,
  query: string | Float32Array,
  opts: SearchOptions = {},
): Promise<RelatedHit[]> {
  const state = store.get(ctx);
  if (!state) return [];
  const vec = typeof query === 'string' ? (await state.embedder.embed([query]))[0] : query;
  if (!vec) return [];

  const where = [`embedding_model = ${lit(state.model)}`, kindClause(opts.kinds)];
  if (opts.exclude) where.push(`NOT (kind = ${lit(opts.exclude.kind)} AND ref_id = ${lit(opts.exclude.ref)})`);
  const sql =
    `SELECT kind, ref_id, section_heading, chunk_text, ` +
    `array_cosine_distance(embedding, ${arrayLit(vec)}) AS dist ` +
    `FROM ${TABLE} WHERE ${where.filter(Boolean).join(' AND ')} ORDER BY dist ASC LIMIT ${limitOf(opts)}`;
  return mapHits(await runRows(state, sql));
}

/**
 * "Find chunks related to this ref" — rank every *other* ref's chunks by their
 * nearest distance to any of this ref's stored chunks. Reuses stored vectors (no
 * re-embedding). `kinds` restricts the result corpus.
 */
export async function relatedToRef(
  ctx: ProjectContext,
  kind: RefKind,
  ref: string,
  opts: SearchOptions = {},
): Promise<RelatedHit[]> {
  const state = store.get(ctx);
  if (!state) return [];
  const model = lit(state.model);
  const kc = kindClause(opts.kinds, 't.');
  const sql =
    `WITH q AS (SELECT embedding FROM ${TABLE} ` +
    `WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)} AND embedding_model = ${model}) ` +
    `SELECT t.kind, t.ref_id, t.section_heading, t.chunk_text, ` +
    `MIN(array_cosine_distance(t.embedding, q.embedding)) AS dist ` +
    `FROM ${TABLE} t, q ` +
    `WHERE NOT (t.kind = ${lit(kind)} AND t.ref_id = ${lit(ref)}) ` +
    `AND t.embedding_model = ${model}${kc ? ` AND ${kc}` : ''} ` +
    `GROUP BY t.kind, t.ref_id, t.section_heading, t.chunk_text ORDER BY dist ASC LIMIT ${limitOf(opts)}`;
  return mapHits(await runRows(state, sql));
}

/** Back-compat: relatives of a note (the active note in the Related panel). */
export const relatedToNote = (ctx: ProjectContext, notePath: string, opts: SearchOptions = {}) =>
  relatedToRef(ctx, 'note', notePath, opts);

// ── internals ───────────────────────────────────────────────────────────────

export function _connectionForTest(ctx: ProjectContext): DuckDBConnection {
  const state = store.get(ctx);
  if (!state) throw new Error('vector store not initialized');
  return state.connection;
}

async function runRows(state: StoreState, sql: string): Promise<Record<string, unknown>[]> {
  const reader = await state.connection.runAndReadAll(sql);
  return reader.getRowObjectsJS();
}

function mapHits(rows: Record<string, unknown>[]): RelatedHit[] {
  return rows.map((r) => ({
    kind: String(r.kind) as RefKind,
    ref: String(r.ref_id),
    sectionHeading: String(r.section_heading),
    chunkText: String(r.chunk_text),
    score: 1 - Number(r.dist),
  }));
}

async function readExisting(state: StoreState, kind: RefKind, ref: string): Promise<Map<string, Float32Array>> {
  const reader = await state.connection.runAndReadAll(
    `SELECT content_hash, embedding FROM ${TABLE} ` +
    `WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)} AND embedding_model = ${lit(state.model)}`,
  );
  const out = new Map<string, Float32Array>();
  for (const r of reader.getRowObjectsJS() as Record<string, unknown>[]) {
    out.set(String(r.content_hash), Float32Array.from(r.embedding as number[]));
  }
  return out;
}

async function deleteRef(state: StoreState, kind: RefKind, ref: string): Promise<void> {
  await state.connection.run(`DELETE FROM ${TABLE} WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)}`);
}

async function insertRows(
  state: StoreState,
  kind: RefKind,
  ref: string,
  rows: { chunk: { index: number; heading: string; text: string; hash: string }; vec: Float32Array }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map(({ chunk, vec }) =>
    `(${lit(kind)}, ${lit(ref)}, ${chunk.index}, ${lit(chunk.heading)}, ${lit(chunk.text)}, ` +
    `${lit(chunk.hash)}, ${lit(state.model)}, ${arrayLit(vec)}, now())`,
  );
  await state.connection.run(`INSERT INTO ${TABLE} VALUES ${values.join(', ')}`);
}

function runLocked<T>(state: StoreState, fn: () => Promise<T>): Promise<T> {
  const run = state.lock.then(fn, fn);
  state.lock = run.then(() => undefined, () => undefined);
  return run;
}

function kindClause(kinds: readonly RefKind[] | undefined, prefix = ''): string {
  if (!kinds || kinds.length === 0 || kinds.length === ALL_KINDS.length) return '';
  return `${prefix}kind IN (${kinds.map(lit).join(', ')})`;
}

function limitOf(opts: SearchOptions): number {
  return Math.floor(opts.limit ?? 10);
}

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function arrayLit(vec: Float32Array): string {
  return `[${Array.from(vec).join(',')}]::FLOAT[${MODEL.dim}]`;
}
