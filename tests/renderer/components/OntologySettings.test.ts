/**
 * @vitest-environment happy-dom
 *
 * Settings → Ontology (#2788): the thoughtbase's imported vocabularies.
 * Mocks `api.ontology` and the notebase store; the ontology store is real, so
 * this pins the panel and the store together: the on-mount list, a refused
 * file's problems, review before import (Import / Cancel, and Close for a
 * refused file), remove, and the error line.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { VocabularyImportPreview, VocabularyStatus } from '../../../src/shared/ontology-vocabularies';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  pickImport: vi.fn(),
  import: vi.fn(),
  remove: vi.fn(),
  meta: { rootPath: '/tb', name: 'tb' },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { ontology: { list: h.list, pickImport: h.pickImport, import: h.import, remove: h.remove } },
}));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ get meta() { return h.meta; } }),
}));

import OntologySettings from '../../../src/renderer/lib/components/OntologySettings.svelte';
import { getOntologyStore } from '../../../src/renderer/lib/stores/ontology.svelte';

const LAB: VocabularyStatus = {
  file: 'lab.ttl', ok: true, triples: 4, notes: [],
  prefixes: [{ prefix: 'lab', iri: 'https://lab.example/ns#' }],
  classes: [{ iri: 'https://lab.example/ns#Sample', curie: 'lab:Sample', label: 'Sample' }],
  properties: [{ iri: 'https://lab.example/ns#on', curie: 'lab:on' }],
};
const REFUSED: VocabularyStatus = { file: 'rebind.ttl', ok: false, problems: ['It binds the standard prefix skos: to <x>; Minerva binds it to <y>.'] };

beforeEach(() => {
  vi.resetAllMocks();
  h.meta = { rootPath: '/tb', name: 'tb' };
  h.list.mockResolvedValue([LAB, REFUSED]);
});
afterEach(() => {
  getOntologyStore().cancelImport();
  cleanup();
});

/** The button is disabled while the on-mount list loads; wait for it, as a user would. */
async function importButton(getByText: (t: string) => HTMLElement): Promise<HTMLElement> {
  const button = getByText('Import Turtle…') as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

describe('OntologySettings (#2788)', () => {
  it('lists the vocabularies on open: prefixes and counts, or why one isn\'t loaded', async () => {
    const { findByText, getByText } = render(OntologySettings);
    await findByText('lab.ttl');
    expect(getByText('lab:')).toBeTruthy();
    expect(getByText('1 class · 1 property')).toBeTruthy();
    expect(getByText('Not loaded')).toBeTruthy();
    expect(getByText(/binds the standard prefix skos:/)).toBeTruthy();
  });

  it('with no thoughtbase open, says so and asks main for nothing', () => {
    h.meta = null;
    const { getByText } = render(OntologySettings);
    expect(getByText(/Open a thoughtbase to import vocabularies/)).toBeTruthy();
    expect(h.list).not.toHaveBeenCalled();
  });

  it('Import Turtle… shows what the file declares, and Import saves it', async () => {
    h.list.mockResolvedValue([]);
    const preview: VocabularyImportPreview = { id: 'p1', file: 'lab.ttl', replaces: false, status: LAB };
    h.pickImport.mockResolvedValue(preview);
    h.import.mockResolvedValue([LAB]);
    const { getByText, findByRole, queryByRole } = render(OntologySettings);
    await fireEvent.click(await importButton(getByText));
    const review = await findByRole('region', { name: 'Review lab.ttl' });
    expect(review.textContent).toContain('Import as lab.ttl');
    expect(review.textContent).toContain('Sample');
    expect(review.textContent).toContain('lab:on'); // no label — its CURIE
    expect(h.import).not.toHaveBeenCalled();
    await fireEvent.click(getByText('Import'));
    expect(h.import).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(queryByRole('region')).toBeNull());
    expect(getByText('lab.ttl')).toBeTruthy();
  });

  it('Cancel drops the review; a cancelled picker shows none', async () => {
    h.pickImport.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p', file: 'x.ttl', replaces: true, status: LAB });
    const { getByText, findByRole, queryByRole } = render(OntologySettings);
    await fireEvent.click(await importButton(getByText));
    await waitFor(() => expect(h.pickImport).toHaveBeenCalledTimes(1));
    expect(queryByRole('region')).toBeNull();
    await fireEvent.click(await importButton(getByText));
    expect((await findByRole('region')).textContent).toContain('Replace x.ttl');
    await fireEvent.click(getByText('Cancel'));
    expect(queryByRole('region')).toBeNull();
    expect(h.import).not.toHaveBeenCalled();
  });

  it('a refused file is reviewed with its problems and has no Import button', async () => {
    h.pickImport.mockResolvedValue({ id: 'p', file: 'rebind.ttl', replaces: false, status: REFUSED });
    const { getByText, findByRole, queryByText } = render(OntologySettings);
    await fireEvent.click(await importButton(getByText));
    const review = await findByRole('region', { name: 'Review rebind.ttl' });
    expect(review.textContent).toContain('It can\'t be imported:');
    expect(queryByText('Import')).toBeNull();
    await fireEvent.click(getByText('Close'));
  });

  it('Remove asks main and shows what\'s left', async () => {
    h.remove.mockResolvedValue([REFUSED]);
    const { findByRole, queryByText } = render(OntologySettings);
    await fireEvent.click(await findByRole('button', { name: 'Remove lab.ttl' }));
    expect(h.remove).toHaveBeenCalledWith('lab.ttl');
    await waitFor(() => expect(queryByText('lab.ttl')).toBeNull());
  });

  it('an error from main is shown', async () => {
    h.pickImport.mockRejectedValue(new Error('Lab.ttl is 2048 KB; a vocabulary may be at most 1024 KB.'));
    const { getByText, findByRole } = render(OntologySettings);
    await fireEvent.click(await importButton(getByText));
    expect((await findByRole('alert')).textContent).toContain('at most 1024 KB');
  });
});
