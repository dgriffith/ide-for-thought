/**
 * Persist the decoded pairing (port + secret) in `chrome.storage.local`.
 * Thin chrome glue around the shared `decodePairingCode` codec.
 */

import { decodePairingCode, type PairingPayload } from '../../src/shared/clipper-pairing';

const KEY = 'pairing';

export async function loadPairing(): Promise<PairingPayload | null> {
  const got = await chrome.storage.local.get(KEY);
  const p = got[KEY] as Partial<PairingPayload> | undefined;
  if (p && typeof p.port === 'number' && typeof p.secret === 'string') {
    return { v: 1, port: p.port, secret: p.secret };
  }
  return null;
}

/** Decode + store a pairing code. Returns the pairing, or null if malformed. */
export async function savePairingCode(code: string): Promise<PairingPayload | null> {
  const decoded = decodePairingCode(code);
  if (!decoded) return null;
  await chrome.storage.local.set({ [KEY]: decoded });
  return decoded;
}

export async function clearPairing(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
