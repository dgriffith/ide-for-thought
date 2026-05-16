import { describe, expect, it } from 'vitest';
import {
  patchFrontmatterProperties,
  readFrontmatterProperties,
} from '../../../src/shared/refactor/frontmatter-patch';

describe('patchFrontmatterProperties', () => {
  it('creates a frontmatter block on a note that has none', () => {
    const before = '# My Note\n\nSome body content.\n';
    const result = patchFrontmatterProperties(before, { status: 'draft' });
    expect(result.changedKeys).toEqual(['status']);
    expect(result.content).toBe(
      '---\nstatus: draft\n---\n\n# My Note\n\nSome body content.\n',
    );
  });

  it('merges new keys into an existing frontmatter block', () => {
    const before = '---\ntitle: Hello\n---\n\n# Hello\n';
    const result = patchFrontmatterProperties(before, { status: 'draft' });
    expect(result.changedKeys).toEqual(['status']);
    expect(result.content).toContain('title: Hello');
    expect(result.content).toContain('status: draft');
    expect(result.content).toMatch(/^---\n[\s\S]*?\n---\n/);
  });

  it('overwrites an existing key when the value differs', () => {
    const before = '---\nstatus: draft\n---\n\nbody\n';
    const result = patchFrontmatterProperties(before, { status: 'published' });
    expect(result.changedKeys).toEqual(['status']);
    expect(readFrontmatterProperties(result.content).status).toBe('published');
  });

  it('treats an existing value matching the patch as a no-op', () => {
    const before = '---\nstatus: draft\n---\n\nbody\n';
    const result = patchFrontmatterProperties(before, { status: 'draft' });
    expect(result.changedKeys).toEqual([]);
    expect(result.content).toBe(before);
  });

  it('deletes a key when patch value is null', () => {
    const before = '---\ntitle: Hello\nstatus: draft\n---\n\nbody\n';
    const result = patchFrontmatterProperties(before, { status: null });
    expect(result.deletedKeys).toEqual(['status']);
    expect(readFrontmatterProperties(result.content)).toEqual({ title: 'Hello' });
  });

  it('removes the frontmatter block entirely when it ends up empty', () => {
    const before = '---\nstatus: draft\n---\n\n# Note\n';
    const result = patchFrontmatterProperties(before, { status: null });
    expect(result.content).toBe('# Note\n');
  });

  it('handles array values', () => {
    const before = '# Note\n';
    const result = patchFrontmatterProperties(before, { tags: ['a', 'b'] });
    expect(result.changedKeys).toEqual(['tags']);
    expect(readFrontmatterProperties(result.content).tags).toEqual(['a', 'b']);
  });

  it('treats malformed existing frontmatter as empty (overwrites it)', () => {
    const before = '---\n: : : not yaml\n---\n\nbody\n';
    const result = patchFrontmatterProperties(before, { status: 'draft' });
    expect(result.changedKeys).toEqual(['status']);
    expect(readFrontmatterProperties(result.content).status).toBe('draft');
  });
});

describe('readFrontmatterProperties', () => {
  it('returns {} for a note without frontmatter', () => {
    expect(readFrontmatterProperties('# Just a heading\n')).toEqual({});
  });

  it('parses a valid frontmatter block', () => {
    expect(readFrontmatterProperties('---\nstatus: draft\ntags:\n  - a\n  - b\n---\n\nbody'))
      .toEqual({ status: 'draft', tags: ['a', 'b'] });
  });
});
