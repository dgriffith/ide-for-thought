import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createExcerpt, buildExcerptTtl } from '../../../src/main/sources/create-excerpt';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-excerpt-test-'));
}

describe('buildExcerptTtl (#224)', () => {
  it('emits the required predicates', () => {
    const ttl = buildExcerptTtl({
      sourceId: 'toulmin-1958',
      citedText: 'The essence of a software entity is a construct of interlocking concepts.',
    });
    expect(ttl).toContain('this: a thought:Excerpt');
    expect(ttl).toContain('thought:fromSource sources:toulmin-1958');
    expect(ttl).toContain('thought:citedText "The essence of a software entity is a construct of interlocking concepts."');
    expect(ttl).toMatch(/prov:generatedAtTime "[^"]+"\^\^xsd:dateTime \./);
  });

  it('includes optional page / pageRange / locationText when supplied', () => {
    const ttl = buildExcerptTtl({
      sourceId: 's',
      citedText: 'x',
      page: 42,
      pageRange: '97-98',
      locationText: 'Section: The Essential Difficulties',
    });
    expect(ttl).toContain('thought:page 42');
    expect(ttl).toContain('thought:pageRange "97-98"');
    expect(ttl).toContain('thought:locationText "Section: The Essential Difficulties"');
  });

  it('omits optional predicates when absent', () => {
    const ttl = buildExcerptTtl({ sourceId: 's', citedText: 'x' });
    expect(ttl).not.toContain('thought:page');
    expect(ttl).not.toContain('thought:pageRange');
    expect(ttl).not.toContain('thought:locationText');
  });

  it('escapes quotes and backslashes in the cited text', () => {
    const ttl = buildExcerptTtl({
      sourceId: 's',
      citedText: 'He said "so" and escaped \\ things.',
    });
    expect(ttl).toContain('thought:citedText "He said \\"so\\" and escaped \\\\ things."');
  });

  it('escapes newlines in multi-line excerpts', () => {
    const ttl = buildExcerptTtl({ sourceId: 's', citedText: 'line one\nline two' });
    expect(ttl).toContain('thought:citedText "line one\\nline two"');
  });

  it('trims leading/trailing whitespace from the cited text', () => {
    const ttl = buildExcerptTtl({ sourceId: 's', citedText: '   padded on both sides   ' });
    expect(ttl).toContain('thought:citedText "padded on both sides"');
  });
});

describe('createExcerpt (#224)', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('writes the ttl under .minerva/excerpts/ with a sourceId-hash id', async () => {
    const result = await createExcerpt(root, {
      sourceId: 'toulmin-1958',
      citedText: 'A quote to cite.',
    });
    expect(result.duplicate).toBe(false);
    expect(result.excerptId).toMatch(/^toulmin-1958-[a-f0-9]{12}$/);
    expect(result.relativePath).toBe(`.minerva/excerpts/${result.excerptId}.ttl`);
    expect(fs.existsSync(path.join(root, result.relativePath))).toBe(true);
  });

  it('is idempotent — same text yields the same id', async () => {
    const a = await createExcerpt(root, { sourceId: 's', citedText: 'Identical quote.' });
    const b = await createExcerpt(root, { sourceId: 's', citedText: 'Identical quote.' });
    expect(a.excerptId).toBe(b.excerptId);
    expect(b.duplicate).toBe(true);
  });

  it('produces different ids for different text on the same source', async () => {
    const a = await createExcerpt(root, { sourceId: 's', citedText: 'First passage.' });
    const b = await createExcerpt(root, { sourceId: 's', citedText: 'Second passage.' });
    expect(a.excerptId).not.toBe(b.excerptId);
  });

  it('produces different ids for the same text on different sources', async () => {
    const a = await createExcerpt(root, { sourceId: 'alice-2024', citedText: 'shared quote' });
    const b = await createExcerpt(root, { sourceId: 'bob-2024', citedText: 'shared quote' });
    expect(a.excerptId).not.toBe(b.excerptId);
    expect(a.excerptId.startsWith('alice-2024-')).toBe(true);
    expect(b.excerptId.startsWith('bob-2024-')).toBe(true);
  });

  it('persists the content so the indexer picks it up', async () => {
    const result = await createExcerpt(root, {
      sourceId: 's',
      citedText: 'Check me.',
      page: 11,
      locationText: 'Introduction',
    });
    const ttl = await fsp.readFile(path.join(root, result.relativePath), 'utf-8');
    expect(ttl).toContain('thought:fromSource sources:s');
    expect(ttl).toContain('thought:page 11');
    expect(ttl).toContain('thought:locationText "Introduction"');
  });

  it('does not overwrite an existing file on a duplicate call', async () => {
    const first = await createExcerpt(root, { sourceId: 's', citedText: 'Same.' });
    const absPath = path.join(root, first.relativePath);
    // Hand-edit the file; a duplicate save should preserve the edit.
    await fsp.writeFile(absPath, 'this: a thought:Excerpt ;\n    thought:citedText "Hand-edited" .\n', 'utf-8');
    const second = await createExcerpt(root, { sourceId: 's', citedText: 'Same.' });
    expect(second.duplicate).toBe(true);
    const content = await fsp.readFile(absPath, 'utf-8');
    expect(content).toContain('Hand-edited');
  });

  it('rejects an empty selection', async () => {
    await expect(
      createExcerpt(root, { sourceId: 's', citedText: '   \n  ' }),
    ).rejects.toThrow(/empty/i);
  });

  it('rejects a missing sourceId', async () => {
    await expect(
      createExcerpt(root, { sourceId: '', citedText: 'anything' }),
    ).rejects.toThrow(/sourceid/i);
  });
});
