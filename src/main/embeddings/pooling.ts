/**
 * Pure vector math for the embedding subsystem (#834).
 *
 * A sentence-transformer model emits a per-token hidden state `[seq, dim]`; the
 * sentence embedding is the attention-masked **mean** over tokens, then L2-
 * normalized so cosine similarity reduces to a dot product. Kept dependency-free
 * and side-effect-free so it's trivially testable without loading the model.
 */

/**
 * Mean-pool one sequence's token vectors under its attention mask, then L2-
 * normalize. `tokens` is the flat `[seq * dim]` slice for one input; `mask` is
 * its `[seq]` attention mask (1 = real token, 0 = padding).
 */
export function meanPoolNormalize(
  tokens: ArrayLike<number>,
  mask: ArrayLike<number>,
  seq: number,
  dim: number,
): Float32Array {
  const out = new Float32Array(dim);
  let kept = 0;
  for (let s = 0; s < seq; s++) {
    if (!mask[s]) continue;
    kept++;
    const base = s * dim;
    for (let d = 0; d < dim; d++) out[d] += tokens[base + d];
  }
  if (kept > 0) {
    for (let d = 0; d < dim; d++) out[d] /= kept;
  }
  return l2normalize(out);
}

/** L2-normalize in place and return the same array. A zero vector is left as-is
 *  (no divide-by-zero) — degenerate, but never NaN. */
export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/** Cosine similarity. For L2-normalized inputs this is just the dot product,
 *  but we divide by norms so it's correct for any vectors. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
