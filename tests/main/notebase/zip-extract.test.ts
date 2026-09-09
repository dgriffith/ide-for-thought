import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import {
  extractZipToTempDir,
  _setMaxZipBytesForTests,
} from '../../../src/main/notebase/zip-extract';
import { _setMaxBulkIngestEntriesForTests } from '../../../src/main/notebase/folder-walk';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-zip-extract-test-'));
}

async function writeZip(dir: string, name: string, build: (zip: JSZip) => void): Promise<string> {
  const zip = new JSZip();
  build(zip);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const zipPath = path.join(dir, name);
  await fsp.writeFile(zipPath, buf);
  return zipPath;
}

/** Every `minerva-zip-import-*` scratch dir currently on disk under os.tmpdir(). */
function existingScratchDirs(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('minerva-zip-import-'));
}

describe('extractZipToTempDir (#2087)', () => {
  let staging: string;

  beforeEach(() => { staging = mkTempDir(); });
  afterEach(async () => {
    _setMaxZipBytesForTests(undefined);
    _setMaxBulkIngestEntriesForTests(undefined);
    await fsp.rm(staging, { recursive: true, force: true });
  });

  it('extracts nested folders correctly and reflects them via enumerateFolderTree', async () => {
    const zipPath = await writeZip(staging, 'archive.zip', (zip) => {
      zip.file('top.md', '# top');
      zip.file('sub/nested.md', '# nested');
      zip.file('sub/deep/deeper.md', '# deeper');
    });

    const result = await extractZipToTempDir(zipPath);
    try {
      expect(result.capped).toBe(false);
      const relPaths = result.entries.map((e) => e.relativePath).sort();
      expect(relPaths).toEqual(['sub/deep/deeper.md', 'sub/nested.md', 'top.md']);
      // The returned entries genuinely reflect what's on disk, not zip
      // metadata directly — every localPath exists and its content matches.
      for (const entry of result.entries) {
        expect(fs.existsSync(entry.localPath)).toBe(true);
      }
      const top = result.entries.find((e) => e.relativePath === 'top.md')!;
      expect(await fsp.readFile(top.localPath, 'utf-8')).toBe('# top');
    } finally {
      await fsp.rm(result.tmpDir, { recursive: true, force: true });
    }
  });

  it('never writes dotfile entries to disk', async () => {
    const zipPath = await writeZip(staging, 'archive.zip', (zip) => {
      zip.file('.DS_Store', 'junk');
      zip.file('.git/HEAD', 'ref: refs/heads/main');
      zip.file('keep.md', '# keep');
    });

    const result = await extractZipToTempDir(zipPath);
    try {
      expect(result.entries.map((e) => e.relativePath)).toEqual(['keep.md']);
      expect(fs.existsSync(path.join(result.tmpDir, '.DS_Store'))).toBe(false);
      expect(fs.existsSync(path.join(result.tmpDir, '.git'))).toBe(false);
    } finally {
      await fsp.rm(result.tmpDir, { recursive: true, force: true });
    }
  });

  it('neutralizes a relative ../ traversal entry — nothing escapes tmpDir', async () => {
    // JSZip's own `loadAsync` resolves `.`/`..` path segments unconditionally
    // on read (lib/load.js: `utils.resolve(input.fileNameStr)`), and its
    // resolver can only pop back to the root, never past it (an over-popped
    // `..` is a silent no-op, not a preserved `..` component) — so a
    // `../../evil.txt` entry lands as plain `evil.txt`, not as a traversal,
    // even though `zip.file()` stores the raw literal name un-sanitized at
    // write time (verified directly: this is JSZip's real, current behavior,
    // not an assumption). `assertSafePath` is still mandatory defense in
    // depth for the vector JSZip does NOT neutralize — an absolute-path
    // entry name, covered by the next test — but there is no achievable
    // relative-traversal escape left to reject here.
    const zipPath = await writeZip(staging, 'traversal.zip', (zip) => {
      zip.file('innocent.md', '# fine');
      zip.file('../../evil.txt', 'not actually escaping');
    });

    const result = await extractZipToTempDir(zipPath);
    try {
      expect(result.entries.map((e) => e.relativePath).sort()).toEqual(['evil.txt', 'innocent.md']);
      for (const entry of result.entries) {
        expect(entry.localPath.startsWith(result.tmpDir)).toBe(true);
      }
    } finally {
      await fsp.rm(result.tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects the whole archive on an absolute-path entry name', async () => {
    const zipPath = await writeZip(staging, 'evil2.zip', (zip) => {
      zip.file('innocent.md', '# fine');
      zip.file('/etc/passwd', 'pwned');
    });

    const before = existingScratchDirs();
    await expect(extractZipToTempDir(zipPath)).rejects.toThrow();
    expect(existingScratchDirs()).toEqual(before);
  });

  it('rejects a corrupted zip buffer and leaves no orphaned tmpDir', async () => {
    const badPath = path.join(staging, 'corrupt.zip');
    await fsp.writeFile(badPath, Buffer.from('this is not a zip file at all'));

    const before = existingScratchDirs();
    await expect(extractZipToTempDir(badPath)).rejects.toThrow();
    expect(existingScratchDirs()).toEqual(before);
  });

  it('rejects upfront when the file exceeds the size ceiling, before reading it', async () => {
    _setMaxZipBytesForTests(10);
    const zipPath = await writeZip(staging, 'big.zip', (zip) => {
      zip.file('a.md', 'x'.repeat(100));
    });
    const before = existingScratchDirs();
    await expect(extractZipToTempDir(zipPath)).rejects.toThrow(/too large/i);
    // Rejected before mkdtemp even runs — nothing to clean up.
    expect(existingScratchDirs()).toEqual(before);
  });

  it('does not report capped when the entry count is under the (real, large) cap', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 5; i++) zip.file(`f${i}.md`, 'x');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = path.join(staging, 'many.zip');
    await fsp.writeFile(zipPath, buf);

    const result = await extractZipToTempDir(zipPath);
    try {
      expect(result.capped).toBe(false);
      expect(result.entries.length).toBe(5);
    } finally {
      await fsp.rm(result.tmpDir, { recursive: true, force: true });
    }
  });

  it('enforces the entry cap DURING extraction, not after the fact', async () => {
    // Uses the shared override from folder-walk.ts, which zip-extract.ts's
    // own extraction loop must read live (via getMaxBulkIngestEntries())
    // rather than the raw MAX_BULK_INGEST_ENTRIES constant — otherwise this
    // override would have no effect here and the cap-during-extraction path
    // could only be tested by generating 5000+ real zip entries.
    _setMaxBulkIngestEntriesForTests(2);
    const zip = new JSZip();
    for (let i = 0; i < 5; i++) zip.file(`f${i}.md`, 'x');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = path.join(staging, 'many.zip');
    await fsp.writeFile(zipPath, buf);

    const result = await extractZipToTempDir(zipPath);
    try {
      expect(result.capped).toBe(true);
      // Only the first 2 entries were ever written to disk — the rest were
      // never extracted, not just excluded from the returned list.
      expect(result.entries.length).toBe(2);
      const onDisk = await fsp.readdir(result.tmpDir);
      expect(onDisk.length).toBe(2);
    } finally {
      await fsp.rm(result.tmpDir, { recursive: true, force: true });
    }
  });
});
