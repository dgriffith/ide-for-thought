/**
 * Main-process handle to the off-thread embedder (#834).
 *
 * Spawns `embed-worker.js` lazily (on first embed, so launch pays nothing) and
 * multiplexes requests over it by id. This is the seam the rest of the
 * semantic-search subsystem (vector store #835, search_related #837) calls — it
 * never touches onnxruntime-web or the worker directly.
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { MODEL } from './embedder';

export interface EmbedderService {
  /** 384 for all-MiniLM-L6-v2. */
  readonly dim: number;
  /** Embed a batch off the main thread. Empty input short-circuits (no worker). */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Terminate the worker. Idempotent; a later embed() respawns it. */
  dispose(): Promise<void>;
}

export interface EmbedderServiceOptions {
  /** `process.resourcesPath` in the packaged app; omit in dev. */
  resourcesBase?: string;
  /** Where ORT-web finds its `.wasm`, if the default resolution doesn't. */
  wasmPaths?: string;
  /** Override the worker path (tests). Defaults to `embed-worker.js` beside the
   *  bundled main. */
  workerPath?: string;
}

interface Pending {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}

export function createEmbedderService(opts: EmbedderServiceOptions = {}): EmbedderService {
  const workerPath = opts.workerPath ?? path.join(__dirname, 'embed-worker.js');
  const workerData = { resourcesBase: opts.resourcesBase, wasmPaths: opts.wasmPaths };

  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function ensureWorker(): Worker {
    if (worker) return worker;
    const w = new Worker(workerPath, { workerData });
    w.on('message', (msg: { id: number; vectors?: Float32Array[]; error?: string }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.vectors ?? []);
    });
    // A worker-level error (e.g. the model failed to load) rejects everything
    // in flight; the next embed() respawns a fresh worker.
    w.on('error', (err: Error) => {
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
    });
    worker = w;
    return w;
  }

  return {
    dim: MODEL.dim,

    embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return Promise.resolve([]);
      const w = ensureWorker();
      const id = nextId++;
      return new Promise<Float32Array[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, texts });
      });
    },

    async dispose(): Promise<void> {
      const w = worker;
      worker = null;
      if (w) await w.terminate();
    },
  };
}
