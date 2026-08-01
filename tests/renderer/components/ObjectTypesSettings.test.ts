/**
 * @vitest-environment happy-dom
 *
 * Object Types settings panel (#1584): lists stock (read-only) + user types with
 * property + instance counts; user types can be duplicated and deleted (with a
 * confirm), routed through the object-types store. Stock types show no actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { listMock, saveMock, deleteMock, queryMock, confirmMock } = vi.hoisted(() => ({
  listMock: vi.fn(), saveMock: vi.fn(), deleteMock: vi.fn(), queryMock: vi.fn(), confirmMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { list: listMock, save: saveMock, delete: deleteMock }, graph: { query: queryMock } },
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: confirmMock }),
}));

import ObjectTypesSettings from '../../../src/renderer/lib/components/ObjectTypesSettings.svelte';

const BOOK = { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [{ name: 'author', type: 'text' }] };
const GADGET = { id: 'gadget', label: 'Gadget', classLocalName: 'Gadget', source: 'user', icon: '🔧', properties: [{ name: 'maker', type: 'text' }, { name: 'model', type: 'text' }] };

beforeEach(() => {
  listMock.mockResolvedValue({ types: [BOOK, GADGET], errors: [] });
  saveMock.mockResolvedValue({ id: 'gadget-copy', filePath: '.minerva/types/gadget-copy.md' });
  deleteMock.mockResolvedValue(undefined);
  queryMock.mockResolvedValue({ results: [{ id: 'book', n: '3' }, { id: 'gadget', n: '1' }], columns: [] });
  confirmMock.mockResolvedValue(true);
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

  it('delete asks for confirmation and removes on confirm', async () => {
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(confirmMock.mock.calls[0]![0]).toMatch(/1 note still references it/); // instance-count warning
    expect(deleteMock).toHaveBeenCalledWith('gadget');
  });

  it('delete does nothing when the confirm is dismissed', async () => {
    confirmMock.mockResolvedValue(false);
    render(ObjectTypesSettings);
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
