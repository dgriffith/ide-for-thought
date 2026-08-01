/**
 * @vitest-environment happy-dom
 *
 * The type-keyed card post-render pass (#1071): block-level typed links become
 * cards; inline links, untyped links, and non-block links are left untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NoteTypedProperties } from '../../../src/shared/objects/type-def';

const { notePropsMock, queryMock } = vi.hoisted(() => ({ notePropsMock: vi.fn(), queryMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { noteProperties: notePropsMock }, graph: { query: queryMock } },
}));

import { hydrateTypedCards, type TypedCardDeps } from '../../../src/renderer/lib/preview/typed-link-render';

const TYPED: NoteTypedProperties = {
  type: { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [{ name: 'author', type: 'text', label: 'Author' }] },
  properties: [{ name: 'author', type: 'text', label: 'Author', value: 'Herbert' }],
};
const UNTYPED: NoteTypedProperties = { type: null, properties: [] };

function deps(previewEl: HTMLElement): TypedCardDeps {
  return {
    previewEl,
    typePropsCache: new Map(),
    quoteMetaCache: new Map(),
    queryPrefixes: '',
    resolvePath: (t) => (t === 'Dune' ? 'Dune.md' : t === 'Plain' ? 'Plain.md' : null),
  };
}

beforeEach(() => {
  notePropsMock.mockImplementation((path: string) => Promise.resolve(path === 'Dune.md' ? TYPED : UNTYPED));
  queryMock.mockResolvedValue({ results: [{ citedText: 'A quote.', sourceTitle: 'Src', pageRange: '1-2' }], columns: [] });
});
afterEach(() => { notePropsMock.mockReset(); queryMock.mockReset(); document.body.innerHTML = ''; });

function render(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('hydrateTypedCards (#1071)', () => {
  it('promotes a block-level typed link to an object card', async () => {
    const el = render('<p><a class="wiki-link" data-target="Dune">Dune</a></p>');
    await hydrateTypedCards(deps(el));
    const a = el.querySelector('a')!;
    expect(a.classList.contains('object-card')).toBe(true);
    expect(a.innerHTML).toContain('oc-title');
    expect(a.innerHTML).toContain('Herbert');
    expect(a.dataset.target).toBe('Dune'); // still navigable
  });

  it('leaves an inline typed link untouched', async () => {
    const el = render('<p>see <a class="wiki-link" data-target="Dune">Dune</a> now</p>');
    await hydrateTypedCards(deps(el));
    const a = el.querySelector('a')!;
    expect(a.classList.contains('object-card')).toBe(false);
    expect(a.textContent).toBe('Dune');
  });

  it('leaves a block-level link to an untyped note as a bare link', async () => {
    const el = render('<p><a class="wiki-link" data-target="Plain">Plain</a></p>');
    await hydrateTypedCards(deps(el));
    expect(el.querySelector('a')!.classList.contains('object-card')).toBe(false);
  });

  it('renders a block-level quote link as an excerpt card', async () => {
    const el = render('<p><a class="wiki-link typed-link quote-link" data-excerpt-id="e1"><span class="link-display">e1</span></a></p>');
    await hydrateTypedCards(deps(el));
    const a = el.querySelector('a')!;
    expect(a.classList.contains('excerpt-card')).toBe(true);
    expect(a.innerHTML).toContain('A quote.');
    expect(a.innerHTML).toContain('Src');
  });

  it('does not touch a cite/type badge link (not a plain note link)', async () => {
    const el = render('<p><a class="wiki-link typed-link cite-link" data-source-id="s1"><span class="link-display">s1</span></a></p>');
    await hydrateTypedCards(deps(el));
    expect(el.querySelector('a')!.classList.contains('object-card')).toBe(false);
    expect(notePropsMock).not.toHaveBeenCalled();
  });
});
