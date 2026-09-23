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
 *  - **Incremental on disk too** (#2217) — and this is a separate property from
 *    the one above, which is how it went missing for so long. Re-indexing
 *    rewrites only the rows that differ; a save that changes nothing a chunk
 *    can see opens no transaction at all. The caller is the 1-second autosave,
 *    so "what does an unchanged save cost" is the number that matters.
 *  - **Offline brute-force KNN** — `array_cosine_distance` is core DuckDB 1.5, so
 *    exact nearest-neighbour needs no VSS extension and no network.
 *
 * Rows carry `embedding_model`, so a model swap leaves old rows detectably stale.
 *
 * **On not debouncing this** (#2217 proposed a 5-10s timer for "the persistence
 * step", after the model of `search.schedulePersist`): there is no separable
 * persistence step here to defer. The search index is an in-memory structure
 * that has to be explicitly serialized, so debouncing its `save` defers only a
 * write. This store *is* the on-disk structure — `indexChunks` commits to a
 * file-backed DuckDB — so a debounce would defer the whole operation, embedding
 * included, and would need a flush hook that does not exist: `before-quit`'s
 * `flushAllProjects` persists the search index and the graph only, and
 * `releaseProject`'s `disposeAllProjectStores` awaits the in-flight lock, not a
 * pending timer. A timer armed at quit, or at the close of a window on macOS
 * where the app keeps running, would fire into a closed connection or not at
 * all. With the diff in place the steady-state save is one small SELECT and
 * (usually) nothing else, which is what the debounce was for.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  DuckDBInstance, DuckDBConnection, DuckDBPreparedStatement,
} from '@duckdb/node-api';
import { duckdb } from '../duckdb-lazy';
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { MODEL } from './embedder';
import { chunkMarkdown, type Chunk } from './chunk';
import { planRowDiff, type StoredRow } from './chunk-row-diff';
import { logger } from '../../shared/logger';

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
  /** Lazily prepared, then reused for the life of the connection (#2217).
   *  Preparing costs a parse + bind; the row loop runs it once per row. */
  insertStmt: DuckDBPreparedStatement | null;
}

