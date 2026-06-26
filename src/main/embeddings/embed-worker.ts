/**
 * Worker-thread host for the WASM embedder (#834).
 *
 * Embedding is CPU-bound (WASM matmuls, ~10 ms/text) and would otherwise block
 * the main thread's event loop — felt most during the #836 backfill. So the
 * embedder runs here, off the main thread. Bundled as its own forge/vite entry
 * (`embed-worker.js`, beside `main.js`) so it shares the externalized
 * node_modules; `embedder-service.ts` spawns and talks to it.
 *
 * Protocol: `{ id, texts }` in → `{ id, vectors }` or `{ id, error }` out. The
 * model loads lazily on the first request and is reused for the worker's life.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { createWasmEmbedder, type WasmEmbedderOptions } from './wasm-embedder';
import type { Embedder } from './embedder';

if (!parentPort) throw new Error('embed-worker must run as a worker thread');
const port = parentPort;

let embedderPromise: Promise<Embedder> | null = null;
function embedder(): Promise<Embedder> {
  if (!embedderPromise) embedderPromise = createWasmEmbedder((workerData ?? {}) as WasmEmbedderOptions);
  return embedderPromise;
}

interface Request { id: number; texts: string[] }

port.on('message', (msg: Request) => {
  void (async () => {
    try {
      const vectors = await (await embedder()).embed(msg.texts);
      // Transfer the vector buffers to avoid copying them back across the thread.
      port.postMessage({ id: msg.id, vectors }, vectors.map((v) => v.buffer as ArrayBuffer));
    } catch (err) {
      port.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
