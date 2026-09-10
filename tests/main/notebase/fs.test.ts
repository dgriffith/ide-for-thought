import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertSafePath, listFiles, writeFile, deleteFile, deleteFolder } from '../../../src/main/notebase/fs';
import { listRevisions } from '../../../src/main/history/store';

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
  // Build a known tree in beforeEach instead of walking the live
  // sample-project fixture. The fixture is shared with the dev app and
  // gets contaminated when someone opens it for editing (#344) — copying
  // wouldn't help because `fs.cp` would still mirror the dirty state.
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'minerva-listfiles-test-'));
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes', 'a.md'), '# a\n');
    await fsp.mkdir(path.join(root, 'research', 'papers'), { recursive: true });
    await fsp.writeFile(path.join(root, 'research', 'papers', 'lambda-calculus.md'), '# lc\n');
    await fsp.mkdir(path.join(root, 'journal'), { recursive: true }); // empty
    await fsp.writeFile(path.join(root, 'README.md'), '# readme\n');
    await fsp.writeFile(path.join(root, 'data.csv'), 'a,b\n1,2\n');
    await fsp.writeFile(path.join(root, 'ontology.ttl'), '@prefix x: <x:> .\n');
    // Non-indexable: now LISTED (#1130) though still not indexed.
    await fsp.writeFile(path.join(root, 'image.png'), 'fake');
    await fsp.writeFile(path.join(root, 'notes.txt'), 'plain text\n');
    // Hidden dir: must be filtered out.
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva', 'graph.ttl'), '@prefix x: <x:> .\n');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns the project structure (top-level dirs + README)', async () => {
    const files = await listFiles(root);
    const names = files.map((f) => f.name);
    expect(names).toContain('notes');
    expect(names).toContain('research');
    expect(names).toContain('README.md');
  });

  it('sorts directories before files', async () => {
    const files = await listFiles(root);
    const firstFile = files.findIndex((f) => !f.isDirectory);
    const lastDir = files.findLastIndex((f) => f.isDirectory);
    expect(firstFile).toBeGreaterThanOrEqual(0);
    expect(lastDir).toBeGreaterThanOrEqual(0);
    expect(lastDir).toBeLessThan(firstFile);
  });

  it('ignores .minerva directory', async () => {
    const files = await listFiles(root);
    const names = files.map((f) => f.name);
    expect(names).not.toContain('.minerva');
  });

  it('lists all files, including non-indexable types (#1130)', async () => {
    const files = await listFiles(root);
    const names = files.map((f) => f.name);
    // Previously hidden non-indexable files are now surfaced in the tree.
    expect(names).toContain('image.png');
    expect(names).toContain('notes.txt');
    // Indexable files still listed too.
    expect(names).toContain('data.csv');
    expect(names).toContain('ontology.ttl');
    // Hidden dirs stay filtered.
    expect(names).not.toContain('.minerva');
  });

  it('includes nested files', async () => {
    const files = await listFiles(root);
    const research = files.find((f) => f.name === 'research');
    expect(research?.isDirectory).toBe(true);
    const papers = research?.children?.find((f) => f.name === 'papers');
    expect(papers?.isDirectory).toBe(true);
    const lc = papers?.children?.find((f) => f.name === 'lambda-calculus.md');
    expect(lc).toBeDefined();
  });

  it('includes empty folders', async () => {
    const files = await listFiles(root);
    const journal = files.find((f) => f.name === 'journal');
    expect(journal?.isDirectory).toBe(true);
    expect(journal?.children).toEqual([]);
  });
});

describe('deleteFile / deleteFolder — local history capture (#2089)', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'minerva-delete-history-test-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('deleteFile appends a delete marker capturing the final content', async () => {
    await writeFile(root, 'notes/a.md', 'v1');
    await writeFile(root, 'notes/a.md', 'v2 — the final version');

    await deleteFile(root, 'notes/a.md');

    const revs = await listRevisions(root, 'notes/a.md');
    expect(revs[0]!.origin).toBe('delete');
    // The actual file is gone from the project tree.
    await expect(fsp.access(path.join(root, 'notes/a.md'))).rejects.toThrow();
  });

  it('deleteFile captures drift before recording the deletion', async () => {
    await writeFile(root, 'notes/a.md', 'captured');
    // Changed on disk after the last app-driven write, outside writeFile's
    // own capture hook — the pre-delete hook must still preserve it.
    await fsp.writeFile(path.join(root, 'notes/a.md'), 'changed on disk, never saved via the app', 'utf-8');

    await deleteFile(root, 'notes/a.md');

    const revs = await listRevisions(root, 'notes/a.md');
    // Newest-first: the delete marker, then the drift capture, then the baseline.
    expect(revs.map((r) => r.origin)).toEqual(['delete', 'edit', 'edit']);
  });

  it('deleteFolder marks every note file under it as deleted', async () => {
    await writeFile(root, 'notes/a.md', 'a');
    await writeFile(root, 'notes/sub/b.md', 'b');
    await fsp.writeFile(path.join(root, 'notes/asset.png'), 'not a note');

    await deleteFolder(root, 'notes');

    expect((await listRevisions(root, 'notes/a.md'))[0]!.origin).toBe('delete');
    expect((await listRevisions(root, 'notes/sub/b.md'))[0]!.origin).toBe('delete');
    // Non-note assets aren't in scope for history at all — no marker to check.
    await expect(fsp.access(path.join(root, 'notes'))).rejects.toThrow();
  });

  it('a note recreated at the same path after deletion gets its own fresh history on top', async () => {
    await writeFile(root, 'notes/a.md', 'v1');
    await deleteFile(root, 'notes/a.md');
    await writeFile(root, 'notes/a.md', 'recreated');

    const revs = await listRevisions(root, 'notes/a.md');
    expect(revs.map((r) => r.origin)).toEqual(['edit', 'delete', 'edit']);
  });
});
