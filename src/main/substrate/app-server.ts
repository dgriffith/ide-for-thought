/**
 * The app side of route-through-the-running-app (#1524, epic #1145).
 *
 * While a thoughtbase is open, the app runs a single loopback HTTP server and,
 * for each open project, writes a `.minerva/runtime.json` advert pointing a
 * CLI/MCP client at it. Requests are dispatched against the project's already-
 * live `ProjectContext`, so:
 *   - a proposal files through the app's own approval gate (single writer on the
 *     graph — no lost-update race, and it fires `PROPOSALS_CHANGED`), and
 *   - semantic search runs against the DuckDB the app already holds open (no
 *     second opener → no `Conflicting lock`, closing #1272).
 *
 * The server binds `127.0.0.1` only and gates every request on a per-project
 * random token, so nothing off-box (and no untokened local process) can drive
 * the app. Lifecycle is owned by `project-context.ts`: `registerProject` on
 * first-open, `unregisterProject` on last-close.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as vectors from '../embeddings/vector-store';
import { fileNoteProposal } from '../llm/propose-note';
import type { ProjectContext } from '../project-context-types';
import {
  RUNTIME_FILE,
  formatSemantic,
  type RuntimeAdvert,
  type SubstrateResponse,
} from './protocol';
import { logger } from '../../shared/logger';

interface ProjectEntry {
  token: string;
  ctx: ProjectContext;
}

/** rootPath → { token, live ctx }. Also the set of projects we'll answer for. */
const registry = new Map<string, ProjectEntry>();

let server: http.Server | null = null;
let listeningPort: number | null = null;
/** In-flight `ensureServer()` so concurrent first-opens share one bind. */
let starting: Promise<number> | null = null;
/** Count of authenticated requests dispatched — lets tests prove a call routed
 *  through the app rather than falling back to the direct path. */
let dispatchedCount = 0;

function advertPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', RUNTIME_FILE);
}

async function ensureServer(): Promise<number> {
  if (listeningPort != null) return listeningPort;
  if (starting) return starting;
  starting = new Promise<number>((resolve, reject) => {
    const srv = http.createServer(handleRequest);
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      if (port == null) {
        reject(new Error('substrate server: could not resolve listening port'));
        return;
      }
      server = srv;
      listeningPort = port;
      resolve(port);
    });
  });
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/**
 * Start advertising `ctx`'s project to out-of-process clients. Idempotent per
 * rootPath — re-registering just refreshes the advert (e.g. after a restart on
 * the same port). Failure to advertise is non-fatal: the app works fine without
 * it, and clients simply fall back to opening state directly.
 */
export async function registerProject(ctx: ProjectContext): Promise<void> {
  try {
    const port = await ensureServer();
    const token = crypto.randomBytes(24).toString('hex');
    registry.set(ctx.rootPath, { token, ctx });
    const advert: RuntimeAdvert = {
      pid: process.pid,
      port,
      token,
      startedAt: new Date().toISOString(),
    };
    await fs.writeFile(advertPath(ctx.rootPath), JSON.stringify(advert, null, 2), 'utf-8');
  } catch (err) {
    logger('substrate').warn(
      `failed to advertise ${ctx.rootPath}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Stop advertising a project (last window closed). Removes its advert + token
 * and, once no projects remain, tears the server down so nothing lingers.
 */
export async function unregisterProject(rootPath: string): Promise<void> {
  registry.delete(rootPath);
  try {
    await fs.rm(advertPath(rootPath), { force: true });
  } catch {
    /* best-effort — a missing advert is fine */
  }
  if (registry.size === 0 && server) {
    const srv = server;
    server = null;
    listeningPort = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
}

function sendJson(res: http.ServerResponse, status: number, body: SubstrateResponse): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== 'POST' || req.url !== '/rpc') {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('error', () => {
    try {
      res.writeHead(400).end();
    } catch {
      /* connection already gone */
    }
  });
  req.on('end', () => {
    void (async () => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      const rootPath = typeof body.rootPath === 'string' ? body.rootPath : '';
      const entry = registry.get(rootPath);
      // Constant contract: unknown project and bad token look the same to a
      // client (403) — no oracle for "is this project open".
      if (!entry || entry.token !== body.token) {
        sendJson(res, 403, { ok: false, error: 'unknown project or invalid token' });
        return;
      }
      const op = body.op;
      const args = (body.args ?? {}) as Record<string, unknown>;
      dispatchedCount++;
      try {
        sendJson(res, 200, await dispatch(entry.ctx, op, args));
      } catch (err) {
        // Handler failures ride in the body (like the Engine's ExecResult), not
        // the HTTP status — 200 means "the app processed it", ok:false means the
        // op failed.
        sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}

async function dispatch(
  ctx: ProjectContext,
  op: unknown,
  args: Record<string, unknown>,
): Promise<SubstrateResponse> {
  switch (op) {
    case 'proposeNote':
      // Files against the app's LIVE store (no initGraph) so it can't clobber —
      // and emits PROPOSALS_CHANGED via the approval engine's event.
      return fileNoteProposal(ctx, {
        relativePath: typeof args.relativePath === 'string' ? args.relativePath : '',
        content: typeof args.content === 'string' ? args.content : '',
        note: typeof args.note === 'string' ? args.note : undefined,
        proposedBy: typeof args.proposedBy === 'string' && args.proposedBy ? args.proposedBy : 'cli',
      });
    case 'semantic': {
      const text = typeof args.text === 'string' ? args.text : '';
      const limit = typeof args.limit === 'number' && args.limit > 0 ? { limit: args.limit } : {};
      const hits = await vectors.searchRelated(ctx, text, limit);
      return formatSemantic(text, hits);
    }
    default:
      return { ok: false, error: `unknown substrate op: ${String(op)}` };
  }
}

/** Test-only: the port the server is bound to (null if not started). */
export function _listeningPortForTest(): number | null {
  return listeningPort;
}

/** Test-only: how many authenticated requests the server has dispatched. */
export function _dispatchedCountForTest(): number {
  return dispatchedCount;
}
