/**
 * @vitest-environment jsdom
 *
 * Image-upload helper unit tests (#455). The upload module talks to
 * `api.notebase.fileExists` / `writeBinary` — mocked here so the
 * tests stay fast and don't need a project on disk.
 *
 * jsdom rather than happy-dom because the helper uses
 * `crypto.subtle.digest`, and jsdom 26 ships a full webcrypto API
 * while happy-dom's coverage of subtle is patchy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  uploadImage,
  relativeAssetPathForNote,
  rejectionMessage,
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
} from '../../src/renderer/lib/editor/image-upload';

// Stub the IPC surface — the helper only calls these two methods on
// the upload path. `__store` is the recorded write payload so the
// asserts can verify what would have hit disk.
const __writes = new Map<string, Uint8Array>();
const __existsResponses = new Map<string, boolean>();

vi.mock('../../src/renderer/lib/ipc/client', () => ({
  api: {
    notebase: {
      fileExists: vi.fn((rel: string) => Promise.resolve(__existsResponses.get(rel) ?? false)),
      writeBinary: vi.fn((rel: string, bytes: Uint8Array) => {
        __writes.set(rel, bytes);
        return Promise.resolve();
      }),
    },
  },
}));

beforeEach(() => {
  __writes.clear();
  __existsResponses.clear();
});

function makeBlob(bytes: number[], mime: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

describe('uploadImage (#455)', () => {
  it('writes a valid PNG and returns a hash-prefixed asset path', async () => {
    const blob = makeBlob([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01], 'image/png');
    const result = await uploadImage(blob, { filename: 'screenshot.png' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relativePath).toMatch(/^\.minerva\/assets\/inline\/[0-9a-f]{12}-screenshot\.png$/);
    expect(result.alt).toBe('screenshot.png');
    expect(__writes.get(result.relativePath)?.byteLength).toBe(10);
  });

  it('rejects unsupported MIME types', async () => {
    const blob = makeBlob([1, 2, 3], 'application/zip');
    const result = await uploadImage(blob, { filename: 'notes.zip' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-mime');
    expect(result.detail).toBe('application/zip');
    expect(__writes.size).toBe(0);
  });

  it('rejects empty blobs', async () => {
    const blob = new Blob([], { type: 'image/png' });
    const result = await uploadImage(blob, { filename: 'empty.png' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty');
  });

  it('rejects blobs over the size cap', async () => {
    // 6MB > 5MB cap. We don't actually allocate 6MB — fake the size.
    const blob = makeBlob([1], 'image/png');
    Object.defineProperty(blob, 'size', { value: MAX_IMAGE_BYTES + 1 });
    const result = await uploadImage(blob, { filename: 'huge.png' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('too-large');
  });

  it('content-hashes for dedupe — two drops of identical bytes share a path', async () => {
    const bytes = [0x89, 0x50, 0x4E, 0x47, 0xFF];
    const r1 = await uploadImage(makeBlob(bytes, 'image/png'), { filename: 'a.png' });
    const r2 = await uploadImage(makeBlob(bytes, 'image/png'), { filename: 'a.png' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    // Identical bytes → identical hash prefix → identical asset path.
    expect(r1.relativePath).toBe(r2.relativePath);
  });

  it('skips the writeBinary call when an asset with the hash already exists', async () => {
    const bytes = [0xFF, 0xD8, 0xFF];
    // Pre-seed the existence-check response: the helper should believe
    // the asset is already on disk and skip the write.
    const r1 = await uploadImage(makeBlob(bytes, 'image/jpeg'), { filename: 'photo.jpg' });
    if (!r1.ok) throw new Error('first upload should succeed');
    __writes.clear();
    __existsResponses.set(r1.relativePath, true);
    const r2 = await uploadImage(makeBlob(bytes, 'image/jpeg'), { filename: 'photo.jpg' });
    expect(r2.ok).toBe(true);
    expect(__writes.size).toBe(0);
  });

  it('different content → different paths even when filenames match', async () => {
    const r1 = await uploadImage(makeBlob([1, 2, 3], 'image/png'), { filename: 'shot.png' });
    const r2 = await uploadImage(makeBlob([1, 2, 4], 'image/png'), { filename: 'shot.png' });
    if (!r1.ok || !r2.ok) throw new Error('uploads should succeed');
    expect(r1.relativePath).not.toBe(r2.relativePath);
  });

  it('SVG markup uploads with the right extension', async () => {
    const blob = makeBlob([0x3C, 0x73, 0x76, 0x67], 'image/svg+xml');
    const result = await uploadImage(blob, { filename: 'icon.svg' });
    if (!result.ok) throw new Error('upload should succeed');
    expect(result.relativePath).toMatch(/\.svg$/);
  });

  it('clipboard pastes (no filename) get a generated stem with the MIME-derived ext', async () => {
    const blob = makeBlob([1, 2, 3, 4], 'image/png');
    const result = await uploadImage(blob); // no opts.filename
    if (!result.ok) throw new Error('upload should succeed');
    // Generated stem is the fallback "image"; ext from MIME → png.
    expect(result.relativePath).toMatch(/^\.minerva\/assets\/inline\/[0-9a-f]{12}-image\.png$/);
  });

  it('sanitises spaces and special chars in filenames', async () => {
    const blob = makeBlob([1, 2, 3], 'image/png');
    const result = await uploadImage(blob, { filename: 'My Screen Shot (v2).png' });
    if (!result.ok) throw new Error('upload should succeed');
    expect(result.relativePath).toMatch(/^\.minerva\/assets\/inline\/[0-9a-f]{12}-my-screen-shot-v2\.png$/);
  });

  it('every allowlist MIME is accepted', async () => {
    for (const mime of ALLOWED_IMAGE_MIMES) {
      const blob = makeBlob([1, 2, 3], mime);
      const r = await uploadImage(blob, { filename: 'x.bin' });
      expect(r.ok, `expected ${mime} to be accepted`).toBe(true);
    }
  });
});

describe('relativeAssetPathForNote (#455)', () => {
  it('project-root note → asset path emitted as-is', () => {
    const out = relativeAssetPathForNote('graph.md', '.minerva/assets/inline/abc.png');
    expect(out).toBe('.minerva/assets/inline/abc.png');
  });

  it('nested note → climbs out via `../../`', () => {
    const out = relativeAssetPathForNote('notes/derived/foo.md', '.minerva/assets/inline/abc.png');
    expect(out).toBe('../../.minerva/assets/inline/abc.png');
  });

  it('deeply nested note → enough `..`s', () => {
    const out = relativeAssetPathForNote('a/b/c/d.md', '.minerva/assets/inline/abc.png');
    expect(out).toBe('../../../.minerva/assets/inline/abc.png');
  });

  it('shared-prefix path collapses correctly', () => {
    // Asset and note both live under `.minerva/`.
    const out = relativeAssetPathForNote('.minerva/scratch/note.md', '.minerva/assets/inline/abc.png');
    expect(out).toBe('../assets/inline/abc.png');
  });
});

describe('rejectionMessage (#455)', () => {
  it('produces a human-readable message for each reject reason', () => {
    expect(rejectionMessage({ ok: false, reason: 'too-large', detail: '6 MB > 5 MB' })).toContain('too large');
    expect(rejectionMessage({ ok: false, reason: 'unsupported-mime', detail: 'application/zip' })).toContain('Unsupported');
    expect(rejectionMessage({ ok: false, reason: 'empty' })).toContain('Empty');
    expect(rejectionMessage({ ok: false, reason: 'write-failed', detail: 'EACCES' })).toContain('Couldn\'t write');
  });
});
