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
 * When there is no real OS key store, secrets are stored as plain text, and
 * that is explicit rather than silent (#2569):
 *  - "No real key store" includes Linux's `basic_text` backend. There
 *    `isEncryptionAvailable()` says true, but the "encryption" uses a key
 *    compiled into Chromium, so the bytes are only obfuscated. Wrapping them in
 *    `enc:v1:` would make Settings claim "encrypted at rest" for what is in
 *    effect plain text. So we treat it as unavailable.
 *  - `secretStorageStatus()` says which case applies, and why. Settings shows
 *    it as a persistent note beside the keys. The first plaintext write in a
 *    process logs one warning.
 *  - Nothing is refused. Refusing to save an API key or OAuth refresh token on
 *    a machine with no keyring would leave Minerva unusable there, which
 *    would protect nobody. The user is told the truth where they enter the
 *    secret, and the file is 0600 (#2562).
 * This is tracked against the cross-platform epic (#2198): macOS always has
 * the Keychain, so today this only affects ports.
 */
import { safeStorage } from 'electron';
import { logger } from '../shared/logger';
import type { SecretStorageStatus } from '../shared/secret-storage-status';

/**
 * Marks a `safeStorage`-encrypted, base64-encoded value. A real Anthropic key
 * (`sk-ant-…`) or a hex clipper secret never begins with this, so its absence
 * unambiguously means "legacy plaintext" — the basis for the migration.
 */
const ENC_PREFIX = 'enc:v1:';

/**
 * How a secret written now would be stored, and why (#2569). Read fresh each
 * time: on Linux the backend is only known once the app is ready.
 */
export function secretStorageStatus(): SecretStorageStatus {
  try {
    if (typeof safeStorage?.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) {
      return { encrypted: false, reason: 'no-keystore' };
    }
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function'
      && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      return { encrypted: false, reason: 'linux-basic-text' };
    }
    return { encrypted: true, reason: 'os-keystore' };
  } catch {
    // isEncryptionAvailable can throw before the app is ready on some platforms.
    return { encrypted: false, reason: 'no-keystore' };
  }
}

function encryptionAvailable(): boolean {
  return secretStorageStatus().encrypted;
}

/**
 * Whether a secret written now would really be encrypted at rest by an OS key
 * store (#1326). Linux's `basic_text` counts as no (#2569).
 */
export function secretEncryptionAvailable(): boolean {
  return encryptionAvailable();
}

let warnedPlaintext = false;
/** One log line per process the first time a secret is stored in the clear. */
function notePlaintextWrite(): void {
  if (warnedPlaintext) return;
  warnedPlaintext = true;
  const { reason } = secretStorageStatus();
  logger('secrets').warn(
    reason === 'linux-basic-text'
      ? 'no OS key store (Linux basic_text backend; install/unlock a Secret Service such as gnome-keyring or KWallet) — secrets are stored as plain text, in owner-only files'
      : 'no OS key store available — secrets are stored as plain text, in owner-only files',
  );
}

/** Test-only: re-arm the once-per-process plaintext warning. */
export function _resetPlaintextWarningForTests(): void {
  warnedPlaintext = false;
}

/**
 * Encode a secret for on-disk storage. Empty in → empty out. Encrypts when
 * `safeStorage` is available; otherwise returns the plaintext unchanged (same
 * as the pre-#1326 behavior).
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (!encryptionAvailable()) {
    notePlaintextWrite();
    return plain;
  }
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    // Never lose the user's secret to a transient encryption failure — the
    // worst case degrades to the old plaintext-at-rest behavior.
    notePlaintextWrite();
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
