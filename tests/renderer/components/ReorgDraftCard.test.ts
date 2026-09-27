/**
 * @vitest-environment happy-dom
 *
 * Render coverage for ReorgDraftCard (#2354) — the review card for a batch
 * `propose_reorganization` / batched `propose_folder_move`. Pins:
 *
 *  - the headline ("Reorganize" / "Move folders") and a per-item verb derived
 *    from each pair of paths (Rename vs Move);
 *  - every from → to pair and the combined link-rewrite blast radius;
 *  - `onApprove` receives exactly the ticked {fromPath, toPath} pairs, in
 *    draft order, and none the user unticked;
 *  - Discard fires `onDiscard` only.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type {
  ConversationReorgDraft,
  ReorgDraftItem,
  RefactorAffectedNote,
} from '../../../src/shared/conversation-refactor-drafts';
import ReorgDraftCard from '../../../src/renderer/lib/components/ReorgDraftCard.svelte';

function affected(path: string, over: Partial<RefactorAffectedNote> = {}): RefactorAffectedNote {
  return { path, before: 'a\n[[x]]', after: 'a\n[[y]]', isMoved: false, ...over };
}

function item(fromPath: string, toPath: string, affectedNotes: RefactorAffectedNote[] = []): ReorgDraftItem {
  return { fromPath, toPath, affectedNotes };
}

function draft(over: Partial<ConversationReorgDraft> = {}): ConversationReorgDraft {
  return {
    draftId: 'reorg-1',
    conversationId: 'c1',
    createdAt: '2026-01-01T00:00:00Z',
    note: 'Tidy up inbox',
    items: [
      item('inbox/a.md', 'topics/a.md', [affected('ref1.md'), affected('inbox/a.md', { isMoved: true })]),
      item('inbox/b.md', 'inbox/b-renamed.md', [affected('ref1.md'), affected('ref2.md')]),
    ],
    warnings: [],
    ...over,
  };
}

type Pair = { fromPath: string; toPath: string };

function renderCard(d: ConversationReorgDraft = draft()) {
  const onApprove = vi.fn<(selected: Pair[]) => void>();
  const onDiscard = vi.fn<() => void>();
  const utils = render(ReorgDraftCard, { draft: d, onApprove, onDiscard });
  const primary = () => utils.container.querySelector<HTMLButtonElement>('.draft-btn.primary')!;
  const checkboxes = () => Array.from(utils.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const summary = () => utils.container.querySelector('.draft-note')!.textContent.replace(/\s+/g, ' ').trim();
  return { ...utils, onApprove, onDiscard, primary, checkboxes, summary };
}

afterEach(cleanup);

describe('ReorgDraftCard — display', () => {
  it('headlines a note batch "Reorganize"', () => {
    const { container } = renderCard();
    expect(container.querySelector('.draft-summary strong')!.textContent).toBe('Reorganize');
  });

  it('headlines a folder batch "Move folders" and counts folders', () => {
    const { container, summary } = renderCard(draft({ isFolder: true }));
    expect(container.querySelector('.draft-summary strong')!.textContent).toBe('Move folders');
    expect(summary()).toMatch(/^2 of 2 folders/);
  });

  it('never calls itself a delete', () => {
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/delete/i);
  });

  it('labels each item with its own verb — Move across folders, Rename within one', () => {
    const { container } = renderCard();
    expect(Array.from(container.querySelectorAll('.verb')).map((v) => v.textContent)).toEqual(['Move', 'Rename']);
  });

  it('shows every from → to pair', () => {
    const { container } = renderCard();
    expect(Array.from(container.querySelectorAll('.paths')).map((p) => p.textContent)).toEqual([
      'inbox/a.md → topics/a.md',
      'inbox/b.md → inbox/b-renamed.md',
    ]);
  });

  it('counts DISTINCT other notes with rewritten links, excluding moved notes', () => {
    const { summary } = renderCard();
    expect(summary()).toBe("2 of 2 notes · 2 notes' links rewritten");
  });

  it('uses singulars for a one-item, one-link plan', () => {
    const { summary } = renderCard(draft({ items: [item('a.md', 'b/a.md', [affected('r.md')])] }));
    expect(summary()).toBe("1 of 1 note · 1 note' links rewritten");
  });

  it('shows a per-item link badge only when other notes are affected', () => {
    const { container } = renderCard(draft({
      items: [item('a.md', 'x/a.md', [affected('a.md', { isMoved: true })]), item('b.md', 'x/b.md', [affected('r.md')])],
    }));
    const badges = Array.from(container.querySelectorAll('.links-badge'));
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent.trim()).toBe('1 link');
  });

  it('pluralises the per-item link badge', () => {
    const { container } = renderCard();
    expect(Array.from(container.querySelectorAll('.links-badge')).map((b) => b.textContent.trim()))
      .toEqual(['1 link', '2 links']);
  });

  it('renders each plan-level warning', () => {
    const { getByText } = renderCard(draft({ warnings: ['collision: topics/a.md exists'] }));
    expect(getByText(/collision: topics\/a\.md exists/)).toBeTruthy();
  });

  it('renders no warnings block when there are none', () => {
    const { container } = renderCard();
    expect(container.querySelector('.warnings')).toBeNull();
  });
});

describe('ReorgDraftCard — diff', () => {
  it('is collapsed until the link badge is clicked', () => {
    const { container } = renderCard();
    expect(container.querySelector('.diffs')).toBeNull();
  });

  it('expanding an item shows ITS affected files with before/after lines', async () => {
    const { container } = renderCard();
    const badges = container.querySelectorAll<HTMLButtonElement>('.links-badge');
    await fireEvent.click(badges[1]!);
    const diffs = container.querySelectorAll('.diffs');
    expect(diffs).toHaveLength(1);
    expect(Array.from(diffs[0]!.querySelectorAll('.file-path')).map((f) => f.textContent)).toEqual(['ref1.md', 'ref2.md']);
    expect(Array.from(diffs[0]!.querySelectorAll('.line.removed')).map((l) => l.textContent)).toEqual(['[[x]]', '[[x]]']);
    expect(Array.from(diffs[0]!.querySelectorAll('.line.added')).map((l) => l.textContent)).toEqual(['[[y]]', '[[y]]']);
  });

  it('marks the moved note itself as "this note"', async () => {
    const { container } = renderCard();
    await fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.links-badge')[0]!);
    const paths = Array.from(container.querySelectorAll('.file-path'));
    expect(paths[0]!.textContent).toBe('ref1.md');
    expect(paths[1]!.textContent).toMatch(/^inbox\/a\.md\s*· this note$/);
  });

  it('clicking the badge again collapses the item', async () => {
    const { container } = renderCard();
    const badge = container.querySelectorAll<HTMLButtonElement>('.links-badge')[0]!;
    await fireEvent.click(badge);
    await fireEvent.click(badge);
    expect(container.querySelector('.diffs')).toBeNull();
  });
});

describe('ReorgDraftCard — selection and callbacks', () => {
  it('Approve sends every pair when nothing was unticked', async () => {
    const { primary, onApprove } = renderCard();
    expect(primary().textContent.trim()).toBe('Approve 2');
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith([
      { fromPath: 'inbox/a.md', toPath: 'topics/a.md' },
      { fromPath: 'inbox/b.md', toPath: 'inbox/b-renamed.md' },
    ]);
  });

  it('Approve sends only the pairs still ticked', async () => {
    const { primary, checkboxes, onApprove } = renderCard();
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith([{ fromPath: 'inbox/b.md', toPath: 'inbox/b-renamed.md' }]);
  });

  it('unticking the second item keeps the first', async () => {
    const { primary, checkboxes, onApprove } = renderCard();
    await fireEvent.change(checkboxes()[1]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith([{ fromPath: 'inbox/a.md', toPath: 'topics/a.md' }]);
  });

  it('re-ticking restores the item', async () => {
    const { primary, checkboxes, onApprove } = renderCard();
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.click(primary());
    expect(onApprove.mock.calls[0]![0]).toHaveLength(2);
  });

  it('unticking updates the counts, the blast radius and dims the row', async () => {
    const { primary, checkboxes, summary, container } = renderCard();
    await fireEvent.change(checkboxes()[1]!);
    expect(primary().textContent.trim()).toBe('Approve 1');
    expect(summary()).toBe("1 of 2 notes · 1 note' links rewritten");
    expect(container.querySelectorAll('.item')[1]!.classList.contains('deselected')).toBe(true);
  });

  it('"Deselect all" disables Approve', async () => {
    const { getByText, primary } = renderCard();
    await fireEvent.click(getByText('Deselect all'));
    expect(primary().disabled).toBe(true);
  });

  it('"Select all" after deselecting re-selects everything', async () => {
    const { getByText, primary, onApprove } = renderCard();
    await fireEvent.click(getByText('Deselect all'));
    await fireEvent.click(getByText('Select all'));
    await fireEvent.click(primary());
    expect(onApprove.mock.calls[0]![0]).toHaveLength(2);
  });

  it('Discard fires onDiscard only', async () => {
    const { getByText, onApprove, onDiscard } = renderCard();
    await fireEvent.click(getByText('Discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('with two cards, approving the second reports only its own pairs', async () => {
    const first = renderCard(draft({ draftId: 'r1', items: [item('a.md', 'x/a.md')] }));
    const second = renderCard(draft({ draftId: 'r2', items: [item('b.md', 'y/b.md')] }));
    await fireEvent.click(second.primary());
    expect(second.onApprove).toHaveBeenCalledWith([{ fromPath: 'b.md', toPath: 'y/b.md' }]);
    expect(first.onApprove).not.toHaveBeenCalled();
  });
});
