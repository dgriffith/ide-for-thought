/**
 * LLM settings — API key at-rest encryption + backward compatibility (#1326).
 *
 * `saveSettings` encrypts the Anthropic key on disk; `getSettings` decrypts it
 * transparently and still reads pre-encryption (plaintext) configs. Stubs
 * `app.getPath('userData')` to a temp dir and mocks `safeStorage` with a
 * reversible fake (mirrors clipper-config.test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { getSettings, saveSettings } from '../../../src/main/llm/settings';
import type { LLMSettings } from '../../../src/shared/tools/types';

const settingsFile = () => path.join(tempDir, 'llm-settings.json');
const base: LLMSettings = {
  apiKey: '',
  model: 'claude-sonnet-5',
  web: { enabled: false, allowedDomains: [], blockedDomains: [] },
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-llm-settings-'));
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('llm settings — API key at-rest encryption (#1326)', () => {
  it('reads a legacy plaintext apiKey unchanged (backward compat)', async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: 'sk-ant-legacy', model: 'claude-sonnet-5' }));
    expect((await getSettings()).apiKey).toBe('sk-ant-legacy');
  });

  it('encrypts the apiKey on save and decrypts it on read', async () => {
    await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
    const onDisk = fs.readFileSync(settingsFile(), 'utf-8');
    expect(onDisk).not.toContain('sk-ant-secret');
    expect((JSON.parse(onDisk).apiKey as string).startsWith('enc:v1:')).toBe(true);
    expect((await getSettings()).apiKey).toBe('sk-ant-secret');
  });

  it('migrates a legacy plaintext key to encrypted on the next save', async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: 'sk-ant-old', model: 'claude-sonnet-5' }));
    const loaded = await getSettings();
    expect(loaded.apiKey).toBe('sk-ant-old');
    await saveSettings(loaded);
    const onDisk = fs.readFileSync(settingsFile(), 'utf-8');
    expect(onDisk).not.toContain('sk-ant-old');
    expect((JSON.parse(onDisk).apiKey as string).startsWith('enc:v1:')).toBe(true);
  });

  it('falls back to the env var when apiKey is absent, but respects an explicit empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    fs.writeFileSync(settingsFile(), JSON.stringify({ model: 'claude-sonnet-5' }));
    expect((await getSettings()).apiKey).toBe('sk-ant-env');
    // An explicitly-cleared key stays cleared (matches the pre-#1326 `??` chain).
    fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: '', model: 'claude-sonnet-5' }));
    expect((await getSettings()).apiKey).toBe('');
  });
});
