/**
 * safeFetch (#2566): untrusted URLs fetched from main can't reach the local
 * network, can't redirect there, can't run forever and can't send unbounded bytes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isBlockedAddress, safeFetch, setSafeFetchLookup, SafeFetchRefused } from '../../src/main/safe-fetch';

const PUBLIC = '93.184.216.34';

afterEach(() => setSafeFetchLookup(async () => [PUBLIC]));

/** A fetch that answers from a table, so no network is involved. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  };
}

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT, multicast and IPv6 equivalents', () => {
    for (const ip of [
      '127.0.0.1', '127.8.8.8', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::192.168.0.1',
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('safeFetch', () => {
  const opts = { timeoutMs: 2000, maxBytes: 1024 };

  it('fetches a public https URL', async () => {
    const r = await safeFetch('https://example.com/a.png', {
      ...opts,
      fetchImpl: fakeFetch({ 'https://example.com/a.png': () => new Response('img', { headers: { 'content-type': 'image/png' } }) }),
    });
    expect(r.ok).toBe(true);
    expect(r.contentType).toBe('image/png');
    expect(new TextDecoder().decode(r.bytes)).toBe('img');
  });

  it('refuses IP literals and names that resolve to private ranges — before any request', async () => {
    const fetchImpl = fakeFetch({});
    for (const url of ['https://127.0.0.1/', 'https://10.0.0.5/x', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]/']) {
      await expect(safeFetch(url, { ...opts, fetchImpl }), url).rejects.toThrow(SafeFetchRefused);
    }
    setSafeFetchLookup(async () => ['192.168.1.1']);
    await expect(safeFetch('https://router.example/', { ...opts, fetchImpl })).rejects.toThrow(/private or local address/);
    // One bad address in the answer is enough.
    setSafeFetchLookup(async () => [PUBLIC, '127.0.0.1']);
    await expect(safeFetch('https://mixed.example/', { ...opts, fetchImpl })).rejects.toThrow(/private or local/);
  });

  it('refuses a redirect into a private range, checking every hop', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/start': () => new Response(null, { status: 302, headers: { location: 'https://example.com/next' } }),
      'https://example.com/next': () => new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest' } }),
    });
    await expect(safeFetch('https://example.com/start', { ...opts, fetchImpl, protocols: ['https:', 'http:'] }))
      .rejects.toThrow(/169\.254\.169\.254/);
  });

  it('refuses a scheme the caller did not allow, including via redirect', async () => {
    await expect(safeFetch('http://example.com/', { ...opts, fetchImpl: fakeFetch({}) })).rejects.toThrow(/refusing http:/);
    const fetchImpl = fakeFetch({
      'https://example.com/r': () => new Response(null, { status: 302, headers: { location: 'http://example.com/plain' } }),
    });
    await expect(safeFetch('https://example.com/r', { ...opts, fetchImpl })).rejects.toThrow(/refusing http:/);
    await expect(safeFetch('file:///etc/passwd', { ...opts, fetchImpl })).rejects.toThrow(/refusing file:/);
  });

  it('cuts off an oversized body (declared or streamed)', async () => {
    const big = 'x'.repeat(5000);
    await expect(safeFetch('https://example.com/declared', {
      ...opts,
      fetchImpl: fakeFetch({ 'https://example.com/declared': () => new Response(big, { headers: { 'content-length': '5000' } }) }),
    })).rejects.toThrow(/over the 1024-byte limit/);
    await expect(safeFetch('https://example.com/streamed', {
      ...opts,
      fetchImpl: fakeFetch({ 'https://example.com/streamed': () => new Response(new Blob([big]).stream()) }),
    })).rejects.toThrow(/exceeded the 1024-byte limit/);
  });

  it('times out a server that never finishes', async () => {
    const server = http.createServer((_req, res) => { res.writeHead(200); res.write('partial'); /* never ends */ });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    // The hang server is on loopback; let the lookup say "public" and point
    // the request at it, to exercise the timeout path itself.
    setSafeFetchLookup(async () => [PUBLIC]);
    const viaLoopback: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return fetch(url.replace('https://slow.example', `http://127.0.0.1:${port}`), init);
    };
    try {
      const started = Date.now();
      await expect(safeFetch('https://slow.example/', { timeoutMs: 300, maxBytes: 1024, fetchImpl: viaLoopback }))
        .rejects.toThrow(/timed out after 300ms/);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
