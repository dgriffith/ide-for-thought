/**
 * @vitest-environment happy-dom
 *
 * Unit coverage for the excerpt text matcher (#102 / #1451). `normalizeForMatch`
 * is a pure string transform; `findExcerptRange` walks a rendered DOM container
 * (TreeWalker + Range), so the test runs in happy-dom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { normalizeForMatch, findExcerptRange } from '../../../src/renderer/lib/components/find-excerpt-range';

afterEach(() => { document.body.innerHTML = ''; });

describe('normalizeForMatch', () => {
  it('collapses whitespace runs to a single space', () => {
    expect(normalizeForMatch('hello   world')).toBe('hello world');
    expect(normalizeForMatch('multi\n\nline\ttext')).toBe('multi line text');
  });

  it('lowercases and trims', () => {
    expect(normalizeForMatch('  Hello World  ')).toBe('hello world');
  });

  it('strips soft-hyphen / zero-width space / zero-width non-joiner', () => {
    expect(normalizeForMatch('soft­hyphen')).toBe('softhyphen');
    expect(normalizeForMatch('zero​width‌join')).toBe('zerowidthjoin');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeForMatch('   \n\t ')).toBe('');
  });
});

/** Build a container from HTML for findExcerptRange to search. */
function container(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('findExcerptRange', () => {
  it('returns a Range covering the matched text within a single block', () => {
    const el = container('<p>The sky is blue because of Rayleigh scattering.</p>');
    const range = findExcerptRange(el, 'sky is blue');
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('sky is blue');
  });

  it('matches case-insensitively and across collapsed whitespace', () => {
    const el = container('<p>The   SKY\nis   Blue.</p>');
    const range = findExcerptRange(el, 'sky is blue');
    expect(range).not.toBeNull();
    // The matched original text keeps its raw casing/spacing.
    expect(normalizeForMatch(range!.toString())).toBe('sky is blue');
  });

  it('matches text spanning adjacent block elements (synthetic space between blocks)', () => {
    const paras = container('<p>end of para</p><p>next line</p>');
    const range = findExcerptRange(paras, 'para next');
    expect(range).not.toBeNull();
    // The synthetic inter-block space lives only in the internal index, so the
    // Range's DOM text is "para"→"next" with no gap — but it spans BOTH blocks.
    const [first, second] = Array.from(paras.querySelectorAll('p'));
    expect(range!.startContainer.parentElement).toBe(first);
    expect(range!.endContainer.parentElement).toBe(second);
    expect(range!.toString().replace(/\s+/g, '')).toBe('paranext');
  });

  it('finds text despite soft-hyphens in the rendered DOM', () => {
    const el = container('<p>Ray­leigh scat­tering</p>');
    const range = findExcerptRange(el, 'rayleigh scattering');
    expect(range).not.toBeNull();
  });

  it('returns null when the text is not present', () => {
    const el = container('<p>Some unrelated content.</p>');
    expect(findExcerptRange(el, 'not in here')).toBeNull();
  });

  it('returns null for empty / whitespace-only cited text', () => {
    const el = container('<p>content</p>');
    expect(findExcerptRange(el, '')).toBeNull();
    expect(findExcerptRange(el, '   ')).toBeNull();
  });

  it('ignores text inside the excerpt density gutter chrome', () => {
    const el = container(
      '<div class="excerpt-density-gutter">phantom text</div><p>real body text</p>',
    );
    // The gutter copy must not be matchable…
    expect(findExcerptRange(el, 'phantom text')).toBeNull();
    // …but the real body still is.
    expect(findExcerptRange(el, 'real body')).not.toBeNull();
  });

  it('matches the first occurrence when the text repeats', () => {
    const el = container('<p>alpha</p><p>alpha</p>');
    const range = findExcerptRange(el, 'alpha');
    expect(range).not.toBeNull();
    // Range should be anchored in the first paragraph's text node.
    expect(range!.startContainer.parentElement).toBe(el.querySelector('p'));
  });
});
