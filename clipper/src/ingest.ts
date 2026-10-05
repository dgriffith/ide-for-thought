/**
 * Talk to Minerva's loopback clipper endpoint (#790/#791). Pure transport —
 * `fetch` is injectable so it's unit-testable without a browser or a server.
 *
 * The POST goes out from the extension service worker (not a content script),
 * so its Origin is `chrome-extension://…` — which the app's endpoint allows;
 * a content-script Origin (the page's `http(s)://`) is rejected with 403.
 */

import { CLIPPER_CHALLENGE_HEADER, clipperProofMessage, type PairingPayload } from '../../src/shared/clipper-pairing';
import type { ClipPayload } from './payload';

const SECRET_HEADER = 'x-minerva-clipper-secret';

export interface ClipResult {
  ok: boolean;
  /** Set on success. */
  sourceId?: string | undefined;
  duplicate?: boolean | undefined;
  title?: string | undefined;
  excerptId?: string | undefined;
  /** Human-readable failure reason. */
  error?: string;
}

function endpoint(pairing: PairingPayload, path: string): string {
  return `http://127.0.0.1:${pairing.port}${path}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pairings whose server proved itself in this service-worker lifetime. */
const verified = new Set<string>();

/**
 * Make the server at the paired port prove it holds the secret BEFORE we send
 * the secret or a page to it (#2567). Something squatting the paired port
 * (Minerva then listens elsewhere) can neither compute the proof nor relay the
 * real server's — that proof is bound to the real server's port.
 *
 * An app too old to answer the challenge (401 without a proof) is accepted, so
 * an extension update doesn't break against an older Minerva; it's the
 * impostor answering with a WRONG proof, or no proof on 200, that's refused.
 */
export async function verifyServer(pairing: PairingPayload, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const key = `${pairing.port}:${pairing.secret}`;
  if (verified.has(key)) return null;
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  let res: Response;
  try {
    res = await fetchImpl(endpoint(pairing, '/ping'), { headers: { [CLIPPER_CHALLENGE_HEADER]: nonce } });
  } catch {
    return 'Minerva isn’t reachable — is it running with a thoughtbase open?';
  }
  if (res.status === 401) return null; // pre-#2567 app: no challenge support
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const expected = await hmacHex(pairing.secret, clipperProofMessage(nonce, pairing.port));
  if (!res.ok || body.proof !== expected) {
    return 'Something other than Minerva is answering on the paired port — open Minerva, then re-pair the extension in its Settings.';
  }
  verified.add(key);
  return null;
}

/** Test seam: forget verified pairings. */
export function _resetVerifiedServersForTests(): void {
  verified.clear();
}

/** POST a clip; resolves to a `ClipResult` (never throws — errors are mapped). */
export async function sendClip(
  pairing: PairingPayload,
  payload: ClipPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<ClipResult> {
  const impostor = await verifyServer(pairing, fetchImpl);
  if (impostor) return { ok: false, error: impostor };
  let res: Response;
  try {
    res = await fetchImpl(endpoint(pairing, '/ingest'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SECRET_HEADER]: pairing.secret },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'Minerva isn’t reachable — is it running with a thoughtbase open?' };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch { /* non-JSON / empty body */ }

  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    return { ok: false, error: reason };
  }
  return {
    ok: true,
    sourceId: typeof body.sourceId === 'string' ? body.sourceId : undefined,
    duplicate: typeof body.duplicate === 'boolean' ? body.duplicate : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
    excerptId: typeof body.excerptId === 'string' ? body.excerptId : undefined,
  };
}

export interface PreviewResult {
  ok: boolean;
  /** Canonical source id the save would produce (e.g. `arxiv-2604.18561`). */
  sourceId?: string | undefined;
  method?: string | undefined;
  title?: string | undefined;
  error?: string;
}

/** Ask the app for the canonical source id a clip would produce (no write). */
export async function preview(
  pairing: PairingPayload,
  payload: { url: string; html: string },
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewResult> {
  const impostor = await verifyServer(pairing, fetchImpl);
  if (impostor) return { ok: false, error: impostor };
  let res: Response;
  try {
    res = await fetchImpl(endpoint(pairing, '/preview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SECRET_HEADER]: pairing.secret },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'Minerva isn’t reachable.' };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
  }
  return {
    ok: true,
    sourceId: typeof body.sourceId === 'string' ? body.sourceId : undefined,
    method: typeof body.method === 'string' ? body.method : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
  };
}

export interface PingResult {
  ok: boolean;
  projectOpen?: boolean;
  error?: string;
}

/** Verify a pairing: secret accepted + whether a thoughtbase is open. */
export async function ping(
  pairing: PairingPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<PingResult> {
  const impostor = await verifyServer(pairing, fetchImpl);
  if (impostor) return { ok: false, error: impostor };
  let res: Response;
  try {
    res = await fetchImpl(endpoint(pairing, '/ping'), {
      headers: { [SECRET_HEADER]: pairing.secret },
    });
  } catch {
    return { ok: false, error: 'Not reachable' };
  }
  if (res.status === 401) return { ok: false, error: 'Secret rejected — re-pair the extension.' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: true, projectOpen: body.projectOpen === true };
}
