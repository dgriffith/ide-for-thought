/**
 * Extension → app transport (#792). `fetch` is injected, so the request shape
 * (URL, secret header, body) and the response → ClipResult mapping are tested
 * without a browser or a live server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { sendClip, ping, preview, verifyServer, _resetVerifiedServersForTests } from '../../clipper/src/ingest';
import { clipperProofMessage } from '../../src/shared/clipper-pairing';
import type { ClipPayload } from '../../clipper/src/payload';

const PAIRING = { v: 1 as const, port: 41599, secret: 'sekret' };
const PAYLOAD: ClipPayload = { url: 'https://example.com/a', html: '<h1>Hi</h1>', pageTitle: 'A' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CHALLENGE = 'x-minerva-clipper-challenge';
const challengeOf = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.[CHALLENGE];

/** Answers the server-proof challenge like the real app at `port` (#2567);
 *  every other request goes to `inner`, whose mock.calls stay the real ones. */
function proving(inner: (url: string, init?: RequestInit) => Promise<Response>, port = PAIRING.port, secret = PAIRING.secret): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const nonce = challengeOf(init);
    if (nonce) return jsonResponse(200, { proof: createHmac('sha256', secret).update(clipperProofMessage(nonce, port)).digest('hex') });
    return inner(url, init);
  }) as unknown as typeof fetch;
}

beforeEach(() => _resetVerifiedServersForTests());

describe('sendClip', () => {
  it('POSTs to the loopback /ingest with the secret header and maps the result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      sourceId: 'url-abc', duplicate: false, title: 'A Page', excerptId: 'url-abc-deadbeef',
    }));
    const result = await sendClip(PAIRING, { ...PAYLOAD, selection: 'quote' }, proving(fetchImpl));

    expect(result).toEqual({ ok: true, sourceId: 'url-abc', duplicate: false, title: 'A Page', excerptId: 'url-abc-deadbeef' });
    const [calledUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://127.0.0.1:41599/ingest');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-minerva-clipper-secret']).toBe('sekret');
    expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://example.com/a', selection: 'quote' });
  });

  it('maps a server error response to ok:false with the reason', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: 'No thoughtbase open' }));
    const result = await sendClip(PAIRING, PAYLOAD, proving(fetchImpl));
    expect(result).toEqual({ ok: false, error: 'No thoughtbase open' });
  });

  it('maps a network failure to a friendly error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const result = await sendClip(PAIRING, PAYLOAD, proving(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reachable/i);
  });
});

describe('preview', () => {
  it('POSTs to /preview and maps the source-id result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      sourceId: 'arxiv-2604.18561', method: 'arxiv', title: 'Some Paper',
    }));
    const result = await preview(PAIRING, { url: 'https://arxiv.org/abs/2604.18561', html: '<h1>x</h1>' }, proving(fetchImpl));
    expect(result).toEqual({ ok: true, sourceId: 'arxiv-2604.18561', method: 'arxiv', title: 'Some Paper' });
    const [calledUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://127.0.0.1:41599/preview');
  });

  it('maps an error response to ok:false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'Missing `html` in payload' }));
    const result = await preview(PAIRING, { url: 'x', html: '' }, proving(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/html/i);
  });
});

describe('sendClip — tags + note (#793)', () => {
  it('includes tags and note in the POST body when present', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sourceId: 'url-abc', duplicate: false }));
    await sendClip(PAIRING, { ...PAYLOAD, tags: ['ai', 'ml'], note: 'read later' }, proving(fetchImpl));
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ tags: ['ai', 'ml'], note: 'read later' });
  });
});

describe('ping', () => {
  it('reports projectOpen on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, projectOpen: true }));
    expect(await ping(PAIRING, proving(fetchImpl))).toEqual({ ok: true, projectOpen: true });
  });

  it('flags a rejected secret distinctly', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' }));
    const result = await ping(PAIRING, proving(fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/re-pair/i);
  });
});

describe('verifyServer — the server proves it holds the secret before the secret is sent (#2567)', () => {
  it('accepts the real app, once per pairing', async () => {
    const inner = vi.fn(async () => jsonResponse(200, { ok: true, projectOpen: true }));
    expect(await verifyServer(PAIRING, proving(inner))).toBeNull();
    const second = vi.fn();
    expect(await verifyServer(PAIRING, second as unknown as typeof fetch)).toBeNull(); // cached
    expect(second).not.toHaveBeenCalled();
  });

  it('an impostor on the paired port (wrong or missing proof) never receives the secret or the page', async () => {
    const calls: RequestInit[] = [];
    const impostor = (async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return jsonResponse(200, { proof: 'deadbeef', ok: true });
    }) as unknown as typeof fetch;
    const result = await sendClip(PAIRING, PAYLOAD, impostor);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Something other than Minerva/);
    expect(calls).toHaveLength(1); // the challenge only
    expect(JSON.stringify(calls)).not.toContain(PAIRING.secret);
  });

  it('a proof relayed from the real Minerva on another port is refused', async () => {
    const relay = proving(vi.fn(), 52001); // the real app, listening elsewhere
    expect(await verifyServer(PAIRING, relay)).toMatch(/Something other than Minerva/);
  });

  it('an app from before the challenge (401 on a secret-less ping) still works', async () => {
    const inner = vi.fn(async (_u: string, init?: RequestInit) =>
      challengeOf(init) ? jsonResponse(401, { error: 'Unauthorized' }) : jsonResponse(200, { ok: true, projectOpen: false }));
    expect(await ping(PAIRING, inner as unknown as typeof fetch)).toEqual({ ok: true, projectOpen: false });
  });
});
