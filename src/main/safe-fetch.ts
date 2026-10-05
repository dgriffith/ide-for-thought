/**
 * One fetch for URLs nobody vouched for (#2566): a note's image, a URL a
 * shared note or an LLM card asked to ingest, an OAuth server's discovered
 * endpoints.
 *
 * Plain `fetch` from main has none of a browser's guards: no Private Network
 * Access, no timeout, no size limit, redirects followed silently. So a note
 * that embeds `http://192.168.1.1/reboot` as an image, or an ingest of a URL
 * that redirects to `http://169.254.169.254/…`, made main issue that request
 * from inside the user's network. `safeFetch`:
 *
 *  - allows only the given schemes (https, plus http where a caller opts in);
 *  - resolves the host and refuses if ANY address is loopback, private,
 *    link-local, CGNAT, multicast or otherwise non-public (IP literals too);
 *  - follows redirects itself, re-checking every hop the same way;
 *  - aborts after `timeoutMs` (the whole exchange, body included);
 *  - stops reading at `maxBytes`.
 *
 * Known limit: the address is checked by a lookup before the request, and the
 * request resolves again — a DNS-rebinding server can answer differently the
 * second time. Closing that needs a connection-level hook the injected fetch
 * implementations (`privilegedFetch` uses Electron's net) don't offer.
 */
import dns from 'node:dns';
import net from 'node:net';

export type LookupFn = (hostname: string) => Promise<string[]>;

const defaultLookup: LookupFn = async (hostname) =>
  (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

let lookupImpl: LookupFn = defaultLookup;

/** Test seam: answer DNS from a function (the global test setup makes it hermetic). */
export function setSafeFetchLookup(fn: LookupFn | null): void {
  lookupImpl = fn ?? defaultLookup;
}

export class SafeFetchRefused extends Error {
  override name = 'SafeFetchRefused';
}

const BLOCKED = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) BLOCKED.addSubnet(addr, bits, 'ipv6');

/** An IPv4 address embedded in an IPv6 one (`::ffff:a.b.c.d`, NAT64 `64:ff9b::a.b.c.d`). */
function embeddedIpv4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1]!;
  const hex = ip.toLowerCase().match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for any address a fetch of untrusted content must not reach. */
export function isBlockedAddress(ip: string): boolean {
  const v4 = net.isIPv4(ip) ? ip : embeddedIpv4(ip);
  if (v4) return BLOCKED.check(v4, 'ipv4');
  if (net.isIPv6(ip)) return BLOCKED.check(ip, 'ipv6');
  return true; // not an address at all
}

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  init?: Omit<RequestInit, 'redirect' | 'signal'>;
  timeoutMs: number;
  maxBytes: number;
  /** Allowed schemes. Default https only. */
  protocols?: readonly ('https:' | 'http:')[];
  maxRedirects?: number;
}

export interface SafeResponse {
  /** The final URL, after redirects. */
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  contentType: string;
  bytes: Uint8Array;
}

async function assertPublicDestination(url: URL, protocols: readonly string[]): Promise<void> {
  if (!protocols.includes(url.protocol)) {
    throw new SafeFetchRefused(`refusing ${url.protocol} URL (allowed: ${protocols.join(', ')})`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : await lookupImpl(host);
  if (addresses.length === 0) throw new SafeFetchRefused(`${host} did not resolve`);
  const blocked = addresses.find(isBlockedAddress);
  if (blocked) throw new SafeFetchRefused(`refusing ${host}: it resolves to a private or local address (${blocked})`);
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SafeFetchRefused(`response is ${declared} bytes, over the ${maxBytes}-byte limit`);
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchRefused(`response exceeded the ${maxBytes}-byte limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

/** Fetch an untrusted URL under the rules in this file's header. */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const protocols = opts.protocols ?? ['https:'];
  const maxRedirects = opts.maxRedirects ?? 5;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new SafeFetchRefused(`timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
  try {
    let url = new URL(rawUrl);
    for (let hop = 0; ; hop++) {
      await assertPublicDestination(url, protocols);
      const res = await fetchImpl(url.href, { ...opts.init, redirect: 'manual', signal: controller.signal });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= maxRedirects) throw new SafeFetchRefused(`more than ${maxRedirects} redirects`);
        await res.body?.cancel();
        url = new URL(location, url);
        continue;
      }
      if (res.type === 'opaqueredirect' || (res.status === 0 && !res.ok)) {
        throw new SafeFetchRefused('redirect target could not be checked');
      }
      const bytes = await readCapped(res, opts.maxBytes);
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      return { url: url.href, status: res.status, ok: res.ok, headers: res.headers, contentType, bytes };
    }
  } catch (e) {
    if (controller.signal.aborted && controller.signal.reason instanceof SafeFetchRefused) throw controller.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
