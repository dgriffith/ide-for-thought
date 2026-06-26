import { describe, it, expect } from 'vitest';
import { meanPoolNormalize, l2normalize, cosineSimilarity } from '../../../src/main/embeddings/pooling';

describe('meanPoolNormalize', () => {
  it('averages only the masked-in tokens, then L2-normalizes', () => {
    // 3 tokens, dim 2; the third is padding (mask 0) and must be ignored.
    const tokens = [
      3, 0, // token 0
      1, 0, // token 1
      99, 99, // token 2 — padding, excluded
    ];
    const mask = [1, 1, 0];
    const v = meanPoolNormalize(tokens, mask, 3, 2);
    // mean of kept = (2, 0) → normalized = (1, 0)
    expect(v[0]).toBeCloseTo(1, 6);
    expect(v[1]).toBeCloseTo(0, 6);
    // Unit length.
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 6);
  });

  it('returns a zero vector (not NaN) when everything is masked out', () => {
    const v = meanPoolNormalize([5, 5, 5, 5], [0, 0], 2, 2);
    expect([...v]).toEqual([0, 0]);
  });
});

describe('l2normalize', () => {
  it('scales to unit length', () => {
    const v = l2normalize(new Float32Array([3, 4]));
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
  });

  it('leaves a zero vector alone', () => {
    expect([...l2normalize(new Float32Array([0, 0]))]).toEqual([0, 0]);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });
});
