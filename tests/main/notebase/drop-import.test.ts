import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  dropImport,
  resolveDropName,
} from '../../../src/main/notebase/drop-import';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-drop-import-test-'));
}

async function writeLocalFile(dir: string, name: string, content: string): Promise<string> {
  const p = path.join(dir, name);
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

describe('dropImport (#259)', () => {
  let root: string;
  let staging: string;

  beforeEach(() => {
    root = mkTempProject();
    staging = mkTempProject();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(staging, { recursive: true, force: true });
  });

  it('copies a .md into the target folder, preserving the basename', async () => {
    const src = await writeLocalFile(staging, 'note.md', '# Hello\n');
    const result = await dropImport(root, 'notes', [src]);
    expect(result.copied).toEqual([
      { localPath: src, relativePath: 'notes/note.md' },
    ]);
    expect(result.ingestedPdfs).toEqual([]);
    expect(result.rejected).toEqual([]);
    const landed = await fsp.readFile(path.join(root, 'notes/note.md'), 'utf-8');
    expect(landed).toBe('# Hello\n');
  });

  it('creates a missing target folder on the fly', async () => {
    const src = await writeLocalFile(staging, 'note.md', 'x');
    await dropImport(root, 'a/b/c', [src]);
    expect(fs.existsSync(path.join(root, 'a/b/c/note.md'))).toBe(true);
  });

  it('drops into the project root when targetFolder is empty', async () => {
    const src = await writeLocalFile(staging, 'root-note.md', 'r');
    const result = await dropImport(root, '', [src]);
    expect(result.copied[0]?.relativePath).toBe('root-note.md');
  });

  it('auto-renames on collision: foo.md → foo-2.md → foo-3.md', async () => {
    // Pre-populate the target folder with `foo.md` and `foo-2.md`.
    await fsp.writeFile(path.join(root, 'foo.md'), 'existing', 'utf-8');
    await fsp.writeFile(path.join(root, 'foo-2.md'), 'existing', 'utf-8');
    const src = await writeLocalFile(staging, 'foo.md', 'new');
    const result = await dropImport(root, '', [src]);
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
    const result = await dropImport(root, '', [md, ttl, csv, exe, noext]);
    expect(result.copied.map((c) => c.relativePath).sort()).toEqual(
      ['n.md', 's.ttl', 't.csv'].sort(),
    );
    expect(result.rejected.map((r) => r.localPath).sort()).toEqual([exe, noext].sort());
    expect(result.rejected.find((r) => r.localPath === exe)?.reason).toMatch(/\.exe/);
    expect(result.rejected.find((r) => r.localPath === noext)?.reason).toMatch(/no extension/i);
  });

  it('ingests .pdf through ingestPdf — does NOT copy into the target folder', async () => {
    const result = await dropImport(root, 'anywhere', [ARXIV_FIXTURE]);
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
    const result = await dropImport(root, '', [missing, good]);
    expect(result.copied.map((c) => c.relativePath)).toEqual(['good.md']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].localPath).toBe(missing);
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
