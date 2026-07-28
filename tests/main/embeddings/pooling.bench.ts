/**
 * Embedding hot-path throughput benchmark (#1004). Not run by `pnpm test` —
 * invoke with `pnpm bench`.
 *
 * Guards the two numeric loops that back local semantic search:
 *   - `meanPoolNormalize` — reduce a model's `[seq × dim]` token output to one
 *     sentence vector (runs once per embedded chunk);
 *   - `cosineSimilarity` — score a query vector against the corpus (runs once
 *     per candidate on every search).
 * A regression here scales with corpus size, so it's exactly the kind of thing
 * that silently degrades search as a vault grows.
 */
import { describe, bench } from 'vitest';
import { meanPoolNormalize, cosineSimilarity } from '../../../src/main/embeddings/pooling';

const DIM = 384;   // all-MiniLM-L6-v2 embedding width
const SEQ = 512;   // the model's max sequence length — the worst-case pool
const CORPUS = 10_000;

/** Deterministic filler so runs are comparable (no Math.random). */
function fill(v: Float32Array, phase: number): Float32Array {
  for (let i = 0; i < v.length; i++) v[i] = Math.sin(i + phase) * 0.1;
  return v;
}

// Setup at top-level, not in `beforeAll` — vitest's benchmark runner doesn't
// reliably finish an async `beforeAll` before a `bench`'s iterations start, so
// the bodies below would run against `undefined` arrays and error out (the same
// gap documented in n3-cold-rebuild.bench.ts, and the reason these two benches
// previously reported no numbers). Plain module-evaluation order fixes it.
const tokens = fill(new Float32Array(SEQ * DIM), 0);
const mask = new Float32Array(SEQ).fill(1);
const query = fill(new Float32Array(DIM), 1);
const corpus = Array.from({ length: CORPUS }, (_, i) => fill(new Float32Array(DIM), i));

describe('embedding pooling', () => {
  bench(`meanPoolNormalize: seq=${SEQ} dim=${DIM}`, () => {
    meanPoolNormalize(tokens, mask, SEQ, DIM);
  });
});

describe('embedding similarity', () => {
  bench(`cosineSimilarity: query vs ${CORPUS.toLocaleString()} corpus vectors (dim=${DIM})`, () => {
    let best = -Infinity;
    for (let i = 0; i < corpus.length; i++) {
      const s = cosineSimilarity(query, corpus[i]!);
      if (s > best) best = s;
    }
  });
});
