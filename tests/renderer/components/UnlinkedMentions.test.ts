/**
 * @vitest-environment happy-dom
 *
 * Unlinked mentions of a typed object (#1074): self-gates to typed notes, lists
 * unlinked semantic mentions above threshold, "link it" inserts a link to the
 * object INTO the mentioning note (the inverse direction), and dismissals
 * persist. Nothing is written without a click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { notePropsMock, mentionsMock, applyLinkMock } = vi.hoisted(() => ({
  notePropsMock: vi.fn(), mentionsMock: vi.fn(), applyLinkMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: { noteProperties: notePropsMock },
    embeddings: { unlinkedMentions: mentionsMock },
    refactor: { applySuggestedLink: applyLinkMock },
  },
}));

import UnlinkedMentions from '../../../src/renderer/lib/components/right-sidebar/UnlinkedMentions.svelte';

const TYPED = { type: { id: 'person', label: 'Person' }, properties: [] };
const UNTYPED = { type: null, properties: [] };
const mention = (ref: string, score: number, alreadyLinked = false) =>
  ({ kind: 'note' as const, ref, title: ref.replace(/\.md$/, ''), sectionHeading: '', snippet: 'mentions Alice', score, alreadyLinked });

function props(over: Record<string, unknown> = {}) {
  return { activeFilePath: 'Alice.md', revision: 0, onFileSelect: vi.fn(), ...over };
}

beforeEach(() => {
  const ls: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    clear: () => { for (const k of Object.keys(ls)) delete ls[k]; },
  });
  notePropsMock.mockResolvedValue(TYPED);
  applyLinkMock.mockResolvedValue({ changed: true });
  mentionsMock.mockResolvedValue({ enabled: true, notes: [mention('Diary.md', 0.7), mention('Notes.md', 0.6)] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); notePropsMock.mockReset(); mentionsMock.mockReset(); applyLinkMock.mockReset(); });

describe('UnlinkedMentions (#1074)', () => {
  it('renders nothing for an untyped note (object-scoped)', async () => {
    notePropsMock.mockResolvedValue(UNTYPED);
    const { container } = render(UnlinkedMentions, props());
    await waitFor(() => expect(notePropsMock).toHaveBeenCalled());
    expect(mentionsMock).not.toHaveBeenCalled();
    expect(container.querySelector('.mentions')).toBeNull();
  });

  it('lists unlinked mentions of a typed object', async () => {
    render(UnlinkedMentions, props());
    await waitFor(() => expect(screen.getByText('Diary')).toBeTruthy());
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText(/Unlinked mentions/)).toBeTruthy();
  });

  it('excludes already-linked and below-threshold mentions', async () => {
    mentionsMock.mockResolvedValue({ enabled: true, notes: [
      mention('Linked.md', 0.9, true),   // already links the object
      mention('Weak.md', 0.30),          // below 0.45
      mention('Good.md', 0.6),
    ] });
    render(UnlinkedMentions, props());
    await waitFor(() => expect(screen.getByText('Good')).toBeTruthy());
    expect(screen.queryByText('Linked')).toBeNull();
    expect(screen.queryByText('Weak')).toBeNull();
  });

  it('"link it" inserts the object link INTO the mentioning note (inverse order)', async () => {
    render(UnlinkedMentions, props({ activeFilePath: 'Alice.md' }));
    await waitFor(() => expect(screen.getByText('Diary')).toBeTruthy());
    await fireEvent.click(screen.getAllByTitle(/Insert a \[\[link\]\]/)[0]!);
    // The mentioning note (Diary.md) gains [[Alice]] — args are (mention, object).
    expect(applyLinkMock).toHaveBeenCalledWith('Diary.md', 'Alice.md');
  });

  it('does not write anything without a click', async () => {
    render(UnlinkedMentions, props());
    await waitFor(() => expect(screen.getByText('Diary')).toBeTruthy());
    expect(applyLinkMock).not.toHaveBeenCalled();
  });

  it('dismissing hides the mention and persists across a remount', async () => {
    const first = render(UnlinkedMentions, props());
    await waitFor(() => expect(screen.getByText('Diary')).toBeTruthy());
    await fireEvent.click(screen.getAllByLabelText('Dismiss')[0]!);
    await waitFor(() => expect(screen.queryByText('Diary')).toBeNull());
    expect(JSON.parse(localStorage.getItem('minerva.mentions.dismissed') ?? '[]')).toContain('Alice.md Diary.md');

    // A fresh mount reads the persisted dismissal.
    first.unmount();
    render(UnlinkedMentions, props());
    await waitFor(() => expect(screen.getByText('Notes')).toBeTruthy());
    expect(screen.queryByText('Diary')).toBeNull();
  });
});
