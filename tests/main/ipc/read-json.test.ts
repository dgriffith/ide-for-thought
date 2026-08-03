/**
 * `readJsonFileOr` — the IPC store-load helper that disambiguates "not written
 * yet" from "corrupt on disk" (#1631). The old `try { readFile; JSON.parse }
 * catch { return fallback }` idiom collapsed both into the fallback, silently
 * losing a user's bookmarks/session when the file was corrupt. This pins:
 *   - missing file (ENOENT) → fallback   (expected: "none yet")
 *   - valid JSON            → parsed value
 *   - corrupt JSON          → THROWS      (data loss must not read as "empty")
 *   - other read error      → THROWS
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readJsonFileOr } from '../../../src/main/ipc/read-json';

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
