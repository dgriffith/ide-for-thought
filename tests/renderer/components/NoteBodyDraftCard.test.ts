/**
 * @vitest-environment happy-dom
 *
 * Render coverage for NoteBodyDraftCard (#2354) — the review card for
 * `propose_note_body` in-place rewrites (#938). The rewrite IS the change, so
 * what the diff shows is the whole of what the user is confirming. Pins:
 *
 *  - the "Rewrite" label and target path(s);
 *  - the diff: removed lines from `beforeContent`, added lines from
 *    `afterContent`, and the +/− counts;
 *  - a lone rewrite shows its diff expanded; a batch starts collapsed with
 *    per-note checkboxes;
 *  - `onApprove` receives exactly the ticked paths; Discard fires only
 *    `onDiscard`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type {
  ConversationNoteBodyDraft,
  NoteBodyDraftItem,
} from '../../../src/shared/conversation-note-body-drafts';
import NoteBodyDraftCard from '../../../src/renderer/lib/components/NoteBodyDraftCard.svelte';

function item(relativePath: string, beforeContent: string, afterContent: string): NoteBodyDraftItem {
  return { relativePath, beforeContent, afterContent };
}

function draft(over: Partial<ConversationNoteBodyDraft> = {}): ConversationNoteBodyDraft {
  return {
    draftId: 'nb-1',
    conversationId: 'c1',
    createdAt: '2026-01-01T00:00:00Z',
    note: 'Rewrite stub.md',
    items: [item('stub.md', '# Stub\ntodo', '# Stub\nA fleshed-out paragraph.\nAnother line.')],
    warnings: [],
    ...over,
  };
}

const batch = () => draft({
  note: 'Rewrite 2 notes',
  items: [
    item('a.md', 'one\ntwo', 'one\nTWO'),
    item('b.md', 'x', 'x\ny\nz'),
  ],
});

function renderCard(d: ConversationNoteBodyDraft = draft()) {
  const onApprove = vi.fn<(selected: string[]) => void>();
  const onDiscard = vi.fn<() => void>();
  const utils = render(NoteBodyDraftCard, { draft: d, onApprove, onDiscard });
  const primary = () => utils.container.querySelector<HTMLButtonElement>('.draft-btn.primary')!;
  const checkboxes = () => Array.from(utils.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const counts = () => utils.container.querySelector('.counts')!.textContent.replace(/\s+/g, ' ').trim();
  const lines = (kind: 'removed' | 'added') =>
    Array.from(utils.container.querySelectorAll(`.line.${kind}`)).map((l) => l.textContent);
  return { ...utils, onApprove, onDiscard, primary, checkboxes, counts, lines };
}

afterEach(cleanup);

describe('NoteBodyDraftCard — single note', () => {
  it('labels the operation "Rewrite" and names the target path', () => {
    const { container } = renderCard();
    expect(container.querySelector('.draft-summary strong')!.textContent).toBe('Rewrite');
    expect(container.querySelector('.draft-note')!.textContent).toBe('stub.md');
  });

  it('never calls itself a delete, rename or move', () => {
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/\b(delete|rename|move)\b/i);
  });

  it('shows the diff expanded by default', () => {
    const { getByText, container } = renderCard();
    expect(getByText('Hide diff')).toBeTruthy();
    expect(container.querySelector('.diff')).not.toBeNull();
  });

  it('renders removed lines from before and added lines from after', () => {
    const { lines } = renderCard();
    expect(lines('removed')).toEqual(['todo']);
    expect(lines('added')).toEqual(['A fleshed-out paragraph.', 'Another line.']);
  });

  it('counts each side of the diff independently', () => {
    const { counts } = renderCard();
    expect(counts()).toBe('+2 −1 lines changed');
  });

  it('uses the singular for a one-line change', () => {
    const { counts } = renderCard(draft({ items: [item('n.md', 'a', 'a\nb')] }));
    expect(counts()).toBe('+1 −0 line changed');
  });

  it('says "No line-level changes" when before and after are identical', () => {
    const { getByText } = renderCard(draft({ items: [item('n.md', 'same', 'same')] }));
    expect(getByText('No line-level changes.')).toBeTruthy();
  });

  it('hides the generated default rationale', () => {
    const { container } = renderCard();
    expect(container.querySelector('.rationale')).toBeNull();
  });

  it('shows a rationale that adds something over the default', () => {
    const { container } = renderCard(draft({ note: 'Flesh out the dictated stub' }));
    expect(container.querySelector('.rationale')!.textContent).toBe('Flesh out the dictated stub');
  });

  it('has no checkboxes for a lone rewrite', () => {
    const { checkboxes } = renderCard();
    expect(checkboxes()).toHaveLength(0);
  });

  it('collapses and re-expands the diff', async () => {
    const { getByText, container } = renderCard();
    await fireEvent.click(getByText('Hide diff'));
    expect(container.querySelector('.diff')).toBeNull();
    await fireEvent.click(getByText('Show diff'));
    expect(container.querySelector('.diff')).not.toBeNull();
  });

  it('Approve sends the one path', async () => {
    const { primary, onApprove } = renderCard();
    expect(primary().textContent).toBe('Approve & rewrite');
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['stub.md']);
  });

  it('Discard fires onDiscard only', async () => {
    const { getByText, onApprove, onDiscard } = renderCard();
    await fireEvent.click(getByText('Discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('renders warnings when present', () => {
    const { container } = renderCard(draft({ warnings: ['gone.md: no such note', 'x.png: not markdown'] }));
    expect(Array.from(container.querySelectorAll('.warnings li')).map((l) => l.textContent))
      .toEqual(['gone.md: no such note', 'x.png: not markdown']);
  });

  it('renders no warnings list when there are none', () => {
    const { container } = renderCard();
    expect(container.querySelector('.warnings')).toBeNull();
  });
});

describe('NoteBodyDraftCard — batch', () => {
  it('summarises the batch as "N notes"', () => {
    const { container } = renderCard(batch());
    expect(container.querySelector('.draft-note')!.textContent).toBe('2 notes');
  });

  it('starts every diff collapsed', () => {
    const { container } = renderCard(batch());
    expect(container.querySelector('.diff')).toBeNull();
  });

  it('shows one checkbox + path per note, all ticked', () => {
    const { checkboxes, container } = renderCard(batch());
    expect(checkboxes().map((c) => c.checked)).toEqual([true, true]);
    expect(Array.from(container.querySelectorAll('.pick .path')).map((p) => p.textContent)).toEqual(['a.md', 'b.md']);
  });

  it('shows per-note and total counts', () => {
    const { container, counts } = renderCard(batch());
    expect(Array.from(container.querySelectorAll('.item-counts')).map((c) => c.textContent.replace(/\s+/g, ' ').trim()))
      .toEqual(['+1 −1', '+2 −0']);
    expect(counts()).toBe('+3 −1 lines changed across 2 notes');
  });

  it('expanding the second note shows ITS diff, not the first', async () => {
    const { getAllByText, lines } = renderCard(batch());
    await fireEvent.click(getAllByText('Show diff')[1]!);
    expect(lines('removed')).toEqual([]);
    expect(lines('added')).toEqual(['y', 'z']);
  });

  it('labels Approve with the selected count', () => {
    const { primary } = renderCard(batch());
    expect(primary().textContent).toBe('Approve & rewrite 2');
  });

  it('Approve sends every path when all are ticked', async () => {
    const { primary, onApprove } = renderCard(batch());
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['a.md', 'b.md']);
  });

  it('unticking the first note approves only the second', async () => {
    const { primary, checkboxes, onApprove } = renderCard(batch());
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['b.md']);
  });

  it('unticking the second note approves only the first', async () => {
    const { primary, checkboxes, onApprove } = renderCard(batch());
    await fireEvent.change(checkboxes()[1]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['a.md']);
  });

  it('unticking updates the label and totals', async () => {
    const { primary, checkboxes, counts } = renderCard(batch());
    await fireEvent.change(checkboxes()[1]!);
    expect(primary().textContent).toBe('Approve & rewrite');
    expect(counts()).toBe('+1 −1 lines changed across 1 note');
  });

  it('re-ticking restores the note', async () => {
    const { primary, checkboxes, onApprove } = renderCard(batch());
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['a.md', 'b.md']);
  });

  it('unticking everything disables Approve', async () => {
    const { primary, checkboxes } = renderCard(batch());
    for (const c of checkboxes()) await fireEvent.change(c);
    expect(primary().disabled).toBe(true);
  });

  it('hides the generated batch default rationale', () => {
    const { container } = renderCard(batch());
    expect(container.querySelector('.rationale')).toBeNull();
  });
});

describe('NoteBodyDraftCard — two cards side by side', () => {
  it('approving the second card reports only its own path', async () => {
    const first = renderCard(draft({ draftId: 'n1', items: [item('first.md', 'a', 'b')] }));
    const second = renderCard(draft({ draftId: 'n2', items: [item('second.md', 'a', 'b')] }));
    await fireEvent.click(second.primary());
    expect(second.onApprove).toHaveBeenCalledWith(['second.md']);
    expect(first.onApprove).not.toHaveBeenCalled();
  });
});
