/**
 * Read and write the `Duration` of a WebM file (#2728).
 *
 * Chromium's `MediaRecorder` streams WebM as it records, so it can't know the
 * length when it writes the header: the Segment `Info` element has no
 * `Duration`. An `<audio>` element playing such a file shows no length and
 * can't seek until it has played through once. `withWebmDuration` adds the
 * duration after the fact, by inserting (or overwriting) `Duration` inside
 * `Info` and growing `Info`'s size field to match.
 *
 * A WebM file is EBML: a tree of elements, each `ID | size | payload`, where
 * the ID and size are variable-length integers (VINTs) whose first byte's
 * leading zeros give their length. MediaRecorder output looks like:
 *
 *   EBML header
 *   Segment (size "unknown": all ones)
 *     Info      { TimecodeScale, MuxingApp, WritingApp }
 *     Tracks    { … }
 *     Cluster…  (size "unknown")
 *
 * Inserting bytes into `Info` shifts everything after it. Nothing in that
 * layout records an absolute offset, so a shift is harmless. A file with a
 * `SeekHead` or `Cues` does record offsets; for one of those an insert is
 * refused and the bytes come back untouched (overwriting an existing
 * `Duration` in place shifts nothing, so that still works). Every failure mode
 * returns the input unchanged: a recording without a duration still plays,
 * and a corrupted one doesn't.
 *
 * Pure byte manipulation, no Node or DOM APIs, so it's shared: the renderer
 * patches on save and main can read the length when indexing (#2730).
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_SEEKHEAD = 0x114d9b74;
const ID_CUES = 0x1c53bb6b;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

/** Matroska's default: one timecode unit is 1 ms (1,000,000 ns). */
const DEFAULT_TIMECODE_SCALE = 1_000_000;

interface Vint {
  /** The decoded value (for an ID: the raw bytes, marker bit kept). */
  value: number;
  /** Bytes the VINT occupies. */
  length: number;
  /** For a size: every value bit set, i.e. "unknown size". */
  unknown: boolean;
}

/** Read a VINT at `pos`. `keepMarker` is for element IDs, which are
 *  conventionally written with their length-marker bit included. */
