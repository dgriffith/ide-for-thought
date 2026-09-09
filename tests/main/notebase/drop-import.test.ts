import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  dropImport,
  resolveDropName,
} from '../../../src/main/notebase/drop-import';
import { extractZipToTempDir } from '../../../src/main/notebase/zip-extract';

// Zip I/O itself is covered by zip-extract.test.ts. Here we only need a
// controllable stand-in so drop-import's dispatch/recursion logic can be
// exercised without real zip files.
vi.mock('../../../src/main/notebase/zip-extract', () => ({
  extractZipToTempDir: vi.fn(),
}));

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-drop-import-test-'));
}

async function writeLocalFile(dir: string, name: string, content: string): Promise<string> {
  const p = path.join(dir, name);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf-8');
  return p;
}

const ARXIV_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'sample-project',
  '.minerva',
  'sources',
  'arxiv-2604.18522',
  'original.pdf',
);

/**
 * Stub `extractZipToTempDir` for one call: creates real staging files for
 * each requested entry (dropImport's COPY_EXTS branch does a real
 * `fs.copyFile`, so the source has to actually exist) and queues a resolved
 * value shaped like the real function's result.
 */
async function mockZipExtraction(
  stagingRoot: string,
  entries: Array<{ relativePath: string; content?: string }>,
  opts: { capped?: boolean } = {},
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(stagingRoot, 'zip-extract-stub-'));
  const built = [];
  for (const e of entries) {
    const localPath = path.join(tmpDir, e.relativePath);
    await fsp.mkdir(path.dirname(localPath), { recursive: true });
    await fsp.writeFile(localPath, e.content ?? `# ${e.relativePath}`, 'utf-8');
    built.push({ localPath, relativePath: e.relativePath });
  }
  vi.mocked(extractZipToTempDir).mockResolvedValueOnce({
    tmpDir,
    entries: built,
    capped: opts.capped ?? false,
  });
}