// Dispose waits for any in-flight indexing (the per-project lock) to settle,
// then closes the persisted DuckDB. The store removes the state before running
// this hook, so a concurrent call sees the project already gone — preserving
// the original delete-first-then-close ordering.
const store = createProjectStore<StoreState>({
  dispose: async (state) => {
    try { await state.lock; } catch { /* ignore */ }
    try { state.insertStmt?.destroySync(); } catch { /* already destroyed */ }
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

  // Lazy for the same reason as `sources/tables.ts` — see `duckdb-lazy.ts`.
  const { DuckDBInstance } = await duckdb();
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
    insertStmt: null,
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
 *
 * **Incremental persistence (#2217).** This used to delete every row for the
 * ref and re-insert all of them on each call, which matters because the caller
 * is the 1-second autosave (`editor.svelte.ts`'s `AUTO_SAVE_DELAY` →
 * `write-pipeline.ts` → `indexNote`). Measured on a 60-section note with one
 * word edited: 61 rows deleted, 61 re-inserted, a 191 KB `INSERT … VALUES`
 * string built in JS and re-lexed by DuckDB, and a commit — every second, for
 * one row's worth of change. Now `planRowDiff` says which rows actually differ,
 * and a save that changes nothing a chunk can see opens no transaction at all.
 *
 * The ordering below is not arbitrary: vectors for reusable hashes are read
 * *before* the transaction deletes anything, because the row a vector is being
 * carried over from may itself be one of the rows being replaced (an edit that
 * shifts `chunk_index` moves a chunk's text to a different row).
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
      const plan = planRowDiff(chunks, await readStoredRows(state, kind, ref), state.model);
      // Nothing to do. This is the common autosave case once the user pauses —
      // and the whole point of the diff: no transaction, no commit, no fsync.
      if (!plan.fullReplace && plan.write.length === 0 && plan.deleteIndexes.length === 0) return;

      const rows = await resolveVectors(state, kind, ref, plan.write);

      await state.connection.run('BEGIN TRANSACTION');
      try {
        if (plan.fullReplace) await deleteRef(state, kind, ref);
        else if (plan.deleteIndexes.length > 0) await deleteIndexes(state, kind, ref, plan.deleteIndexes);
        await insertRows(state, kind, ref, rows);
        await state.connection.run('COMMIT');
      } catch (err) {
        await state.connection.run('ROLLBACK').catch(() => { /* ignore */ });
        throw err;
      }
    } catch (err) {
      logger('vectors').warn(`indexChunks failed for ${kind}:${ref}:`, err);
    }
  });
}

/**
 * Pair each chunk that needs writing with its vector, embedding only what isn't
 * already on disk under the current model.
 *
 * Two things here that the pre-#2217 version did differently, both deliberate:
 *
 *  - It read `content_hash, embedding` for *every* row of the ref, pulling
 *    60 × 384 floats across the DuckDB→JS boundary on every keystroke-triggered
 *    save. The vectors are only ever needed for rows being rewritten, so the
 *    read is now restricted to those hashes — usually zero of them, since a
 *    changed chunk's text is new and has to be embedded anyway.
 *  - Chunks are de-duplicated by hash before embedding. The old code filtered
 *    the chunk list, so a note with two byte-identical sections embedded the
 *    same text twice.
 */
async function resolveVectors(
  state: StoreState,
  kind: RefKind,
  ref: string,
  write: readonly Chunk[],
): Promise<{ chunk: Chunk; vec: Float32Array }[]> {
  if (write.length === 0) return [];
  const textByHash = new Map(write.map((c) => [c.hash, c.text]));
  const vecByHash = await readEmbeddings(state, kind, ref, [...textByHash.keys()]);
  const toEmbed = [...textByHash.keys()].filter((h) => !vecByHash.has(h));
  if (toEmbed.length > 0) {
    const fresh = await state.embedder.embed(toEmbed.map((h) => textByHash.get(h)!));
    toEmbed.forEach((h, i) => vecByHash.set(h, fresh[i]!));
  }
  return write.map((chunk) => ({ chunk, vec: vecByHash.get(chunk.hash)! }));
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
    catch (err) { logger('vectors').warn(`removeRef failed for ${kind}:${ref}:`, err); }
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

/**
 * The identifying columns of every row stored for this ref — everything the
 * diff needs and nothing it doesn't. Notably **no `embedding`**: the old
 * `readExisting` pulled 384 floats per row across the DuckDB→JS boundary on
 * every autosave purely so unchanged chunks could be re-inserted with the same
 * vector, which the diff makes unnecessary (#2217).
 *
 * Also deliberately **not** filtered by `embedding_model`. A row written under
 * a previous model has to be *seen* here so the diff schedules its deletion;
 * filtering it out would leave it behind next to the new model's rows, which is
 * exactly the staleness the `embedding_model` column exists to prevent.
 */
async function readStoredRows(state: StoreState, kind: RefKind, ref: string): Promise<StoredRow[]> {
  const reader = await state.connection.runAndReadAll(
    `SELECT chunk_index, section_heading, content_hash, embedding_model FROM ${TABLE} ` +
    `WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)}`,
  );
  // `Number()` rather than a cast: DuckDB hands INTEGER back as a JS `number`
  // but BIGINT as a `bigint`, and `chunk_index`'s declared width is not
  // something this function should have to depend on.
  return (reader.getRowObjectsJS() as Record<string, unknown>[]).map((r) => ({
    index: Number(r.chunk_index),
    heading: String(r.section_heading),
    hash: String(r.content_hash),
    model: String(r.embedding_model),
  }));
}

/** Stored vectors for the given hashes, so a chunk whose text is already
 *  embedded under the current model doesn't go back to the model just because
 *  its row moved. Restricted to the hashes actually being rewritten — usually
 *  none, since a changed chunk's text is new by definition. */
async function readEmbeddings(
  state: StoreState,
  kind: RefKind,
  ref: string,
  hashes: readonly string[],
): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  if (hashes.length === 0) return out;
  const reader = await state.connection.runAndReadAll(
    `SELECT content_hash, embedding FROM ${TABLE} ` +
    `WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)} AND embedding_model = ${lit(state.model)} ` +
    `AND content_hash IN (${hashes.map(lit).join(', ')})`,
  );
  for (const r of reader.getRowObjectsJS() as Record<string, unknown>[]) {
    out.set(String(r.content_hash), Float32Array.from(r.embedding as number[]));
  }
  return out;
}

async function deleteRef(state: StoreState, kind: RefKind, ref: string): Promise<void> {
  await state.connection.run(`DELETE FROM ${TABLE} WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)}`);
}

/** Delete exactly the rows the diff condemned. `chunk_index` is a row's identity
 *  within a (kind, ref); `planRowDiff` refuses the incremental path outright if
 *  the stored rows ever violate that, so an `IN` list here is precise. */
async function deleteIndexes(
  state: StoreState,
  kind: RefKind,
  ref: string,
  indexes: readonly number[],
): Promise<void> {
  await state.connection.run(
    `DELETE FROM ${TABLE} WHERE kind = ${lit(kind)} AND ref_id = ${lit(ref)} ` +
    `AND chunk_index IN (${indexes.map((i) => String(Math.trunc(i))).join(', ')})`,
  );
}

/** The one statement, prepared once per connection and re-bound per row (#2217).
 *  `now()` is evaluated server-side, so it isn't a parameter. */
const INSERT_SQL = `INSERT INTO ${TABLE} VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())`;

/**
 * Insert rows through a prepared statement rather than a concatenated
 * `VALUES (…), (…)` literal.
 *
 * The literal form ran every one of 384 floats through `Number.prototype
 * .toString` and handed DuckDB a ~3 KB text blob per vector to lex back into
 * floats — 191 KB of SQL for the 61-row rewrite measured in #2217. The diff
 * above already removes most of those rows; this removes the per-row cost of
 * the ones that remain, and it is what the bulk paths (a note's first index,
 * the backfill) pay too, where the diff has nothing to save.
 *
 * One `run()` per row is deliberate over a multi-row prepared statement: the
 * parameter count would then vary with the row count, requiring a statement
 * cache keyed by width. DuckDB executes are in-process, and after the diff the
 * common row count is one.
 */
async function insertRows(
  state: StoreState,
  kind: RefKind,
  ref: string,
  rows: { chunk: Chunk; vec: Float32Array }[],
): Promise<void> {
  if (rows.length === 0) return;
  // `insertRows` only ever runs against an already-open store, so the module
  // is resolved by the time this awaits (#2335).
  const { ARRAY, FLOAT, arrayValue } = await duckdb();
  if (!state.insertStmt) state.insertStmt = await state.connection.prepare(INSERT_SQL);
  const stmt = state.insertStmt;
  for (const { chunk, vec } of rows) {
    stmt.bindVarchar(1, kind);
    stmt.bindVarchar(2, ref);
    stmt.bindInteger(3, chunk.index);
    stmt.bindVarchar(4, chunk.heading);
    stmt.bindVarchar(5, chunk.text);
    stmt.bindVarchar(6, chunk.hash);
    stmt.bindVarchar(7, state.model);
    // The explicit `ARRAY(FLOAT, dim)` matters: without it the binder infers
    // DOUBLE[] from the JS numbers and the insert fails against `FLOAT[dim]`.
    stmt.bindArray(8, arrayValue(Array.from(vec)), ARRAY(FLOAT, MODEL.dim));
    await stmt.run();
  }
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

/** Still the right tool on the read side: a search embeds its query vector into
 *  one `array_cosine_distance(…)` call inside a larger hand-built SELECT, once
 *  per search. It was the wrong tool on the write side, where it ran once per
 *  row per autosave — see `insertRows` (#2217). */
function arrayLit(vec: Float32Array): string {
  return `[${Array.from(vec).join(',')}]::FLOAT[${MODEL.dim}]`;
}
