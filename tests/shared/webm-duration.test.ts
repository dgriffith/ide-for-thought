import { describe, it, expect } from 'vitest';
import { readWebmDuration, withWebmDuration } from '../../src/shared/webm-duration';
import { el, uint, float, EBML_HEADER, TRACKS, CLUSTER, mediaRecorderFile } from '../helpers/webm-fixture';

function endsWith(bytes: Uint8Array, tail: number[]): boolean {
  return tail.every((b, i) => bytes[bytes.length - tail.length + i] === b);
}

describe('withWebmDuration', () => {
  it('adds a Duration to a MediaRecorder file that has none', () => {
    const input = mediaRecorderFile();
    expect(readWebmDuration(input)).toBeNull();

    const out = withWebmDuration(input, 93_250);
    expect(readWebmDuration(out)).toBeCloseTo(93_250, 6);
    expect(out.length).toBe(input.length + 11);
    // The media after Info is carried over byte-for-byte.
    expect(endsWith(out, [...TRACKS, ...CLUSTER])).toBe(true);
    // The input is not mutated.
    expect(readWebmDuration(input)).toBeNull();
  });

  it('keeps the Info size in its original width', () => {
    const input = mediaRecorderFile({ infoWidth: 8 });
    expect(readWebmDuration(withWebmDuration(input, 1_500))).toBeCloseTo(1_500, 6);
  });

  it('scales by a non-default TimecodeScale', () => {
    // 1 unit = 1 µs, so 2.5 s is stored as 2,500,000 units.
    const out = withWebmDuration(mediaRecorderFile({ timecodeScale: 1_000 }), 2_500);
    expect(readWebmDuration(out)).toBeCloseTo(2_500, 6);
  });

  it('overwrites an existing Duration in place (float32 and float64)', () => {
    for (const w of [4, 8] as const) {
      const input = mediaRecorderFile({ duration: el(0x4489, float(10, w)) });
      expect(readWebmDuration(input)).toBeCloseTo(10, 3);
      const out = withWebmDuration(input, 4_000);
      expect(out.length).toBe(input.length);
      expect(readWebmDuration(out)).toBeCloseTo(4_000, w === 4 ? 0 : 6);
    }
  });

  it('refuses to insert when a SeekHead records offsets, but still overwrites', () => {
    const seekHead = el(0x114d9b74, el(0x4dbb, [...el(0x53ab, [0x15, 0x49, 0xa9, 0x66]), ...el(0x53ac, [0])]));
    const input = mediaRecorderFile({ extra: seekHead });
    expect(withWebmDuration(input, 5_000)).toBe(input);

    const withDuration = mediaRecorderFile({ extra: seekHead, duration: el(0x4489, float(1, 8)) });
    expect(readWebmDuration(withWebmDuration(withDuration, 5_000))).toBeCloseTo(5_000, 6);
  });

  it('grows a known-size Segment along with Info', () => {
    const info = el(0x1549a966, [...el(0x2ad7b1, uint(1_000_000, 3))]);
    const body = [...info, ...TRACKS];
    const input = new Uint8Array([...EBML_HEADER, ...el(0x18538067, body, { width: 4 })]);
    const out = withWebmDuration(input, 750);
    expect(readWebmDuration(out)).toBeCloseTo(750, 6);
    // Segment size field (4 bytes after its 4-byte ID) now covers the 11 new bytes.
    const sizeAt = EBML_HEADER.length + 4;
    const size = ((out[sizeAt]! & 0x0f) << 24) | (out[sizeAt + 1]! << 16) | (out[sizeAt + 2]! << 8) | out[sizeAt + 3]!;
    expect(size).toBe(body.length + 11);
  });

  it('passes anything it cannot patch through untouched', () => {
    const notWebm = [
      new Uint8Array(0),
      new TextEncoder().encode('ID3\u0003not an mp3 really'),
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), // truncated header
      new Uint8Array([0x00, 0x00, 0x00, 0x00]),
      mediaRecorderFile().slice(0, 40), // cut off before Info ends
    ];
    for (const bytes of notWebm) {
      expect(withWebmDuration(bytes, 1_000)).toBe(bytes);
      expect(readWebmDuration(bytes)).toBeNull();
    }
  });

  it('ignores a non-positive or non-finite duration', () => {
    const input = mediaRecorderFile();
    for (const d of [0, -5, NaN, Infinity]) expect(withWebmDuration(input, d)).toBe(input);
  });
});
