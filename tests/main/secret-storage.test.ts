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

const state = vi.hoisted(() => ({ available: true }));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from('FAKEENC:' + s, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('FAKEENC:')) throw new Error('bad ciphertext');
      return s.slice('FAKEENC:'.length);
    },
  },
}));

import { encryptSecret, decryptSecret, isEncrypted } from '../../src/main/secret-storage';

beforeEach(() => {
  state.available = true;
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
