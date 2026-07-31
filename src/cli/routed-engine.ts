/**
 * The client side of route-through-the-running-app (#1524, epic #1145).
 *
 * `createRoutedEngine` wraps the direct `Engine` and, for the two ops that must
 * not race a running app — `proposeNote` (single writer on the graph) and
 * `semantic` (the DuckDB lock-holder, #1272) — checks for a live app advert on
 * the thoughtbase. If one is present, it POSTs the op to the app and returns its
 * response verbatim (identical shape to the direct result). Otherwise, or on any
 * transport failure / stale advert, it falls back to the direct in-process path
 * exactly as before — so a closed app changes nothing.
 *
 * Every other op (query/search/sql/grep/read/context) is read-only or in-memory
 * and passes straight through to the direct engine, unrouted.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectContext } from '../main/project-context-types';
import { createEngine, type Engine, type EngineOptions, type ExecResult } from './engine';
import {
  RUNTIME_FILE,
  type RuntimeAdvert,
  type SubstrateOp,
  type SubstrateResponse,
} from '../main/substrate/protocol';

async function readAdvert(rootPath: string): Promise<RuntimeAdvert | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, '.minerva', RUNTIME_FILE), 'utf-8');
    const advert = JSON.parse(raw) as RuntimeAdvert;
    if (
      typeof advert.pid !== 'number' ||
      typeof advert.port !== 'number' ||
      typeof advert.token !== 'string'
    ) {
      return null;
    }
    return advert;
  } catch {
    return null; // no advert → app isn't open on this thoughtbase
  }
}

/** Is the advertised app process still alive? A dead pid means a stale advert
 *  left by a crash/hard-kill — treat as "app not open" and go direct. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, kills nothing
    return true;
  } catch (err) {
    // EPERM = the process exists but is owned by another user — still "alive".
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * POST an op to the running app. Resolves the app's `SubstrateResponse` on a
 * clean 200, or `null` on any transport-level failure (connection refused, non-
 * 200, unparseable body) so the caller falls back to the direct path.
 */
function callApp(
  advert: RuntimeAdvert,
  rootPath: string,
  op: SubstrateOp,
  args: Record<string, unknown>,
): Promise<SubstrateResponse | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ rootPath, token: advert.token, op, args });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: advert.port,
        path: '/rpc',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(null); // 403 (stale/unknown) / 404 / 5xx → fall back to direct
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SubstrateResponse);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null)); // connection refused → app gone since advert
    req.write(payload);
    req.end();
  });
}

/**
 * Route `op` to the app if one is live on `rootPath`; otherwise return null so
 * the caller runs the op directly. Returns the app's result (typed as
 * `ExecResult` — structurally identical to `SubstrateResponse`).
 */
async function tryRoute(
  rootPath: string,
  op: SubstrateOp,
  args: Record<string, unknown>,
): Promise<ExecResult | null> {
  const advert = await readAdvert(rootPath);
  if (!advert || !isPidAlive(advert.pid)) return null;
  // `SubstrateResponse` is structurally identical to `ExecResult`.
  return callApp(advert, rootPath, op, args);
}

export function createRoutedEngine(ctx: ProjectContext, opts: EngineOptions = {}): Engine {
  const direct = createEngine(ctx, opts);
  return {
    ...direct,
    async semantic(text, limit) {
      const routed = await tryRoute(ctx.rootPath, 'semantic', { text, limit });
      return routed ?? direct.semantic(text, limit);
    },
    async proposeNote(input) {
      const routed = await tryRoute(ctx.rootPath, 'proposeNote', { ...input });
      return routed ?? direct.proposeNote(input);
    },
  };
}
