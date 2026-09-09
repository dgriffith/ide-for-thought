import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  enumerateFolderTree,
  _setMaxBulkIngestEntriesForTests,
} from '../../../src/main/notebase/folder-walk';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-folder-walk-test-'));
}

describe('enumerateFolderTree (#2087)', () => {
  let root: string;

  beforeEach(() => { root = mkTempDir(); });
  afterEach(async () => {
    _setMaxBulkIngestEntriesForTests(undefined);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('flat-lists a nested tree, relative to rootDir with no prefix for rootDir itself', async () => {
    await fsp.mkdir(path.join(root, 'a', 'b'), { recursive: true });
    await fsp.writeFile(path.join(root, 'top.md'), 'x');
    await fsp.writeFile(path.join(root, 'a', 'mid.md'), 'x');
    await fsp.writeFile(path.join(root, 'a', 'b', 'deep.md'), 'x');

    const result = await enumerateFolderTree(root);

    expect(result.capped).toBe(false);
    const paths = result.entries.map((e) => e.relativePath).sort();
    expect(paths).toEqual(['a/b/deep.md', 'a/mid.md', 'top.md']);
    // Every localPath is absolute and actually exists.
    for (const entry of result.entries) {
      expect(path.isAbsolute(entry.localPath)).toBe(true);
      expect(fs.existsSync(entry.localPath)).toBe(true);
    }
  });

  it('uses POSIX separators in relativePath regardless of platform', async () => {
    await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(root, 'sub', 'file.md'), 'x');
    const result = await enumerateFolderTree(root);
    expect(result.entries[0]?.relativePath).toBe('sub/file.md');
    expect(result.entries[0]?.relativePath).not.toContain('\\');
  });

  it('excludes dotfiles and IGNORED_DIRS as both files and pruned subtrees', async () => {
    // A dotfile at the top level.
    await fsp.writeFile(path.join(root, '.DS_Store'), 'x');
    // An IGNORED_DIRS entry with a file INSIDE it — the file must never
    // appear, not just the directory's own name.
    await fsp.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await fsp.writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    await fsp.mkdir(path.join(root, '.git'), { recursive: true });
    await fsp.writeFile(path.join(root, '.git', 'HEAD'), 'x');
    // A dot-prefixed directory with contents.
    await fsp.mkdir(path.join(root, '.hidden'), { recursive: true });
    await fsp.writeFile(path.join(root, '.hidden', 'secret.md'), 'x');
    // One legitimate file so the walk isn't vacuously empty.
    await fsp.writeFile(path.join(root, 'visible.md'), 'x');

    const result = await enumerateFolderTree(root);

    expect(result.entries.map((e) => e.relativePath)).toEqual(['visible.md']);
  });

  it('stops early once the cap is hit, reporting capped: true', async () => {
    _setMaxBulkIngestEntriesForTests(3);
    for (let i = 0; i < 10; i++) {
      await fsp.writeFile(path.join(root, `file-${i}.md`), 'x');
    }
    const result = await enumerateFolderTree(root);
    expect(result.capped).toBe(true);
    expect(result.entries.length).toBe(3);
  });

  it('does not report capped when the count is under the limit', async () => {
    _setMaxBulkIngestEntriesForTests(100);
    await fsp.writeFile(path.join(root, 'a.md'), 'x');
    await fsp.writeFile(path.join(root, 'b.md'), 'x');
    const result = await enumerateFolderTree(root);
    expect(result.capped).toBe(false);
    expect(result.entries.length).toBe(2);
  });

  it('returns an empty, uncapped result for an empty directory', async () => {
    const result = await enumerateFolderTree(root);
    expect(result).toEqual({ entries: [], capped: false });
  });

  it('treats a readdir failure as an empty subtree rather than aborting the whole walk', async () => {
    await fsp.mkdir(path.join(root, 'ok'), { recursive: true });
    await fsp.mkdir(path.join(root, 'broken'), { recursive: true });
    await fsp.writeFile(path.join(root, 'ok', 'fine.md'), 'x');
    await fsp.writeFile(path.join(root, 'broken', 'unreadable.md'), 'x');

    const brokenDir = path.join(root, 'broken');
    const realReaddir = fsp.readdir.bind(fsp);
    const spy = vi.spyOn(fsp, 'readdir').mockImplementation(async (dir: unknown, opts?: unknown) => {
      if (dir === brokenDir) throw new Error('EACCES: permission denied');
      return realReaddir(dir as string, opts as Parameters<typeof fsp.readdir>[1]);
    });

    try {
      const result = await enumerateFolderTree(root);
      expect(result.capped).toBe(false);
      expect(result.entries.map((e) => e.relativePath)).toEqual(['ok/fine.md']);
    } finally {
      spy.mockRestore();
    }
  });

  it('propagates a cap hit from within a nested subdirectory, stopping later root-level siblings', async () => {
    _setMaxBulkIngestEntriesForTests(2);
    await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(root, 'sub', 'a.md'), 'x');
    await fsp.writeFile(path.join(root, 'sub', 'b.md'), 'x');
    await fsp.writeFile(path.join(root, 'sub', 'c.md'), 'x'); // never reached — cap hits at 2
    await fsp.writeFile(path.join(root, 'trailing.md'), 'x'); // root-level sibling AFTER 'sub'

    // Force 'sub' to be visited before 'trailing.md' regardless of the real
    // filesystem's own listing order, so the cap is guaranteed to hit inside
    // the nested recursion rather than at the root level.
    const realReaddir = fsp.readdir.bind(fsp);
    const spy = vi.spyOn(fsp, 'readdir').mockImplementation(async (dir: unknown, opts?: unknown) => {
      const result = await realReaddir(dir as string, opts as Parameters<typeof fsp.readdir>[1]);
      if (dir === root) {
        return [...(result as { name: string }[])].sort((a, b) =>
          a.name === 'sub' ? -1 : b.name === 'sub' ? 1 : 0,
        ) as typeof result;
      }
      return result;
    });

    try {
      const result = await enumerateFolderTree(root);
      expect(result.capped).toBe(true);
      expect(result.entries.length).toBe(2);
      expect(result.entries.some((e) => e.relativePath === 'trailing.md')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
