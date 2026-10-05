/**
 * The clipper pins its paired extension and proves itself before the
 * extension sends the secret (#2567).
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { startClipperServer, SECRET_HEADER, type ClipperServerHandle } from '../../../src/main/clipper/clipper-server';
import { CLIPPER_CHALLENGE_HEADER, clipperProofMessage } from '../../../src/shared/clipper-pairing';

const SECRET = 'pairing-secret-xyz';
let server: ClipperServerHandle | null = null;
let pinned: string | null = null;

afterEach(async () => { await server?.close(); server = null; pinned = null; });

async function start(): Promise<number> {
  server = await startClipperServer({
    secret: SECRET,
    resolveRootPath: () => '/tmp/p',
    ingest: async () => ({ sourceId: 's', relativePath: 'r', duplicate: false, title: 't', kind: 'web' }),
    preview: () => ({ sourceId: 's', method: 'url', title: 't' }),
    pairedOrigin: { get: async () => pinned, pin: async (o) => { pinned = o; } },
    port: 0,
  });
  return server.port;
}

function get(port: number, headers: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/ping', headers }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) as Record<string, unknown> : {} }));
    }).on('error', reject);
  });
}

describe('clipper server proof (#2567)', () => {
  it('answers a secret-less challenge with HMAC(secret, nonce + its own port) — and nothing else', async () => {
    const port = await start();
    const nonce = 'a'.repeat(32);
    const r = await get(port, { [CLIPPER_CHALLENGE_HEADER]: nonce });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ proof: createHmac('sha256', SECRET).update(clipperProofMessage(nonce, port)).digest('hex') });
  });

  it('rejects a malformed challenge', async () => {
    const port = await start();
    expect((await get(port, { [CLIPPER_CHALLENGE_HEADER]: 'not hex!' })).status).toBe(400);
  });

  it('without a challenge or the secret, still 401', async () => {
    const port = await start();
    expect((await get(port, {})).status).toBe(401);
  });
});

describe('clipper extension-origin pin (#2567)', () => {
  it('pins the first authenticated extension origin and refuses any other', async () => {
    const port = await start();
    const A = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const B = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect((await get(port, { [SECRET_HEADER]: SECRET, origin: A })).status).toBe(200);
    expect(pinned).toBe(A);
    const other = await get(port, { [SECRET_HEADER]: SECRET, origin: B });
    expect(other.status).toBe(403);
    expect(String(other.body.error)).toMatch(/not the one paired/);
    expect((await get(port, { [SECRET_HEADER]: SECRET, origin: A })).status).toBe(200);
    // A raw client with the secret (no Origin) isn't an extension: neither pinned nor refused.
    expect((await get(port, { [SECRET_HEADER]: SECRET })).status).toBe(200);
  });

  it('an unauthenticated request from an extension does not pin it', async () => {
    const port = await start();
    await get(port, { [SECRET_HEADER]: 'wrong', origin: 'chrome-extension://cccccccccccccccccccccccccccccccc' });
    expect(pinned).toBeNull();
  });
});
