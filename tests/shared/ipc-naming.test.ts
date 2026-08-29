/**
 * @vitest-environment node
 *
 * IPC channel-domain ↔ client-namespace consistency (#1634). A channel string is
 * `domain:verbNoun`; the renderer reaches it as `window.api.<namespace>.<method>`.
 * When the domain prefix and the namespace disagree, the `api.*` surface is hard
 * to discover (someone hunting `excerpt:` won't look under `api.sources`). The API
 * review flagged this drift and recommended a test to hold the line rather than a
 * risky hard-rename.
 *
 * This asserts, for every renderer-facing channel, that its domain prefix maps to
 * the `api.*` namespace it's exposed under — via the naming rules:
 *   1. namespace === domain (the common case), OR
 *   2. namespace === domain + 's' (channels are singular, namespaces plural —
 *      `conversation:` → `api.conversations`, `proposal:` → `api.proposals`), OR
 *   3. a DOCUMENTED cross-domain exception below (with its rationale).
 *
 * A new channel that drifts without being a documented exception fails HERE —
 * forcing the author to either land it under the matching namespace or justify
 * the exception. (Parsed straight from channels.ts + preload.ts so it can't go
 * stale.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Channels whose domain intentionally differs from their client namespace,
 * because the operation semantically belongs to the host domain.
 */
const NAMESPACE_EXCEPTIONS: Record<string, string> = {
  excerpt: 'sources',      // an excerpt belongs to a source
  excerpts: 'sources',     // excerpts:changed — a source-library event
  ingest: 'sources',       // ingest creates sources
  inspections: 'graph',    // graph-integrity inspections
  project: 'menu',         // project-lifecycle events ride the app/menu event surface
  recent: 'notebase',      // recent-projects is a notebase-open concern
};

/** channel constant name → string value, from channels.ts. */
function channelValues(): Record<string, string> {
  const src = readFileSync('src/shared/channels.ts', 'utf8');
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s*([A-Z0-9_]+):\s*'([^']+)',/gm)) out[m[1]!] = m[2]!;
  return out;
}

/** channel value → the api.* namespace(s) it's exposed under, from preload.ts. */
function channelNamespaces(values: Record<string, string>): Record<string, Set<string>> {
  const src = readFileSync('src/preload/preload.ts', 'utf8');
  // The `api` object literal is named (#1920 — so its type can be exported and
  // checked against client.ts) rather than passed inline to
  // `exposeInMainWorld`; anchor on its declaration instead.
  const body = src.slice(src.indexOf('const api = {'));
  const out: Record<string, Set<string>> = {};
  let depth = 0;
  let ns: string | null = null;
  for (const line of body.split('\n')) {
    const nsm = line.match(/^ {2}(\w+):\s*\{/); // a top-level namespace key (depth 1)
    if (depth === 1 && nsm) ns = nsm[1]!;
    if (ns) {
      for (const cm of line.matchAll(/Channels\.([A-Z0-9_]+)/g)) {
        const v = values[cm[1]!];
        if (v) (out[v] ??= new Set()).add(ns);
      }
      for (const cm of line.matchAll(/(?:invoke|subscribe)\('([a-z][a-zA-Z:]+)'/g)) {
        (out[cm[1]!] ??= new Set()).add(ns);
      }
    }
    for (const c of line) { if (c === '{') depth++; else if (c === '}') depth--; }
    if (depth <= 0) break;
  }
  return out;
}

const okForDomain = (domain: string, namespace: string): boolean =>
  namespace === domain || namespace === `${domain}s` || NAMESPACE_EXCEPTIONS[domain] === namespace;

describe('IPC channel-domain ↔ client-namespace consistency (#1634)', () => {
  const values = channelValues();
  const nsMap = channelNamespaces(values);

  it('maps the renderer-facing channel surface (parser sanity)', () => {
    expect(Object.keys(nsMap).length).toBeGreaterThan(200);
  });

  it('exposes every channel under a namespace matching its domain (rule or documented exception)', () => {
    const violations: string[] = [];
    for (const [channel, namespaces] of Object.entries(nsMap)) {
      const domain = channel.split(':')[0]!;
      for (const ns of namespaces) {
        if (!okForDomain(domain, ns)) violations.push(`${channel}  →  api.${ns}`);
      }
    }
    expect(
      violations.sort(),
      'Channel(s) exposed under a namespace that doesn\'t match their domain prefix. ' +
        'Land the channel under the matching namespace, or — if the grouping is intentional — ' +
        'add the domain to NAMESPACE_EXCEPTIONS in this test with a one-line rationale.\n' +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('keeps every documented exception live (no stale entries)', () => {
    const seenDomains = new Set(Object.keys(nsMap).map((c) => c.split(':')[0]!));
    const stale = Object.keys(NAMESPACE_EXCEPTIONS).filter((d) => !seenDomains.has(d));
    expect(stale, `NAMESPACE_EXCEPTIONS entries no longer used — remove: ${stale.join(', ')}`).toEqual([]);
  });
});
