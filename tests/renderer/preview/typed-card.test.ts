/**
 * @vitest-environment happy-dom
 *
 * Type-keyed card HTML builders + the block-level heuristic (#1071).
 */
import { describe, it, expect } from 'vitest';
import {
  buildObjectCardHtml,
  buildExcerptCardHtml,
  isBlockLevelLink,
  isImageUrl,
} from '../../../src/renderer/lib/preview/typed-card';
import type { NoteTypedProperties } from '../../../src/shared/objects/type-def';

function book(values: Record<string, string | null>, over = {}): NoteTypedProperties {
  return {
    type: {
      id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', cover: 'cover',
      properties: [
        { name: 'cover', type: 'text', label: 'Cover' },
        { name: 'author', type: 'text', label: 'Author' },
        { name: 'rating', type: 'number', label: 'Rating' },
      ],
      ...over,
    },
    properties: [
      { name: 'cover', type: 'text', label: 'Cover', value: values.cover ?? null },
      { name: 'author', type: 'text', label: 'Author', value: values.author ?? null },
      { name: 'rating', type: 'number', label: 'Rating', value: values.rating ?? null },
    ],
  };
}

describe('isImageUrl', () => {
  it('accepts http(s) URLs and rejects everything else', () => {
    expect(isImageUrl('https://x/a.png')).toBe(true);
    expect(isImageUrl('http://x/a.png')).toBe(true);
    expect(isImageUrl('assets/a.png')).toBe(false);
    expect(isImageUrl(null)).toBe(false);
    expect(isImageUrl('')).toBe(false);
  });
});

describe('buildObjectCardHtml (#1071)', () => {
  it('renders a cover image + title + selected field chips', () => {
    const html = buildObjectCardHtml(book({ cover: 'https://x/dune.png', author: 'Herbert', rating: '5' }), { title: 'Dune' });
    expect(html).toContain('<img src="https://x/dune.png"');
    expect(html).toContain('oc-title');
    expect(html).toContain('Dune');
    expect(html).toContain('Author');
    expect(html).toContain('Herbert');
    expect(html).toContain('Rating');
    expect(html).toContain('5');
  });

  it('falls back to the type icon when the cover is not an image URL', () => {
    const html = buildObjectCardHtml(book({ cover: null, author: 'Herbert' }), { title: 'Dune' });
    expect(html).not.toContain('<img');
    expect(html).toContain('oc-cover-icon');
    expect(html).toContain('📖');
  });

  it('omits empty fields', () => {
    const html = buildObjectCardHtml(book({ author: 'Herbert', rating: null }), { title: 'Dune' });
    expect(html).toContain('Author');
    expect(html).not.toContain('Rating'); // rating is null → no chip
  });

  it('escapes untrusted title + values', () => {
    const html = buildObjectCardHtml(book({ author: '<script>x</script>' }), { title: '<b>t</b>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>t</b>');
    expect(html).toContain('&lt;');
  });
});

describe('buildExcerptCardHtml (#1071)', () => {
  it('renders the span + source byline + locator', () => {
    const html = buildExcerptCardHtml({
      citedText: 'Being precedes essence.',
      sourceTitle: 'Existentialism',
      sourceCreator: 'Sartre',
      sourceYear: '1946',
      pageRange: '12-14',
    });
    expect(html).toContain('Being precedes essence.');
    expect(html).toContain('Existentialism');
    expect(html).toContain('Sartre (1946)');
    expect(html).toContain('pp. 12-14');
  });

  it('degrades gracefully with only a span', () => {
    const html = buildExcerptCardHtml({ citedText: 'Just a quote.' });
    expect(html).toContain('Just a quote.');
  });
});

describe('isBlockLevelLink (#1071)', () => {
  function inP(inner: string): Element {
    const p = document.createElement('p');
    p.innerHTML = inner;
    document.body.appendChild(p);
    return p.querySelector('a')!;
  }

  it('is true when the link is the sole content of its paragraph', () => {
    expect(isBlockLevelLink(inP('<a class="wiki-link" data-target="Dune">Dune</a>'))).toBe(true);
  });

  it('is false for a link mid-prose', () => {
    expect(isBlockLevelLink(inP('see <a class="wiki-link" data-target="Dune">Dune</a> here'))).toBe(false);
  });

  it('is false when another element shares the paragraph', () => {
    expect(isBlockLevelLink(inP('<a class="wiki-link" data-target="Dune">Dune</a><em>x</em>'))).toBe(false);
  });

  it('is false when the link is not inside a paragraph', () => {
    const li = document.createElement('li');
    li.innerHTML = '<a class="wiki-link" data-target="Dune">Dune</a>';
    document.body.appendChild(li);
    expect(isBlockLevelLink(li.querySelector('a')!)).toBe(false);
  });
});
