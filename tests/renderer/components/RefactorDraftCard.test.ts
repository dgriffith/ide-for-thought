/**
 * @vitest-environment happy-dom
 *
 * Render coverage for RefactorDraftCard (#2354) — the review card for a single
 * `propose_note_rename` / `propose_note_move` / `propose_folder_move`. Pins:
 *
 *  - the operation label: same-folder is a Rename, cross-folder is a Move,
 *    and a folder draft says "folder" — the verb is derived from the paths,
 *    so a Move must never be labelled a Rename or vice versa;
 *  - both paths and the blast radius are shown;
 *  - the per-file diff renders the before/after lines from the dry run;
 *  - Approve / Discard fire their own callback and never each other's.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type {
  ConversationRefactorDraft,
  RefactorAffectedNote,
} from '../../../src/shared/conversation-refactor-drafts';
import RefactorDraftCard from '../../../src/renderer/lib/components/RefactorDraftCard.svelte';

function affected(path: string, over: Partial<RefactorAffectedNote> = {}): RefactorAffectedNote {
  return {
    path,
    before: 'intro\nsee [[old]]\noutro',
    after: 'intro\nsee [[new]]\noutro',
    isMoved: false,
    ...over,
  };
}

function draft(over: Partial<ConversationRefactorDraft> = {}): ConversationRefactorDraft {
  return {
    draftId: 'ref-1',
    conversationId: 'c1',
    createdAt: '2026-01-01T00:00:00Z',
    note: 'Clearer name',
    fromPath: 'notes/old.md',
    toPath: 'notes/new.md',
    affectedNotes: [affected('notes/linker.md')],
    ...over,
  };
}

function renderCard(d: ConversationRefactorDraft = draft()) {
  const onApprove = vi.fn<() => void>();
  const onDiscard = vi.fn<() => void>();
  const utils = render(RefactorDraftCard, { draft: d, onApprove, onDiscard });
  const headline = () => utils.container.querySelector('.draft-summary strong')!.textContent.trim();
  const primary = () => utils.container.querySelector<HTMLButtonElement>('.draft-btn.primary')!;
  return { ...utils, onApprove, onDiscard, headline, primary };
}

afterEach(cleanup);

describe('RefactorDraftCard — operation label', () => {
  it('labels a same-folder change a Rename', () => {
    const { headline, primary } = renderCard();
    expect(headline()).toBe('Rename');
    expect(primary().textContent.trim()).toBe('Approve & rename');
  });

  it('labels a cross-folder change a Move', () => {
    const { headline, primary } = renderCard(draft({ toPath: 'archive/old.md' }));
    expect(headline()).toBe('Move');
    expect(primary().textContent.trim()).toBe('Approve & move');
  });

  it('labels a top-level → subfolder change a Move', () => {
    const { headline } = renderCard(draft({ fromPath: 'old.md', toPath: 'sub/old.md' }));
    expect(headline()).toBe('Move');
  });

  it('labels a folder rename "Rename folder"', () => {
    const { headline, primary } = renderCard(draft({
      isFolder: true, fromPath: 'projects/alpha', toPath: 'projects/beta', affectedNotes: [],
    }));
    expect(headline()).toBe('Rename folder');
    expect(primary().textContent.trim()).toBe('Approve & rename folder');
  });

  it('labels a folder relocation "Move folder"', () => {
    const { headline, primary } = renderCard(draft({
      isFolder: true, fromPath: 'projects/alpha', toPath: 'archive/alpha', affectedNotes: [],
    }));
    expect(headline()).toBe('Move folder');
    expect(primary().textContent.trim()).toBe('Approve & move folder');
  });

  it('never calls itself a delete', () => {
    const { container } = renderCard();
    expect(container.textContent).not.toMatch(/delete/i);
  });
});

describe('RefactorDraftCard — paths and blast radius', () => {
  it('shows the source → destination path', () => {
    const { container } = renderCard();
    expect(container.querySelector('.draft-note')!.textContent).toBe('notes/old.md → notes/new.md');
  });

  it('counts other notes whose links get rewritten, excluding the moved note', () => {
    const { container } = renderCard(draft({
      affectedNotes: [affected('a.md'), affected('b.md'), affected('notes/old.md', { isMoved: true })],
    }));
    expect(container.querySelector('.blast')!.textContent.replace(/\s+/g, ' ').trim())
      .toBe('2 notes will have links rewritten.');
  });

  it('uses the singular for one rewritten note', () => {
    const { container } = renderCard();
    expect(container.querySelector('.blast')!.textContent.replace(/\s+/g, ' ').trim())
      .toBe('1 note will have links rewritten.');
  });

  it('says only the note moves when nothing links to it', () => {
    const { container } = renderCard(draft({ affectedNotes: [] }));
    const blast = container.querySelector('.blast')!;
    expect(blast.textContent.trim()).toBe('No other notes link here — only the note moves.');
    expect(blast.classList.contains('none')).toBe(true);
  });

  it('a folder move counts the notes travelling with it and the referrers', () => {
    const { container } = renderCard(draft({
      isFolder: true, fromPath: 'p/a', toPath: 'q/a',
      affectedNotes: [
        affected('p/a/one.md', { isMoved: true }),
        affected('p/a/two.md', { isMoved: true }),
        affected('elsewhere.md'),
      ],
    }));
    expect(container.querySelector('.blast')!.textContent.replace(/\s+/g, ' ').trim())
      .toBe('2 notes move with the folder; 1 other note will have links rewritten.');
  });

  it('a folder move with one note and no referrers uses the singular and omits the rewrite clause', () => {
    const { container } = renderCard(draft({
      isFolder: true, fromPath: 'p/a', toPath: 'q/a',
      affectedNotes: [affected('p/a/one.md', { isMoved: true })],
    }));
    expect(container.querySelector('.blast')!.textContent.replace(/\s+/g, ' ').trim())
      .toBe('1 note moves with the folder.');
  });

  it('a folder move with several referrers pluralises them', () => {
    const { container } = renderCard(draft({
      isFolder: true, fromPath: 'p/a', toPath: 'q/a',
      affectedNotes: [affected('x.md'), affected('y.md')],
    }));
    expect(container.querySelector('.blast')!.textContent.replace(/\s+/g, ' ').trim())
      .toBe('0 notes move with the folder; 2 other notes will have links rewritten.');
  });
});

describe('RefactorDraftCard — diff', () => {
  it('hides the diff until asked', () => {
    const { container, getByText } = renderCard();
    expect(getByText('Show changes')).toBeTruthy();
    expect(container.querySelector('.diffs')).toBeNull();
  });

  it('shows each affected file with only its changed lines', async () => {
    const { container, getByText } = renderCard();
    await fireEvent.click(getByText('Show changes'));
    expect(container.querySelector('.file-path')!.textContent.trim()).toBe('notes/linker.md');
    expect(Array.from(container.querySelectorAll('.line.removed')).map((l) => l.textContent)).toEqual(['see [[old]]']);
    expect(Array.from(container.querySelectorAll('.line.added')).map((l) => l.textContent)).toEqual(['see [[new]]']);
  });

  it('marks the moved note itself as "this note"', async () => {
    const { container, getByText } = renderCard(draft({
      affectedNotes: [affected('notes/old.md', { isMoved: true })],
    }));
    await fireEvent.click(getByText('Show changes'));
    expect(container.querySelector('.file-path')!.textContent).toMatch(/notes\/old\.md\s*· this note/);
  });

  it('toggles back to hidden', async () => {
    const { container, getByText } = renderCard();
    await fireEvent.click(getByText('Show changes'));
    await fireEvent.click(getByText('Hide changes'));
    expect(container.querySelector('.diffs')).toBeNull();
  });

  it('offers no toggle when there is nothing to diff', () => {
    const { queryByText } = renderCard(draft({ affectedNotes: [] }));
    expect(queryByText('Show changes')).toBeNull();
  });
});

describe('RefactorDraftCard — callbacks', () => {
  it('Approve fires onApprove only', async () => {
    const { primary, onApprove, onDiscard } = renderCard();
    await fireEvent.click(primary());
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Discard fires onDiscard only', async () => {
    const { getByText, onApprove, onDiscard } = renderCard();
    await fireEvent.click(getByText('Discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('with two cards, approving the second fires only the second', async () => {
    const first = renderCard(draft({ draftId: 'r1', fromPath: 'a.md', toPath: 'b.md' }));
    const second = renderCard(draft({ draftId: 'r2', fromPath: 'c.md', toPath: 'x/c.md' }));
    await fireEvent.click(second.primary());
    expect(second.onApprove).toHaveBeenCalledTimes(1);
    expect(first.onApprove).not.toHaveBeenCalled();
    expect(first.headline()).toBe('Rename');
    expect(second.headline()).toBe('Move');
  });
});
