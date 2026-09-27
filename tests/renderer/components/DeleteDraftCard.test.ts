/**
 * @vitest-environment happy-dom
 *
 * Render coverage for DeleteDraftCard (#2354) — the review card for
 * `propose_note_delete` / `propose_folder_delete`. This is the "human
 * confirms" half of the Trust Principle for the most destructive operation an
 * LLM can propose, so the tests pin:
 *
 *  - it reads as a DELETE (never a rename/move), with the target paths shown;
 *  - the dangling-link blast radius is stated;
 *  - `onApprove` receives exactly the units the user left ticked — NOTE paths
 *    for a note delete, FOLDER paths for a folder delete (#1778) — and nothing
 *    the user unticked;
 *  - Discard fires `onDiscard` and never `onApprove`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type {
  ConversationDeleteDraft,
  DeleteDraftItem,
} from '../../../src/shared/conversation-refactor-drafts';
import DeleteDraftCard from '../../../src/renderer/lib/components/DeleteDraftCard.svelte';

function item(path: string, over: Partial<DeleteDraftItem> = {}): DeleteDraftItem {
  return { path, title: path.replace(/\.md$/, '').split('/').pop()!, inbound: [], ...over };
}

function draft(over: Partial<ConversationDeleteDraft> = {}): ConversationDeleteDraft {
  return {
    draftId: 'del-1',
    conversationId: 'c1',
    createdAt: '2026-01-01T00:00:00Z',
    note: 'Remove the stale scratch notes',
    items: [item('scratch/a.md'), item('scratch/b.md')],
    warnings: [],
    ...over,
  };
}

function renderCard(d: ConversationDeleteDraft = draft()) {
  const onApprove = vi.fn<(selected: string[]) => void>();
  const onDiscard = vi.fn<() => void>();
  const utils = render(DeleteDraftCard, { draft: d, onApprove, onDiscard });
  const primary = () => utils.container.querySelector<HTMLButtonElement>('.draft-btn.primary')!;
  const checkboxes = () => Array.from(utils.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  return { ...utils, onApprove, onDiscard, primary, checkboxes };
}

afterEach(cleanup);

describe('DeleteDraftCard — note delete', () => {
  it('labels the operation as a delete, not a rename or move', () => {
    const { container } = renderCard();
    const headline = container.querySelector('.draft-summary strong')!.textContent.trim();
    expect(headline).toBe('Delete');
  });

  it('never uses rename/move wording anywhere on the card', () => {
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/\b(rename|move)\b/i);
  });

  it('shows every target note path and title', () => {
    const d = draft({ items: [item('scratch/a.md', { title: 'Alpha' }), item('scratch/b.md', { title: 'Beta' })] });
    const { getByText } = renderCard(d);
    expect(getByText('scratch/a.md')).toBeTruthy();
    expect(getByText('scratch/b.md')).toBeTruthy();
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('Beta')).toBeTruthy();
  });

  it('summarises how many of the notes are selected', () => {
    const { container } = renderCard();
    expect(container.querySelector('.draft-note')!.textContent).toMatch(/2 of 2 notes/);
  });

  it('uses the singular for a one-note draft', () => {
    const { container } = renderCard(draft({ items: [item('solo.md')] }));
    expect(container.querySelector('.draft-note')!.textContent).toMatch(/1 of 1 note(?!s)/);
  });

  it('labels the primary button with the delete count', () => {
    const { primary } = renderCard();
    expect(primary().textContent.trim()).toBe('Delete 2');
  });

  it('Approve hands back every note path when nothing was unticked', async () => {
    const { primary, onApprove } = renderCard();
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['scratch/a.md', 'scratch/b.md']);
  });

  it('Approve hands back only the notes still ticked', async () => {
    const { primary, checkboxes, onApprove } = renderCard();
    await fireEvent.change(checkboxes()[0]!); // untick scratch/a.md
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['scratch/b.md']);
  });

  it('unticking the SECOND note removes the second, not the first', async () => {
    const { primary, checkboxes, onApprove } = renderCard();
    await fireEvent.change(checkboxes()[1]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['scratch/a.md']);
  });

  it('re-ticking a note restores it to the approved set', async () => {
    const { primary, checkboxes, onApprove } = renderCard();
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.change(checkboxes()[0]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['scratch/a.md', 'scratch/b.md']);
  });

  it('updates the count label after unticking', async () => {
    const { primary, checkboxes, container } = renderCard();
    await fireEvent.change(checkboxes()[0]!);
    expect(primary().textContent.trim()).toBe('Delete 1');
    expect(container.querySelector('.draft-note')!.textContent).toMatch(/1 of 2 notes/);
  });

  it('dims an unticked note row', async () => {
    const { checkboxes, container } = renderCard();
    await fireEvent.change(checkboxes()[0]!);
    const rows = container.querySelectorAll('.item');
    expect(rows[0]!.classList.contains('deselected')).toBe(true);
    expect(rows[1]!.classList.contains('deselected')).toBe(false);
  });

  it('"Deselect all" disables Approve', async () => {
    const { getByText, primary } = renderCard();
    await fireEvent.click(getByText('Deselect all'));
    expect(primary().disabled).toBe(true);
  });

  it('"Deselect all" flips to "Select all", which re-selects everything', async () => {
    const { getByText, primary, onApprove } = renderCard();
    await fireEvent.click(getByText('Deselect all'));
    await fireEvent.click(getByText('Select all'));
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['scratch/a.md', 'scratch/b.md']);
  });

  it('Discard fires onDiscard and never onApprove', async () => {
    const { getByText, onApprove, onDiscard } = renderCard();
    await fireEvent.click(getByText('Discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('renders each warning', () => {
    const { getByText } = renderCard(draft({ warnings: ['missing.md: no such note', 'x.png: not a note'] }));
    expect(getByText(/missing\.md: no such note/)).toBeTruthy();
    expect(getByText(/x\.png: not a note/)).toBeTruthy();
  });

  it('renders no warnings block when there are none', () => {
    const { container } = renderCard();
    expect(container.querySelector('.warnings')).toBeNull();
  });
});

describe('DeleteDraftCard — dangling-link blast radius', () => {
  const linked = () => draft({
    items: [
      item('a.md', {
        inbound: [
          { source: 'x.md', sourceTitle: 'X note', linkCount: 2 },
          { source: 'y.md', sourceTitle: 'Y note', linkCount: 1 },
        ],
      }),
      item('b.md', { inbound: [{ source: 'x.md', sourceTitle: 'X note', linkCount: 1 }] }),
    ],
  });

  it('counts DISTINCT linking notes across the selection', () => {
    const { container } = renderCard(linked());
    expect(container.querySelector('.draft-note')!.textContent).toMatch(/2 other notes will have dangling links/);
  });

  it('shrinks the dangling count when a linked note is unticked', async () => {
    const { checkboxes, container } = renderCard(linked());
    await fireEvent.change(checkboxes()[0]!); // drop a.md — only x.md → b.md remains
    expect(container.querySelector('.draft-note')!.textContent).toMatch(/1 other note will have dangling links/);
  });

  it('omits the dangling-link clause when nothing links in', () => {
    const { container } = renderCard();
    expect(container.querySelector('.draft-note')!.textContent).not.toMatch(/dangling/);
  });

  it('shows a per-note inbound-link badge summing link counts', () => {
    const { getByText } = renderCard(linked());
    expect(getByText(/3 inbound links/)).toBeTruthy();
    expect(getByText(/1 inbound link(?!s)/)).toBeTruthy();
  });

  it('expanding the badge lists the linking notes with a multiplicity marker', async () => {
    const { getByText, queryByText } = renderCard(linked());
    expect(queryByText('Y note')).toBeNull();
    await fireEvent.click(getByText(/3 inbound links/));
    expect(getByText('X note')).toBeTruthy();
    expect(getByText('Y note')).toBeTruthy();
    expect(getByText('×2')).toBeTruthy();
  });

  it('clicking the badge again collapses the list', async () => {
    const { getByText, queryByText } = renderCard(linked());
    await fireEvent.click(getByText(/3 inbound links/));
    await fireEvent.click(getByText(/3 inbound links/));
    expect(queryByText('Y note')).toBeNull();
  });
});

describe('DeleteDraftCard — folder delete (#1778)', () => {
  const twoFolders = () => draft({
    folderPaths: ['old', 'tmp'],
    assetCount: 3,
    items: [
      item('old/a.md', { folder: 'old' }),
      item('old/b.md', { folder: 'old' }),
      item('tmp/c.md', { folder: 'tmp' }),
    ],
  });

  it('labels a multi-folder draft "Delete folders"', () => {
    const { container } = renderCard(twoFolders());
    expect(container.querySelector('.draft-summary strong')!.textContent.trim()).toBe('Delete folders');
  });

  it('summarises folders, notes and assets', () => {
    const { container } = renderCard(twoFolders());
    const note = container.querySelector('.draft-note')!.textContent;
    expect(note).toMatch(/2 of 2 folders/);
    expect(note).toMatch(/3 notes, 3 assets/);
  });

  it('puts checkboxes on folders, not notes', () => {
    const { checkboxes } = renderCard(twoFolders());
    expect(checkboxes()).toHaveLength(2);
  });

  it('groups notes under their folder heading', () => {
    const { container } = renderCard(twoFolders());
    const groups = Array.from(container.querySelectorAll('.group'));
    expect(groups.map((g) => g.querySelector('.group-head .path')!.textContent)).toEqual(['old', 'tmp']);
    expect(groups[0]!.textContent).toContain('old/a.md');
    expect(groups[0]!.textContent).toContain('old/b.md');
    expect(groups[0]!.textContent).not.toContain('tmp/c.md');
    expect(groups[0]!.querySelector('.group-head .count')!.textContent).toBe('2 notes');
    expect(groups[1]!.querySelector('.group-head .count')!.textContent).toBe('1 note');
  });

  it('Approve hands back FOLDER paths, not note paths', async () => {
    const { primary, onApprove } = renderCard(twoFolders());
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['old', 'tmp']);
  });

  it('unticking the second folder approves only the first', async () => {
    const { primary, checkboxes, onApprove } = renderCard(twoFolders());
    await fireEvent.change(checkboxes()[1]!);
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledWith(['old']);
  });

  it('unticking a folder drops its notes from the note count and dims the group', async () => {
    const { checkboxes, container } = renderCard(twoFolders());
    await fireEvent.change(checkboxes()[0]!);
    expect(container.querySelector('.draft-note')!.textContent).toMatch(/1 of 2 folders · 1 note(?!s)/);
    expect(container.querySelectorAll('.group')[0]!.classList.contains('deselected')).toBe(true);
  });

  it('labels the primary button with the selected folder count', () => {
    const { primary } = renderCard(twoFolders());
    expect(primary().textContent.trim()).toBe('Delete 2 folders');
  });

  // Bug found writing these tests: with one of several folders left ticked the
  // button read "Delete 1 folders".
  it('uses the singular on the button when one of several folders is left ticked', async () => {
    const { primary, checkboxes } = renderCard(twoFolders());
    await fireEvent.change(checkboxes()[0]!);
    expect(primary().textContent.trim()).toBe('Delete 1 folder');
  });

  it('deselecting every folder disables Approve', async () => {
    const { getByText, primary } = renderCard(twoFolders());
    await fireEvent.click(getByText('Deselect all'));
    expect(primary().disabled).toBe(true);
  });

  it('keeps Approve live for a selected folder that holds only assets', () => {
    const d = draft({ folderPaths: ['imgs', 'tmp'], assetCount: 1, items: [item('tmp/c.md', { folder: 'tmp' })] });
    const { primary } = renderCard(d);
    expect(primary().disabled).toBe(false);
  });

  describe('a lone folder', () => {
    const lone = () => draft({
      folderPaths: ['archive'],
      assetCount: 1,
      items: [item('archive/a.md', { folder: 'archive' })],
    });

    it('reads "Delete folder" and names the folder', () => {
      const { container } = renderCard(lone());
      expect(container.querySelector('.draft-summary strong')!.textContent.trim()).toBe('Delete folder');
      expect(container.querySelector('.draft-note .path')!.textContent).toBe('archive');
      expect(container.querySelector('.draft-note')!.textContent).toMatch(/1 note, 1 asset(?!s)/);
    });

    it('renders no checkboxes and no select-all', () => {
      const { checkboxes, queryByText } = renderCard(lone());
      expect(checkboxes()).toHaveLength(0);
      expect(queryByText(/Select all|Deselect all/)).toBeNull();
    });

    it('Approve reads "Delete folder" and hands back the folder path', async () => {
      const { primary, onApprove } = renderCard(lone());
      expect(primary().textContent.trim()).toBe('Delete folder');
      await fireEvent.click(primary());
      expect(onApprove).toHaveBeenCalledWith(['archive']);
    });

    it('omits the asset clause when there are no assets', () => {
      const { container } = renderCard({ ...lone(), assetCount: 0 });
      expect(container.querySelector('.draft-note')!.textContent).not.toMatch(/asset/);
    });
  });
});

describe('DeleteDraftCard — two cards side by side', () => {
  it('each card reports its own paths to its own callback', async () => {
    const first = renderCard(draft({ draftId: 'd-1', items: [item('one.md')] }));
    const second = renderCard(draft({ draftId: 'd-2', items: [item('two.md')] }));

    await fireEvent.click(second.primary());

    expect(second.onApprove).toHaveBeenCalledWith(['two.md']);
    expect(first.onApprove).not.toHaveBeenCalled();
  });

  it("discarding one card does not discard the other", async () => {
    const first = renderCard(draft({ draftId: 'd-1', items: [item('one.md')] }));
    const second = renderCard(draft({ draftId: 'd-2', items: [item('two.md')] }));

    const discards = first.container.querySelectorAll<HTMLButtonElement>('.draft-btn:not(.primary)');
    await fireEvent.click(discards[0]!);

    expect(first.onDiscard).toHaveBeenCalledTimes(1);
    expect(second.onDiscard).not.toHaveBeenCalled();
  });
});
