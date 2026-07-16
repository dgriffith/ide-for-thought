/**
 * At-rest encryption for the handful of secrets Minerva persists under
 * `userData` — the Anthropic API key (`llm-settings.json`) and the
 * browser-clipper shared secret (`clipper-config.json`) (#1326).
 *
 * Values are wrapped with Electron `safeStorage` (Keychain on macOS, DPAPI on
 * Windows, libsecret/kwallet on Linux) and tagged with a version prefix so the
 * read path can tell an encrypted value from a legacy plaintext one. That tag
 * is what makes the migration **backward-compatible**: an existing plaintext
 * config still decrypts (returned verbatim), and the value is re-stored
 * encrypted the next time its config is written.
 *
 * When `safeStorage` is unavailable (e.g. Linux with no keyring, or before the
 * app is `ready`) we fall back to storing plaintext — encryption at rest is a
 * hardening measure, not a boundary that should ever cost the user their API
 * key, and this preserves the prior behavior exactly.
 */
import { safeStorage } from 'electron';

/**
 * Marks a `safeStorage`-encrypted, base64-encoded value. A real Anthropic key
 * (`sk-ant-…`) or a hex clipper secret never begins with this, so its absence
 * unambiguously means "legacy plaintext" — the basis for the migration.
 */
const ENC_PREFIX = 'enc:v1:';

function encryptionAvailable(): boolean {
  try {
    return (
      typeof safeStorage?.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
    );
  } catch {
    // isEncryptionAvailable can throw before the app is ready on some platforms.
    return false;
  }
}

/**
 * Encode a secret for on-disk storage. Empty in → empty out. Encrypts when
 * `safeStorage` is available; otherwise returns the plaintext unchanged (same
 * as the pre-#1326 behavior).
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (!encryptionAvailable()) return plain;
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    // Never lose the user's secret to a transient encryption failure — the
    // worst case degrades to the old plaintext-at-rest behavior.
    return plain;
  }
}

/**
 * Decode a stored secret, transparently handling both the encrypted
 * (`enc:v1:` prefix) and legacy plaintext forms. Returns '' when an encrypted
 * value can't be decrypted (e.g. the OS keychain entry was rotated or the
 * profile moved machines) rather than surfacing ciphertext to a caller that
 * expects a usable key.
 */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext
  const b64 = stored.slice(ENC_PREFIX.length);
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return '';
  }
}

/** True when a stored value is in the encrypted (tagged) form. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}