describe('dropImport (#259, extended #2087)', () => {
  let root: string;
  let staging: string;

  beforeEach(() => {
    root = mkTempProject();
    staging = mkTempProject();
    vi.mocked(extractZipToTempDir).mockReset();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(staging, { recursive: true, force: true });
  });

  it('copies a .md into the target folder, preserving the basename', async () => {
    const src = await writeLocalFile(staging, 'note.md', '# Hello\n');
    const result = await dropImport(root, 'notes', [{ localPath: src }]);
    expect(result.copied).toEqual([
      { localPath: src, relativePath: 'notes/note.md' },
    ]);
    expect(result.ingestedPdfs).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.capped).toBe(false);
    const landed = await fsp.readFile(path.join(root, 'notes/note.md'), 'utf-8');
    expect(landed).toBe('# Hello\n');
  });

  it('creates a missing target folder on the fly', async () => {
    const src = await writeLocalFile(staging, 'note.md', 'x');
    await dropImport(root, 'a/b/c', [{ localPath: src }]);
    expect(fs.existsSync(path.join(root, 'a/b/c/note.md'))).toBe(true);
  });

  it('drops into the project root when targetFolder is empty', async () => {
    const src = await writeLocalFile(staging, 'root-note.md', 'r');
    const result = await dropImport(root, '', [{ localPath: src }]);
    expect(result.copied[0]?.relativePath).toBe('root-note.md');
  });

  it('auto-renames on collision: foo.md → foo-2.md → foo-3.md', async () => {
    // Pre-populate the target folder with `foo.md` and `foo-2.md`.
    await fsp.writeFile(path.join(root, 'foo.md'), 'existing', 'utf-8');
    await fsp.writeFile(path.join(root, 'foo-2.md'), 'existing', 'utf-8');
    const src = await writeLocalFile(staging, 'foo.md', 'new');
    const result = await dropImport(root, '', [{ localPath: src }]);
    expect(result.copied[0]?.relativePath).toBe('foo-3.md');
    const content = await fsp.readFile(path.join(root, 'foo-3.md'), 'utf-8');
    expect(content).toBe('new');
  });

  it('accepts .md / .ttl / .csv; rejects unknown extensions', async () => {
    const md = await writeLocalFile(staging, 'n.md', '# n');
    const ttl = await writeLocalFile(staging, 's.ttl', '@prefix ex: <ex:> .');
    const csv = await writeLocalFile(staging, 't.csv', 'a,b\n1,2');
    const exe = await writeLocalFile(staging, 'bad.exe', 'NOT ALLOWED');
    const noext = await writeLocalFile(staging, 'noext', 'x');
    const result = await dropImport(root, '', [md, ttl, csv, exe, noext].map((localPath) => ({ localPath })));
    expect(result.copied.map((c) => c.relativePath).sort()).toEqual(
      ['n.md', 's.ttl', 't.csv'].sort(),
    );
    expect(result.rejected.map((r) => r.localPath).sort()).toEqual([exe, noext].sort());
    expect(result.rejected.find((r) => r.localPath === exe)?.reason).toMatch(/\.exe/);
    expect(result.rejected.find((r) => r.localPath === noext)?.reason).toMatch(/no extension/i);
  });

  it('ingests .pdf through ingestPdf — does NOT copy into the target folder', async () => {
    const result = await dropImport(root, 'anywhere', [{ localPath: ARXIV_FIXTURE }]);
    expect(result.ingestedPdfs).toHaveLength(1);
    expect(result.ingestedPdfs[0].sourceId).toMatch(/^sha-[0-9a-f]{12}$/);
    expect(result.copied).toEqual([]);
    // Target folder should not have received a copy of the PDF.
    expect(fs.existsSync(path.join(root, 'anywhere'))).toBe(false);
    // The Source lives under .minerva/sources/…
    expect(
      fs.existsSync(path.join(root, '.minerva/sources', result.ingestedPdfs[0].sourceId, 'original.pdf')),
    ).toBe(true);
  });

  it('captures a per-file failure in `rejected` without short-circuiting the others', async () => {
    const good = await writeLocalFile(staging, 'good.md', '# good');
    const missing = path.join(staging, 'never-existed.md');
    const result = await dropImport(root, '', [{ localPath: missing }, { localPath: good }]);
    expect(result.copied.map((c) => c.relativePath)).toEqual(['good.md']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].localPath).toBe(missing);
  });

  it('a colliding subfolder file renames only the leaf, not the whole relative path', async () => {
    await fsp.mkdir(path.join(root, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(root, 'sub', 'foo.md'), 'existing', 'utf-8');
    const src = await writeLocalFile(staging, 'foo.md', 'new');
    const result = await dropImport(root, '', [{ localPath: src, relativePath: 'sub/foo.md' }]);
    expect(result.copied[0]?.relativePath).toBe('sub/foo-2.md');
    expect(await fsp.readFile(path.join(root, 'sub/foo-2.md'), 'utf-8')).toBe('new');
    // The original collision at sub/foo.md is untouched.
    expect(await fsp.readFile(path.join(root, 'sub/foo.md'), 'utf-8')).toBe('existing');
  });

  describe('.zip entries (#2087)', () => {
    it('extracts and prefixes copied contents with the zip stem', async () => {
      await mockZipExtraction(staging, [{ relativePath: 'note.md', content: '# hi' }]);
      const zipLocal = path.join(staging, 'archive.zip');

      const result = await dropImport(root, '', [{ localPath: zipLocal }]);

      expect(extractZipToTempDir).toHaveBeenCalledWith(zipLocal);
      expect(result.rejected).toEqual([]);
      expect(result.copied).toEqual([
        { localPath: expect.stringContaining('note.md'), relativePath: 'archive/note.md' },
      ]);
      expect(await fsp.readFile(path.join(root, 'archive/note.md'), 'utf-8')).toBe('# hi');
    });

    it('nests under the zip entry\'s own relativePath directory when present', async () => {
      await mockZipExtraction(staging, [{ relativePath: 'note.md', content: '# hi' }]);
      const zipLocal = path.join(staging, 'archive.zip');

      const result = await dropImport(root, '', [
        { localPath: zipLocal, relativePath: 'MyFolder/archive.zip' },
      ]);

      expect(result.copied[0]?.relativePath).toBe('MyFolder/archive/note.md');
    });

    it('rejects a nested zip while the outer zip\'s other entries still succeed', async () => {
      // The outer zip's extracted contents include another zip and a normal
      // .md file. The inner zip must be rejected (zipDepth === 1) WITHOUT
      // extractZipToTempDir ever being called for it, and the .md sibling
      // must still land — proving the try/catch lives in dispatchEntry
      // itself rather than around the whole loop.
      const tmpDir = fs.mkdtempSync(path.join(staging, 'outer-stub-'));
      const goodLocal = path.join(tmpDir, 'good.md');
      await fsp.writeFile(goodLocal, '# good', 'utf-8');
      const innerZipLocal = path.join(tmpDir, 'inner.zip');
      await fsp.writeFile(innerZipLocal, 'not read', 'utf-8');
      vi.mocked(extractZipToTempDir).mockResolvedValueOnce({
        tmpDir,
        entries: [
          { localPath: innerZipLocal, relativePath: 'inner.zip' },
          { localPath: goodLocal, relativePath: 'good.md' },
        ],
        capped: false,
      });

      const outerZipLocal = path.join(staging, 'outer.zip');
      const result = await dropImport(root, '', [{ localPath: outerZipLocal }]);

      // extractZipToTempDir called exactly once — for the outer zip only.
      expect(extractZipToTempDir).toHaveBeenCalledTimes(1);
      expect(extractZipToTempDir).toHaveBeenCalledWith(outerZipLocal);

      expect(result.rejected).toEqual([
        { localPath: innerZipLocal, reason: 'Nested zip archives are not supported' },
      ]);
      expect(result.copied).toEqual([
        { localPath: goodLocal, relativePath: 'outer/good.md' },
      ]);
    });

    it('zipDepth resets for each top-level entry — a second top-level zip still extracts', async () => {
      await mockZipExtraction(staging, [{ relativePath: 'a.md', content: '# a' }]);
      await mockZipExtraction(staging, [{ relativePath: 'b.md', content: '# b' }]);
      const zip1 = path.join(staging, 'one.zip');
      const zip2 = path.join(staging, 'two.zip');

      const result = await dropImport(root, '', [{ localPath: zip1 }, { localPath: zip2 }]);

      expect(result.rejected).toEqual([]);
      expect(result.copied.map((c) => c.relativePath).sort()).toEqual(['one/a.md', 'two/b.md']);
    });

    it('one entry inside a zip failing to copy does not abort the other entries from that zip', async () => {
      await mockZipExtraction(staging, [
        { relativePath: 'bad.md', content: '# bad' },
        { relativePath: 'good.md', content: '# good' },
      ]);
      const zipLocal = path.join(staging, 'archive.zip');

      const realCopyFile = fsp.copyFile.bind(fsp);
      const spy = vi.spyOn(fsp, 'copyFile').mockImplementation(async (src, dest, mode?: number) => {
        if (typeof src === 'string' && src.endsWith('bad.md')) {
          throw new Error('EACCES: permission denied');
        }
        return realCopyFile(src, dest, mode);
      });

      try {
        const result = await dropImport(root, '', [{ localPath: zipLocal }]);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].reason).toMatch(/EACCES/);
        expect(result.copied).toEqual([
          { localPath: expect.stringContaining('good.md'), relativePath: 'archive/good.md' },
        ]);
      } finally {
        spy.mockRestore();
      }
    });

    it('propagates capped: true from the extraction result', async () => {
      await mockZipExtraction(staging, [{ relativePath: 'a.md', content: '# a' }], { capped: true });
      const zipLocal = path.join(staging, 'archive.zip');

      const result = await dropImport(root, '', [{ localPath: zipLocal }]);
      expect(result.capped).toBe(true);
    });

    it('does not set capped when nothing was capped', async () => {
      await mockZipExtraction(staging, [{ relativePath: 'a.md', content: '# a' }], { capped: false });
      const zipLocal = path.join(staging, 'archive.zip');
      const result = await dropImport(root, '', [{ localPath: zipLocal }]);
      expect(result.capped).toBe(false);
    });
  });
});

describe('resolveDropName', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('returns the input name when the slot is free', async () => {
    expect(await resolveDropName(root, '', 'foo.md')).toBe('foo.md');
    expect(await resolveDropName(root, 'notes', 'foo.md')).toBe('notes/foo.md');
  });

  it('increments the suffix past every existing collision', async () => {
    await fsp.writeFile(path.join(root, 'foo.md'), 'x');
    await fsp.writeFile(path.join(root, 'foo-2.md'), 'x');
    await fsp.writeFile(path.join(root, 'foo-3.md'), 'x');
    expect(await resolveDropName(root, '', 'foo.md')).toBe('foo-4.md');
  });

  it('preserves the extension when stemming the basename', async () => {
    await fsp.writeFile(path.join(root, 'data.csv'), 'x');
    expect(await resolveDropName(root, '', 'data.csv')).toBe('data-2.csv');
  });
});
