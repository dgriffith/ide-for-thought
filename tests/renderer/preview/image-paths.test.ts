/**
 * Relative-image-path resolution + MIME guessing (#672).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRelativeImagePath,
  mimeFromPath,
} from '../../../src/renderer/lib/preview/image-paths';

describe('resolveRelativeImagePath', () => {
  it('resolves against a nested note directory', () => {
    expect(resolveRelativeImagePath('img.png', 'notes/sub/post.md')).toBe('notes/sub/img.png');
  });
  it('collapses .. segments relative to the note dir', () => {
    expect(resolveRelativeImagePath('../assets/img.png', 'notes/sub/post.md'))
      .toBe('notes/assets/img.png');
  });
  it('strips a leading ./', () => {
    expect(resolveRelativeImagePath('./img.png', 'notes/post.md')).toBe('notes/img.png');
  });
  it('treats a root-level note (graph.md) as having no dir prefix', () => {
    expect(resolveRelativeImagePath('img.png', 'graph.md')).toBe('img.png');
  });
  it('handles a null note path', () => {
    expect(resolveRelativeImagePath('img.png', null)).toBe('img.png');
  });
});

describe('mimeFromPath', () => {
  it('maps known extensions', () => {
    expect(mimeFromPath('a.png')).toBe('image/png');
    expect(mimeFromPath('a.jpg')).toBe('image/jpeg');
    expect(mimeFromPath('a.jpeg')).toBe('image/jpeg');
    expect(mimeFromPath('a.gif')).toBe('image/gif');
    expect(mimeFromPath('a.webp')).toBe('image/webp');
    expect(mimeFromPath('a.svg')).toBe('image/svg+xml');
    expect(mimeFromPath('a.avif')).toBe('image/avif');
  });
  it('falls back to octet-stream for unknown / extensionless', () => {
    expect(mimeFromPath('a.bmp')).toBe('application/octet-stream');
    expect(mimeFromPath('noext')).toBe('application/octet-stream');
  });
});
