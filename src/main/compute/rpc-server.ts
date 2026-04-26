/**
 * Minerva Python library RPC server (#242).
 *
 * One Unix domain socket per project. The Python kernel for that project
 * connects with `MINERVA_IPC_SOCKET=<path>`; the bundled `minerva` package
 * inside the kernel marshals method calls (sparql, sql, notes.read, …) as
 * line-delimited JSON-RPC over that socket. Main dispatches each method
 * to the existing service it would have used for the renderer — same
 * graph queries, same DuckDB session, same fs guards — so a SPARQL
 * query in a Python cell returns the same rows as the same query in
 * the Query Panel.
 *
 * Wire format (one JSON object per line):
 *   request:  {"id": <number>, "method": "sparql", "params": {...}}
 *   response: {"id": <number>, "result": <any>}
 *           | {"id": <number>, "error": {"code": "...", "message": "..."}}
 *
 * Lifecycle: created when a project's Python kernel is spawned, stopped
 * when the kernel is. One server per project means the socket itself
 * carries the project identity — no need to re-thread `rootPath` on
 * every call.
 */

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import * as graph from '../graph/index';
import * as tables from '../sources/tables';
import * as search from '../search/index';
import * as notebaseFs from '../notebase/fs';
import { parseMarkdown } from '../graph/parser';
import { projectContext } from '../project-context-types';

interface RpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcSuccess {
  id: number;
  result: unknown;
}

interface RpcFailure {
  id: number;
  error: { code: string; message: string };
}

type RpcMethod = (rootPath: string, params: Record<string, unknown>) => unknown;

class RpcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function notFound(message: string): never {
  throw new RpcError('NotFoundError', message);
}

function queryError(message: string): never {
  throw new RpcError('QueryError', message);
}

function asString(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new RpcError('TypeError', `${name} must be a string`);
  return v;
}

const methods: Record<string, RpcMethod> = {
  // ── Graph / SQL ───────────────────────────────────────────────────
  sparql: async (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const query = asString(params.query, 'query');
    const r = (await graph.queryGraph(ctx, query)) as { results: unknown[]; error?: string };
    if (r.error) queryError(r.error);
    return { rows: r.results };
  },

  sql: async (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const query = asString(params.query, 'query');
    const r = await tables.runQuery(ctx, query);
    if (!r.ok) queryError(r.error);
    // Strip the discriminant so Python sees a clean { columns, rows }.
    return { columns: r.columns, rows: serializeForJson(r.rows) };
  },

  // ── Notes ─────────────────────────────────────────────────────────
  'notes.read': async (rootPath, params) => {
    const relativePath = asString(params.relativePath, 'relativePath');
    let content: string;
    try {
      content = await notebaseFs.readFile(rootPath, relativePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') notFound(`Note not found: ${relativePath}`);
      throw new RpcError('IOError', err instanceof Error ? err.message : String(err));
    }
    const parsed = parseMarkdown(content);
    // parseMarkdown.tags is body-only (#tags inline); merge frontmatter
    // tags so the Python API's `note['tags']` matches user expectations
    // ("the tags this note has", not "the tags in the body").
    const fmTags = parsed.frontmatter.tags;
    const tags = new Set(parsed.tags);
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) {
        if (typeof t === 'string') tags.add(t);
      }
    }
    return {
      relativePath,
      title: parsed.title ?? null,
      frontmatter: parsed.frontmatter,
      tags: [...tags],
      body: content,
    };
  },

  'notes.by_tag': (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const tag = asString(params.tag, 'tag');
    return graph.notesByTag(ctx, tag);
  },

  'notes.search': (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const query = asString(params.query, 'query');
    const limit = typeof params.limit === 'number' ? params.limit : 20;
    return search.search(ctx, query, { limit });
  },

  // ── Sources ───────────────────────────────────────────────────────
  'sources.get': (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const sourceId = asString(params.sourceId, 'sourceId');
    const detail = graph.getSourceDetail(ctx, sourceId);
    if (!detail) notFound(`Source not found: ${sourceId}`);
    return detail;
  },

  'sources.citing': (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const sourceId = asString(params.sourceId, 'sourceId');
    const detail = graph.getSourceDetail(ctx, sourceId);
    if (!detail) return [];
    // SourceDetail.backlinks already mixes cite + quote kinds; filter
    // to the cite-only set so Python's `sources.citing(id)` matches
    // its name.
    return detail.backlinks.filter((b) => b.kind === 'cite');
  },

  // ── Excerpts ──────────────────────────────────────────────────────
  'excerpts.for_source': (rootPath, params) => {
    const ctx = projectContext(rootPath);
    const sourceId = asString(params.sourceId, 'sourceId');
    return graph.excerptIdsForSource(ctx, sourceId);
  },
};

/** DuckDB returns BigInt for INTEGER columns; JSON.stringify can't
 *  handle them, so coerce to string here. Mirrors what the SQL
 *  executor does for the cell-output path. */
function serializeForJson(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'bigint') out[k] = v.toString();
      else if (v instanceof Date) out[k] = v.toISOString();
      else out[k] = v;
    }
    return out;
  });
}

export interface RpcServer {
  socketPath: string;
  close: () => Promise<void>;
}

/**
 * Dispatch a single method by name. Exported for unit tests so they can
 * exercise the dispatch table without standing up a socket.
 */
export async function dispatchMethod(rootPath: string, method: string, params: Record<string, unknown>): Promise<RpcSuccess | RpcFailure> {
  const fn = methods[method];
  if (!fn) {
    return { id: 0, error: { code: 'MethodNotFound', message: `Unknown RPC method: ${method}` } };
  }
  try {
    const result = await fn(rootPath, params);
    return { id: 0, result };
  } catch (err) {
    if (err instanceof RpcError) {
      return { id: 0, error: { code: err.code, message: err.message } };
    }
    return {
      id: 0,
      error: { code: 'InternalError', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Start a listening socket. Returns the path to pass to the kernel
 * via `MINERVA_IPC_SOCKET` and a close() handle the kernel adapter
 * calls when the kernel exits.
 */
export async function startRpcServer(rootPath: string): Promise<RpcServer> {
  const socketPath = path.join(
    os.tmpdir(),
    `minerva-rpc-${process.pid}-${randomBytes(4).toString('hex')}.sock`,
  );

  const server = net.createServer((conn) => {
    const rl = readline.createInterface({ input: conn });
    rl.on('line', async (line) => {
      let req: RpcRequest;
      try {
        req = JSON.parse(line);
      } catch {
        // Malformed line — caller protocol bug. Drop it; the Python
        // side will time out on its own.
        return;
      }
      const dispatched = await dispatchMethod(rootPath, req.method, req.params ?? {});
      const reply: RpcSuccess | RpcFailure = 'result' in dispatched
        ? { id: req.id, result: dispatched.result }
        : { id: req.id, error: dispatched.error };
      try {
        conn.write(JSON.stringify(reply) + '\n');
      } catch {
        // Client gone — let the connection close naturally.
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // The .sock inode hangs around after close on some systems —
        // best-effort unlink so /tmp doesn't accumulate stragglers.
        // (Errors ignored: the socket may have already been removed.)
      }).then(async () => {
        try {
          const fs = await import('node:fs/promises');
          await fs.unlink(socketPath);
        } catch { /* nothing to do */ }
      }),
  };
}
