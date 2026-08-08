/**
 * @vitest-environment happy-dom
 *
 * Object Types settings panel (#1584): lists stock + user types with
 * property + instance counts; user types can be duplicated and deleted (with a
 * confirm), routed through the object-types store. Stock types show no actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen, within } from '@testing-library/svelte';

const { listMock, saveMock, deleteMock, deleteSafelyMock, renameMock, noteTypeMapMock, queryMock, confirmMock, promptMock } = vi.hoisted(() => ({
  listMock: vi.fn(), saveMock: vi.fn(), deleteMock: vi.fn(), deleteSafelyMock: vi.fn(), renameMock: vi.fn(),
  // The store fetches the catalog and the note→type map together, so every
  // `refresh()` here hits both.
  noteTypeMapMock: vi.fn(),
  queryMock: vi.fn(), confirmMock: vi.fn(), promptMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { list: listMock, save: saveMock, delete: deleteMock, deleteSafely: deleteSafelyMock, rename: renameMock, noteTypeMap: noteTypeMapMock }, graph: { query: queryMock } },
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: confirmMock, showPrompt: promptMock }),
}));
vi.mock('../../../src/renderer/lib/stores/toasts.svelte', () => ({
  getToastStore: () => ({ push: vi.fn() }),
}));

import ObjectTypesSettings from '../../../src/renderer/lib/components/ObjectTypesSettings.svelte';

const BOOK = { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [{ name: 'author', type: 'text' }] };
const GADGET = { id: 'gadget', label: 'Gadget', classLocalName: 'Gadget', source: 'user', icon: '🔧', properties: [{ name: 'maker', type: 'text' }, { name: 'model', type: 'text' }] };

/** The type list only — the panel's intro copy names the same words the action
 *  buttons use ("Revert", "stock"), so an unscoped query matches the prose. */
function list(): HTMLElement {
  return document.querySelector('.type-list') as HTMLElement;
}
/** Actions for one type's row, so "Duplicate" is unambiguous now that stock
 *  types have their own action buttons too. */
function row(label: string): HTMLElement {
  return screen.getByText(label).closest('.type-row') as HTMLElement;
}

beforeEach(() => {
  listMock.mockResolvedValue({ types: [BOOK, GADGET], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  saveMock.mockResolvedValue({ id: 'gadget-copy', filePath: '.minerva/types/gadget-copy.md' });
  deleteMock.mockResolvedValue(undefined);
  deleteSafelyMock.mockResolvedValue({ cleared: [], failed: [] });
  renameMock.mockResolvedValue({ newId: 'widget', migrated: ['W1.md'], failed: [] });
  queryMock.mockResolvedValue({ results: [{ id: 'book', n: '3' }, { id: 'gadget', n: '1' }], columns: [] });
  confirmMock.mockResolvedValue(true);
  promptMock.mockResolvedValue('Widget');
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ObjectTypesSettings (#1584)', () => {
  it('lists types with property + instance counts', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    expect(screen.getByText('Gadget')).toBeTruthy();
    expect(screen.getByText(/1 property · 3 instances/)).toBeTruthy();   // Book
    expect(screen.getByText(/2 properties · 1 instance/)).toBeTruthy();  // Gadget
  });

  it('offers Edit + Duplicate on a stock type, but not Rename or Delete', async () => {
    // A stock type is customizable now — editing it forks a local copy — but
    // Delete/Rename are meaningless against the bundle: there is no in-tree
    // file to remove, and a renamed id would just resurrect the stock type
    // alongside the copy.
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    expect(within(list()).getAllByText('Edit')).toHaveLength(2);      // both types
    expect(within(list()).getAllByText('Duplicate')).toHaveLength(2);
    expect(within(list()).getAllByText('Delete')).toHaveLength(1);    // the user type only
    expect(within(list()).getAllByText('Rename')).toHaveLength(1);
    expect(within(row('Book')).getByText('stock')).toBeTruthy();
    expect(within(list()).queryByText('Revert')).toBeNull();          // nothing customized yet
  });

  it('marks a customized stock type and offers Revert instead of Delete', async () => {
    listMock.mockResolvedValue({ types: [{ ...BOOK, source: 'user', overridesStock: true }], errors: [] });
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    expect(within(list()).getByText('customized')).toBeTruthy();
    expect(within(list()).getByText('Revert')).toBeTruthy();
    expect(within(list()).queryByText('Delete')).toBeNull();
    expect(within(list()).queryByText('Rename')).toBeNull();
  });

  it('revert drops the local copy without touching the instances', async () => {
    // Crucially `delete`, not `deleteSafely`: the type still exists after a
    // revert, so clearing `type:` off its notes would be wrong.
    listMock.mockResolvedValue({ types: [{ ...BOOK, source: 'user', overridesStock: true }], errors: [] });
    render(ObjectTypesSettings);
    await waitFor(() => expect(within(list()).getByText('Revert')).toBeTruthy());

    await fireEvent.click(within(list()).getByText('Revert'));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('book'));
    expect(deleteSafelyMock).not.toHaveBeenCalled();
  });

  it('revert does nothing when the confirm is dismissed', async () => {
    confirmMock.mockResolvedValue(false);
    listMock.mockResolvedValue({ types: [{ ...BOOK, source: 'user', overridesStock: true }], errors: [] });
    render(ObjectTypesSettings);
    await waitFor(() => expect(within(list()).getByText('Revert')).toBeTruthy());

    await fireEvent.click(within(list()).getByText('Revert'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('duplicate saves a copy of the user type', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(within(row('Gadget')).getByText('Duplicate'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0]).toMatchObject({ label: 'Gadget copy', icon: '🔧' });
  });

  it('delete warns with the count, then offers to clear the instances (#1588)', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(within(row('Gadget')).getByText('Delete'));
    await waitFor(() => expect(deleteSafelyMock).toHaveBeenCalled());
    // First confirm = the count warning; second = the clear-from-notes choice.
    expect(confirmMock.mock.calls[0]![0]).toMatch(/1 note still references it/);
    expect(confirmMock.mock.calls[1]![0]).toMatch(/remove .type: gadget./i);
    // Both confirmed → delete AND clear.
    expect(deleteSafelyMock).toHaveBeenCalledWith('gadget', true);
  });

  it('delete does nothing when the first confirm is dismissed', async () => {
    confirmMock.mockResolvedValue(false);
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(within(row('Gadget')).getByText('Delete'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteSafelyMock).not.toHaveBeenCalled();
  });

  it('deletes but leaves the notes when the clear confirm is declined', async () => {
    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // delete yes, clear no
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(within(row('Gadget')).getByText('Delete'));
    await waitFor(() => expect(deleteSafelyMock).toHaveBeenCalled());
    expect(deleteSafelyMock).toHaveBeenCalledWith('gadget', false);
  });

  it('rename prompts and migrates instances (#1588)', async () => {
    promptMock.mockResolvedValue('Doohickey');
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(within(row('Gadget')).getByText('Rename'));
    await waitFor(() => expect(renameMock).toHaveBeenCalled());
    expect(renameMock).toHaveBeenCalledWith('gadget', 'Doohickey');
  });

  it('rename does nothing when the name is unchanged or cancelled', async () => {
    promptMock.mockResolvedValue('Gadget'); // same label
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(within(row('Gadget')).getByText('Rename'));
    await waitFor(() => expect(promptMock).toHaveBeenCalled());
    expect(renameMock).not.toHaveBeenCalled();
  });
});
