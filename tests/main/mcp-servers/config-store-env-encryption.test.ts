/**
 * MCP stdio `env` values are encrypted at rest, and the file is 0600 (#2562).
 *
 * `secret-storage` is replaced by a fake keychain: `enc:v1:` + reversed text,
 * with a switch for "available" and a set of values it refuses to decrypt
 * (a rotated keychain), which `decryptSecret` answers with ''.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const k = vi.hoisted(() => ({ available: true, undecryptable: new Set<string>(), availabilityChecks: 0 }));
vi.mock('../../../src/main/secret-storage', () => {
  const PREFIX = 'enc:v1:';
  return {
    isEncrypted: (v: string) => v.startsWith(PREFIX),
    secretEncryptionAvailable: () => { k.availabilityChecks++; return k.available; },
    encryptSecret: (v: string) => (v && k.available ? PREFIX + [...v].reverse().join('') : v),
    decryptSecret: (v: string) => {
      if (!v.startsWith(PREFIX)) return v;
      if (k.undecryptable.has(v)) return '';
      return [...v.slice(PREFIX.length)].reverse().join('');
    },
  };
});

import {
  addStoredServer,
  getStoredServers,
  setStoredServerEnabled,
  updateStoredServer,
  _resetEnvUpgradeForTests,
} from '../../../src/main/mcp-servers/config-store';

let dir: string;
let file: string;
const onDisk = async () => JSON.parse(await fs.readFile(file, 'utf-8')) as { servers: Array<{ id: string; descriptor: { env?: Record<string, string> } }> };

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-mcp-env-'));
  file = path.join(dir, 'mcp-servers.json');
  k.available = true;
  k.undecryptable.clear();
  k.availabilityChecks = 0;
  _resetEnvUpgradeForTests();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('MCP stdio env encryption (#2562)', () => {
  it('stores env values encrypted and hands them back decrypted', async () => {
    const added = await addStoredServer('gh', { kind: 'stdio', command: 'npx', env: { GITHUB_TOKEN: 'ghp_secret', MODE: 'x' } }, file);
    expect(added.descriptor).toMatchObject({ env: { GITHUB_TOKEN: 'ghp_secret', MODE: 'x' } });

    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).not.toContain('ghp_secret');
    expect((await onDisk()).servers[0]!.descriptor.env!.GITHUB_TOKEN).toMatch(/^enc:v1:/);

    const [server] = await getStoredServers(file);
    expect(server!.descriptor).toMatchObject({ env: { GITHUB_TOKEN: 'ghp_secret', MODE: 'x' } });
  });

  it.runIf(process.platform !== 'win32')('writes the file owner-only', async () => {
    await addStoredServer('gh', { kind: 'stdio', command: 'npx', env: { T: 'v' } }, file);
    expect(fsSync.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('a legacy plaintext file still loads, and is encrypted by the lazy upgrade', async () => {
    await fs.writeFile(file, JSON.stringify({ servers: [{ id: 'a', name: 'a', enabled: true, descriptor: { kind: 'stdio', command: 'npx', env: { API_KEY: 'plain-key' } } }] }), { mode: 0o644 });
    const [server] = await getStoredServers(file);
    expect(server!.descriptor).toMatchObject({ env: { API_KEY: 'plain-key' } });
    // The upgrade runs under the file's lock; a later mutation queues behind it.
    await setStoredServerEnabled('a', true, file);
    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).not.toContain('plain-key');
    expect((await onDisk()).servers[0]!.descriptor.env!.API_KEY).toMatch(/^enc:v1:/);
    if (process.platform !== 'win32') expect(fsSync.statSync(file).mode & 0o777).toBe(0o600);
    expect((await getStoredServers(file))[0]!.descriptor).toMatchObject({ env: { API_KEY: 'plain-key' } });
  });

  it('a value the keychain can no longer decrypt survives an unrelated mutation verbatim', async () => {
    await addStoredServer('a', { kind: 'stdio', command: 'npx', env: { KEY: 'aaa' } }, file);
    const b = await addStoredServer('b', { kind: 'stdio', command: 'npx' }, file);
    const storedA = (await onDisk()).servers[0]!.descriptor.env!.KEY!;
    k.undecryptable.add(storedA);

    await setStoredServerEnabled(b.id, true, file);
    await updateStoredServer(b.id, { name: 'renamed' }, file);

    expect((await onDisk()).servers[0]!.descriptor.env!.KEY).toBe(storedA);
  });

  it('without a keychain, values stay as they are (no worse than before) and no upgrade is attempted', async () => {
    k.available = false;
    await fs.writeFile(file, JSON.stringify({ servers: [{ id: 'a', name: 'a', enabled: false, descriptor: { kind: 'stdio', command: 'npx', env: { K: 'plain' } } }] }));
    await getStoredServers(file);
    await new Promise((r) => setTimeout(r, 20));
    expect(await fs.readFile(file, 'utf-8')).toContain('"plain"');
  });

  it('an edit that supplies new plaintext env encrypts it', async () => {
    const s = await addStoredServer('a', { kind: 'stdio', command: 'npx', env: { K: 'old' } }, file);
    await updateStoredServer(s.id, { descriptor: { kind: 'stdio', command: 'npx', env: { K: 'new-secret' } } }, file);
    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).not.toContain('new-secret');
    expect((await getStoredServers(file))[0]!.descriptor).toMatchObject({ env: { K: 'new-secret' } });
  });

  it('never asks the keychain at startup unless there is plaintext to upgrade', async () => {
    // Missing file (a fresh profile): no keychain access at all. It used to
    // check availability on every load, which is a synchronous keychain call
    // on macOS — it hung the packaged app's launch on a headless CI runner.
    expect(await getStoredServers(file)).toEqual([]);
    expect(k.availabilityChecks).toBe(0);
    // Everything already encrypted: still none.
    await addStoredServer('a', { kind: 'stdio', command: 'npx', env: { K: 'v' } }, file);
    k.availabilityChecks = 0;
    _resetEnvUpgradeForTests();
    await getStoredServers(file);
    expect(k.availabilityChecks).toBe(0);
  });
});
