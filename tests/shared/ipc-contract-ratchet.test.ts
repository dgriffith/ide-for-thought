import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Channels } from '../../src/shared/channels';

/**
 * Typed-IPC ratchet (#1082).
 *
 * The typed-IPC migration is incremental: `ChannelMap` in
 * `src/shared/ipc-contract.ts` covers one domain at a time. This test is the
 * ratchet that keeps the migration monotonic — it only ever TIGHTENS:
 *
 *   - Every invoke channel in `channels.ts` whose domain has been migrated
 *     MUST have a matching `ChannelMap` key. A migrated channel that falls out
 *     of the contract (or a newly-added untyped channel in a migrated domain)
 *     fails here instead of silently widening the gap.
 *   - Domains not yet migrated are listed in `UNMIGRATED_DOMAINS`. That list is
 *     an allowlist you DELETE from as you convert a domain — never add to. A
 *     channel in a brand-new (unlisted) domain fails the test until it's either
 *     typed or the domain is consciously allowlisted, so the migration can't
 *     quietly fall behind.
 *
 * The `ChannelMap` keys are read straight from the contract source (rather than
 * duplicated here) so there is nothing to keep in sync.
 */

// The channel prefix before ':' — e.g. 'notebase:open' → 'notebase'.
function domainOf(channel: string): string {
  return channel.split(':')[0];
}

/**
 * Domains whose channels have NOT yet been migrated to the typed `ChannelMap`.
 * The ratchet only tightens: remove a domain from this set when you migrate it;
 * never add one to loosen the check. Any channel whose domain is absent from
 * this set (and isn't a declared event channel below) MUST be a `ChannelMap`
 * key.
 */
const UNMIGRATED_DOMAINS = new Set<string>([
  'bibliography',
  'citation',
  'collections',
  'conversation',
  'csl',
  'excerpt',
  'excerpts',
  'formatter',
  'ingest',
  'menu',
  'project',
  'proposal',
  'refactor',
  'skills',
  'sources',
  'tool',
]);

/**
 * Channels in a MIGRATED domain that are one-way events (main→renderer
 * broadcasts / renderer→main sends), not `invoke` request/response calls. They
 * are legitimately absent from `ChannelMap` (which types invoke channels only),
 * so they're excluded from the "must be typed" rule. Events in a not-yet-
 * migrated domain don't need to be listed — the whole domain is skipped.
 */
const EVENT_CHANNELS = new Set<string>([
  Channels.NOTEBASE_FILE_CHANGED,
  Channels.NOTEBASE_FILE_CREATED,
  Channels.NOTEBASE_FILE_DELETED,
  Channels.NOTEBASE_RENAMED,
  Channels.NOTEBASE_REWRITTEN,
  Channels.NOTEBASE_HEADING_RENAME_SUGGESTED,
  Channels.EMBEDDINGS_BACKFILL_PROGRESS,
  Channels.TABLES_CHANGED,
  Channels.TABLES_NAME_COLLISION,
]);

/** Parse the `ChannelMap` keys out of the contract source (single source of truth). */
function readChannelMapKeys(): Set<string> {
  const src = readFileSync(
    fileURLToPath(new URL('../../src/shared/ipc-contract.ts', import.meta.url)),
    'utf8',
  );
  const body = src.match(/export interface ChannelMap\s*\{([\s\S]*?)\n\}/);
  expect(body, 'could not locate `export interface ChannelMap { … }` in ipc-contract.ts').not.toBeNull();
  const keys = new Set<string>();
  // Each member is `'channel:name': (…) => …;`
  for (const m of body![1].matchAll(/^\s*'([^']+)'\s*:/gm)) keys.add(m[1]);
  return keys;
}

describe('typed-IPC ratchet (#1082)', () => {
  const channelValues = Object.values(Channels);
  const mapKeys = readChannelMapKeys();

  it('parses a non-empty ChannelMap from the contract source', () => {
    expect(mapKeys.size).toBeGreaterThan(0);
  });

  it('every migrated-domain invoke channel is present in ChannelMap', () => {
    const missing = channelValues.filter(
      (ch) => !UNMIGRATED_DOMAINS.has(domainOf(ch)) && !EVENT_CHANNELS.has(ch) && !mapKeys.has(ch),
    );
    expect(
      missing,
      `These channels are in a migrated domain but missing from ChannelMap. ` +
        `Add them to ipc-contract.ts, mark them as EVENT_CHANNELS, or (if a whole ` +
        `domain isn't migrated yet) add the domain to UNMIGRATED_DOMAINS:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every ChannelMap key is a real channel defined in channels.ts', () => {
    const known = new Set<string>(channelValues);
    const stale = [...mapKeys].filter((k) => !known.has(k));
    expect(stale, `ChannelMap keys with no matching Channels entry (typo or stale):\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('UNMIGRATED_DOMAINS never lists an already-migrated domain (ratchet cannot loosen)', () => {
    const migratedDomains = new Set([...mapKeys].map(domainOf));
    const loosened = [...UNMIGRATED_DOMAINS].filter((d) => migratedDomains.has(d));
    expect(
      loosened,
      `These domains have ChannelMap entries yet are still allowlisted as unmigrated — ` +
        `remove them from UNMIGRATED_DOMAINS:\n  ${loosened.join('\n  ')}`,
    ).toEqual([]);
  });

  it('EVENT_CHANNELS lists only real channels in migrated domains, none of them typed', () => {
    const known = new Set<string>(channelValues);
    for (const ch of EVENT_CHANNELS) {
      expect(known.has(ch), `EVENT_CHANNELS entry "${ch}" is not a real channel`).toBe(true);
      expect(mapKeys.has(ch), `EVENT_CHANNELS entry "${ch}" is also a ChannelMap key — it isn't an event`).toBe(false);
      expect(
        UNMIGRATED_DOMAINS.has(domainOf(ch)),
        `EVENT_CHANNELS entry "${ch}" is in an unmigrated domain — unnecessary, its domain is already skipped`,
      ).toBe(false);
    }
  });
});
