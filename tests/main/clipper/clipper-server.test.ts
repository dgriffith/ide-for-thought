/**
 * Clipper loopback ingest server (#790) — the transport. Driven over a real
 * ephemeral port with an injected fake `ingest`, so every branch (secret gate,
 * preflight, routing, validation, no-project, error) is exercised end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startClipperServer,
  SECRET_HEADER,
  type ClipperServerHandle,
  type ClipperIngestFn,
} from '../../../src/main/clipper/clipper-server';

const SECRET = 'test-secret-abc';

let server: ClipperServerHandle;
let rootPath: string | null;
let ingest: ReturnType<typeof vi.fn> & ClipperIngestFn;

async function start(opts: { maxBodyBytes?: number } = {}) {
  server = await startClipperServer({
    secret: SECRET,
    resolveRootPath: () => rootPath,
    ingest,
    port: 0,
    maxBodyBytes: opts.maxBodyBytes,
  });
}

function url(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

beforeEach(() => {
  rootPath = '/tmp/project';
  ingest = vi.fn(async () => ({
    sourceId: 'url-abc123',
    relativePath: '.minerva/sources/url-abc123/meta.ttl',
    duplicate: false,
    title: 'Clipped Page',
    kind: 'web',
  })) as ReturnType<typeof vi.fn> & ClipperIngestFn;
});

afterEach(async () => {
  await server?.close();
});

describe('auth', () => {
  it('rejects a request with no secret header (401)', async () => {
    await start();
    const res = await fetch(url('/ingest'), { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret (401)', async () => {
    await start();
    const res = await fetch(url('/ingest'), {
      method: 'POST',
      headers: { [SECRET_HEADER]: 'nope' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('answers an OPTIONS preflight without a secret (204 + CORS)', async () => {
    await start();
    const res = await fetch(url('/ingest'), { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(SECRET_HEADER);
  });
});

describe('routing', () => {
  it('GET /ping reports project-open status', async () => {
    await start();
    const res = await fetch(url('/ping'), { headers: { [SECRET_HEADER]: SECRET } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, projectOpen: true });

    rootPath = null;
    const res2 = await fetch(url('/ping'), { headers: { [SECRET_HEADER]: SECRET } });
    expect((await res2.json()).projectOpen).toBe(false);
  });

  it('returns 404 for an unknown route', async () => {
    await start();
    const res = await fetch(url('/nope'), { headers: { [SECRET_HEADER]: SECRET } });
    expect(res.status).toBe(404);
  });
});

describe('POST /ingest', () => {
  function post(body: unknown) {
    return fetch(url('/ingest'), {
      method: 'POST',
      headers: { [SECRET_HEADER]: SECRET, 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('ingests a payload and returns the outcome', async () => {
    await start();
    const res = await post({ url: 'https://example.com/a', html: '<h1>Hi</h1>', pageTitle: 'A' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sourceId: 'url-abc123', duplicate: false });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/a', html: '<h1>Hi</h1>', pageTitle: 'A' }),
      '/tmp/project',
    );
  });

  it('rejects a payload with no html (400)', async () => {
    await start();
    const res = await post({ url: 'https://example.com/a' });
    expect(res.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON (400)', async () => {
    await start();
    const res = await post('{not json');
    expect(res.status).toBe(400);
  });

  it('returns 503 when no thoughtbase is open', async () => {
    await start();
    rootPath = null;
    const res = await post({ html: '<h1>Hi</h1>' });
    expect(res.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('surfaces an ingest failure as 500', async () => {
    await start();
    ingest.mockRejectedValueOnce(new Error('disk full'));
    const res = await post({ html: '<h1>Hi</h1>' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('disk full');
  });

  it('rejects an over-sized body (413)', async () => {
    await start({ maxBodyBytes: 100 });
    const res = await post({ html: 'x'.repeat(500) });
    expect(res.status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
  });
});
