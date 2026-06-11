/**
 * Pure text/frontmatter helpers extracted from Preview.svelte (#672).
 */
import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  escapeAttr,
  stripFrontmatter,
  countFrontmatterLines,
} from '../../../src/renderer/lib/preview/text';

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('escapes & first so entities are not double-encoded', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('escapeAttr', () => {
  it('escapes html plus double quotes', () => {
    expect(escapeAttr('say "<hi>"')).toBe('say &quot;&lt;hi&gt;&quot;');
  });
});

describe('stripFrontmatter', () => {
  it('removes a leading --- … --- block', () => {
    const text = '---\ntitle: X\ntags: [a]\n---\nbody here';
    expect(stripFrontmatter(text)).toBe('body here');
  });
  it('leaves content without frontmatter untouched', () => {
    expect(stripFrontmatter('# Heading\nbody')).toBe('# Heading\nbody');
  });
});

describe('countFrontmatterLines', () => {
  it('counts the newlines in the frontmatter block', () => {
    const text = '---\ntitle: X\ntags: [a]\n---\nbody';
    expect(countFrontmatterLines(text)).toBe(4);
  });
  it('returns 0 when there is no frontmatter', () => {
    expect(countFrontmatterLines('# Heading\nbody')).toBe(0);
  });
});
