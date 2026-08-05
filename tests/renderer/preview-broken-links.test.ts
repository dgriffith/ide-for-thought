/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { markBrokenWikiLinks } from '../../src/renderer/lib/preview/broken-links';

// Only `raft` resolves; everything else is "missing".
const resolvePath = (t: string): string | null => (t === 'raft' ? 'notes/raft.md' : null);

function render(html: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'preview';
  el.innerHTML = html;
  return el;
}

describe('markBrokenWikiLinks (#1446)', () => {
  it('marks an unresolved note link and leaves a resolved one alone', () => {
    const el = render(
      '<a class="wiki-link" data-target="missing">missing</a>' +
      '<a class="wiki-link" data-target="raft">raft</a>',
    );
    markBrokenWikiLinks(el, resolvePath);
    const [a, b] = [...el.querySelectorAll('.wiki-link')];
    expect(a!.classList.contains('wiki-link-broken')).toBe(true);
    expect(b!.classList.contains('wiki-link-broken')).toBe(false);
  });

  it('strips a #heading anchor — a missing heading on an existing note is not broken', () => {
    const el = render('<a class="wiki-link" data-target="raft#gone">raft</a>');
    markBrokenWikiLinks(el, resolvePath);
    expect(el.querySelector('.wiki-link')!.classList.contains('wiki-link-broken')).toBe(false);
  });

  it('skips typed (cite/quote) links — they resolve to sources/excerpts, not notes', () => {
    const el = render('<a class="wiki-link typed-link" data-target="some-source-id">cite</a>');
    markBrokenWikiLinks(el, resolvePath);
    expect(el.querySelector('.wiki-link')!.classList.contains('wiki-link-broken')).toBe(false);
  });

  it('clears the broken class when a link now resolves (re-render safety)', () => {
    const el = render('<a class="wiki-link wiki-link-broken" data-target="raft">raft</a>');
    markBrokenWikiLinks(el, resolvePath);
    expect(el.querySelector('.wiki-link')!.classList.contains('wiki-link-broken')).toBe(false);
  });

  it('is a no-op on a null container', () => {
    expect(() => markBrokenWikiLinks(null, resolvePath)).not.toThrow();
  });
});
