import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/canonicalize-frontmatter-keys';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'canonicalize-frontmatter-keys': true },
  configs: {},
};

describe('canonicalize-frontmatter-keys (#161)', () => {
  it('renames author → creator', () => {
    const out = formatContent('---\nauthor: Alice\n---\n', enabled);
    expect(out).toContain('creator: Alice');
    expect(out).not.toContain('author:');
  });

  it('renames date → issued', () => {
    const out = formatContent('---\ndate: 2025-01-01\n---\n', enabled);
    expect(out).toContain('issued: 2025-01-01');
  });

  it('renames url → uri', () => {
    const out = formatContent('---\nurl: https://example.com\n---\n', enabled);
    expect(out).toContain('uri: https://example.com');
  });

  it('leaves canonical keys untouched', () => {
    const src = '---\ncreator: Alice\nissued: 2025\nuri: https://x\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('leaves unknown keys alone', () => {
    const src = '---\nstatus: draft\nlocation: office\n---\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not overwrite when both alias and canonical are present', () => {
    // Merging two values is out of scope; the alias stays.
    const src = '---\ncreator: Bob\nauthor: Alice\n---\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('creator: Bob');
    expect(out).toContain('author: Alice');
  });

  it('is a no-op on files without frontmatter', () => {
    const src = 'body\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('---\nauthor: Alice\n---\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
