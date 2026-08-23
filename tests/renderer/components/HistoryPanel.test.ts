/**
 * @vitest-environment happy-dom
 *
 * History panel (#1158, store-backed since #1834). Mounts the real panel over
 * the REAL history store with only the `api.history` boundary and the dialogs
 * mocked, so the test exercises the store's watch/refresh path rather than a
 * stand-in. Asserts: empty / no-note states, the timeline, the cause column,
 * selecting a revision and diffing it, naming a version, and Restore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: {
    history: {
      list: vi.fn(),
      getRevision: vi.fn(),
      restore: vi.fn(),
      setLabel: vi.fn(),
      onChanged: vi.fn(() => () => {}),
    },
  },
  showConfirm: vi.fn(),
  showPrompt: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: h.showConfirm, showPrompt: h.showPrompt }),
}));

import HistoryPanel from '../../../src/renderer/lib/components/right-sidebar/HistoryPanel.svelte';
import { getHistoryStore } from '../../../src/renderer/lib/stores/history.svelte';

function props(over: Record<string, unknown> = {}) {
  return { activeFilePath: 'notes/a.md', content: 'line1\nline2\n', ...over };
}

/** Wait for the store's async load to land in the panel. */
async function rendered(over: Record<string, unknown> = {}) {
  const r = render(HistoryPanel, props(over));
  await waitFor(() => expect(h.api.history.list).toHaveBeenCalled());
  return r;
}

beforeEach(() => {
  h.api.history.list.mockResolvedValue([]);
  h.api.history.getRevision.mockResolvedValue(null);
  h.api.history.restore.mockResolvedValue(undefined);
  h.api.history.setLabel.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  // The store is a module singleton: park it on "no note" so the next test's
  // render is a real change and reloads.
  getHistoryStore().watch(null);
  vi.clearAllMocks();
});

describe('HistoryPanel (#1158)', () => {
  it('shows the no-note state when nothing is open', () => {
    render(HistoryPanel, props({ activeFilePath: null }));
    expect(screen.getByText('No active note.')).toBeTruthy();
  });

  it('shows the empty state when the note has no history yet', async () => {
    await rendered();
    expect(h.api.history.list).toHaveBeenCalledWith('notes/a.md');
    expect(screen.getByText(/No history yet/)).toBeTruthy();
  });

  it('says the history could not be read rather than claiming there is none (#1835)', async () => {
    h.api.history.list.mockRejectedValue(new Error('index.json is not a list of revisions'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rendered();

    await waitFor(() => expect(screen.getByText(/couldn't be read/)).toBeTruthy());
    // The old empty-state message would have been a lie about a damaged file.
    expect(screen.queryByText(/No history yet/)).toBeNull();
    err.mockRestore();
  });

  it('renders the revision timeline newest-first, stamped with date and time', async () => {
    const ts = new Date(2026, 7, 22, 14, 7).getTime();
    h.api.history.list.mockResolvedValue([
      { ts, origin: 'restore', cause: 'Restored from Aug 21, 9:30 AM' },
      { ts: ts - 60_000, origin: 'edit' },
    ]);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    // Absolute stamps, not "now" / "1m" — a minute apart has to be legible.
    const [newest, older] = screen.getAllByRole('listitem');
    expect(newest!.textContent).toMatch(/22.*\d{1,2}:07/);
    expect(older!.textContent).toMatch(/22.*\d{1,2}:06/);
    expect(newest!.textContent).not.toMatch(/\bnow\b/);
  });

  it('names what caused each revision, falling back to the origin', async () => {
    h.api.history.list.mockResolvedValue([
      { ts: 3000, origin: 'proposal', cause: 'Antithesize' },
      { ts: 2000, origin: 'restore', cause: 'Restored from Aug 21, 9:30 AM' },
      { ts: 1000, origin: 'edit' },
    ]);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(screen.getByText('Antithesize')).toBeTruthy();
    expect(screen.getByText('Restored from Aug 21, 9:30 AM')).toBeTruthy();
    // Pre-cause revisions still read sensibly.
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('offers Label Version on right-click, prompting with an empty name', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.showPrompt.mockResolvedValue('before refactor');
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    await fireEvent.contextMenu(screen.getAllByRole('listitem')[0]!);
    await fireEvent.click(screen.getByRole('button', { name: 'Label Version…' }));

    // Unnamed version → the prompt is seeded empty, not with a stale name.
    await waitFor(() => expect(h.showPrompt).toHaveBeenCalledWith('Name this version:', ''));
    expect(h.api.history.setLabel).toHaveBeenCalledWith('notes/a.md', 1000, 'before refactor');
  });

  it('does not write a label when the prompt is cancelled', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.showPrompt.mockResolvedValue(null);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    await fireEvent.contextMenu(screen.getAllByRole('listitem')[0]!);
    await fireEvent.click(screen.getByRole('button', { name: 'Label Version…' }));

    await waitFor(() => expect(h.showPrompt).toHaveBeenCalled());
    expect(h.api.history.setLabel).not.toHaveBeenCalled();
  });

  it('offers Rename/Remove Label on a revision that already has one', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit', label: 'before refactor' }]);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('before refactor')).toBeTruthy();

    await fireEvent.contextMenu(screen.getAllByRole('listitem')[0]!);
    expect(screen.getByRole('button', { name: 'Rename Label…' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Label' }));

    // Clearing never prompts — it just clears.
    await waitFor(() => expect(h.api.history.setLabel).toHaveBeenCalledWith('notes/a.md', 1000, null));
    expect(h.showPrompt).not.toHaveBeenCalled();
  });

  it('selecting a revision loads it and diffs it against the current text', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.api.history.getRevision.mockResolvedValue('line1\n'); // older: one fewer line
    await rendered({ content: 'line1\nline2\n' });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    await fireEvent.click(screen.getAllByRole('listitem')[0]!);
    await waitFor(() => expect(h.api.history.getRevision).toHaveBeenCalledWith('notes/a.md', 1000));
    // Current has an added line vs the selected revision → Restore offered.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy());
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('confirms before restoring, then restores the selected revision', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.api.history.getRevision.mockResolvedValue('older text');
    h.showConfirm.mockResolvedValue(true);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    await fireEvent.click(screen.getAllByRole('listitem')[0]!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(h.api.history.restore).toHaveBeenCalledWith('notes/a.md', 1000));
  });

  it('does not restore when the confirmation is declined', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.api.history.getRevision.mockResolvedValue('older text');
    h.showConfirm.mockResolvedValue(false);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    await fireEvent.click(screen.getAllByRole('listitem')[0]!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(h.showConfirm).toHaveBeenCalled());
    expect(h.api.history.restore).not.toHaveBeenCalled();
  });

  it('says the contents are identical (no Restore) when the selected revision matches the text', async () => {
    // Deliberately an OLD revision that happens to match: the message is about
    // content, not recency, so "this is the current version" would be a lie.
    h.api.history.list.mockResolvedValue([
      { ts: 2000, origin: 'edit' },
      { ts: 1000, origin: 'edit', initial: true },
    ]);
    h.api.history.getRevision.mockResolvedValue('line1\nline2\n'); // == current
    await rendered({ content: 'line1\nline2\n' });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    await fireEvent.click(screen.getAllByRole('listitem')[1]!);
    await waitFor(() => expect(screen.getByText('Contents are identical.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('names the baseline revision "Initial version" when nothing else caused it', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit', initial: true }]);
    await rendered();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('Initial version')).toBeTruthy();
  });
});
