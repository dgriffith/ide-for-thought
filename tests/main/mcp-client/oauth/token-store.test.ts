/**
 * Encrypted OAuth token storage (#2030) — real temp dir + a reversible fake
 * `safeStorage`, mirroring `clipper-config.test.ts`'s pattern, so the file
 * is hermetic and the encrypt/decrypt round-trip is genuinely exercised.
 */
import { it, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tempDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
      return tempDir;
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('FAKEENC:' + s, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('FAKEENC:')) throw new Error('bad ciphertext');
      return s.slice('FAKEENC:'.length);
    },
  },
}));

import { deleteStoredTokens, getStoredTokens, saveStoredTokens } from '../../../../src/main/mcp-client/oauth/token-store';
import type { StoredOAuthRecord } from '../../../../src/main/mcp-client/oauth/types';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mcp-oauth-'));
});
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function record(overrides: Partial<StoredOAuthRecord> = {}): StoredOAuthRecord {
  return {
    serverUrl: 'https://mcp.example.com/mcp',
    issuer: 'https://as.example.com',
    clientId: 'client-1',
    tokenEndpoint: 'https://as.example.com/token',
    resource: 'https://mcp.example.com/mcp',
    accessToken: 'access-token-1',
    scope: 'files:read',
    ...overrides,
  };
}

describe('getStoredTokens', () => {
  it('returns null when nothing is stored', async () => {
    expect(await getStoredTokens('https://mcp.example.com/mcp')).toBeNull();
  });

  it('round-trips a saved record', async () => {
    await saveStoredTokens(record());
    expect(await getStoredTokens('https://mcp.example.com/mcp')).toEqual(record());
  });

  it('encrypts accessToken/refreshToken/clientSecret at rest, but not the other fields', async () => {
    await saveStoredTokens(record({ refreshToken: 'refresh-1', clientSecret: 'secret-1' }));
    const onDisk = JSON.parse(fs.readFileSync(path.join(tempDir, 'mcp-oauth-tokens.json'), 'utf-8'));
    const stored = onDisk['https://mcp.example.com/mcp'];
    expect(stored.accessToken).toMatch(/^enc:v1:/);
    expect(stored.refreshToken).toMatch(/^enc:v1:/);
    expect(stored.clientSecret).toMatch(/^enc:v1:/);
    expect(stored.issuer).toBe('https://as.example.com'); // plain, not encrypted
    expect(stored.scope).toBe('files:read');
  });

  it('keeps records for different servers independent', async () => {
    await saveStoredTokens(record({ serverUrl: 'https://a.example.com/mcp' }));
    await saveStoredTokens(record({ serverUrl: 'https://b.example.com/mcp', accessToken: 'other-token' }));
    expect((await getStoredTokens('https://a.example.com/mcp'))?.accessToken).toBe('access-token-1');
    expect((await getStoredTokens('https://b.example.com/mcp'))?.accessToken).toBe('other-token');
  });

  it('decrypts a stored clientSecret back on read, when one was saved', async () => {
    await saveStoredTokens(record({ clientSecret: 'secret-1' }));
    expect((await getStoredTokens('https://mcp.example.com/mcp'))?.clientSecret).toBe('secret-1');
  });

  it('drops a structurally incomplete record rather than crashing', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'mcp-oauth-tokens.json'),
      JSON.stringify({ 'https://mcp.example.com/mcp': { issuer: 'https://as.example.com' } }), // missing clientId etc.
      'utf-8',
    );
    expect(await getStoredTokens('https://mcp.example.com/mcp')).toBeNull();
  });

  it('degrades to no stored tokens (not a crash) on a corrupt file', async () => {
    fs.writeFileSync(path.join(tempDir, 'mcp-oauth-tokens.json'), 'not json at all {{{', 'utf-8');
    expect(await getStoredTokens('https://mcp.example.com/mcp')).toBeNull();
  });
});

