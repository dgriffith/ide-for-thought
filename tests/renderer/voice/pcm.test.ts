/**
 * Pure PCM helper tests (#voice). These cover the audio math that turns
 * browser-decoded channel data into Whisper-ready 16 kHz mono samples,
 * without needing a real AudioContext.
 */

import { describe, it, expect } from 'vitest';
import { mixToMono, resampleLinear, toMono16k, TARGET_SAMPLE_RATE } from '../../../src/renderer/lib/voice/pcm';

describe('mixToMono', () => {
  it('returns the single channel unchanged', () => {
    const ch = new Float32Array([0.1, -0.2, 0.3]);
    expect(mixToMono([ch])).toBe(ch);
  });

  it('averages stereo channels sample-wise', () => {
    const l = new Float32Array([1, 0, -1]);
    const r = new Float32Array([0, 0, 1]);
    expect(Array.from(mixToMono([l, r]))).toEqual([0.5, 0, 0]);
  });

  it('handles the empty case', () => {
    expect(mixToMono([]).length).toBe(0);
  });
});

describe('resampleLinear', () => {
  it('returns the input untouched when rates match', () => {
    const x = new Float32Array([1, 2, 3]);
    expect(resampleLinear(x, 16_000, 16_000)).toBe(x);
  });

  it('downsamples by the rate ratio (length)', () => {
    const x = new Float32Array(48_000); // 1s @ 48k
    const out = resampleLinear(x, 48_000, 16_000);
    expect(out.length).toBe(16_000);
  });

  it('upsamples by the rate ratio (length)', () => {
    const x = new Float32Array(8_000); // 1s @ 8k
    const out = resampleLinear(x, 8_000, 16_000);
    expect(out.length).toBe(16_000);
  });

  it('linearly interpolates between samples', () => {
    // 0,1,2,3 at 4Hz -> 8Hz should put interpolated midpoints between.
    const x = new Float32Array([0, 1, 2, 3]);
    const out = resampleLinear(x, 4, 8);
    expect(out.length).toBe(8);
    // First sample is exact; an interior one lands on a half-step.
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0.5, 5);
    expect(out[2]).toBeCloseTo(1, 5);
  });

  it('preserves a constant signal', () => {
    const x = new Float32Array(1000).fill(0.42);
    const out = resampleLinear(x, 44_100, 16_000);
    for (const v of out) expect(v).toBeCloseTo(0.42, 5);
  });
});

describe('toMono16k', () => {
  it('downmixes and resamples in one pass', () => {
    const l = new Float32Array(44_100).fill(1);
    const r = new Float32Array(44_100).fill(0);
    const out = toMono16k([l, r], 44_100);
    expect(out.length).toBe(TARGET_SAMPLE_RATE);
    // averaged 1 and 0 -> 0.5 everywhere
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[out.length - 1]).toBeCloseTo(0.5, 5);
  });
});
