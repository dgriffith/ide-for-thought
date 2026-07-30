/**
 * Thoughtbase display name (#1443, Part A). A user-chosen label stored in
 * config.json, decoupled from the folder; clearing it falls back to the folder
 * basename. safeStorage is mocked because project-config pulls in secret-storage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((s: string) => Buffer.from('FAKEENC:' + s, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8').replace(/^FAKEENC:/, '')),
  },
}));

import {
  getDisplayName,
  setDisplayName,
  resolveDisplayName,
  patchProjectConfig,
  readProjectConfig,
} from '../../src/main/project-config';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-dn-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('display name', () => {
  it('falls back to the folder basename when unset', () => {
    expect(getDisplayName(root)).toBeNull();
    expect(resolveDisplayName(root)).toBe(path.basename(root));
  });

  it('stores + resolves a chosen name (trimmed)', () => {
    setDisplayName(root, '  My Garden  ');
    expect(getDisplayName(root)).toBe('My Garden');
    expect(resolveDisplayName(root)).toBe('My Garden');
    // Persisted in config.json.
    expect(JSON.parse(fs.readFileSync(path.join(root, '.minerva', 'config.json'), 'utf-8')).displayName).toBe('My Garden');
  });

  it('clearing (empty) reverts to the folder basename', () => {
    setDisplayName(root, 'Named');
    setDisplayName(root, '   ');
    expect(getDisplayName(root)).toBeNull();
    expect(resolveDisplayName(root)).toBe(path.basename(root));
  });

  it('does not disturb other config keys (merge)', () => {
    patchProjectConfig(root, { baseUri: 'https://example/base/' });
    setDisplayName(root, 'Named');
    expect(readProjectConfig(root).baseUri).toBe('https://example/base/'); // survived
    expect(readProjectConfig(root).displayName).toBe('Named');
  });
});
