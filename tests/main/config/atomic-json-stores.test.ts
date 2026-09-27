/**
 * Every JSON store moved onto the atomic writer in #2369 really writes through
 * it — and keeps its file format.
 *
 * The check per store is the one that distinguishes an atomic write from a
 * plain one: make the final `rename` onto the store's file fail, as a crash
 * between "temp file written" and "swapped into place" would, and the file
 * must still hold the PREVIOUS complete state, with no temp file left beside
 * it. A raw `writeFile` never renames, so it would have already overwritten
 * the file (and the failing rename would never fire, so the write wouldn't
 * throw either).
 *
 * The rename is failed only when its destination is the store under test, so
 * a store whose write touches a second file first (`upsertPublishTarget` patches
 * `config.json` before `secrets.json`) is tested on the file that matters.
 *
 * `tests/main/config/json-file.test.ts` pins the writer itself; this pins that
 * each store uses it. Conversation transcripts are covered in
 * `tests/main/llm/conversation-model.test.ts`, which already has a graph
 * project to create them in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const h = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? h.userData : '') },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`FAKEENC:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^FAKEENC:/, ''),
  },
  session: { fromPartition: () => ({ clearStorageData: () => Promise.resolve() }) },
  BrowserWindow: class {},
}));

import { saveSession } from '../../../src/main/session';
import { addRecentProject, clearRecentProjects, invalidateRecentProjectsCache } from '../../../src/main/recent-projects';
import { addSite } from '../../../src/main/privileged-sites';
import { grantConsent } from '../../../src/main/compute/consent';
import { patchRawProjectConfig } from '../../../src/main/config/project-config-store';
import { upsertPublishTarget } from '../../../src/main/project-config';
import { saveInspectionSettings } from '../../../src/main/config/inspection-settings';
import { setHistorySettings } from '../../../src/main/history/settings';
import { captureSnapshot } from '../../../src/main/history/store';
import { saveIngestSettings } from '../../../src/main/sources/ingest-settings';
import { setPythonSettings } from '../../../src/main/compute/python-settings';
import { saveMenuConfig } from '../../../src/main/skills/menu-config-store';
import { createCollection } from '../../../src/main/sources/collections';
import { saveStoredTokens } from '../../../src/main/mcp-client/oauth/token-store';
import { addStoredServer } from '../../../src/main/mcp-servers/config-store';
import { emptyMenuConfig } from '../../../src/shared/skills/menu-config';
import { DEFAULT_HISTORY_SETTINGS } from '../../../src/main/history/settings';

let userData: string;
let root: string;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-atomic-userdata-'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-atomic-root-'));
  h.userData = userData;
  invalidateRecentProjectsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

/** Fail any rename — sync or async — whose destination is `target`; let every other rename through. */
function failRenameOnto(target: string): void {
  const realRenameSync = fs.renameSync;
  const realRename = fs.promises.rename;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === target) throw new Error('simulated crash');
    realRenameSync(from, to);
  });
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
    if (to === target) throw new Error('simulated crash');
    await realRename(from, to);
  });
}

interface StoreCase {
  name: string;
  file: () => string;
  /** Write a distinguishable state; version 2 is the write that gets interrupted. */
  write: (version: 1 | 2) => unknown;
}

const LAYOUT_HISTORY = { ...DEFAULT_HISTORY_SETTINGS };

