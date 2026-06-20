/**
 * Extension → app transport (#792). `fetch` is injected, so the request shape
 * (URL, secret header, body) and the response → ClipResult mapping are tested
 * without a browser or a live server.
 */

import { describe, it, expect, vi } from 'vitest';
import { sendClip, ping, preview } from '../../clipper/src/ingest';
import type { ClipPayload } from '../../clipper/src/payload';

const PAIRING = { v: 1 as const, port: 41599, secret: 'sekret' };
const PAYLOAD: ClipPayload = { url: 'https://example.com/a', html: '<h1>Hi</h1>', pageTitle: 'A' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('sendClip', () => {
  it('POSTs to the loopback /ingest with the secret header and maps the result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      sourceId: 'url-abc', duplicate: false, title: 'A Page', excerptId: 'url-abc-deadbeef',
    }));
    const result = await sendClip(PAIRING, { ...PAYLOAD, selection: 'quote' }, fetchImpl);

    expect(result).toEqual({ ok: true, sourceId: 'url-abc', duplicate: false, title: 'A Page', excerptId: 'url-abc-deadbeef' });
    const [calledUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://127.0.0.1:41599/ingest');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-minerva-clipper-secret']).toBe('sekret');
    expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://example.com/a', selection: 'quote' });
  });

  it('maps a server error response to ok:false with the reason', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: 'No thoughtbase open' }));
    const result = await sendClip(PAIRING, PAYLOAD, fetchImpl);
    expect(result).toEqual({ ok: false, error: 'No thoughtbase open' });
  });

  it('maps a network failure to a friendly error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const result = await sendClip(PAIRING, PAYLOAD, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reachable/i);
  });
});

describe('preview', () => {
  it('POSTs to /preview and maps the source-id result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      sourceId: 'arxiv-2604.18561', method: 'arxiv', title: 'Some Paper',
    }));
    const result = await preview(PAIRING, { url: 'https://arxiv.org/abs/2604.18561', html: '<h1>x</h1>' }, fetchImpl);
    expect(result).toEqual({ ok: true, sourceId: 'arxiv-2604.18561', method: 'arxiv', title: 'Some Paper' });
    const [calledUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://127.0.0.1:41599/preview');
  });

  it('maps an error response to ok:false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'Missing `html` in payload' }));
    const result = await preview(PAIRING, { url: 'x', html: '' }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/html/i);
  });
});

describe('sendClip — tags + note (#793)', () => {
  it('includes tags and note in the POST body when present', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sourceId: 'url-abc', duplicate: false }));
    await sendClip(PAIRING, { ...PAYLOAD, tags: ['ai', 'ml'], note: 'read later' }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ tags: ['ai', 'ml'], note: 'read later' });
  });
});

describe('ping', () => {
  it('reports projectOpen on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, projectOpen: true }));
    expect(await ping(PAIRING, fetchImpl)).toEqual({ ok: true, projectOpen: true });
  });

  it('flags a rejected secret distinctly', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' }));
    const result = await ping(PAIRING, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/re-pair/i);
  });
});
