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
import * as approval from '../main/llm/approval';
import { readFile } from '../main/notebase/fs';
import type { ProjectContext } from '../main/project-context-types';

export type ExecResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface ProposeNoteInput {
  relativePath: string;
  content: string;
  /** One-line summary for the review queue; defaulted from the path if absent. */
  note?: string | undefined;
  /** Provenance — who proposed this. e.g. 'cli' or 'mcp:claude-code'. */
  proposedBy: string;
}

export interface Engine {
  query(sparql: string): Promise<ExecResult>;
  sql(sql: string): Promise<ExecResult>;
  search(text: string, limit?: number): Promise<ExecResult>;
  semantic(text: string, limit?: number): Promise<ExecResult>;
  read(relativePath: string): Promise<ExecResult>;
  /** Assemble a task-relevant slice of the thoughtbase for a topic: the matching
   *  notes plus their link neighborhood and full content, as one bundle an
   *  external agent can seed its own context with (#1150). */
  context(topic: string, limit?: number): Promise<ExecResult>;
  /** File a NEW note as a pending proposal through the approval gate. Never
   *  writes the vault directly — a human approves it in Minerva. */
  proposeNote(input: ProposeNoteInput): Promise<ExecResult>;
}

export interface EngineOptions {
  /** Injectable embedder for `semantic` so tests avoid the real WASM model.
   *  Resolved lazily — the shared embedder is only constructed if `semantic`
   *  actually runs. */
  embedder?: ChunkEmbedder | undefined;
  /** Absolute path to the bundled `resources/` dir. The CLI derives this from the
   *  bundle location so semantic search finds the model regardless of the
   *  caller's cwd; the app omits it (electron resolves via `process.resourcesPath`)
   *  and tests inject a fake embedder instead. */
  resourcesBase?: string | undefined;
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
    await vectors.init(ctx, { embedder: opts.embedder ?? getSharedEmbedder(opts.resourcesBase) });
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

    async context(topic, limit) {
      const t = topic?.trim();
      if (!t) return { ok: false, error: 'A topic is required.' };
      const n = limit && limit > 0 ? limit : 5;
      // Full-text retrieval (reliable, no model load), then expand each hit along
      // its graph edges. Both indexes are needed: search for retrieval, graph for
      // the link neighborhood + note content grounding.
      await ensureSearch();
      await ensureGraph();
      const hits = search.search(ctx, t, { limit: n });
      const notes = await Promise.all(
        hits.map(async (h) => {
          let content = '';
          try {
            content = await readFile(ctx.rootPath, h.relativePath);
          } catch {
            // A hit whose file vanished between index and read — skip its body,
            // keep the neighborhood.
          }
          return {
            path: h.relativePath,
            title: h.title,
            score: h.score,
            snippet: h.snippet,
            content,
            // "Linked from" — notes that reference this one.
            backlinks: graph.backlinks(ctx, h.relativePath).map((b) => ({
              source: b.source,
              sourceTitle: b.sourceTitle,
              linkType: b.linkType,
            })),
            // "Links to" — what this note references.
            outgoingLinks: graph.outgoingLinks(ctx, h.relativePath).map((o) => ({
              target: o.target,
              targetTitle: o.targetTitle,
              linkType: o.linkType,
              exists: o.exists,
            })),
          };
        }),
      );
      return { ok: true, data: { topic: t, noteCount: notes.length, notes } };
    },

    async proposeNote(input) {
      const rel = input.relativePath?.trim();
      if (!rel) return { ok: false, error: 'A relative note path is required.' };
      if (typeof input.content !== 'string' || !input.content.trim()) {
        return { ok: false, error: 'Note content is required.' };
      }

      // Load the on-disk snapshot fresh — NOT the read path's `indexAllNotes`
      // store, which resets to note-derived triples and would drop existing
      // proposals — so filing preserves everything already in graph.ttl. Then
      // invalidate the read memo so a later query re-indexes against the store
      // we're about to mutate.
      await graph.initGraph(ctx);
      graphReady = undefined;

      const summary = input.note?.trim() || `Proposed note: ${rel}`;
      // Route through the approval gate exactly like the internal AI does, and in
      // LLM context so a regression that wrote directly (bypassing proposeWrite)
      // would trip the write guard. The proposal lands PENDING — never applied
      // here — so nothing touches the vault until a human approves it.
      const proposal = await graph.withLLMContext(() =>
        approval.proposeWrite(ctx, {
          operationType: 'component_creation',
          payloads: [{ kind: 'note', relativePath: rel, content: input.content }],
          note: summary,
          proposedBy: input.proposedBy,
        }),
      );
      await graph.persistGraph(ctx);

      return {
        ok: true,
        data: {
          status: 'pending',
          proposalUri: proposal?.uri ?? null,
          relativePath: rel,
          proposedBy: input.proposedBy,
          note: summary,
          message:
            'Filed as a pending proposal. It is NOT written to the vault until a ' +
            'human reviews and approves it in Minerva (Proposals panel).',
        },
      };
    },
  };
}