const stores: StoreCase[] = [
  {
    name: 'session.json',
    file: () => path.join(userData, 'session.json'),
    write: (v) => saveSession([{ x: v, y: 0, width: 800, height: 600, rootPath: '/tb' }]),
  },
  {
    name: 'recent-projects.json',
    file: () => path.join(userData, 'recent-projects.json'),
    write: (v) => addRecentProject(`/thoughtbase-${v}`),
  },
  {
    name: 'privileged-sites.json',
    file: () => path.join(userData, 'privileged-sites.json'),
    write: (v) => addSite(`site${v}.example`),
  },
  {
    name: 'compute-consent.json',
    file: () => path.join(userData, 'compute-consent.json'),
    write: (v) => grantConsent(root, 'python', `print(${v})`, 'cell'),
  },
  {
    name: '.minerva/config.json',
    file: () => path.join(root, '.minerva', 'config.json'),
    write: (v) => patchRawProjectConfig(root, { [`key${v}`]: v }),
  },
  {
    name: '.minerva/secrets.json',
    file: () => path.join(root, '.minerva', 'secrets.json'),
    write: (v) => upsertPublishTarget(root, {
      id: `t${v}`, kind: 's3', label: 'Site', exporter: 'static-site', bucket: 'b', region: 'auto',
      endpoint: 'https://x.example', accessKeyId: 'AKIA', secretAccessKey: `secret-${v}`,
    }),
  },
  {
    name: 'inspection-settings.json',
    file: () => path.join(userData, 'inspection-settings.json'),
    write: (v) => saveInspectionSettings({ disabled: [], staleDays: 10 + v, stubDays: 10 }),
  },
  {
    name: 'history-settings.json',
    file: () => path.join(userData, 'history-settings.json'),
    write: (v) => setHistorySettings({ ...LAYOUT_HISTORY, retentionDays: 10 + v }),
  },
  {
    name: 'history index.json',
    file: () => path.join(root, '.minerva', 'history', 'note.md', 'index.json'),
    write: (v) => captureSnapshot(root, 'note.md', `content ${v}`, { origin: 'edit' }, v * 1000, LAYOUT_HISTORY),
  },
  {
    name: 'ingest-settings.json',
    file: () => path.join(userData, 'ingest-settings.json'),
    write: (v) => saveIngestSettings({ importUpstreamTags: v === 1 }),
  },
  {
    name: 'python-settings.json',
    file: () => path.join(userData, 'python-settings.json'),
    write: (v) => setPythonSettings({ pythonPath: `/py${v}`, allowNetwork: false, cellTimeoutSeconds: 30 }),
  },
  {
    name: 'menu-config.json',
    file: () => path.join(userData, 'menu-config.json'),
    write: (v) => saveMenuConfig(
      { ...emptyMenuConfig(), skills: { [`skill-${v}`]: { enabled: false } } },
      path.join(userData, 'menu-config.json'),
    ),
  },
  {
    name: '.minerva/collections.json',
    file: () => path.join(root, '.minerva', 'collections.json'),
    write: (v) => createCollection(root, { name: `Collection ${v}` }),
  },
  {
    name: 'mcp-oauth-tokens.json',
    file: () => path.join(userData, 'mcp-oauth-tokens.json'),
    write: (v) => saveStoredTokens({
      serverUrl: `https://server-${v}.example`, issuer: 'https://issuer.example', clientId: 'client',
      tokenEndpoint: 'https://issuer.example/token', resource: '', accessToken: `token-${v}`, scope: '',
    }),
  },
  {
    name: 'mcp-servers.json',
    file: () => path.join(userData, 'mcp-servers.json'),
    write: (v) => addStoredServer(`Server ${v}`, { kind: 'http', url: 'https://mcp.example' }, path.join(userData, 'mcp-servers.json')),
  },
];

describe('JSON stores write atomically (#2369)', () => {
  it.each(stores)('$name: an interrupted write leaves the previous file whole', async ({ file, write }) => {
    await write(1);
    const before = fs.readFileSync(file(), 'utf-8');

    failRenameOnto(file());
    await expect((async () => write(2))()).rejects.toThrow('simulated crash');

    expect(fs.readFileSync(file(), 'utf-8')).toBe(before);
    const litter = fs.readdirSync(path.dirname(file())).filter((f) => f.endsWith('.tmp'));
    expect(litter).toEqual([]);
  });
});

describe('the atomic path keeps each store\'s file format (#2369)', () => {
  it('session.json stays compact', () => {
    const windows = [{ x: 1, y: 2, width: 3, height: 4, rootPath: '/tb' }];
    saveSession(windows);
    expect(fs.readFileSync(path.join(userData, 'session.json'), 'utf-8')).toBe(JSON.stringify(windows));
  });

  it('recent-projects.json stays compact, and clearing writes `[]`', () => {
    const file = path.join(userData, 'recent-projects.json');
    addRecentProject('/a');
    addRecentProject('/b');
    expect(fs.readFileSync(file, 'utf-8')).toBe(JSON.stringify(['/b', '/a']));
    clearRecentProjects();
    expect(fs.readFileSync(file, 'utf-8')).toBe('[]');
  });

  it('menu-config.json and mcp-servers.json keep their trailing newline', async () => {
    const menuFile = path.join(userData, 'menu-config.json');
    const saved = await saveMenuConfig(emptyMenuConfig(), menuFile);
    expect(fs.readFileSync(menuFile, 'utf-8')).toBe(`${JSON.stringify(saved, null, 2)}\n`);

    const serversFile = path.join(userData, 'mcp-servers.json');
    const server = await addStoredServer('S', { kind: 'http', url: 'https://mcp.example' }, serversFile);
    expect(fs.readFileSync(serversFile, 'utf-8')).toBe(`${JSON.stringify({ servers: [server] }, null, 2)}\n`);
  });

  it('the pretty-printed stores stay two-space indented with no trailing newline', async () => {
    await saveIngestSettings({ importUpstreamTags: false });
    expect(fs.readFileSync(path.join(userData, 'ingest-settings.json'), 'utf-8'))
      .toBe(JSON.stringify({ importUpstreamTags: false }, null, 2));
  });
});
