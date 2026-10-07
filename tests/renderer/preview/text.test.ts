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
  // The preview strips a CRLF block (stripFrontmatter is CRLF-aware) but this
  // used to count 0 lines for it, shifting every line reference after it —
  // the image-resize ref among them (#2690).
  it('counts a CRLF block, and one behind a byte-order mark, as the same lines', () => {
    const text = '---\r\ntitle: X\r\ntags: [a]\r\n---\r\nbody';
    expect(countFrontmatterLines(text)).toBe(4);
    expect(countFrontmatterLines(`\uFEFF${text}`)).toBe(4);
  });
});
