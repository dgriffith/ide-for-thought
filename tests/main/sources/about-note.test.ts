/**
 * Zotero-style about-note creation for the clipper (#793/#474).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAboutNote, slugifyTitle } from '../../../src/main/sources/about-note';

const roots: string[] = [];
function mkRoot(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-about-note-'));
  roots.push(r);
  return r;
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe('slugifyTitle', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugifyTitle('  Note on A Great Page!  ')).toBe('note-on-a-great-page');
  });
  it('caps length and strips edge hyphens', () => {
    expect(slugifyTitle('--- @@@ ---')).toBe('');
    expect(slugifyTitle('x'.repeat(100)).length).toBe(60);
  });
});

describe('createAboutNote', () => {
  it('writes about frontmatter, heading, and body', async () => {
    const root = mkRoot();
    const { relativePath } = await createAboutNote(root, {
      sourceId: 'arxiv-2604.18561',
      title: 'Note on Attention Is All You Need',
      body: 'Key result: transformers.',
    });
    expect(relativePath).toBe('note-on-attention-is-all-you-need.md');
    const content = await fsp.readFile(path.join(root, relativePath), 'utf-8');
    expect(content).toBe(
      '---\nabout: [[sources/arxiv-2604.18561]]\n---\n\n' +
      '# Note on Attention Is All You Need\n\nKey result: transformers.\n',
    );
  });

  it('disambiguates the filename instead of overwriting', async () => {
    const root = mkRoot();
    const a = await createAboutNote(root, { sourceId: 's', title: 'Same Title', body: 'one' });
    const b = await createAboutNote(root, { sourceId: 's', title: 'Same Title', body: 'two' });
    expect(a.relativePath).toBe('same-title.md');
    expect(b.relativePath).toBe('same-title-2.md');
    expect(await fsp.readFile(path.join(root, a.relativePath), 'utf-8')).toContain('one');
    expect(await fsp.readFile(path.join(root, b.relativePath), 'utf-8')).toContain('two');
  });

  it('falls back to a default stem when the title has no usable chars', async () => {
    const root = mkRoot();
    const { relativePath } = await createAboutNote(root, { sourceId: 's', title: '!!!', body: 'x' });
    expect(relativePath).toBe('clipped-note.md');
  });
});
