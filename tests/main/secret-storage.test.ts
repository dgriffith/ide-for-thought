/**
 * At-rest secret encryption (#1326).
 *
 * Wraps Electron `safeStorage` behind a version-tagged encode/decode so the
 * read path can distinguish an encrypted value from a legacy plaintext one —
 * the property that makes the migration backward-compatible. The real
 * `safeStorage` needs an Electron runtime + OS keychain, so we mock it with a
 * reversible fake and a toggleable availability flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret', warn: [] as unknown[][], throws: false }));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => { if (state.throws) throw new Error('not ready'); return state.available; },
    getSelectedStorageBackend: () => state.backend,
    encryptString: (s: string) => Buffer.from('FAKEENC:' + s, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('FAKEENC:')) throw new Error('bad ciphertext');
      return s.slice('FAKEENC:'.length);
    },
  },
}));

vi.mock('../../src/shared/logger', () => ({
  logger: () => ({ warn: (...a: unknown[]) => { state.warn.push(a); }, info: () => {}, error: () => {}, debug: () => {} }),
}));

import {
  encryptSecret, decryptSecret, isEncrypted, secretStorageStatus, secretEncryptionAvailable,
  _resetPlaintextWarningForTests,
} from '../../src/main/secret-storage';

const realPlatform = process.platform;
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p });

beforeEach(() => {
  state.available = true;
  state.backend = 'gnome_libsecret';
  state.warn = [];
  state.throws = false;
  setPlatform(realPlatform);
  _resetPlaintextWarningForTests();
});

describe('secret-storage (#1326)', () => {
  it('round-trips through safeStorage and never exposes the plaintext', () => {
    const key = 'sk-ant-abc123';
    const enc = encryptSecret(key);
    expect(enc).not.toBe(key);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain(key); // ciphertext, not the key
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(key);
  });

  it('reads a legacy plaintext value unchanged (backward compat)', () => {
    expect(decryptSecret('sk-ant-legacy')).toBe('sk-ant-legacy');
    expect(isEncrypted('sk-ant-legacy')).toBe(false);
  });

  it('handles empty strings on both paths', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('falls back to plaintext when encryption is unavailable', () => {
    state.available = false;
    const enc = encryptSecret('sk-ant-xyz');
    expect(enc).toBe('sk-ant-xyz');
    expect(isEncrypted(enc)).toBe(false);
    expect(decryptSecret(enc)).toBe('sk-ant-xyz');
  });

  it('returns empty string when a tagged value cannot be decrypted', () => {
    const undecryptable = 'enc:v1:' + Buffer.from('not-real-ciphertext').toString('base64');
    expect(decryptSecret(undecryptable)).toBe('');
  });

  // Guards the tag-collision assumption: the sentinel prefix must not appear at
  // the start of a plausible real secret, or a plaintext value would be
  // mistaken for ciphertext.
  it('the encrypted prefix does not collide with real secret shapes', () => {
    expect('sk-ant-api03-xyz'.startsWith('enc:v1:')).toBe(false);
    expect('a'.repeat(64).startsWith('enc:v1:')).toBe(false);
  });
});

describe('no OS key store is explicit, not silent (#2569)', () => {
  it('safeStorage off: plain text, reported as no-keystore, warned once per process', () => {
    state.available = false;
    expect(secretStorageStatus()).toEqual({ encrypted: false, reason: 'no-keystore' });
    expect(secretEncryptionAvailable()).toBe(false);
    expect(encryptSecret('sk-ant-1')).toBe('sk-ant-1');
    expect(encryptSecret('sk-ant-2')).toBe('sk-ant-2');
    expect(state.warn).toHaveLength(1);
    expect(String(state.warn[0]![0])).toMatch(/plain text/);
  });

  it('Linux basic_text counts as unencrypted: no enc: tag that would claim otherwise', () => {
    setPlatform('linux');
    state.backend = 'basic_text';
    expect(secretStorageStatus()).toEqual({ encrypted: false, reason: 'linux-basic-text' });
    const stored = encryptSecret('refresh-token');
    expect(stored).toBe('refresh-token');
    expect(isEncrypted(stored)).toBe(false);
    expect(String(state.warn[0]![0])).toMatch(/basic_text/);
  });

  it('a value encrypted earlier under basic_text still reads back', () => {
    const earlier = encryptSecret('k'); // libsecret-era
    setPlatform('linux');
    state.backend = 'basic_text';
    expect(decryptSecret(earlier)).toBe('k');
  });

  it('a real keyring on Linux, or any other platform, is encrypted and silent', () => {
    setPlatform('linux');
    state.backend = 'kwallet6';
    expect(secretStorageStatus()).toEqual({ encrypted: true, reason: 'os-keystore' });
    setPlatform('darwin');
    state.backend = 'basic_text'; // ignored off Linux
    expect(isEncrypted(encryptSecret('k'))).toBe(true);
    expect(state.warn).toHaveLength(0);
  });

  it('an availability probe that throws (app not ready) reads as no-keystore', () => {
    state.throws = true;
    expect(secretStorageStatus()).toEqual({ encrypted: false, reason: 'no-keystore' });
    expect(encryptSecret('k')).toBe('k');
  });
});
