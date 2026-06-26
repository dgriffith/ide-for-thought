import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createWasmEmbedder } from '../../../src/main/embeddings/wasm-embedder';
import { cosineSimilarity } from '../../../src/main/embeddings/pooling';
import { MODEL, modelDir } from '../../../src/main/embeddings/embedder';
import type { Embedder } from '../../../src/main/embeddings/embedder';

// Real model inference — needs the bundled weights staged by
// scripts/fetch-embedding-model.mjs. Skip (don't fail) when they're absent so a
// no-network checkout still passes the rest of the suite.
const haveModel = fs.existsSync(path.join(modelDir(), 'onnx', 'model_quantized.onnx'));
const d = haveModel ? describe : describe.skip;

d('createWasmEmbedder (WASM, all-MiniLM-L6-v2)', () => {
  let embedder: Embedder;
  beforeAll(async () => { embedder = await createWasmEmbedder(); }, 60_000);
  afterAll(async () => { await embedder?.dispose(); });

  it('emits one 384-dim L2-normalized vector per input', async () => {
    const [v] = await embedder.embed(['hello world']);
    expect(v).toHaveLength(MODEL.dim);
    expect(Math.hypot(...v)).toBeCloseTo(1, 4); // unit length
  });

  it('returns [] for an empty batch without calling the model', async () => {
    expect(await embedder.embed([])).toEqual([]);
  });

  it('places semantically related text closer than unrelated text', async () => {
    const [cat, feline, revenue] = await embedder.embed([
      'The cat sat on the mat.',
      'A feline rested on the rug.',
      'Quarterly revenue exceeded forecasts.',
    ]);
    const near = cosineSimilarity(cat, feline);
    const far = cosineSimilarity(cat, revenue);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.4); // genuinely related, not just relatively
    expect(far).toBeLessThan(0.3);
  });

  it('is deterministic — same text embeds identically across calls', async () => {
    const [a] = await embedder.embed(['reproducible']);
    const [b] = await embedder.embed(['reproducible']);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
}, 60_000);
