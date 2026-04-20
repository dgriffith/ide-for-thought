import { describe, it, expect } from 'vitest';
import { buildParseCache } from '../../../src/shared/formatter/parse-cache';

describe('buildParseCache (issue #153)', () => {
  it('detects a top-of-file YAML frontmatter block', () => {
    const src = '---\ntitle: Foo\ntags: [a, b]\n---\n\n# Heading\n';
    const cache = buildParseCache(src);
    expect(cache.frontmatterRange).not.toBeNull();
    expect(cache.frontmatterRange!.start).toBe(0);
    // `---\ntitle: Foo\ntags: [a, b]\n---\n` ends at col 36 \u00B1 a few.
    expect(cache.frontmatterRange!.end).toBeGreaterThan(25);
    expect(cache.isProtected(5)).toBe(true);   // inside frontmatter
    expect(cache.isProtected(50)).toBe(false); // in the body
  });

  it('ignores a `---` line that isn\u2019t at the top of the file', () => {
    const src = '# Title\n\nSome body\n\n---\nnot: frontmatter\n---\n';
    const cache = buildParseCache(src);
    expect(cache.frontmatterRange).toBeNull();
  });

  it('finds fenced code blocks (triple backticks)', () => {
    const src = '# Heading\n\n```js\nconst x = 1;\n```\n\nplain\n';
    const cache = buildParseCache(src);
    expect(cache.codeFenceRanges).toHaveLength(1);
    const range = cache.codeFenceRanges[0];
    expect(src.slice(range.start, range.end)).toContain('```js');
    expect(src.slice(range.start, range.end)).toContain('const x = 1;');
  });

  it('finds fenced code blocks with tildes', () => {
    const src = '~~~~\ncode\n~~~~\n';
    const cache = buildParseCache(src);
    expect(cache.codeFenceRanges).toHaveLength(1);
  });

  it('masks inline-backtick matches inside fenced code blocks', () => {
    const src = '```\n`inside fence`\n```\n\n`real inline`\n';
    const cache = buildParseCache(src);
    // Only the after-fence `real inline` should register as inline code.
    expect(cache.inlineCodeRanges).toHaveLength(1);
    const r = cache.inlineCodeRanges[0];
    expect(src.slice(r.start, r.end)).toBe('`real inline`');
  });

  it('finds inline math `$\u2026$` and block math `$$\u2026$$`', () => {
    const src = 'inline $a+b$ math and block\n$$\nx = 1\n$$\ndone\n';
    const cache = buildParseCache(src);
    expect(cache.mathRanges.length).toBeGreaterThanOrEqual(2);
    const texts = cache.mathRanges.map((r) => src.slice(r.start, r.end));
    expect(texts).toContain('$a+b$');
    expect(texts.some((t) => t.includes('x = 1'))).toBe(true);
  });

  it('does not match inline math inside code fences', () => {
    const src = '```\n$ not math $\n```\n\nreal $x$ math\n';
    const cache = buildParseCache(src);
    expect(cache.mathRanges).toHaveLength(1);
    const r = cache.mathRanges[0];
    expect(src.slice(r.start, r.end)).toBe('$x$');
  });

  it('detects contiguous blockquote regions', () => {
    const src = [
      'prose',
      '',
      '> first quote line',
      '> second quote line',
      '',
      'not a quote',
      '',
      '> another quote',
      'not a quote',
      '',
    ].join('\n');
    const cache = buildParseCache(src);
    expect(cache.blockquoteRanges).toHaveLength(2);
  });

  it('isProtected returns true for offsets inside any protected range', () => {
    const src = '---\nt: x\n---\n\n```\ncode\n```\n\n`inline`\n$m$\n';
    const cache = buildParseCache(src);
    // Pick an offset inside each protected kind.
    const fmIdx = 5;
    const codeIdx = src.indexOf('code');
    const inlineIdx = src.indexOf('`inline`') + 1;
    const mathIdx = src.indexOf('$m$') + 1;
    expect(cache.isProtected(fmIdx)).toBe(true);
    expect(cache.isProtected(codeIdx)).toBe(true);
    expect(cache.isProtected(inlineIdx)).toBe(true);
    expect(cache.isProtected(mathIdx)).toBe(true);
    // A position on a plain blank line should not be protected.
    const blankIdx = src.indexOf('\n\n') + 1;
    expect(cache.isProtected(blankIdx)).toBe(false);
  });

  it('returns empty ranges on an empty document', () => {
    const cache = buildParseCache('');
    expect(cache.frontmatterRange).toBeNull();
    expect(cache.codeFenceRanges).toEqual([]);
    expect(cache.inlineCodeRanges).toEqual([]);
    expect(cache.mathRanges).toEqual([]);
    expect(cache.blockquoteRanges).toEqual([]);
    expect(cache.isProtected(0)).toBe(false);
  });
});
