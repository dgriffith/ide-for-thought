/**
 * @vitest-environment happy-dom
 *
 * Type editor form (#1585): builds a full type from the form — properties with
 * enum options / link-to-type target / on-card flag, plus cover — saved through
 * the object-types store; editing carries the stable id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { saveMock, listMock } = vi.hoisted(() => ({ saveMock: vi.fn(), listMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({
  objectTypesStore: { save: saveMock },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { types: { list: listMock } } }));

import TypeEditorDialog from '../../../src/renderer/lib/components/TypeEditorDialog.svelte';

beforeEach(() => {
  saveMock.mockResolvedValue({ id: 'book', filePath: '.minerva/types/book.md' });
  listMock.mockResolvedValue({ types: [{ id: 'person' }, { id: 'book' }], errors: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TypeEditorDialog (#1585)', () => {
  it('creates a new type from the form — label + added properties', async () => {
    const onSaved = vi.fn();
    render(TypeEditorDialog, { initial: { label: '', properties: [] }, onSaved, onClose: vi.fn() });

    await fireEvent.input(screen.getByPlaceholderText('Book'), { target: { value: 'Reading' } });
    await fireEvent.click(screen.getByText('+ Add property'));
    await fireEvent.click(screen.getByText('+ Add property'));
    const names = screen.getAllByPlaceholderText('author');
    await fireEvent.input(names[0]!, { target: { value: 'rating' } });
    await fireEvent.input(names[1]!, { target: { value: 'status' } });
    // Blank-named rows are dropped on save (here both are named).

    await fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const input = saveMock.mock.calls[0]![0];
    expect(input.label).toBe('Reading');
    expect(input.id).toBeUndefined(); // new type — id derived from label
    expect(input.properties).toEqual([
      { name: 'rating', type: 'text' },
      { name: 'status', type: 'text' },
    ]);
    expect(onSaved).toHaveBeenCalledWith('book');
  });

  it('carries the stable id + link-to-type target + card flag when editing', async () => {
    render(TypeEditorDialog, {
      initial: { id: 'book', label: 'Book', properties: [{ name: 'author', type: 'link-to-type', targetType: 'person' }], card: ['author'] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await waitFor(() => expect(screen.getByDisplayValue('Book')).toBeTruthy());
    // The link-to-type target select should be pre-selected to person.
    await fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const input = saveMock.mock.calls[0]![0];
    expect(input.id).toBe('book');
    expect(input.properties).toEqual([{ name: 'author', type: 'link-to-type', targetType: 'person' }]);
    expect(input.card).toEqual(['author']); // the on-card checkbox stayed set
  });

  it('preserves an explicit per-property label, without materializing defaults (#1594)', async () => {
    render(TypeEditorDialog, {
      initial: {
        id: 'book', label: 'Book',
        properties: [
          { name: 'author', type: 'text', label: 'Auteur' },          // real custom label — keep
          { name: 'page_count', type: 'number', label: 'Page Count' }, // == title-cased default — drop
        ],
      },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await waitFor(() => expect(screen.getByDisplayValue('Book')).toBeTruthy());
    await fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].properties).toEqual([
      { name: 'author', type: 'text', label: 'Auteur' },
      { name: 'page_count', type: 'number' }, // default label not written back
    ]);
  });

  it('carries the parent type through save (#1587)', async () => {
    render(TypeEditorDialog, {
      initial: { id: 'monograph', label: 'Monograph', parent: 'book', properties: [] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    // Wait for the type list to load (populates the parent dropdown).
    await waitFor(() => expect(document.querySelector('option[value="book"]')).toBeTruthy());
    await fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].parent).toBe('book');
  });

  it('reorders properties', async () => {
    render(TypeEditorDialog, {
      initial: { label: 'T', properties: [{ name: 'first', type: 'text' }, { name: 'second', type: 'text' }] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await waitFor(() => expect(screen.getByDisplayValue('first')).toBeTruthy());
    await fireEvent.click(screen.getAllByLabelText('Move down')[0]!); // move 'first' below 'second'
    await fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].properties.map((p: { name: string }) => p.name)).toEqual(['second', 'first']);
  });

  it('refuses to save without a name', async () => {
    render(TypeEditorDialog, { initial: { label: '', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    // The Create button is disabled with an empty name.
    expect(screen.getByText('Create').hasAttribute('disabled')).toBe(true);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
