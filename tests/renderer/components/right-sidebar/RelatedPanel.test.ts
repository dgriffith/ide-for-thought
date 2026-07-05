/**
 * @vitest-environment happy-dom
 *
 * Right-sidebar RelatedPanel rune reactivity (#1002). The panel's `$effect`
 * fetches related notes whenever the active file path / revision changes and
 * drives loading → results / indexing / empty / disabled branches. We mock the
 * coalesced fetch (`getRelatedNotes`) and the IPC client so we control the async
 * result and can pin the promise open to exercise the loading + stale-guard
 * paths. Nothing here touches real IPC.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { RelatedNote, RelatedNotesResult } from '../../../../src/shared/types';

const h = vi.hoisted(() => ({
  getRelatedNotes: vi.fn(),
  api: { refactor: { applySuggestedLink: vi.fn() } },
}));

vi.mock('../../../../src/renderer/lib/sidebar-related', () => ({
  getRelatedNotes: h.getRelatedNotes,
  invalidateRelatedNotes: vi.fn(),
}));
vi.mock('../../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import RelatedPanel from '../../../../src/renderer/lib/components/right-sidebar/RelatedPanel.svelte';

// Node's experimental Web Storage global shadows happy-dom's localStorage but is
// non-functional here (no backing file), so `localStorage.getItem`/`setItem`
// throw and the panel's dismiss-persistence path silently no-ops. Swap in a
// simple in-memory Storage so the persistence branch is actually exercised.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── fixtures ────────────────────────────────────────────────────────────────

function note(over: Partial<RelatedNote> = {}): RelatedNote {
  return {
    kind: 'note',
    ref: 'topics/raft.md',
    title: 'Raft consensus',
    sectionHeading: '',
    snippet: 'A consensus algorithm.',
    score: 0.9,
    alreadyLinked: true,
    ...over,
  };
}

function result(notes: RelatedNote[], enabled = true): RelatedNotesResult {
  return { enabled, notes };
}

/** A promise we resolve by hand, to hold the panel in its loading state. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const baseProps = () => ({ activeFilePath: 'topics/consensus.md', revision: 1, onFileSelect: vi.fn() });

describe('right-sidebar RelatedPanel — $effect reactivity (#1002)', () => {
  it('runs the effect on mount: shows loading, then the resolved results', async () => {
    const d = deferred<RelatedNotesResult>();
    h.getRelatedNotes.mockReturnValueOnce(d.promise);

    const { findByText, queryByText } = render(RelatedPanel, baseProps());

    // The effect fired with the mounted path and the panel is loading.
    expect(h.getRelatedNotes).toHaveBeenCalledWith('topics/consensus.md', 1);
    expect(await findByText('Finding related notes…')).toBeTruthy();
    expect(queryByText('Raft consensus')).toBeNull();

    d.resolve(result([note()]));

    expect(await findByText('Raft consensus')).toBeTruthy();
    expect(await findByText('1 related')).toBeTruthy();
    expect(queryByText('Finding related notes…')).toBeNull();
  });

  it('re-runs the effect and refetches when activeFilePath changes', async () => {
    h.getRelatedNotes
      .mockResolvedValueOnce(result([note({ ref: 'a.md', title: 'First note' })]))
      .mockResolvedValueOnce(result([note({ ref: 'b.md', title: 'Second note' })]));

    const { rerender, findByText, queryByText } = render(RelatedPanel, baseProps());
    expect(await findByText('First note')).toBeTruthy();

    await rerender({ activeFilePath: 'other/topic.md', revision: 1, onFileSelect: vi.fn() });

    expect(await findByText('Second note')).toBeTruthy();
    await waitFor(() => expect(queryByText('First note')).toBeNull());
    expect(h.getRelatedNotes).toHaveBeenNthCalledWith(2, 'other/topic.md', 1);
  });

  it('re-runs the effect when the revision prop is bumped', async () => {
    h.getRelatedNotes
      .mockResolvedValueOnce(result([note({ title: 'Rev one' })]))
      .mockResolvedValueOnce(result([note({ title: 'Rev two' })]));

    const { rerender, findByText } = render(RelatedPanel, baseProps());
    expect(await findByText('Rev one')).toBeTruthy();

    await rerender({ activeFilePath: 'topics/consensus.md', revision: 2, onFileSelect: vi.fn() });

    expect(await findByText('Rev two')).toBeTruthy();
    expect(h.getRelatedNotes).toHaveBeenNthCalledWith(2, 'topics/consensus.md', 2);
  });

  it('drops a stale resolution when the path changed before the fetch resolved', async () => {
    const first = deferred<RelatedNotesResult>();
    const second = deferred<RelatedNotesResult>();
    h.getRelatedNotes
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender, findByText, queryByText } = render(RelatedPanel, baseProps());

    // Switch tabs while the first fetch is still in flight.
    await rerender({ activeFilePath: 'other/topic.md', revision: 1, onFileSelect: vi.fn() });

    // The (now stale) first fetch resolves — its result must be ignored.
    first.resolve(result([note({ ref: 'stale.md', title: 'Stale result' })]));
    await Promise.resolve();

    // The current fetch resolves and wins.
    second.resolve(result([note({ ref: 'fresh.md', title: 'Fresh result' })]));
    expect(await findByText('Fresh result')).toBeTruthy();
    expect(queryByText('Stale result')).toBeNull();
  });

  it('shows the disabled message when the vector store is not enabled', async () => {
    h.getRelatedNotes.mockResolvedValueOnce(result([], false));
    const { findByText } = render(RelatedPanel, baseProps());
    expect(await findByText('Semantic search is not available for this thoughtbase.')).toBeTruthy();
  });

  it('reads an empty result as "indexing" while the backfill is running', async () => {
    h.getRelatedNotes.mockResolvedValueOnce(result([]));
    const { findByText } = render(RelatedPanel, { ...baseProps(), indexing: true });
    expect(await findByText(/Indexing…/)).toBeTruthy();
  });

  it('shows "no related notes" for an empty result when not indexing', async () => {
    h.getRelatedNotes.mockResolvedValueOnce(result([]));
    const { findByText } = render(RelatedPanel, { ...baseProps(), indexing: false });
    expect(await findByText('No related notes found.')).toBeTruthy();
  });

  it('offers a link affordance for a high-score unlinked note and hides it optimistically on link', async () => {
    h.getRelatedNotes.mockResolvedValueOnce(
      result([note({ ref: 'topics/paxos.md', title: 'Paxos', alreadyLinked: false, score: 0.7 })]),
    );
    h.api.refactor.applySuggestedLink.mockResolvedValueOnce(undefined);

    const { findByText, container } = render(RelatedPanel, baseProps());
    expect(await findByText('Paxos')).toBeTruthy();

    const linkBtn = container.querySelector('.suggest-btn.link') as HTMLButtonElement;
    expect(linkBtn).toBeTruthy();

    await fireEvent.click(linkBtn);

    expect(h.api.refactor.applySuggestedLink).toHaveBeenCalledWith('topics/consensus.md', 'topics/paxos.md');
    // Optimistic justLinked hides the affordance immediately.
    await waitFor(() => expect(container.querySelector('.suggest-btn.link')).toBeNull());
  });

  it('hides the affordance and persists the pair when a suggestion is dismissed', async () => {
    h.getRelatedNotes.mockResolvedValueOnce(
      result([note({ ref: 'topics/paxos.md', title: 'Paxos', alreadyLinked: false, score: 0.7 })]),
    );

    const { findByText, container, getByLabelText } = render(RelatedPanel, baseProps());
    expect(await findByText('Paxos')).toBeTruthy();

    await fireEvent.click(getByLabelText('Dismiss'));

    await waitFor(() => expect(container.querySelector('.suggest-btn.dismiss')).toBeNull());
    const persisted = JSON.parse(localStorage.getItem('minerva.related.dismissed') ?? '[]') as string[];
    // The dismissed pair key joins active + ref with a NUL separator (not a
    // space) — see `pairKey` in the component.
    expect(persisted).toContain('topics/consensus.md\u0000topics/paxos.md');
  });

  it('does not offer an affordance for a low-score or already-linked note', async () => {
    h.getRelatedNotes.mockResolvedValueOnce(
      result([
        note({ ref: 'low.md', title: 'Low score', alreadyLinked: false, score: 0.2 }),
        note({ ref: 'linked.md', title: 'Already linked', alreadyLinked: true, score: 0.9 }),
      ]),
    );
    const { findByText, container } = render(RelatedPanel, baseProps());
    expect(await findByText('Low score')).toBeTruthy();
    expect(container.querySelector('.suggest-btn')).toBeNull();
  });
});
