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
import { fileNoteProposal, type ProposeNoteInput } from '../main/llm/propose-note';
import { readFile } from '../main/notebase/fs';
import { searchInNotes } from '../main/notebase/search-in-notes';
import { agentPathRefusal } from '../main/path-containment';
import type { ProjectContext } from '../main/project-context-types';

export type ExecResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface GrepOptions {
  regex?: boolean | undefined;
  caseSensitive?: boolean | undefined;
  limit?: number | undefined;
}

/** Default / hard caps on grep match lines, so a broad pattern can't flood the
 *  agent's context; the result still reports the true `total`. */
const GREP_DEFAULT_LIMIT = 50;
const GREP_MAX_LIMIT = 200;

export type { ProposeNoteInput };

/*
 * WHO WROTE THE INPUT decides which method runs it (#2452). Two callers drive
 * this engine and they are not equally trusted:
 *
 *   - the CLI (`minerva sql`, `minerva read`, …) runs what the USER typed at
 *     their own shell — like the Query panel, it gets the full root-locked
 *     connection and can `read_csv` an in-root file;
 *   - `minerva mcp` runs what an EXTERNAL AGENT chose, and that agent reads
 *     thoughtbase text (which a shared note can plant instructions in) through
 *     the other MCP tools. Its input is untrusted, so it gets the `agent*`
 *     methods: `agentSql` (the #2442 relation allowlist) and `agentRead`
 *     (nothing under `.minerva/` or any other ignored/hidden path).
 *
 * Do not "fix" the CLI into the guarded methods (it is the user's own input),
 * and do not point an MCP tool at `sql` / `read` (it would reopen
 * `.minerva/conversations/*` and `.minerva/secrets.json` to a planted note).
 * `tests/cli/mcp-agent-guard.test.ts` fails if an MCP tool reaches either.
 */
export interface Engine {
  query(sparql: string): Promise<ExecResult>;
  /** The USER's own SQL (the `minerva sql` CLI command): unguarded, on the
   *  root-locked connection. Never call this with agent-authored SQL. */
  sql(sql: string): Promise<ExecResult>;
  /** Agent-authored SQL (MCP `sql_query`): registered tables and views only,
   *  never a file — `tables.runAgentQuery`, the #2442 allowlist (#2452). */
  agentSql(sql: string): Promise<ExecResult>;
  search(text: string, limit?: number): Promise<ExecResult>;
  semantic(text: string, limit?: number): Promise<ExecResult>;
  /** Exact literal / regex search over raw note text (like grep) — matches
   *  grounded with note path + line number. Complements `search` (word-based
   *  full-text) and `semantic` (meaning); the tool for exact strings, symbols,
   *  and structural patterns. */
  grep(pattern: string, opts?: GrepOptions): Promise<ExecResult>;
  /** The USER's own read (the `minerva read` CLI command): any in-root path. */
  read(relativePath: string): Promise<ExecResult>;
  /** Agent-requested read (MCP `read_note`): as `read`, but refuses a path
   *  with an ignored or hidden segment — `.minerva/` (transcripts,
   *  `secrets.json`), `.git/`, `node_modules/`, dotfiles — the same entries
   *  every listing, index and search already skips (#2452). */
  agentRead(relativePath: string): Promise<ExecResult>;
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
  /** Absolute path to the bundled `resources/` dir. The CLI passes
   *  `bundledResourcesRoot()` (#2410) so semantic search finds the model
   *  regardless of the caller's cwd, packaged or not; the app omits it (the
   *  shared embedder resolves the same root itself) and tests inject a fake
   *  embedder instead. */
  resourcesBase?: string | undefined;
}

