import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertSafePath, listFiles } from '../../../src/main/notebase/fs';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/sample-project');

describe('assertSafePath', () => {
  it('returns resolved path for a valid relative path', () => {
    const result = assertSafePath('/root', 'notes/test.md');
    expect(result).toBe(path.resolve('/root', 'notes/test.md'));
  });

  it('throws on path traversal with ../', () => {
    expect(() => assertSafePath('/root', '../outside.md')).toThrow('Path traversal');
  });

  it('throws on absolute path outside root', () => {
    expect(() => assertSafePath('/root', '/etc/passwd')).toThrow('Path traversal');
  });

  it('allows path resolving to root itself', () => {
    expect(() => assertSafePath('/root', '')).not.toThrow();
  });
});

describe('assertSafePath: symlinked root (#352)', () => {
  // On macOS, os.tmpdir() returns /var/folders/... which is a symlink
  // to /private/var/folders/.... Before the fix, the prefix-startsWith
  // check could fail (or wrongly succeed) when the caller's rootPath
  // and the resolved subpath disagreed about which side of the
  // symlink they sat on. realpath both sides → equivalent regardless
  // of which form the caller hands us.
  it('treats both ends of a symlinked root as the same project', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'minerva-fs-symlink-test-'));
    try {
      const realRoot = fs.realpathSync(root);
      // The fix only matters when realpath actually changes the
      // string. On Linux, tmpdir is usually already canonical; in
      // that case this assertion is just "both forms equal", which
      // still has to hold.
      await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
      await fsp.writeFile(path.join(root, 'notes', 'a.md'), '# a', 'utf-8');

      // Either form of the rootPath should accept the same relative path.
      expect(() => assertSafePath(root, 'notes/a.md')).not.toThrow();
      expect(() => assertSafePath(realRoot, 'notes/a.md')).not.toThrow();

      // And both should reject a traversal regardless of root form.
      expect(() => assertSafePath(root, '../escape.md')).toThrow('Path traversal');
      expect(() => assertSafePath(realRoot, '../escape.md')).toThrow('Path traversal');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('allows write-to-create paths whose leaf does not yet exist', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'minerva-fs-create-test-'));
    try {
      // The point of `realPathSafe(parent)` (not realpath of leaf) — a
      // file we're about to create can't be realpath'd, but its parent
      // exists. Used in every NOTEBASE_CREATE_FILE / WRITE_FILE call.
      expect(() => assertSafePath(root, 'fresh.md')).not.toThrow();
      expect(() => assertSafePath(root, 'subdir/fresh.md')).not.toThrow();
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});

describe('listFiles', () => {
  it('returns the fixture project structure', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const names = files.map((f) => f.name);

    // Should have top-level dirs and README
    expect(names).toContain('notes');
    expect(names).toContain('research');
    expect(names).toContain('README.md');
  });

  it('sorts directories before files', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const firstFile = files.findIndex((f) => !f.isDirectory);
    const lastDir = files.findLastIndex((f) => f.isDirectory);
    if (firstFile >= 0 && lastDir >= 0) {
      expect(lastDir).toBeLessThan(firstFile);
    }
  });

  it('ignores .minerva directory', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const names = files.map((f) => f.name);
    expect(names).not.toContain('.minerva');
  });

  it('only includes indexable file types (.md, .ttl, .csv)', async () => {
    const files = await listFiles(FIXTURE_DIR);
    function checkLeaves(items: typeof files) {
      for (const f of items) {
        if (!f.isDirectory) {
          expect(f.name).toMatch(/\.(md|ttl|csv)$/);
        }
        if (f.children) checkLeaves(f.children);
      }
    }
    checkLeaves(files);
  });

  it('includes nested files', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const research = files.find((f) => f.name === 'research');
    expect(research?.isDirectory).toBe(true);
    const papers = research?.children?.find((f) => f.name === 'papers');
    expect(papers?.isDirectory).toBe(true);
    const lc = papers?.children?.find((f) => f.name === 'lambda-calculus.md');
    expect(lc).toBeDefined();
  });

  it('includes empty folders', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const journal = files.find((f) => f.name === 'journal');
    expect(journal?.isDirectory).toBe(true);
    expect(journal?.children).toEqual([]);
  });
});
