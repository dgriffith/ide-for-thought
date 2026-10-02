/**
 * @vitest-environment happy-dom
 *
 * A block-level link rendered for export (#2526): the preview's own wiki-link
 * markup and typed-card pass — an object card for a typed note, declined ('')
 * for an untyped one so the export renders the ordinary link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ noteProperties: vi.fn(), query: vi.fn(), aliasEntries: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { noteProperties: h.noteProperties }, graph: { query: h.query, aliasEntries: h.aliasEntries } },
}));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ files: [
    { name: 'Kampa Museum.md', relativePath: 'places/Kampa Museum.md', isDirectory: false },
    { name: 'Plain.md', relativePath: 'Plain.md', isDirectory: false },
  ] }),
}));

import { renderCardForExport } from '../../../src/renderer/lib/export/render-card';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

const PLACE = {
  type: { id: 'place', label: 'Place', classLocalName: 'Place', icon: '📍', source: 'user', properties: [{ name: 'city', type: 'text', label: 'City' }], card: ['city'] },
  properties: [{ name: 'city', type: 'text', label: 'City', value: 'Prague' }],
};

beforeEach(() => {
  h.aliasEntries.mockResolvedValue([]);
  h.noteProperties.mockImplementation(async (p: string) => (p === 'places/Kampa Museum.md' ? PLACE : { type: null, properties: [] }));
});
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('renderCardForExport', () => {
  it('a typed note becomes the preview\'s object card, linked to its note', async () => {
    const html = await renderCardForExport('[[Kampa Museum]]');
    expect(h.noteProperties).toHaveBeenCalledWith('places/Kampa Museum.md');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('object-card');
    expect(html).toContain('Kampa Museum');
    expect(html).toContain('Prague'); // the card field
    expect(html).toContain('data-note-link="Kampa Museum"'); // resolved by the export like [[Kampa Museum]]
  });

  it('declines an untyped note, so the export renders the ordinary link', async () => {
    expect(await renderCardForExport('[[Plain]]')).toBe('');
  });

  it('declines an unresolvable link', async () => {
    expect(await renderCardForExport('[[Nowhere]]')).toBe('');
    expect(h.noteProperties).not.toHaveBeenCalled();
  });

  it('is dispatched for the card kind, and leaves nothing behind', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'card', source: '[[Kampa Museum]]', notePath: 'n.md' });
    expect(r.ok && r.html).toBeTruthy();
    expect(document.body.children).toHaveLength(0);
  });
});
