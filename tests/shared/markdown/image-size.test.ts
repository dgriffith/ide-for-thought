/**
 * The Obsidian image-size suffix (#2666): `![alt|400](pic.png)`,
 * `![alt|400x300](pic.png)`.
 */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  IMAGE_MAX_PX, applyImageSize, findImageLabels, formatImageSizeSuffix, installImageSize, parseImageSizeSuffix,
  type ImageSizeMeta,
} from '../../../src/shared/markdown/image-size';

function render(src: string, env: Record<string, unknown> = {}): string {
  const md = new MarkdownIt();
  installImageSize(md);
  return md.render(src, env);
}

describe('parseImageSizeSuffix', () => {
  it('reads a width', () => {
    expect(parseImageSizeSuffix('shot|400')).toEqual({ alt: 'shot', size: { width: 400, height: null } });
  });
  it('reads width x height', () => {
    expect(parseImageSizeSuffix('shot|400x300')).toEqual({ alt: 'shot', size: { width: 400, height: 300 } });
  });
  it('leaves a non-numeric suffix as alt text', () => {
    expect(parseImageSizeSuffix('shot|wide')).toEqual({ alt: 'shot|wide', size: null });
    expect(parseImageSizeSuffix('shot|400px')).toEqual({ alt: 'shot|400px', size: null });
  });
  it('keeps a | inside real alt text, taking only the last segment as a size', () => {
    expect(parseImageSizeSuffix('a|b')).toEqual({ alt: 'a|b', size: null });
    expect(parseImageSizeSuffix('a|b|400')).toEqual({ alt: 'a|b', size: { width: 400, height: null } });
  });
  it('treats an escaped \\| (a table cell) as the separator', () => {
    expect(parseImageSizeSuffix('shot\\|400')).toEqual({ alt: 'shot', size: { width: 400, height: null } });
  });
  it('rejects a zero width, and formats back', () => {
    expect(parseImageSizeSuffix('a|0').size).toBeNull();
    expect(formatImageSizeSuffix({ width: 400, height: 300 })).toBe('|400x300');
    expect(formatImageSizeSuffix({ width: 400, height: null })).toBe('|400');
    expect(formatImageSizeSuffix(null)).toBe('');
  });
});

describe('installImageSize', () => {
  it('emits width, strips the suffix from alt', () => {
    expect(render('![shot|400](pic.png)')).toContain('<img src="pic.png" alt="shot" width="400">');
  });
  it('emits width and height', () => {
    expect(render('![shot|400x300](pic.png)')).toContain('<img src="pic.png" alt="shot" width="400" height="300">');
  });
  it('leaves a non-numeric suffix and a real | in the alt text', () => {
    expect(render('![shot|wide](pic.png)')).toContain('alt="shot|wide"');
    expect(render('![a|b](pic.png)')).toContain('alt="a|b"');
    expect(render('![a|b](pic.png)')).not.toContain('width=');
  });
  it('a bare |400 is an empty alt', () => {
    expect(render('![|400](pic.png)')).toContain('<img src="pic.png" alt="" width="400">');
  });
  it('clamps an absurd size when drawing, without touching the source', () => {
    expect(render('![x|99999](pic.png)')).toContain(`width="${IMAGE_MAX_PX}"`);
  });
  it('sizes an image in a table cell via \\|', () => {
    const html = render('| a |\n|---|\n| ![s\\|120](p.png) |\n');
    expect(html).toContain('<img src="p.png" alt="s" width="120">');
  });
  it('stamps where each image sits in the full source', () => {
    const md = new MarkdownIt();
    installImageSize(md);
    const tokens = md.parse('para\n\n![a|10](x.png) and ![a|10](y.png)\n', { lineOffset: 3 });
    const imgs = tokens.flatMap((t) => t.children ?? []).filter((t) => t.type === 'image');
    expect(imgs.map((t) => (t.meta as ImageSizeMeta).imageSource)).toEqual([
      { line: 6, endLine: 6, label: 'a|10', ordinal: 0, index: 0 },
      { line: 6, endLine: 6, label: 'a|10', ordinal: 1, index: 1 },
    ]);
  });
});

describe('findImageLabels', () => {
  it('skips code spans and escapes, and nests brackets', () => {
    const text = '`![no](x)` \\![no](x) ![a [b] c](y) ![r][ref]';
    expect(findImageLabels(text).map((s) => text.slice(s.start, s.end))).toEqual(['a [b] c', 'r']);
  });
});

describe('applyImageSize', () => {
  const content = '---\ntitle: T\n---\n# T\n\nSee ![a](x.png) and ![a](y.png).\n';
  const ref = (ordinal: number, label = 'a') => ({ line: 6, endLine: 6, label, ordinal, index: ordinal });

  it('adds a width to the right occurrence', () => {
    expect(applyImageSize(content, ref(1), { width: 400, height: null }))
      .toBe('---\ntitle: T\n---\n# T\n\nSee ![a](x.png) and ![a|400](y.png).\n');
  });
  it('replaces an existing size and resets it', () => {
    const sized = 'x ![shot|200x100](p.png)\n';
    const r = { line: 1, endLine: 1, label: 'shot|200x100', ordinal: 0, index: 0 };
    expect(applyImageSize(sized, r, { width: 400, height: 200 })).toBe('x ![shot|400x200](p.png)\n');
    expect(applyImageSize(sized, r, null)).toBe('x ![shot](p.png)\n');
  });
  it('keeps an escaped separator', () => {
    const r = { line: 1, endLine: 1, label: 's\\|120', ordinal: 0, index: 0 };
    expect(applyImageSize('![s\\|120](p.png)', r, { width: 90, height: null })).toBe('![s\\|90](p.png)');
  });
  it('writes nothing when the image is no longer there', () => {
    expect(applyImageSize(content, ref(0, 'gone'), { width: 400, height: null })).toBeNull();
    expect(applyImageSize(content, { ...ref(0), line: 99, endLine: 99 }, { width: 400, height: null })).toBeNull();
  });
});
