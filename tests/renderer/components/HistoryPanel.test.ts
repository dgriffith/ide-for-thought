/**
 * @vitest-environment happy-dom
 *
 * History panel (#1158, PR 2). Mounts the real panel against a mocked
 * `api.history` and asserts: empty / no-note states, the revision timeline, that
 * selecting a revision loads its content and diffs it, and that Restore routes
 * out through `onRestore` (App owns the confirm + mutation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: { history: { list: vi.fn(), getRevision: vi.fn(), restore: vi.fn() } },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import HistoryPanel from '../../../src/renderer/lib/components/right-sidebar/HistoryPanel.svelte';

function props(over: Record<string, unknown> = {}) {
  return { activeFilePath: 'notes/a.md', content: 'line1\nline2\n', revision: 0, onRestore: vi.fn(), ...over };
}

beforeEach(() => {
  h.api.history.list.mockResolvedValue([]);
  h.api.history.getRevision.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('HistoryPanel (#1158)', () => {
  it('shows the no-note state when nothing is open', () => {
    render(HistoryPanel, props({ activeFilePath: null }));
    expect(screen.getByText('No active note.')).toBeTruthy();
  });

  it('shows the empty state when the note has no history yet', async () => {
    render(HistoryPanel, props());
    await waitFor(() => expect(h.api.history.list).toHaveBeenCalledWith('notes/a.md'));
    expect(screen.getByText(/No history yet/)).toBeTruthy();
  });

  it('renders the revision timeline newest-first, stamped with date and time', async () => {
    const ts = new Date(2026, 7, 22, 14, 7).getTime();
    h.api.history.list.mockResolvedValue([
      { ts, origin: 'restore', cause: 'Restored from Aug 21, 9:30 AM' },
      { ts: ts - 60_000, origin: 'edit' },
    ]);
    render(HistoryPanel, props());
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
    render(HistoryPanel, props());
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
    expect(screen.getByText('Antithesize')).toBeTruthy();
    expect(screen.getByText('Restored from Aug 21, 9:30 AM')).toBeTruthy();
    // Pre-cause revisions still read sensibly.
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('selecting a revision loads it and diffs it against the current text', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.api.history.getRevision.mockResolvedValue('line1\n'); // older: one fewer line
    render(HistoryPanel, props({ content: 'line1\nline2\n' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));

    await fireEvent.click(screen.getAllByRole('listitem')[0]!);
    await waitFor(() => expect(h.api.history.getRevision).toHaveBeenCalledWith('notes/a.md', 1000));
    // Current has an added line vs the selected revision → Restore offered.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy());
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('routes Restore through onRestore with the selected revision', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.api.history.getRevision.mockResolvedValue('older text');
    const p = props();
    render(HistoryPanel, p);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    await fireEvent.click(screen.getAllByRole('listitem')[0]!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy());

    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(p.onRestore).toHaveBeenCalledWith('notes/a.md', 1000);
  });

  it('shows "current version" (no Restore) when the selected revision equals the current text', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1000, origin: 'edit' }]);
    h.api.history.getRevision.mockResolvedValue('line1\nline2\n'); // == current
    render(HistoryPanel, props({ content: 'line1\nline2\n' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    await fireEvent.click(screen.getAllByRole('listitem')[0]!);
    await waitFor(() => expect(screen.getByText(/current version/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});
