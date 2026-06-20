/**
 * Browser-clipper pairing code (#791).
 *
 * The app shows a single copy-paste token that carries everything the
 * extension needs to talk to the loopback endpoint: the port and the shared
 * secret. Encoded as base64url'd JSON so it's one opaque string the user
 * pastes once — `encodePairingCode` in the app (Settings), `decodePairingCode`
 * in the extension (#792). Host is always loopback, so it isn't carried.
 */

export interface PairingPayload {
  v: 1;
  port: number;
  secret: string;
}

/** What the Settings UI shows for the clipper (#791). */
export interface ClipperState {
  enabled: boolean;
  /** The loopback server is currently listening (needs enabled + a project open). */
  running: boolean;
  port: number | null;
  secret: string;
  /** Copy-paste pairing token — present only while running (port known). */
  pairingCode: string | null;
}

// `btoa`/`atob` (global in Node 16+ and every browser) keep this importable
// from the browser extension (#792), where `Buffer` doesn't exist. The payload
// is ASCII (digits, hex secret, JSON punctuation), so the Latin1 round-trip
// btoa requires is safe; forgiving-base64 in both runtimes tolerates the
// stripped `=` padding on decode.
function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

export function encodePairingCode(port: number, secret: string): string {
  const payload: PairingPayload = { v: 1, port, secret };
  return toBase64Url(JSON.stringify(payload));
}

/** Decode a pairing code, or null if it's malformed / wrong version. */
export function decodePairingCode(code: string): PairingPayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(code.trim())) as Partial<PairingPayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.port !== 'number' || !Number.isInteger(parsed.port)) return null;
    if (typeof parsed.secret !== 'string' || parsed.secret === '') return null;
    return { v: 1, port: parsed.port, secret: parsed.secret };
  } catch {
    return null;
  }
}
