/**
 * LLM settings — per-provider credentials, at-rest encryption + backward
 * compatibility (#1326, BYOM #1494).
 *
 * `saveSettings` encrypts each provider's key on disk under a `providers` map;
 * `getSettings` decrypts transparently, folds in each provider's env var as a
 * fallback, and still reads the pre-BYOM single-`apiKey` layout (migrated into
 * `providers.anthropic`). Stubs `app.getPath('userData')` to a temp dir and
 * mocks `safeStorage` with a reversible fake (mirrors clipper-config.test).
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
    encryptString: vi.fn((s: string) => Buffer.from('FAKEENC:' + s, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('FAKEENC:')) throw new Error('bad ciphertext');
      return s.slice('FAKEENC:'.length);
    }),
  },
}));

import { safeStorage } from 'electron';
import { getSettings, getSettingsForDisplay, saveSettings, getApiKeyStorage } from '../../../src/main/llm/settings';
import type { LLMSettingsUpdate } from '../../../src/shared/tools/types';

const settingsFile = () => path.join(tempDir, 'llm-settings.json');
const base: LLMSettingsUpdate = {
  model: 'claude-sonnet-5',
  web: { enabled: false, allowedDomains: [], blockedDomains: [] },
};

/** The decrypted Anthropic key on the call path. */
const anthropicKey = async () => (await getSettings()).providers.anthropic?.apiKey;
/** The raw on-disk Anthropic key (encrypted / plaintext), or undefined. */
const onDiskAnthropic = (): string | undefined =>
  JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')).providers?.anthropic?.apiKey;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-llm-settings-'));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  vi.clearAllMocks();
});
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('llm settings — API key at-rest encryption (#1326)', () => {
  it('reads a legacy plaintext apiKey unchanged (backward compat → providers.anthropic)', async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: 'sk-ant-legacy', model: 'claude-sonnet-5' }));
    expect(await anthropicKey()).toBe('sk-ant-legacy');
  });

  it('encrypts the apiKey on save and decrypts it on read', async () => {
    await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
    const onDisk = fs.readFileSync(settingsFile(), 'utf-8');
    expect(onDisk).not.toContain('sk-ant-secret');
    expect(onDiskAnthropic()!.startsWith('enc:v1:')).toBe(true);
    expect(await anthropicKey()).toBe('sk-ant-secret');
  });

  it('migrates a legacy plaintext key to the providers map, encrypted, on the next save', async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: 'sk-ant-old', model: 'claude-sonnet-5' }));
    const loaded = await getSettings();
    expect(loaded.providers.anthropic?.apiKey).toBe('sk-ant-old');
    await saveSettings(loaded);
    const onDisk = fs.readFileSync(settingsFile(), 'utf-8');
    expect(onDisk).not.toContain('sk-ant-old');
    expect(JSON.parse(onDisk).apiKey).toBeUndefined();      // legacy top-level field gone
    expect(onDiskAnthropic()!.startsWith('enc:v1:')).toBe(true);
  });

  it('falls back to the env var when apiKey is absent, but respects an explicit empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
    fs.writeFileSync(settingsFile(), JSON.stringify({ model: 'claude-sonnet-5' }));
    expect(await anthropicKey()).toBe('sk-ant-env');
    // An explicitly-cleared key stays cleared (matches the pre-#1326 `??` chain).
    fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: '', model: 'claude-sonnet-5' }));
    expect(await anthropicKey()).toBeUndefined();
  });

  describe('display read + keep-on-save never touch the keychain', () => {
    it('getSettingsForDisplay reports a key without decrypting it', async () => {
      await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
      vi.clearAllMocks();
      const view = await getSettingsForDisplay();
      expect(view.hasApiKey).toBe(true);
      expect(view.providers.anthropic?.hasApiKey).toBe(true);
      expect(view.model).toBe('claude-sonnet-5');
      expect((view as { apiKey?: string }).apiKey).toBeUndefined(); // no plaintext leaks out
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
    });

    it('getSettingsForDisplay: hasApiKey false when cleared, true from env', async () => {
      fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: '', model: 'claude-sonnet-5' }));
      expect((await getSettingsForDisplay()).hasApiKey).toBe(false);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env';
      fs.writeFileSync(settingsFile(), JSON.stringify({ model: 'claude-sonnet-5' }));
      expect((await getSettingsForDisplay()).hasApiKey).toBe(true);
    });

    it('saving without an apiKey preserves the stored key verbatim, no decrypt/encrypt', async () => {
      await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
      const encrypted = onDiskAnthropic();
      vi.clearAllMocks();
      // A settings save that doesn't touch the key omits apiKey entirely.
      await saveSettings({ model: 'claude-opus-4-8', web: base.web });
      const after = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'));
      expect(after.providers.anthropic.apiKey).toBe(encrypted); // byte-for-byte preserved
      expect(after.model).toBe('claude-opus-4-8');              // the actual edit landed
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      // And the key still decrypts for the API-call path.
      expect(await anthropicKey()).toBe('sk-ant-secret');
    });

    it('an explicit empty apiKey clears the stored key', async () => {
      await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
      await saveSettings({ model: base.model, web: base.web, apiKey: '' });
      expect(onDiskAnthropic()).toBe('');
      expect((await getSettingsForDisplay()).hasApiKey).toBe(false);
    });
  });

  describe('getApiKeyStorage — settings-panel indicator (#1326)', () => {
    it('reports available + not-encrypted when no key is stored', async () => {
      expect(await getApiKeyStorage()).toEqual({ available: true, encrypted: false });
    });

    it('reports encrypted after a key is saved', async () => {
      await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
      expect(await getApiKeyStorage()).toEqual({ available: true, encrypted: true });
    });

    it('reports NOT-encrypted for a legacy plaintext key until it is re-saved', async () => {
      fs.writeFileSync(settingsFile(), JSON.stringify({ apiKey: 'sk-ant-legacy', model: 'claude-sonnet-5' }));
      expect(await getApiKeyStorage()).toEqual({ available: true, encrypted: false });
      // Re-saving migrates it to encrypted, which the indicator then reflects.
      await saveSettings(await getSettings());
      expect(await getApiKeyStorage()).toEqual({ available: true, encrypted: true });
    });
  });

  describe('multi-provider credentials (BYOM #1494)', () => {
    it('stores + reads a per-provider key without disturbing the others', async () => {
      await saveSettings({ ...base, apiKey: 'sk-ant-secret' });
      await saveSettings({ model: base.model, providers: { openai: { apiKey: 'sk-openai' } } });
      const s = await getSettings();
      expect(s.providers.anthropic?.apiKey).toBe('sk-ant-secret'); // untouched
      expect(s.providers.openai?.apiKey).toBe('sk-openai');
      // Each key is encrypted at rest independently.
      const onDisk = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'));
      expect(onDisk.providers.openai.apiKey.startsWith('enc:v1:')).toBe(true);
    });

    it('folds each provider env var in as a fallback', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai-env';
      process.env.GEMINI_API_KEY = 'sk-gemini-env';
      const s = await getSettings();
      expect(s.providers.openai?.apiKey).toBe('sk-openai-env');
      expect(s.providers.google?.apiKey).toBe('sk-gemini-env');
      const view = await getSettingsForDisplay();
      expect(view.providers.openai?.hasApiKey).toBe(true);
      expect(view.providers.google?.hasApiKey).toBe(true);
    });

    it('persists a local baseURL and treats a keyless local endpoint as configured once it has one', async () => {
      await saveSettings({ model: base.model, providers: { local: { baseURL: 'http://localhost:11434/v1' } } });
      expect((await getSettings()).providers.local?.baseURL).toBe('http://localhost:11434/v1');
      expect((await getSettingsForDisplay()).providers.local?.hasApiKey).toBe(true); // keyless, but has an endpoint
    });

    it('getApiKeyStorage targets the requested provider', async () => {
      await saveSettings({ model: base.model, providers: { openai: { apiKey: 'sk-openai' } } });
      expect(await getApiKeyStorage('openai')).toEqual({ available: true, encrypted: true });
      expect(await getApiKeyStorage('anthropic')).toEqual({ available: true, encrypted: false });
    });
  });

  describe('per-skill model overrides round-trip (#...)', () => {
    it('reads back the saved override map — the API path and the settings view', async () => {
      await saveSettings({ ...base, toolModelOverrides: { 'extract-key-claims': 'claude-opus-4-8' } });
      expect((await getSettings()).toolModelOverrides).toEqual({ 'extract-key-claims': 'claude-opus-4-8' });
      expect((await getSettingsForDisplay()).toolModelOverrides).toEqual({ 'extract-key-claims': 'claude-opus-4-8' });
    });

    it('omits the field entirely when no overrides are stored', async () => {
      await saveSettings({ ...base });
      expect((await getSettings()).toolModelOverrides).toBeUndefined();
      expect((await getSettingsForDisplay()).toolModelOverrides).toBeUndefined();
    });

    it('drops empty / non-string entries and an empty map', async () => {
      fs.writeFileSync(settingsFile(), JSON.stringify({
        model: 'claude-sonnet-5',
        toolModelOverrides: { good: 'claude-opus-4-8', blank: '', bad: 42 },
      }));
      expect((await getSettings()).toolModelOverrides).toEqual({ good: 'claude-opus-4-8' });

      fs.writeFileSync(settingsFile(), JSON.stringify({ model: 'claude-sonnet-5', toolModelOverrides: {} }));
      expect((await getSettings()).toolModelOverrides).toBeUndefined();
    });
  });
});
