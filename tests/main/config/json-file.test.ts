/**
 * `readJsonFileOr` — the IPC store-load helper that disambiguates "not written
 * yet" from "corrupt on disk" (#1631). The old `try { readFile; JSON.parse }
 * catch { return fallback }` idiom collapsed both into the fallback, silently
 * losing a user's bookmarks/session when the file was corrupt. This pins:
 *   - missing file (ENOENT) → fallback   (expected: "none yet")
 *   - valid JSON            → parsed value
 *   - corrupt JSON          → THROWS      (data loss must not read as "empty")
 *   - other read error      → THROWS
 *
 * `writeJsonFileAtomic` (#1915) is its write counterpart: four call sites
 * hand-rolled `mkdir + writeFile(JSON.stringify(...))` with no crash safety, so
 * a process death mid-write produced exactly the corruption `readJsonFileOr`
 * above refuses to swallow. This pins the atomicity: a failure between the
 * temp-file write and the rename must leave the PREVIOUS file untouched, not a
 * half-written one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import fsSync from 'node:fs';
import { readJsonFileOr, writeJsonFileAtomic, writeJsonFileAtomicSync, SECRET_FILE_MODE } from '../../../src/main/config/json-file';

describe('readJsonFileOr (#1631)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-readjson-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns the fallback when the file is absent (ENOENT)', async () => {
    const fallback = [{ marker: true }];
    await expect(readJsonFileOr(path.join(dir, 'missing.json'), fallback)).resolves.toBe(fallback);
  });

  it('parses and returns valid JSON', async () => {
    const p = path.join(dir, 'ok.json');
    await fs.writeFile(p, JSON.stringify([1, 2, 3]), 'utf-8');
    await expect(readJsonFileOr<number[]>(p, [])).resolves.toEqual([1, 2, 3]);
  });

  it('THROWS on corrupt JSON instead of masquerading as the fallback', async () => {
    const p = path.join(dir, 'corrupt.json');
    await fs.writeFile(p, '{ not: valid json, ', 'utf-8');
    await expect(readJsonFileOr(p, [])).rejects.toThrow();
  });

  it('THROWS on a non-ENOENT read error (e.g. path is a directory)', async () => {
    // Reading a directory as a file yields EISDIR, not ENOENT — a real failure.
    await expect(readJsonFileOr(dir, [])).rejects.toThrow();
  });
});

describe('writeJsonFileAtomic (#1915)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-writejson-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates missing parent directories', async () => {
    const p = path.join(dir, 'nested', 'deep', 'settings.json');
    await writeJsonFileAtomic(p, { a: 1 });
    await expect(readJsonFileOr(p, null)).resolves.toEqual({ a: 1 });
  });

  it('round-trips a value, pretty-printed', async () => {
    const p = path.join(dir, 'settings.json');
    await writeJsonFileAtomic(p, { a: 1, b: [1, 2, 3] });
    expect(await fs.readFile(p, 'utf-8')).toBe(JSON.stringify({ a: 1, b: [1, 2, 3] }, null, 2));
  });

  it('leaves the previous file completely intact when the write is interrupted before rename', async () => {
    const p = path.join(dir, 'settings.json');
    await writeJsonFileAtomic(p, { version: 1 });

    // Simulate a crash between the temp-file write and the rename — the point
    // at which a naive writeFile-in-place would already have truncated the
    // real file. `rename` is the last step, so failing it here stands in for
    // "the process died before the atomic swap completed".
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('simulated crash'));
    await expect(writeJsonFileAtomic(p, { version: 2 })).rejects.toThrow('simulated crash');

    await expect(readJsonFileOr(p, null)).resolves.toEqual({ version: 1 });
  });

  it('cleans up its temp file after a failed write', async () => {
    const p = path.join(dir, 'settings.json');
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('simulated crash'));
    await expect(writeJsonFileAtomic(p, { version: 1 })).rejects.toThrow();

    const leftovers = await fs.readdir(dir);
    expect(leftovers).toEqual([]);
  });

  it('honours the file-format options (#2369)', async () => {
    const p = path.join(dir, 'settings.json');
    await writeJsonFileAtomic(p, { a: [1] }, { indent: 0 });
    expect(await fs.readFile(p, 'utf-8')).toBe('{"a":[1]}');
    await writeJsonFileAtomic(p, { a: [1] }, { trailingNewline: true });
    expect(await fs.readFile(p, 'utf-8')).toBe(`${JSON.stringify({ a: [1] }, null, 2)}\n`);
  });
});

describe('writeJsonFileAtomicSync (#2369)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'minerva-writejson-sync-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fsSync.rmSync(dir, { recursive: true, force: true });
  });

  it('creates missing parent directories and writes the same layout as the async twin', () => {
    const p = path.join(dir, 'nested', 'config.json');
    writeJsonFileAtomicSync(p, { a: 1 });
    expect(fsSync.readFileSync(p, 'utf-8')).toBe(JSON.stringify({ a: 1 }, null, 2));
    writeJsonFileAtomicSync(p, ['x'], { indent: 0 });
    expect(fsSync.readFileSync(p, 'utf-8')).toBe('["x"]');
  });

  it('leaves the previous file intact, and no temp file, when the rename fails', () => {
    const p = path.join(dir, 'config.json');
    writeJsonFileAtomicSync(p, { version: 1 });

    vi.spyOn(fsSync, 'renameSync').mockImplementationOnce(() => { throw new Error('simulated crash'); });
    expect(() => writeJsonFileAtomicSync(p, { version: 2 })).toThrow('simulated crash');

    expect(JSON.parse(fsSync.readFileSync(p, 'utf-8'))).toEqual({ version: 1 });
    expect(fsSync.readdirSync(dir)).toEqual(['config.json']);
  });
});

describe('atomic writes honour a file mode (#2562)', () => {
  const posix = process.platform !== 'win32';
  const modeOf = (p: string) => fsSync.statSync(p).mode & 0o777;

  it.runIf(posix)('creates the file with the given mode (async and sync)', async () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'minerva-mode-'));
    try {
      const a = path.join(dir, 'a.json');
      const b = path.join(dir, 'b.json');
      await writeJsonFileAtomic(a, { k: 1 }, { mode: SECRET_FILE_MODE });
      writeJsonFileAtomicSync(b, { k: 1 }, { mode: SECRET_FILE_MODE });
      expect(modeOf(a)).toBe(0o600);
      expect(modeOf(b)).toBe(0o600);
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(posix)('tightens an existing 0644 file on its next write', async () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'minerva-mode-'));
    try {
      const a = path.join(dir, 'a.json');
      fsSync.writeFileSync(a, '{}', { mode: 0o644 });
      fsSync.chmodSync(a, 0o644);
      await writeJsonFileAtomic(a, { k: 2 }, { mode: SECRET_FILE_MODE });
      expect(modeOf(a)).toBe(0o600);
      expect(JSON.parse(fsSync.readFileSync(a, 'utf-8'))).toEqual({ k: 2 });
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(posix)('leaves the process default when no mode is given', async () => {
    const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'minerva-mode-'));
    try {
      const a = path.join(dir, 'a.json');
      await writeJsonFileAtomic(a, {});
      const umask = process.umask();
      expect(modeOf(a)).toBe(0o666 & ~umask);
    } finally {
      fsSync.rmSync(dir, { recursive: true, force: true });
    }
  });
});
