/**
 * @vitest-environment happy-dom
 *
 * Multi-file/directory local history dialog (#2092). Mounts the real dialog
 * over the REAL `multi-file-history` store with only the `api` boundary and
 * the dialogs store mocked, so the test exercises the store's load/refresh
 * path rather than a stand-in. The dialog is self-gated on `store.open` and
 * takes no props — driven entirely through the store, the way a context-menu
 * handler would drive it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: {
    history: {
      listUnified: vi.fn(),
      batchRevert: vi.fn(),
      getRevision: vi.fn(),
      onChanged: vi.fn(() => () => {}),
    },
    notebase: { readFile: vi.fn() },
  },
  showConfirm: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: h.showConfirm }),
}));

import MultiFileHistoryDialog from '../../../src/renderer/lib/components/MultiFileHistoryDialog.svelte';
import { getMultiFileHistoryStore } from '../../../src/renderer/lib/stores/multi-file-history.svelte';

beforeEach(() => {
  h.api.history.listUnified.mockResolvedValue([]);
  h.api.history.getRevision.mockResolvedValue(null);
  h.api.notebase.readFile.mockResolvedValue('');
  h.showConfirm.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  // Module singleton: park it closed so the next test's render starts fresh.
  getMultiFileHistoryStore().close();
  vi.clearAllMocks();
});

describe('MultiFileHistoryDialog (#2092)', () => {
  it('renders nothing when the store is closed', () => {
    render(MultiFileHistoryDialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the merged timeline once the store is opened', async () => {
    h.api.history.listUnified.mockResolvedValue([
      { ts: 2000, origin: 'delete', path: 'notes/gone.md', event: 'deleted' },
      { ts: 1000, origin: 'edit', path: 'notes/a.md', event: 'modified' },
    ]);
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], [{ relativePath: 'notes', isDirectory: true }]);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('notes/gone.md')).toBeTruthy();
    expect(screen.getByText('notes/a.md')).toBeTruthy();
    expect(screen.getByText('deleted')).toBeTruthy();
  });

  it('shows the empty state when the selection has no recorded history', async () => {
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByText('No history yet.')).toBeTruthy());
  });

  it('says the history could not be read rather than claiming there is none', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.api.history.listUnified.mockRejectedValue(new Error('broken index'));
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByText(/broken index/)).toBeTruthy());
    err.mockRestore();
  });

  it('selecting a point in time shows a per-path preview and offers Revert', async () => {
    h.api.history.listUnified.mockResolvedValue([
      { ts: 1000, origin: 'edit', path: 'notes/a.md', event: 'added' },
    ]);
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByText('notes/a.md')).toBeTruthy());

    await fireEvent.click(screen.getByText('notes/a.md'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revert selection…' })).toBeTruthy());
    expect(screen.getByText('no change')).toBeTruthy(); // only revision == the target moment
  });

  it('diffs the focused path against its current content', async () => {
    h.api.history.listUnified.mockResolvedValue([
      { ts: 1000, origin: 'edit', path: 'notes/a.md', event: 'added' },
    ]);
    h.api.history.getRevision.mockResolvedValue('line1\n');
    h.api.notebase.readFile.mockResolvedValue('line1\nline2\n');
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByText('notes/a.md')).toBeTruthy());

    await fireEvent.click(screen.getByText('notes/a.md'));
    await waitFor(() => expect(h.api.history.getRevision).toHaveBeenCalledWith('notes/a.md', 1000));
    await waitFor(() => expect(screen.getByText('+1')).toBeTruthy());
  });

  it('confirms before reverting, then reports the per-bucket outcome', async () => {
    h.api.history.listUnified.mockResolvedValue([
      { ts: 1000, origin: 'edit', path: 'notes/a.md', event: 'added' },
    ]);
    h.api.history.batchRevert.mockResolvedValue({
      ts: 1000, reverted: ['notes/a.md'], recreated: [], removed: [], unchanged: [], skipped: [], errors: [],
    });
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByText('notes/a.md')).toBeTruthy());
    await fireEvent.click(screen.getByText('notes/a.md'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revert selection…' })).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Revert selection…' }));
    await waitFor(() => expect(h.api.history.batchRevert).toHaveBeenCalledWith(['notes/a.md'], [], 1000));
    await waitFor(() => {
      const [msg] = h.showConfirm.mock.calls.at(-1)!;
      expect(msg).toContain('1 reverted');
    });
  });

  it('does not revert when the confirmation is declined', async () => {
    h.api.history.listUnified.mockResolvedValue([
      { ts: 1000, origin: 'edit', path: 'notes/a.md', event: 'added' },
    ]);
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByText('notes/a.md')).toBeTruthy());
    await fireEvent.click(screen.getByText('notes/a.md'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revert selection…' })).toBeTruthy());
    h.showConfirm.mockResolvedValue(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Revert selection…' }));
    await waitFor(() => expect(h.showConfirm).toHaveBeenCalled());
    expect(h.api.history.batchRevert).not.toHaveBeenCalled();
  });

  it('Close hides the dialog', async () => {
    render(MultiFileHistoryDialog);
    await getMultiFileHistoryStore().openFor(['notes/a.md'], []);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
