/**
 * Per-file serialization for async read-modify-write (#2416).
 *
 * The bug this exists for: two overlapping `read → modify → write` sequences
 * against one file both read the old contents, and the second write drops the
 * first's change. The first test reproduces exactly that with a real file,
 * then shows the lock closing it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withFileLock, _lockedPathCountForTests } from '../../../src/main/config/file-lock';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-file-lock-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function appendItem(file: string, item: string): Promise<void> {
  let list: string[] = [];
  try {
    list = JSON.parse(await fs.readFile(file, 'utf-8')) as string[];
  } catch { /* first write */ }
  // Yield so the other caller's read lands between this read and write.
  await new Promise((r) => setTimeout(r, 5));
  await fs.writeFile(file, JSON.stringify([...list, item]));
}

describe('withFileLock', () => {
  it('unserialized, overlapping read-modify-writes lose an update (the bug)', async () => {
    const file = path.join(dir, 'raw.json');
    await Promise.all([appendItem(file, 'a'), appendItem(file, 'b')]);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toHaveLength(1);
  });

  it('under the lock, every overlapping update lands, in call order', async () => {
    const file = path.join(dir, 'locked.json');
    await Promise.all(['a', 'b', 'c', 'd'].map((x) => withFileLock(file, () => appendItem(file, x))));
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keys on the resolved path, so two spellings of one file share a lock', async () => {
    const file = path.join(dir, 'x.json');
    const other = path.join(dir, 'sub', '..', 'x.json');
    await Promise.all([withFileLock(file, () => appendItem(file, 'a')), withFileLock(other, () => appendItem(file, 'b'))]);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual(['a', 'b']);
  });

  it('different files do not wait for each other', async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocked = withFileLock(path.join(dir, 'a.json'), () => new Promise<void>((r) => { release = r; }));
    await withFileLock(path.join(dir, 'b.json'), async () => { order.push('b'); });
    order.push('b-done');
    release();
    await blocked;
    expect(order).toEqual(['b', 'b-done']);
  });

  it('a failed holder rejects its own caller and does not wedge the next one', async () => {
    const file = path.join(dir, 'f.json');
    const first = withFileLock(file, () => Promise.reject(new Error('boom')));
    const second = withFileLock(file, () => Promise.resolve('ok'));
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });

  it('holds nothing once idle', async () => {
    await Promise.all([withFileLock(path.join(dir, 'a'), async () => 1), withFileLock(path.join(dir, 'b'), async () => 2)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(_lockedPathCountForTests()).toBe(0);
  });
});
