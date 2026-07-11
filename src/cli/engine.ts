/**
 * The read Engine (#1146/#1149, epic #1145 — Substrate).
 *
 * The single source of truth for "init the project, then run a read": the CLI
 * (one-shot) and the MCP server (long-lived) both drive it. Each modality's init
 * — graph index, full-text index, DuckDB tables, vector store — runs at most
 * once and is memoized, so a one-shot CLI run pays only for the modality it uses
 * and a persistent MCP server stays warm across tool calls.
 *
 * Results are a discriminated `ExecResult` so callers can format them their own
 * way (CLI → JSON + exit code; MCP → tool result). Every result is grounded:
 * query bindings carry node IRIs, search hits carry note paths, read echoes the
 * path.
 *
 * NOTE (write coordination): init is a point-in-time snapshot. A server that
 * outlives edits to the vault serves stale results until restarted — the caveat
 * flagged in docs/vision/substrate-mcp-plan.md. Acceptable for the read MVP.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../main/graph/index';
import * as search from '../main/search/index';
import * as tables from '../main/sources/tables';
import * as vectors from '../main/embeddings/vector-store';
import type { ChunkEmbedder } from '../main/embeddings/vector-store';
import { getSharedEmbedder } from '../main/embeddings/shared-embedder';
import { readFile } from '../main/notebase/fs';
import type { ProjectContext } from '../main/project-context-types';

export type ExecResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface Engine {
  query(sparql: string): Promise<ExecResult>;
  sql(sql: string): Promise<ExecResult>;
  search(text: string, limit?: number): Promise<ExecResult>;
  semantic(text: string, limit?: number): Promise<ExecResult>;
  read(relativePath: string): Promise<ExecResult>;
}

export interface EngineOptions {
  /** Injectable embedder for `semantic` so tests avoid the real WASM model.
   *  Resolved lazily — the shared embedder is only constructed if `semantic`
   *  actually runs. */
  embedder?: ChunkEmbedder | undefined;
}

const SEMANTIC_EMPTY_NOTE =
  'No embedded content matched. Semantic search covers notes already embedded ' +
  'by the app; a vault that has never been embedded returns no hits.';

export function createEngine(ctx: ProjectContext, opts: EngineOptions = {}): Engine {
  const ensureMinervaDir = () => fs.mkdir(path.join(ctx.rootPath, '.minerva'), { recursive: true });

  // Memoized per-modality init — the `??=` makes each block run exactly once.
  let graphReady: Promise<void> | undefined;
  let searchReady: Promise<void> | undefined;
  let tablesReady: Promise<void> | undefined;
  let vectorsReady: Promise<void> | undefined;

  const ensureGraph = () => (graphReady ??= (async () => {
    await graph.initGraph(ctx);
    await graph.indexAllNotes(ctx);
  })());
  const ensureSearch = () => (searchReady ??= (async () => {
    await ensureMinervaDir();
    await search.initSearch(ctx);
    await search.indexAllNotes(ctx);
  })());
  const ensureTables = () => (tablesReady ??= (async () => {
    await ensureMinervaDir();
    await tables.initTablesDb(ctx);
    await tables.registerAllCsvs(ctx);
  })());
  const ensureVectors = () => (vectorsReady ??= (async () => {
    await ensureMinervaDir();
    await vectors.init(ctx, { embedder: opts.embedder ?? getSharedEmbedder() });
  })());

  return {
    async query(sparql) {
      await ensureGraph();
      const { results, columns, error } = await graph.queryGraph(ctx, sparql);
      return error ? { ok: false, error } : { ok: true, data: { columns, results } };
    },
    async sql(sql) {
      await ensureTables();
      const result = await tables.runQuery(ctx, sql);
      return result.ok
        ? { ok: true, data: { columns: result.columns, rows: result.rows } }
        : { ok: false, error: result.error };
    },
    async search(text, limit) {
      await ensureSearch();
      const hits = search.search(ctx, text, limit ? { limit } : undefined);
      return { ok: true, data: { query: text, hits } };
    },
    async semantic(text, limit) {
      await ensureVectors();
      const hits = await vectors.searchRelated(ctx, text, limit ? { limit } : {});
      const data: Record<string, unknown> = { query: text, hits };
      if (hits.length === 0) data.note = SEMANTIC_EMPTY_NOTE;
      return { ok: true, data };
    },
    async read(relativePath) {
      try {
        const content = await readFile(ctx.rootPath, relativePath);
        return { ok: true, data: { path: relativePath, content } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
