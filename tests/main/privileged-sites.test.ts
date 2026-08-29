/**
 * Privileged-sites trust boundary (QA H1, #1100).
 *
 * `privileged-sites.ts` decides which URLs get fetched through a logged-in
 * Electron session partition (carrying the user's cookies) versus a plain
 * anonymous fetch — a genuine remote-content trust boundary. The security-
 * critical pieces are `partitionForUrl` (host matching: a more specific site
 * wins, and a look-alike domain must NOT match) and `privilegedFetch` (only
 * privileged hosts get the cookie'd session; everything else falls back to
 * `globalThis.fetch`). This locks both down, plus the persisted add/remove/
 * logout lifecycle.
 *
 * `electron` is mocked: `app.getPath('userData')` points at a per-test temp dir
 * (the JSON config is real fs), and `session.fromPartition` / `BrowserWindow`
 * are fakes we can assert against.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mutable holders the electron mock reads — set per test. `userData.value`
// backs the config-file path; `partitions` records every session partition
// touched (clearStorageData / fetch), so we can assert routing decisions.
const h = vi.hoisted(() => ({
  userData: { value: '' },
  fetchCalls: [] as Array<{ partition: string; target: unknown }>,
  clearedPartitions: [] as string[],
  globalFetchCalls: [] as unknown[],
  windows: [] as Array<{ options: unknown; url: string; close: () => void }>,
}));

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? h.userData.value : '') },
  session: {
    fromPartition: (partition: string) => ({
      clearStorageData: () => {
        h.clearedPartitions.push(partition);
        return Promise.resolve();
      },
      fetch: (target: unknown) => {
        h.fetchCalls.push({ partition, target });
        return Promise.resolve(new Response('privileged'));
      },
    }),
  },
  BrowserWindow: class {
    options: unknown;
    private closeCb: (() => void) | null = null;
    constructor(options: unknown) {
      this.options = options;
      h.windows.push({ options, url: '', close: () => this.closeCb?.() });
    }
    loadURL(url: string) {
      h.windows[h.windows.length - 1]!.url = url;
      return Promise.resolve();
    }
    on(evt: string, cb: () => void) {
      if (evt === 'closed') this.closeCb = cb;
    }
  },
}));

import {
  partitionFor,
  listSites,
  addSite,
  removeSite,
  logoutSite,
  partitionForUrl,
  privilegedFetch,
  openLoginWindow,
} from '../../src/main/privileged-sites';

beforeEach(() => {
  h.userData.value = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-privsites-'));
  h.fetchCalls = [];
  h.clearedPartitions = [];
  h.globalFetchCalls = [];
  h.windows = [];
});

afterEach(() => {
  fs.rmSync(h.userData.value, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('partitionFor', () => {
  it('prefixes with persist: so cookies survive on disk', () => {
    expect(partitionFor('arxiv.org')).toBe('persist:site-arxiv.org');
  });
});

describe('readFile config-loader migration (#1913)', () => {
  it('reports and returns an empty list for a corrupt config, instead of silently defaulting', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(path.join(h.userData.value, 'privileged-sites.json'), '{ not valid json', 'utf-8');

    expect(listSites()).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('[config] failed to');
    consoleErrorSpy.mockRestore();
  });

  it('drops a malformed site entry but keeps the valid ones alongside it', () => {
    const malformed = { id: 'bad', domain: 'bad.example', label: 'Bad', addedAt: '2026-01-01T00:00:00.000Z' }; // missing lastLoginAt
    const good = addSite('arxiv.org');
    const data = JSON.parse(fs.readFileSync(path.join(h.userData.value, 'privileged-sites.json'), 'utf-8'));
    data.sites.push(malformed);
    fs.writeFileSync(path.join(h.userData.value, 'privileged-sites.json'), JSON.stringify(data));

    expect(listSites()).toEqual([good]);
  });
});

describe('addSite / listSites', () => {
  it('starts empty and persists an added site', () => {
    expect(listSites()).toEqual([]);
    const site = addSite('arxiv.org');
    expect(site.domain).toBe('arxiv.org');
    expect(site.id).toBe('arxiv.org');
    expect(site.label).toBe('arxiv.org'); // defaults to the domain
    expect(site.lastLoginAt).toBeNull();
    expect(listSites()).toHaveLength(1);
  });

  it('normalises a pasted full URL down to the bare hostname', () => {
    const site = addSite('HTTPS://www.Nature.com/articles/foo?x=1');
    expect(site.domain).toBe('www.nature.com');
  });

  it('strips a leading dot and a port', () => {
    expect(addSite('.example.com').domain).toBe('example.com');
    expect(addSite('localhost:3000').domain).toBe('localhost');
  });

  it('uses a provided label, trimmed', () => {
    expect(addSite('arxiv.org', '  arXiv  ').label).toBe('arXiv');
  });

  it('is idempotent — re-adding the same domain returns the existing entry', () => {
    const first = addSite('arxiv.org', 'arXiv');
    const second = addSite('arxiv.org', 'ignored second label');
    expect(second).toEqual(first);
    expect(listSites()).toHaveLength(1);
  });

  it('rejects input that has no hostname', () => {
    expect(() => addSite('   ')).toThrow(/valid domain/i);
  });
});

describe('partitionForUrl — the routing trust boundary', () => {
  beforeEach(() => {
    addSite('arxiv.org');
    addSite('nature.com');
  });

  it('routes an exact host match through its partition', () => {
    expect(partitionForUrl('https://arxiv.org/abs/2401.00001')).toBe('persist:site-arxiv.org');
  });

  it('routes a subdomain through the parent site partition', () => {
    expect(partitionForUrl('https://www.nature.com/articles/x')).toBe('persist:site-nature.com');
  });

  it('returns null for an unconfigured host', () => {
    expect(partitionForUrl('https://example.com/')).toBeNull();
  });

  it('does NOT match a look-alike suffix (evilarxiv.org ≠ arxiv.org)', () => {
    // The endsWith guard requires a dot boundary, so a bare suffix collision
    // must not leak the user's cookies to an attacker-controlled host.
    expect(partitionForUrl('https://evilarxiv.org/steal')).toBeNull();
    expect(partitionForUrl('https://arxiv.org.evil.com/steal')).toBeNull();
  });

  it('returns null for an unparseable URL', () => {
    expect(partitionForUrl('not a url')).toBeNull();
  });

  it('prefers the longest matching domain when sites nest', () => {
    addSite('org'); // deliberately broad
    addSite('sub.arxiv.org'); // most specific
    // arxiv.org and org both suffix-match, but the most specific wins.
    expect(partitionForUrl('https://sub.arxiv.org/x')).toBe('persist:site-sub.arxiv.org');
    // A host under the broad `org` site with no more-specific match uses `org`.
    expect(partitionForUrl('https://random.org/x')).toBe('persist:site-org');
  });
});

describe('privilegedFetch', () => {
  beforeEach(() => {
    addSite('arxiv.org');
  });

  it('routes a privileged URL through the site session partition', async () => {
    await privilegedFetch('https://arxiv.org/abs/1');
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.fetchCalls[0]!.partition).toBe('persist:site-arxiv.org');
  });

  it('coerces a URL input to a string for Session.fetch', async () => {
    await privilegedFetch(new URL('https://arxiv.org/abs/2'));
    expect(h.fetchCalls[0]!.target).toBe('https://arxiv.org/abs/2');
  });

  it('falls back to global fetch for a non-privileged host', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('anon'));
    await privilegedFetch('https://example.com/');
    expect(globalFetch).toHaveBeenCalledOnce();
    expect(h.fetchCalls).toHaveLength(0); // never touched a privileged partition
  });
});

describe('removeSite', () => {
  it('removes the entry and clears its partition storage', async () => {
    addSite('arxiv.org');
    await removeSite('arxiv.org');
    expect(listSites()).toEqual([]);
    expect(h.clearedPartitions).toContain('persist:site-arxiv.org');
  });

  it('is a no-op for an unknown id (no storage wipe)', async () => {
    addSite('arxiv.org');
    await removeSite('nope');
    expect(listSites()).toHaveLength(1);
    expect(h.clearedPartitions).toEqual([]);
  });
});

describe('logoutSite', () => {
  it('clears storage and resets lastLoginAt', async () => {
    addSite('arxiv.org');
    // Simulate a prior login stamping lastLoginAt.
    const data = JSON.parse(fs.readFileSync(path.join(h.userData.value, 'privileged-sites.json'), 'utf-8'));
    data.sites[0].lastLoginAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(path.join(h.userData.value, 'privileged-sites.json'), JSON.stringify(data));

    await logoutSite('arxiv.org');
    expect(h.clearedPartitions).toContain('persist:site-arxiv.org');
    expect(listSites()[0]!.lastLoginAt).toBeNull();
  });

  it('is a no-op for an unknown id', async () => {
    await logoutSite('nope');
    expect(h.clearedPartitions).toEqual([]);
  });
});

describe('openLoginWindow', () => {
  it('throws for an unknown site', () => {
    expect(() => openLoginWindow('nope')).toThrow(/unknown site/i);
  });

  it('opens the site in its own persistent partition and stamps lastLoginAt on close', async () => {
    addSite('arxiv.org', 'arXiv');
    const done = openLoginWindow('arxiv.org');
    const win = h.windows[0]!;
    expect((win.options as { webPreferences: { partition: string } }).webPreferences.partition).toBe('persist:site-arxiv.org');
    expect(win.url).toBe('https://arxiv.org/');
    win.close(); // fire the 'closed' handler → resolves the promise
    await done;
    expect(listSites()[0]!.lastLoginAt).not.toBeNull();
  });

  it('hardens the third-party login window: isolated, sandboxed, no node, no preload (#1102)', () => {
    // This window loads real third-party HTML, so a flag regression here is
    // higher-risk than the app's own renderer. Guard the construction site.
    addSite('arxiv.org', 'arXiv');
    openLoginWindow('arxiv.org');
    const wp = (h.windows[0]!.options as { webPreferences: Record<string, unknown> }).webPreferences;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    // A preload would expose Minerva's bridge to an untrusted remote page.
    expect(wp.preload).toBeUndefined();
  });
});