function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): Vint | null {
  if (pos >= bytes.length) return null;
  const first = bytes[pos]!;
  if (first === 0) return null; // > 8 bytes: not valid WebM
  const length = Math.clz32(first) - 23; // leading zeros within the byte, + 1
  if (pos + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = bytes[pos + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** Write `value` as a size VINT of exactly `width` bytes, or return false if
 *  it doesn't fit (the all-ones pattern is reserved for "unknown"). */
function writeSizeVint(bytes: Uint8Array, pos: number, width: number, value: number): boolean {
  if (width < 1 || width > 8 || value >= 2 ** (7 * width) - 1) return false;
  let v = value;
  for (let i = width - 1; i >= 1; i--) {
    bytes[pos + i] = v % 256;
    v = Math.floor(v / 256);
  }
  bytes[pos] = v | (0x80 >> (width - 1));
  return true;
}

interface Element {
  id: number;
  /** Offset of the element's first ID byte. */
  start: number;
  /** Offset of the size VINT, and its width. */
  sizePos: number;
  sizeWidth: number;
  /** Offset of the payload. */
  dataStart: number;
  /** Payload length, or null for an unknown size. */
  size: number | null;
}

function readElement(bytes: Uint8Array, pos: number): Element | null {
  const id = readVint(bytes, pos, true);
  if (!id) return null;
  const size = readVint(bytes, pos + id.length, false);
  if (!size) return null;
  return {
    id: id.value,
    start: pos,
    sizePos: pos + id.length,
    sizeWidth: size.length,
    dataStart: pos + id.length + size.length,
    size: size.unknown ? null : size.value,
  };
}

/** The elements of the Segment, with what the patch needs to know. */
interface Layout {
  segment: Element;
  info: Element;
  timecodeScale: number;
  /** The existing `Duration` element inside `Info`, if any. */
  duration: Element | null;
  /** True when something in the file records absolute offsets. */
  hasOffsets: boolean;
}

function parseLayout(bytes: Uint8Array): Layout | null {
  const header = readElement(bytes, 0);
  if (!header || header.id !== ID_EBML || header.size === null) return null;
  const segment = readElement(bytes, header.dataStart + header.size);
  if (!segment || segment.id !== ID_SEGMENT) return null;

  const segmentEnd = segment.size === null ? bytes.length : segment.dataStart + segment.size;
  let info: Element | null = null;
  let hasOffsets = false;
  let pos = segment.dataStart;
  // Top-level children up to the first Cluster; `Info` precedes the media.
  while (pos < segmentEnd) {
    const el = readElement(bytes, pos);
    if (!el) break;
    if (el.id === ID_INFO) info = el;
    if (el.id === ID_SEEKHEAD || el.id === ID_CUES) hasOffsets = true;
    if (el.id === ID_CLUSTER || el.size === null) break;
    pos = el.dataStart + el.size;
  }
  if (!info || info.size === null) return null;

  let timecodeScale = DEFAULT_TIMECODE_SCALE;
  let duration: Element | null = null;
  const infoEnd = info.dataStart + info.size;
  for (let p = info.dataStart; p < infoEnd; ) {
    const el = readElement(bytes, p);
    if (!el || el.size === null) return null;
    if (el.id === ID_TIMECODE_SCALE) timecodeScale = readUint(bytes, el.dataStart, el.size) || DEFAULT_TIMECODE_SCALE;
    if (el.id === ID_DURATION) duration = el;
    p = el.dataStart + el.size;
  }
  return { segment, info, timecodeScale, duration, hasOffsets };
}

function readUint(bytes: Uint8Array, pos: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + bytes[pos + i]!;
  return v;
}

/** The file's `Duration` in milliseconds, or null if it has none (or isn't
 *  WebM/Matroska). */
export function readWebmDuration(bytes: Uint8Array): number | null {
  const layout = parseLayout(bytes);
  if (!layout?.duration) return null;
  const { dataStart, size } = layout.duration;
  if (size !== 4 && size !== 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + dataStart, size);
  const units = size === 4 ? view.getFloat32(0) : view.getFloat64(0);
  return (units * layout.timecodeScale) / 1_000_000;
}

/**
 * `bytes` with its `Duration` set to `durationMs`. Returns the input as-is
 * when it isn't a WebM file this can patch safely (see the header comment);
 * never throws on malformed input.
 */
export function withWebmDuration(bytes: Uint8Array, durationMs: number): Uint8Array {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return bytes;
  const layout = parseLayout(bytes);
  if (!layout) return bytes;
  const units = (durationMs * 1_000_000) / layout.timecodeScale;

  // Already has one: overwrite in place. Same length, nothing shifts.
  if (layout.duration) {
    const { dataStart, size } = layout.duration;
    if (size !== 4 && size !== 8) return bytes;
    const out = bytes.slice();
    const view = new DataView(out.buffer, dataStart, size);
    if (size === 4) view.setFloat32(0, units);
    else view.setFloat64(0, units);
    return out;
  }

  if (layout.hasOffsets) return bytes;

  // Insert `Duration` (ID 0x4489, size 8, float64) at the end of `Info`.
  const element = new Uint8Array(11);
  element[0] = 0x44;
  element[1] = 0x89;
  element[2] = 0x88; // size VINT: 1 byte, value 8
  new DataView(element.buffer).setFloat64(3, units);

  const { info, segment } = layout;
  const insertAt = info.dataStart + info.size!;
  const out = new Uint8Array(bytes.length + element.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(element, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + element.length);

  // Grow Info's size (and the Segment's, when it's known) in their existing
  // widths; both precede `insertAt`, so their offsets are unchanged.
  if (!writeSizeVint(out, info.sizePos, info.sizeWidth, info.size! + element.length)) return bytes;
  if (segment.size !== null && !writeSizeVint(out, segment.sizePos, segment.sizeWidth, segment.size + element.length)) {
    return bytes;
  }
  return out;
}
