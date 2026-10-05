/**
 * Guards shared by Minerva's loopback HTTP servers — the browser clipper
 * (#791) and the substrate server the CLI talks to (#2567).
 */
import crypto from 'node:crypto';

/**
 * The `Host` header must name a loopback address. Defends against DNS
 * rebinding: a malicious site that resolves its domain to 127.0.0.1 still
 * sends its own domain in `Host`, which this rejects. An absent Host (raw
 * clients, tests) is allowed.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

/** Constant-time string equality; false for a missing or differently sized value. */
export function tokensMatch(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || expected.length === 0) return false;
  const a = Buffer.from(given, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
