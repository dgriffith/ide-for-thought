/**
 * The embedder interface (#834) — the thin seam the rest of the semantic-search
 * subsystem (vector store #835, search_related #837, …) talks to, so the model
 * and runtime stay swappable.
 *
 * The shipped implementation is `wasm-embedder.ts`: all-MiniLM-L6-v2 (384-dim,
 * int8-quantized) run through onnxruntime-web (WASM) fully offline. WASM rather
 * than the native onnxruntime-node binary is a deliberate packaging choice —
 * a few MB of `.wasm` vs a ~100 MB per-platform native lib, with speed
 * (~10 ms/text) that's irrelevant at thoughtbase scale.
 */

import path from 'node:path';

export interface Embedder {
  /** Output dimensionality — 384 for all-MiniLM-L6-v2. Vectors are L2-normalized
   *  so cosine similarity is a dot product. */
  readonly dim: number;
  /** Embed a batch of texts, returning one normalized vector per input, in order.
   *  An empty input array returns an empty array (no model call). */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Release the underlying session / threads. Idempotent. */
  dispose(): Promise<void>;
}

/** The bundled model's identifier + dimensionality, in one place. */
export const MODEL = {
  name: 'all-MiniLM-L6-v2',
  dim: 384,
  /** Max tokens the model accepts; longer inputs are truncated by the tokenizer. */
  maxTokens: 256,
} as const;

/**
 * Absolute path to the bundled model directory.
 *
 * Resolution is electron-free on purpose (the worker thread + unit tests have no
 * `app`): pass `resourcesBase` = `process.resourcesPath` in the packaged app, or
 * omit it in dev/test to resolve against the repo's `resources/` (via cwd). The
 * model is staged there by `scripts/fetch-embedding-model.mjs` and shipped via
 * forge's `extraResource`.
 */
export function modelDir(resourcesBase?: string): string {
  const base = resourcesBase ?? path.join(process.cwd(), 'resources');
  return path.join(base, 'models', MODEL.name);
}
