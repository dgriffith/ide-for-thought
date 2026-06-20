/**
 * Loopback HTTP ingest endpoint for the browser clipper (#222 → #790).
 *
 * The clipper extension can't reach the renderer's IPC bridge, so the main
 * process exposes a tiny HTTP server bound to `127.0.0.1`. The browser POSTs
 * the page it's looking at — `{ url, html, selection?, pageTitle }` — and we
 * run it through the *same* extraction the in-app "Ingest URL…" uses, minus
 * the fetch (the browser already has the authenticated HTML, so paywalled
 * pages work).
 *
 * This module is the transport only — generic and dependency-injected so it's
 * unit-testable without touching the filesystem or Electron. The real
 * extraction wiring lives in `clipper-ingest.ts`; lifecycle + secret issuance
 * in `lifecycle.ts`.
 *
 * Security posture for this slice (#790):
 *   - bound to loopback only;
 *   - every request gated on a shared-secret header (constant-time compare);
 *   - a permissive CORS reflection so the extension's cross-origin fetch
 *     works. Tightening to a per-extension origin allowlist + the pairing
 *     UX that distributes the secret is #791.
 */

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export interface ClipperPayload {
  /** The page URL — enables site-handler metadata + a bibo:uri on the source. */
  url?: string;
  /** Rendered HTML as the browser sees it. Required. */
  html: string;
  /** Page title, used as a fallback when extraction can't find one. */
  pageTitle?: string;
  /** Selected text → filed as a linked thought:Excerpt when present. */
  selection?: string;
}

export interface ClipperIngestOutcome {
  sourceId: string;
  relativePath: string;
  duplicate: boolean;
  title?: string;
  kind?: string;
  /** Set when a selection was supplied and an excerpt was filed. */
  excerptId?: string;
  excerptDuplicate?: boolean;
}

export type ClipperIngestFn = (
  payload: ClipperPayload,
  rootPath: string,
) => Promise<ClipperIngestOutcome>;

export interface ClipperListenerOptions {
  /** Shared secret required in the `x-minerva-clipper-secret` header. */
  secret: string;
  /** Which open thoughtbase a clip lands in — null when none is open. */
  resolveRootPath: () => string | null;
  /** Does the extraction + write. Injected so the transport stays pure. */
  ingest: ClipperIngestFn;
  /** Reject bodies larger than this (default 32 MB). */
  maxBodyBytes?: number;
}

export interface ClipperServerHandle {
  port: number;
  secret: string;
  close: () => Promise<void>;
}

export const SECRET_HEADER = 'x-minerva-clipper-secret';
const DEFAULT_MAX_BODY = 32 * 1024 * 1024;

/** Length-safe, constant-time secret comparison. */
function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Reflect the requesting origin (a chrome-extension:// URL). The secret
  // header is the real gate; #791 narrows this to a paired-extension allowlist.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${SECRET_HEADER}`);
  res.setHeader('Access-Control-Max-Age', '600');
}

function tooLarge(): Error & { statusCode: number } {
  return Object.assign(new Error('Payload too large'), { statusCode: 413 });
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Reject but don't destroy the socket — we still want to flush a clean
        // 413 response, which an abrupt socket teardown would race away.
        overflowed = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!overflowed) resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

/**
 * Build the `(req, res)` listener. Exposed separately from the server so tests
 * can drive it directly or over an ephemeral port.
 */
export function createClipperRequestListener(
  opts: ClipperListenerOptions,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const maxBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return (req, res) => {
    void (async () => {
      applyCors(req, res);

      // Preflight — answered before the secret check so the browser can send
      // the real, secret-bearing request.
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!secretsMatch(req.headers[SECRET_HEADER] as string | undefined, opts.secret)) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const url = req.url ?? '/';

      // Health/pairing probe — lets the extension verify the secret + see
      // whether a thoughtbase is currently open.
      if (req.method === 'GET' && url === '/ping') {
        sendJson(res, 200, { ok: true, projectOpen: opts.resolveRootPath() != null });
        return;
      }

      if (req.method === 'POST' && url === '/ingest') {
        // Fast-path rejection on a declared oversized body — avoids reading it.
        const declared = Number(req.headers['content-length'] ?? '0');
        if (Number.isFinite(declared) && declared > maxBytes) {
          sendJson(res, 413, { error: 'Payload too large' });
          return;
        }

        let payload: ClipperPayload;
        try {
          const raw = await readBody(req, maxBytes);
          payload = JSON.parse(raw) as ClipperPayload;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 400;
          sendJson(res, status, { error: status === 413 ? 'Payload too large' : 'Invalid JSON body' });
          return;
        }

        if (typeof payload?.html !== 'string' || payload.html.trim() === '') {
          sendJson(res, 400, { error: 'Missing `html` in payload' });
          return;
        }

        const rootPath = opts.resolveRootPath();
        if (!rootPath) {
          sendJson(res, 503, { error: 'No thoughtbase open' });
          return;
        }

        try {
          const outcome = await opts.ingest(payload, rootPath);
          sendJson(res, 200, outcome);
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    })();
  };
}

/**
 * Start the loopback server. Prefers `port`; on `EADDRINUSE` falls back to an
 * OS-assigned ephemeral port so a stale instance / port clash can't wedge the
 * feature (the actual port is reported back for pairing).
 */
export function startClipperServer(
  opts: ClipperListenerOptions & { port?: number },
): Promise<ClipperServerHandle> {
  const listener = createClipperRequestListener(opts);

  return new Promise((resolve, reject) => {
    const server = http.createServer(listener);
    let triedFallback = false;

    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !triedFallback) {
        triedFallback = true;
        server.listen(0, '127.0.0.1');
        return;
      }
      server.removeListener('error', onError);
      reject(err);
    };
    server.on('error', onError);

    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        secret: opts.secret,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
