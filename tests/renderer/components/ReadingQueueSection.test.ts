/**
 * @vitest-environment happy-dom
 *
 * ReadingQueueSection render test (#2057). Extracted out of SourcesPanel.svelte
 * in #2048. Already got decent incidental coverage from SourcesPanel.test.ts's
 * queue-view click test, but the collapse/expand toggle (persisted to
 * localStorage) had no direct test of its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: { sources: { queueMembers: vi.fn() } },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import ReadingQueueSection from '../../../src/renderer/lib/components/ReadingQueueSection.svelte';

function props(over: Record<string, unknown> = {}) {
  return {
    activeView: null,
    onSelect: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  const ls: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    clear: () => { for (const k of Object.keys(ls)) delete ls[k]; },
  });
  h.api.sources.queueMembers.mockResolvedValue(new Array(3).fill('s'));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('ReadingQueueSection (#2057)', () => {
  it('renders the four queue rows with counts from queueMembers, expanded by default', async () => {
    render(ReadingQueueSection, props());
    await waitFor(() => expect(screen.getByText('Unread')).toBeTruthy());
    expect(screen.getByText('Reading')).toBeTruthy();
    expect(screen.getByText('Due this week')).toBeTruthy();
    expect(screen.getByText('Recently finished')).toBeTruthy();
    await waitFor(() => {
      const unreadRow = screen.getByText('Unread').closest('button')!;
      expect(unreadRow.textContent).toContain('3');
    });
  });

  it('clicking a row selects that queue view', async () => {
    const p = props();
    render(ReadingQueueSection, p);
    await waitFor(() => expect(screen.getByText('Unread')).toBeTruthy());
    await fireEvent.click(screen.getByText('Unread'));
    expect(p.onSelect).toHaveBeenCalledWith('unread');
  });

  it('marks the active view active', async () => {
    render(ReadingQueueSection, props({ activeView: 'reading' }));
    await waitFor(() => expect(screen.getByText('Reading')).toBeTruthy());
    expect(screen.getByText('Reading').closest('button')!.className).toContain('active');
    expect(screen.getByText('Unread').closest('button')!.className).not.toContain('active');
  });

  it('collapses and re-expands the section, persisting the choice to localStorage', async () => {
    render(ReadingQueueSection, props());
    await waitFor(() => expect(screen.getByText('Unread')).toBeTruthy());
    const header = screen.getByTitle('Collapse reading queue');
    await fireEvent.click(header);
    expect(screen.queryByText('Unread')).toBeNull();
    expect(localStorage.getItem('minerva.sources.queueExpanded')).toBe('false');

    await fireEvent.click(screen.getByTitle('Expand reading queue'));
    await waitFor(() => expect(screen.getByText('Unread')).toBeTruthy());
    expect(localStorage.getItem('minerva.sources.queueExpanded')).toBe('true');
  });

  it('starts collapsed when localStorage already says so', async () => {
    localStorage.setItem('minerva.sources.queueExpanded', 'false');
    render(ReadingQueueSection, props());
    await waitFor(() => expect(screen.getByTitle('Expand reading queue')).toBeTruthy());
    expect(screen.queryByText('Unread')).toBeNull();
  });
});
