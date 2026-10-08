/**
 * A tiny EBML writer for building WebM fixtures shaped like Chromium
 * MediaRecorder output (#2728): an unknown-size Segment whose Info has no
 * Duration. Real files can't be produced in the test environment, so these
 * are assembled byte by byte from the Matroska element IDs.
 */
export const UNKNOWN = -1;

function sizeVint(n: number, width?: number): number[] {
  if (n === UNKNOWN) return [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  let w = width ?? 1;
  while (!width && n >= 2 ** (7 * w) - 1) w++;
  const out: number[] = [];
  let v = n;
  for (let i = 0; i < w; i++) {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  out[0]! |= 0x80 >> (w - 1);
  return out;
}

function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
}

export function el(id: number, payload: number[], opts: { size?: number; width?: number } = {}): number[] {
  return [...idBytes(id), ...sizeVint(opts.size ?? payload.length, opts.width), ...payload];
}

export const uint = (n: number, w: number) => sizeVint(n, w).map((b, i) => (i === 0 ? b & (0xff >> w) : b));
export const text = (s: string) => [...new TextEncoder().encode(s)];
export function float(n: number, w: 4 | 8): number[] {
  const b = new Uint8Array(w);
  const v = new DataView(b.buffer);
  if (w === 4) v.setFloat32(0, n);
  else v.setFloat64(0, n);
  return [...b];
}

export const EBML_HEADER = el(0x1a45dfa3, [
  ...el(0x4286, [1]), ...el(0x42f7, [1]), ...el(0x42f2, [4]), ...el(0x42f3, [8]),
  ...el(0x4282, text('webm')), ...el(0x4287, [4]), ...el(0x4285, [2]),
]);
export const TRACKS = el(0x1654ae6b, el(0xae, [...el(0xd7, [1]), ...el(0x86, text('A_OPUS'))]));
export const CLUSTER = el(0x1f43b675, [...el(0xe7, [0]), ...el(0xa3, [0x81, 0, 0, 0x80, 1, 2, 3])], { size: UNKNOWN });

/** WebM as Chromium's MediaRecorder writes it: unknown-size Segment, no Duration. */
export function mediaRecorderFile(opts: { infoWidth?: number; timecodeScale?: number; extra?: number[]; duration?: number[] } = {}): Uint8Array {
  const info = el(0x1549a966, [
    ...el(0x2ad7b1, uint(opts.timecodeScale ?? 1_000_000, 3)),
    ...el(0x4d80, text('Chrome')),
    ...el(0x5741, text('Chrome')),
    ...(opts.duration ?? []),
  ], { width: opts.infoWidth });
  return new Uint8Array([
    ...EBML_HEADER,
    ...el(0x18538067, [...(opts.extra ?? []), ...info, ...TRACKS, ...CLUSTER], { size: UNKNOWN }),
  ]);
}