describe('saveStoredTokens', () => {
  it('overwrites an existing record for the same server', async () => {
    await saveStoredTokens(record());
    await saveStoredTokens(record({ accessToken: 'access-token-2' }));
    expect((await getStoredTokens('https://mcp.example.com/mcp'))?.accessToken).toBe('access-token-2');
  });

  it('recovers the write lock after a failed save, so a later save still succeeds', async () => {
    // The atomic writer creates missing parent dirs (#2369), so fail its final
    // rename instead — the step a crash mid-save would interrupt.
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('simulated crash'));
    await expect(saveStoredTokens(record())).rejects.toThrow('simulated crash');

    await saveStoredTokens(record({ accessToken: 'access-token-after-recovery' }));
    expect((await getStoredTokens('https://mcp.example.com/mcp'))?.accessToken).toBe('access-token-after-recovery');
  });

  it('does not race under concurrent saves for different servers', async () => {
    await Promise.all([
      saveStoredTokens(record({ serverUrl: 'https://a.example.com/mcp' })),
      saveStoredTokens(record({ serverUrl: 'https://b.example.com/mcp' })),
      saveStoredTokens(record({ serverUrl: 'https://c.example.com/mcp' })),
    ]);
    expect(await getStoredTokens('https://a.example.com/mcp')).not.toBeNull();
    expect(await getStoredTokens('https://b.example.com/mcp')).not.toBeNull();
    expect(await getStoredTokens('https://c.example.com/mcp')).not.toBeNull();
  });
});

describe('deleteStoredTokens', () => {
  it('removes a stored record', async () => {
    await saveStoredTokens(record());
    await deleteStoredTokens('https://mcp.example.com/mcp');
    expect(await getStoredTokens('https://mcp.example.com/mcp')).toBeNull();
  });

  it('is a no-op when nothing is stored for that server', async () => {
    await expect(deleteStoredTokens('https://nothing-here.example.com/mcp')).resolves.toBeUndefined();
  });

  it('does not affect other servers records', async () => {
    await saveStoredTokens(record({ serverUrl: 'https://a.example.com/mcp' }));
    await saveStoredTokens(record({ serverUrl: 'https://b.example.com/mcp' }));
    await deleteStoredTokens('https://a.example.com/mcp');
    expect(await getStoredTokens('https://a.example.com/mcp')).toBeNull();
    expect(await getStoredTokens('https://b.example.com/mcp')).not.toBeNull();
  });
});

// #2416: saves and deletes read STRICTLY. A corrupt file used to read as "no
// stored tokens", and the save that followed erased every other server's.
describe('corrupt file is never written over (#2416)', () => {
  const file = () => path.join(tempDir, 'mcp-oauth-tokens.json');
  const CORRUPT = '{"https://a.example.com/mcp": {"issuer": "x", TRUNCATED';

  it.each([
    ['saveStoredTokens', () => saveStoredTokens(record())],
    ['deleteStoredTokens', () => deleteStoredTokens('https://a.example.com/mcp')],
  ])('%s refuses and leaves the file byte-identical', async (_name, op) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.writeFileSync(file(), CORRUPT, 'utf-8');
    await expect(op()).rejects.toThrow(/left untouched/);
    expect(fs.readFileSync(file(), 'utf-8')).toBe(CORRUPT);
    errSpy.mockRestore();
  });

  it('a save leaves another server\'s entry exactly as stored, even one the decoder would drop', async () => {
    const other = { issuer: 'https://as.example.com', note: 'incomplete, but not ours to delete' };
    fs.writeFileSync(file(), JSON.stringify({ 'https://other.example.com/mcp': other }), 'utf-8');
    await saveStoredTokens(record());
    const onDisk = JSON.parse(fs.readFileSync(file(), 'utf-8'));
    expect(onDisk['https://other.example.com/mcp']).toEqual(other);
    expect(onDisk['https://mcp.example.com/mcp'].accessToken).toMatch(/^enc:v1:/);
  });

  it('overlapping save + delete on different servers both land', async () => {
    await saveStoredTokens(record({ serverUrl: 'https://gone.example.com/mcp' }));
    await Promise.all([
      saveStoredTokens(record({ serverUrl: 'https://new.example.com/mcp' })),
      deleteStoredTokens('https://gone.example.com/mcp'),
    ]);
    expect(Object.keys(JSON.parse(fs.readFileSync(file(), 'utf-8')))).toEqual(['https://new.example.com/mcp']);
  });
});
