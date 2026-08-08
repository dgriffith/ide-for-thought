/**
 * @vitest-environment happy-dom
 *
 * Object Types settings panel (#1584): lists stock (read-only) + user types with
 * property + instance counts; user types can be duplicated and deleted (with a
 * confirm), routed through the object-types store. Stock types show no actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

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

  it('shows actions only on user types (stock is read-only)', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    expect(screen.getAllByText('Delete')).toHaveLength(1); // only the user type
    expect(screen.getByText('read-only')).toBeTruthy();    // the stock type
  });

  it('duplicate saves a copy of the user type', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Duplicate'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0]).toMatchObject({ label: 'Gadget copy', icon: '🔧' });
  });

  it('delete warns with the count, then offers to clear the instances (#1588)', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Delete'));
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
    await fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteSafelyMock).not.toHaveBeenCalled();
  });

  it('deletes but leaves the notes when the clear confirm is declined', async () => {
    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // delete yes, clear no
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(deleteSafelyMock).toHaveBeenCalled());
    expect(deleteSafelyMock).toHaveBeenCalledWith('gadget', false);
  });

  it('rename prompts and migrates instances (#1588)', async () => {
    promptMock.mockResolvedValue('Doohickey');
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Rename'));
    await waitFor(() => expect(renameMock).toHaveBeenCalled());
    expect(renameMock).toHaveBeenCalledWith('gadget', 'Doohickey');
  });

  it('rename does nothing when the name is unchanged or cancelled', async () => {
    promptMock.mockResolvedValue('Gadget'); // same label
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Rename'));
    await waitFor(() => expect(promptMock).toHaveBeenCalled());
    expect(renameMock).not.toHaveBeenCalled();
  });
});
