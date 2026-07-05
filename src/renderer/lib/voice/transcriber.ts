/**
 * Front for the Whisper Web Worker (#voice).
 *
 * Owns the worker's lifecycle and multiplexes transcription requests by id,
 * mirroring the main-process `embedder-service` pattern. The worker (and the
 * ~50MB model download it triggers) is created lazily on first `preload`/
 * `transcribe`, so the cost is only paid once the user actually reaches for
 * voice — the renderer's initial load stays lean.
 */

import type { WhisperRequest, WhisperResponse } from './messages';

export interface LoadProgress {
  status: string;
  loaded?: number | undefined;
  total?: number | undefined;
}

export interface Transcriber {
  /** Spin up the worker and download/warm the model. Idempotent. */
  preload(): Promise<void>;
  /** Transcribe 16 kHz mono samples to text. */
  transcribe(pcm: Float32Array): Promise<string>;
  /** Subscribe to model-download/warm progress. Returns an unsubscribe fn. */
  onProgress(cb: (p: LoadProgress) => void): () => void;
  /** Tear down the worker (releases the model from memory). */
  dispose(): void;
}

export function createTranscriber(model: string): Transcriber {
  let worker: Worker | null = null;
  let readyPromise: Promise<void> | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  const progressCbs = new Set<(p: LoadProgress) => void>();

  function ensureWorker(): Worker {
    if (worker) return worker;
    const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
      name: 'whisper',
    });
    w.onmessage = (e: MessageEvent<WhisperResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress':
          for (const cb of progressCbs) cb({ status: msg.status, loaded: msg.loaded, total: msg.total });
          break;
        case 'ready':
          resolveReady?.();
          break;
        case 'result': {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.resolve(msg.text);
          }
          break;
        }
        case 'error': {
          if (msg.id !== undefined) {
            const p = pending.get(msg.id);
            if (p) {
              pending.delete(msg.id);
              p.reject(new Error(msg.message));
            }
          } else {
            rejectReady?.(new Error(msg.message));
          }
          break;
        }
      }
    };
    w.onerror = (e) => {
      console.error('[voice] worker error:', e.message, e);
      const err = new Error(e.message || 'voice worker crashed');
      rejectReady?.(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
    worker = w;
    return w;
  }

  let resolveReady: (() => void) | null = null;
  let rejectReady: ((e: Error) => void) | null = null;

  function preload(): Promise<void> {
    if (!readyPromise) {
      const w = ensureWorker();
      readyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = (e) => {
          // Let a later preload retry after a failed download.
          readyPromise = null;
          reject(e);
        };
      });
      post(w, { type: 'load', model });
    }
    return readyPromise;
  }

  function post(w: Worker, msg: WhisperRequest): void {
    w.postMessage(msg);
  }

  async function transcribe(pcm: Float32Array): Promise<string> {
    await preload();
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Transfer the sample buffer rather than copying it across the boundary.
      w.postMessage({ type: 'transcribe', id, pcm } satisfies WhisperRequest, [pcm.buffer]);
    });
  }

  function onProgress(cb: (p: LoadProgress) => void): () => void {
    progressCbs.add(cb);
    return () => progressCbs.delete(cb);
  }

  function dispose(): void {
    worker?.terminate();
    worker = null;
    readyPromise = null;
    resolveReady = null;
    rejectReady = null;
    for (const p of pending.values()) p.reject(new Error('transcriber disposed'));
    pending.clear();
  }

  return { preload, transcribe, onProgress, dispose };
}
