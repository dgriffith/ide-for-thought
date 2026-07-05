/**
 * Talk to Minerva's loopback clipper endpoint (#790/#791). Pure transport —
 * `fetch` is injectable so it's unit-testable without a browser or a server.
 *
 * The POST goes out from the extension service worker (not a content script),
 * so its Origin is `chrome-extension://…` — which the app's endpoint allows;
 * a content-script Origin (the page's `http(s)://`) is rejected with 403.
 */

import type { PairingPayload } from '../../src/shared/clipper-pairing';
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

/** POST a clip; resolves to a `ClipResult` (never throws — errors are mapped). */
export async function sendClip(
  pairing: PairingPayload,
  payload: ClipPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<ClipResult> {
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