function sqlResult(result: tables.QueryResult): ExecResult {
  return result.ok
    ? { ok: true, data: { columns: result.columns, rows: result.rows } }
    : { ok: false, error: result.error };
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
    // Captioned markdown tables register after CSVs — CSV wins on a name clash.
    await tables.registerAllNoteTables(ctx);
  })());
  const ensureVectors = () => (vectorsReady ??= (async () => {
    await ensureMinervaDir();
    await vectors.init(ctx, { embedder: opts.embedder ?? getSharedEmbedder(opts.resourcesBase) });
  })());

  async function readPath(relativePath: string): Promise<ExecResult> {
    try {
      const content = await readFile(ctx.rootPath, relativePath);
      return { ok: true, data: { path: relativePath, content } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    async query(sparql) {
      await ensureGraph();
      const r = await graph.queryGraph(ctx, sparql);
      return r.ok ? { ok: true, data: { columns: r.columns, results: r.results } } : { ok: false, error: r.error };
    },
    async sql(sql) {
      // User-typed (CLI) — deliberately unguarded; see the note on `Engine`.
      await ensureTables();
      return sqlResult(await tables.runQuery(ctx, sql));
    },
    async agentSql(sql) {
      // Agent-authored (MCP) — guarded; see the note on `Engine`.
      await ensureTables();
      return sqlResult(await tables.runAgentQuery(ctx, sql));
    },
    async search(text, limit) {
      await ensureSearch();
      const hits = await search.search(ctx, text, limit ? { limit } : undefined);
      return { ok: true, data: { query: text, hits } };
    },
    async semantic(text, limit) {
      await ensureVectors();
      const hits = await vectors.searchRelated(ctx, text, limit ? { limit } : {});
      const data: Record<string, unknown> = { query: text, hits };
      if (hits.length === 0) data.note = SEMANTIC_EMPTY_NOTE;
      return { ok: true, data };
    },
    async grep(pattern, opts = {}) {
      if (typeof pattern !== 'string' || pattern.trim() === '') {
        return { ok: false, error: 'pattern is required' };
      }
      const regex = opts.regex === true;
      const caseSensitive = opts.caseSensitive === true;
      const cap = Math.min(
        opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : GREP_DEFAULT_LIMIT,
        GREP_MAX_LIMIT,
      );
      // searchInNotes reads the vault directly (no index), so no ensure* step.
      // Uncapped on purpose (#2220): `total` is reported to the caller and
      // `truncated` is derived from it, so a scan cap would make both a guess.
      const { files, totalMatches: total } = await searchInNotes(ctx.rootPath, { pattern, caseSensitive, regex });
      const matches: { path: string; line: number; text: string }[] = [];
      outer: for (const f of files) {
        for (const m of f.matches) {
          if (matches.length >= cap) break outer;
          matches.push({ path: f.relativePath, line: m.line, text: m.lineText.slice(0, 200) });
        }
      }
      return {
        ok: true,
        data: { pattern, regex, caseSensitive, total, truncated: matches.length < total, matches },
      };
    },
    read: readPath,
    async agentRead(relativePath) {
      if (typeof relativePath !== 'string' || !relativePath) {
        return { ok: false, error: 'relative_path is required' };
      }
      // The shared agent-path guard (#2453): the path as spelled AND where it
      // really lands, since an in-root symlink (`notes/x.json →
      // ../.minerva/secrets.json`) passes the containment check by design.
      // An `outside` verdict falls through to `readPath`, whose traversal
      // error is the answer the CLI has always given.
      if (agentPathRefusal(ctx.rootPath, relativePath) === 'hidden') {
        return {
          ok: false,
          error:
            `Refused: "${relativePath}" is inside a hidden or Minerva-internal folder (such as .minerva/), ` +
            'which read_note cannot read. Read notes by the paths search_notes, grep_notes and ' +
            'gather_context return.',
        };
      }
      return readPath(relativePath);
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
      const hits = await search.search(ctx, t, { limit: n });
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
      // Load the on-disk snapshot fresh — NOT the read path's `indexAllNotes`
      // store, which resets to note-derived triples and would drop existing
      // proposals — so filing preserves everything already in graph.ttl. Then
      // invalidate the read memo so a later query re-indexes against the store
      // we're about to mutate. (The app path skips this: the substrate server
      // files against its already-live store instead — #1524.)
      await graph.initGraph(ctx);
      graphReady = undefined;
      return fileNoteProposal(ctx, input);
    },
  };
}
