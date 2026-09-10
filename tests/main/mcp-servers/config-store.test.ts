/**
 * Configured-MCP-server persistence (#2031) — `file` is injectable (mirrors
 * `menu-config-store.ts`'s convention), so this is a real temp-file
 * round-trip with no electron mocking needed (unlike the OAuth token store,
 * which lives under `userData/`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addStoredServer,
  getStoredServers,
  removeStoredServer,
  setStoredServerEnabled,
  updateStoredServer,
} from '../../../src/main/mcp-servers/config-store';
import type { McpServerDescriptor } from '../../../src/shared/mcp-servers';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-mcp-servers-'));
  file = path.join(dir, 'sub', 'mcp-servers.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const stdioDescriptor: McpServerDescriptor = { kind: 'stdio', command: 'npx', args: ['-y', 'thing'] };
const httpDescriptor: McpServerDescriptor = { kind: 'http', url: 'https://mcp.example.com/mcp' };

describe('getStoredServers', () => {
  it('returns an empty list when the file is missing', async () => {
    expect(await getStoredServers(file)).toEqual([]);
  });

  it('degrades to an empty list (not a crash) on corrupt JSON', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json', 'utf-8');
    expect(await getStoredServers(file)).toEqual([]);
  });

  it('drops an entry with an unknown descriptor kind', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      servers: [{ id: 'a', name: 'bad', enabled: false, descriptor: { kind: 'carrier-pigeon' } }],
    }), 'utf-8');
    expect(await getStoredServers(file)).toEqual([]);
  });

  it('drops a stdio entry with no command, and an http entry with no url', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      servers: [
        { id: 'a', name: 'no-command', enabled: false, descriptor: { kind: 'stdio' } },
        { id: 'b', name: 'no-url', enabled: false, descriptor: { kind: 'http' } },
      ],
    }), 'utf-8');
    expect(await getStoredServers(file)).toEqual([]);
  });

  it('drops an entry missing id or name', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      servers: [{ name: 'no-id', enabled: false, descriptor: stdioDescriptor }],
    }), 'utf-8');
    expect(await getStoredServers(file)).toEqual([]);
  });
});

describe('addStoredServer', () => {
  it('creates the directory, generates an id, and persists', async () => {
    const server = await addStoredServer('My stdio server', stdioDescriptor, file);
    expect(server.id).toBeTruthy();
    expect(server.name).toBe('My stdio server');
    expect(server.enabled).toBe(false);
    expect(server.descriptor).toEqual(stdioDescriptor);

    const reloaded = await getStoredServers(file);
    expect(reloaded).toEqual([server]);
  });

  it('round-trips an http descriptor', async () => {
    await addStoredServer('Remote', httpDescriptor, file);
    expect((await getStoredServers(file))[0]?.descriptor).toEqual(httpDescriptor);
  });

  it('appends to existing servers rather than replacing them', async () => {
    const first = await addStoredServer('First', stdioDescriptor, file);
    const second = await addStoredServer('Second', httpDescriptor, file);
    const all = await getStoredServers(file);
    expect(all.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it('assigns each server a distinct id', async () => {
    const a = await addStoredServer('A', stdioDescriptor, file);
    const b = await addStoredServer('B', stdioDescriptor, file);
    expect(a.id).not.toBe(b.id);
  });
});

describe('updateStoredServer', () => {
  it('patches the name and/or descriptor of an existing server', async () => {
    const server = await addStoredServer('Original', stdioDescriptor, file);
    const updated = await updateStoredServer(server.id, { name: 'Renamed', descriptor: httpDescriptor }, file);
    expect(updated).toEqual({ ...server, name: 'Renamed', descriptor: httpDescriptor });
    expect(await getStoredServers(file)).toEqual([updated]);
  });

  it('leaves other servers untouched', async () => {
    const a = await addStoredServer('A', stdioDescriptor, file);
    const b = await addStoredServer('B', httpDescriptor, file);
    await updateStoredServer(a.id, { name: 'A renamed' }, file);
    const all = await getStoredServers(file);
    expect(all.find((s) => s.id === b.id)).toEqual(b);
  });

  it('returns null when no such server exists', async () => {
    expect(await updateStoredServer('nonexistent', { name: 'x' }, file)).toBeNull();
  });
});

describe('setStoredServerEnabled', () => {
  it('toggles the enabled flag', async () => {
    const server = await addStoredServer('S', stdioDescriptor, file);
    expect(server.enabled).toBe(false);
    const enabled = await setStoredServerEnabled(server.id, true, file);
    expect(enabled?.enabled).toBe(true);
    const disabled = await setStoredServerEnabled(server.id, false, file);
    expect(disabled?.enabled).toBe(false);
  });

  it('returns null when no such server exists', async () => {
    expect(await setStoredServerEnabled('nonexistent', true, file)).toBeNull();
  });
});

describe('removeStoredServer', () => {
  it('removes the matching server and leaves others', async () => {
    const a = await addStoredServer('A', stdioDescriptor, file);
    const b = await addStoredServer('B', httpDescriptor, file);
    await removeStoredServer(a.id, file);
    expect(await getStoredServers(file)).toEqual([b]);
  });

  it('is a no-op when no such server exists', async () => {
    await addStoredServer('A', stdioDescriptor, file);
    await expect(removeStoredServer('nonexistent', file)).resolves.toBeUndefined();
    expect(await getStoredServers(file)).toHaveLength(1);
  });
});
