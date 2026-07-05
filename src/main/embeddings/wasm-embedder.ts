/**
 * The shipped embedder (#834): all-MiniLM-L6-v2 via onnxruntime-web (WASM).
 *
 * No native binaries: tokenization is our pure-JS WordPiece (`wordpiece.ts`) and
 * inference is `onnxruntime-web` (a few MB of `.wasm`), vs the ~100 MB native
 * onnxruntime-node that transformers.js would have dragged in. Fully offline —
 * the model + vocab load from the bundled `resources/models` dir.
 *
 * Pipeline: WordPiece encode → pad batch → ORT-web session (`last_hidden_state`)
 * → attention-masked mean pool → L2 normalize (`pooling.ts`). 384-dim, ~10 ms/text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { meanPoolNormalize } from './pooling';
import { createWordPieceTokenizer, type WordPieceTokenizer, type TokenizerJson } from './wordpiece';
import { MODEL, modelDir, type Embedder } from './embedder';

export interface WasmEmbedderOptions {
  /** `process.resourcesPath` in the packaged app; omit in dev/test (resolves
   *  against the repo's `resources/` via cwd). */
  resourcesBase?: string;
  /** Directory ORT-web should load its `.wasm` from, for the packaged app where
   *  the default relative resolution doesn't find them. Omit in dev/test. */
  wasmPaths?: string;
}

export async function createWasmEmbedder(opts: WasmEmbedderOptions = {}): Promise<Embedder> {
  const ortNS = await import('onnxruntime-web');
  const ort = (ortNS as { default?: typeof import('onnxruntime-web') }).default ?? ortNS;
  if (opts.wasmPaths) {
    ort.env.wasm.wasmPaths = opts.wasmPaths.endsWith('/') ? opts.wasmPaths : `${opts.wasmPaths}/`;
  }

  const dir = modelDir(opts.resourcesBase);
  const tokenizerJson = JSON.parse(
    fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf-8'),
  ) as TokenizerJson;
  const tokenizer: WordPieceTokenizer = createWordPieceTokenizer(tokenizerJson);
  const session = await ort.InferenceSession.create(path.join(dir, 'onnx', 'model_quantized.onnx'));
  const needsTokenType = session.inputNames.includes('token_type_ids');
  const outName = session.outputNames[0]!;

  return {
    dim: MODEL.dim,

    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];

      // Encode + truncate each to the model's max length (keeping the trailing
      // [SEP]); pad the batch to its longest row.
      const rows = texts.map((t) => truncate(tokenizer.encode(t), MODEL.maxTokens, tokenizer.sepId));
      const seq = Math.max(...rows.map((r) => r.length));
      const batch = rows.length;

      const ids = new BigInt64Array(batch * seq);
      const mask = new BigInt64Array(batch * seq);
      for (let b = 0; b < batch; b++) {
        const row = rows[b]!;
        for (let s = 0; s < row.length; s++) {
          ids[b * seq + s] = BigInt(row[s]!);
          mask[b * seq + s] = 1n;
        }
        // remaining positions stay 0 → [PAD] id 0, attention 0
      }

      const dims = [batch, seq];
      const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
        input_ids: new ort.Tensor('int64', ids, dims),
        attention_mask: new ort.Tensor('int64', mask, dims),
      };
      if (needsTokenType) {
        feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(batch * seq), dims);
      }

      const out = await session.run(feeds);
      const last = out[outName]!;
      const [, , dim] = last.dims as [number, number, number];
      const data = last.data as Float32Array;

      const vectors: Float32Array[] = [];
      for (let b = 0; b < batch; b++) {
        const tokens = data.subarray(b * seq * dim, (b + 1) * seq * dim);
        const rowMask = mask.subarray(b * seq, (b + 1) * seq);
        vectors.push(meanPoolNormalize(tokens, toNumbers(rowMask), seq, dim));
      }
      return vectors;
    },

    async dispose(): Promise<void> {
      try { await session.release(); } catch { /* already gone */ }
    },
  };
}

/** Cap a token sequence at `max`, preserving the final [SEP]. */
function truncate(ids: number[], max: number, sepId: number): number[] {
  if (ids.length <= max) return ids;
  return [...ids.slice(0, max - 1), sepId];
}

function toNumbers(mask: BigInt64Array): number[] {
  const out = new Array<number>(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = Number(mask[i]);
  return out;
}
