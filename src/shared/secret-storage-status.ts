/**
 * How Minerva stores secrets on this machine (#1326, #2569), for the settings
 * panels to state honestly.
 */
export interface SecretStorageStatus {
  /** A secret written now is encrypted by an OS key store. */
  encrypted: boolean;
  /**
   * `os-keystore`: Keychain / DPAPI / libsecret / KWallet.
   * `no-keystore`: none is available, so secrets are written as plain text.
   * `linux-basic-text`: Linux with no Secret Service. Chromium's fallback
   * only obfuscates, with a built-in key, so Minerva writes plain text and
   * says so instead of calling that encrypted.
   */
  reason: 'os-keystore' | 'no-keystore' | 'linux-basic-text';
}
