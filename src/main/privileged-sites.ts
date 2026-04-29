/**
 * Privileged sites: per-machine list of domains the user has logged in to
 * inside Minerva (#NEW). Cookies for each site live in a dedicated Electron
 * persistent partition, keyed by `partitionFor(id)`. When the URL ingest
 * pipeline resolves a domain to a site, it routes its fetch through that
 * partition's `Session.fetch`, so the request carries the user's cookies.
 *
 * The list is per-machine — cookies are tied to the local Electron
 * userData directory, so the config has no business living per-project.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, session, type Session } from 'electron';
import type { PrivilegedSite } from '../shared/types';

const FILE = path.join(app.getPath('userData'), 'privileged-sites.json');

interface FileShape {
  sites: PrivilegedSite[];
}

function readFile(): FileShape {
  try {
    const data = fs.readFileSync(FILE, 'utf-8');
    const parsed = JSON.parse(data) as FileShape;
    if (!parsed || !Array.isArray(parsed.sites)) return { sites: [] };
    return parsed;
  } catch {
    return { sites: [] };
  }
}

function writeFile(data: FileShape): void {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/** Bare hostname normaliser: strips leading dot, lowercases, drops port. */
function normaliseDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return '';
  // Allow the user to paste a full URL — pull the hostname out.
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^\./, '');
  } catch {
    return trimmed.replace(/^\./, '').replace(/\/.*$/, '');
  }
}

/** Stable, fs-safe id derived from the domain — easier to debug than uuids. */
function idForDomain(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/g, '-');
}

export function partitionFor(id: string): string {
  // `persist:` prefix tells Electron to keep cookies/storage on disk under
  // userData. Without it, the partition is in-memory only and useless here.
  return `persist:site-${id}`;
}

export function listSites(): PrivilegedSite[] {
  return readFile().sites;
}

export function addSite(domainInput: string, label?: string): PrivilegedSite {
  const domain = normaliseDomain(domainInput);
  if (!domain) throw new Error(`Not a valid domain: ${domainInput}`);
  const data = readFile();
  const id = idForDomain(domain);
  // Re-adding the same domain is idempotent — return the existing entry.
  const existing = data.sites.find((s) => s.id === id);
  if (existing) return existing;
  const site: PrivilegedSite = {
    id,
    domain,
    label: label?.trim() || domain,
    addedAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  data.sites.push(site);
  writeFile(data);
  return site;
}

export async function removeSite(id: string): Promise<void> {
  const data = readFile();
  const next = data.sites.filter((s) => s.id !== id);
  if (next.length === data.sites.length) return;
  writeFile({ sites: next });
  // Best-effort wipe of the partition's storage — leftover cookies for a
  // removed site shouldn't linger and surprise the user.
  try {
    await session.fromPartition(partitionFor(id)).clearStorageData();
  } catch (e) {
    console.warn(`[privileged-sites] failed to clear partition for ${id}:`, e);
  }
}

export async function logoutSite(id: string): Promise<void> {
  const data = readFile();
  const site = data.sites.find((s) => s.id === id);
  if (!site) return;
  await session.fromPartition(partitionFor(id)).clearStorageData();
  // Reset lastLoginAt so the UI shows the site as logged-out.
  site.lastLoginAt = null;
  writeFile(data);
}

/**
 * Resolve a URL to the partition we should fetch it through. Returns the
 * partition string for `session.fromPartition` if the URL's hostname
 * matches a configured site (longest hostname-suffix wins so a more
 * specific entry like `arxiv.org` beats a parent like `org`); null when
 * there's no privileged session for this URL.
 */
export function partitionForUrl(rawUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const sites = readFile().sites;
  let best: PrivilegedSite | null = null;
  for (const s of sites) {
    if (hostname === s.domain || hostname.endsWith(`.${s.domain}`)) {
      if (!best || s.domain.length > best.domain.length) best = s;
    }
  }
  return best ? partitionFor(best.id) : null;
}

/**
 * `fetch`-shaped wrapper that automatically routes URLs on configured
 * privileged domains through their session partitions, falling back to
 * `globalThis.fetch` for everything else. Drop-in replacement for the
 * existing `fetchImpl` seam used by the ingest pipeline.
 */
export const privilegedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const partition = partitionForUrl(url);
  if (!partition) return globalThis.fetch(input, init);
  // `Session.fetch` is `net.fetch` bound to that session — it consults
  // the partition's cookie jar and includes credentials by default.
  // It accepts `string | Request` but not the WHATWG `URL` shape, so we
  // pre-coerce here when needed.
  const sess: Session = session.fromPartition(partition);
  const target: string | Request = input instanceof URL ? input.toString() : input;
  return sess.fetch(target, init);
};

/**
 * Open a normal browser window pointed at the site's domain, using the
 * site's persistent partition so cookies set during login persist after
 * the window closes. Resolves when the user closes the window.
 */
export function openLoginWindow(id: string): Promise<void> {
  const data = readFile();
  const site = data.sites.find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site: ${id}`);

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      title: `Login — ${site.label}`,
      webPreferences: {
        partition: partitionFor(id),
        // No preload — this is a real third-party site, no Minerva APIs.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    void win.loadURL(`https://${site.domain}/`);
    win.on('closed', () => {
      const fresh = readFile();
      const target = fresh.sites.find((s) => s.id === id);
      if (target) {
        target.lastLoginAt = new Date().toISOString();
        writeFile(fresh);
      }
      resolve();
    });
  });
}
