/**
 * Minerva inline markdown tokens extracted from Preview (#672).
 */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { installWikiLinks, installNoteTags } from '../../src/renderer/lib/markdown/inline-tokens-plugin';

function inline(src: string): string {
  const md = new MarkdownIt();
  installWikiLinks(md);
  installNoteTags(md);
  return md.renderInline(src);
}

describe('installWikiLinks', () => {
  it('renders a plain wiki link with target + display', () => {
    const h = inline('[[notes/foo]]');
    expect(h).toContain('class="wiki-link"');
    expect(h).toContain('data-target="notes/foo"');
    expect(h).toContain('>notes/foo</a>');
  });

  it('honours a |display override', () => {
    expect(inline('[[notes/foo|Foo Note]]')).toContain('>Foo Note</a>');
  });

  it('renders a typed link with a colored badge', () => {
    const h = inline('[[supports::notes/bar]]');
    expect(h).toContain('typed-link');
    expect(h).toContain('link-type-badge');
    expect(h).toContain('data-target="notes/bar"');
  });

  it('leaves non-wiki text alone', () => {
    expect(inline('just text [single]')).not.toContain('wiki-link');
  });
});

describe('installNoteTags', () => {
  it('renders a #tag at the start of a line', () => {
    const h = inline('#research');
    expect(h).toContain('class="note-tag"');
    expect(h).toContain('data-tag="research"');
    expect(h).toContain('#research');
  });

  it('renders a #tag after whitespace', () => {
    expect(inline('see #cs/theory here')).toContain('data-tag="cs/theory"');
  });

  it('ignores a # not preceded by whitespace (mid-word)', () => {
    expect(inline('a#b')).not.toContain('note-tag');
  });
});
