/**
 * "Merge into tag…" store (#2430). The IPC client and the dialog / editor /
 * busy stores are mocked; what's asserted is the flow's order and its exits:
 * autosave is flushed before anything is read, cancel at either dialog writes
 * nothing, the confirm carries the counts and the undo story under its own
 * key, and failures are reported rather than thrown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  order: [] as string[],
  allNames: vi.fn(),
  mergePreview: vi.fn(),
  merge: vi.fn(),
  showPrompt: vi.fn(),
  showConfirm: vi.fn(),
  flushAutoSave: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { tags: { allNames: h.allNames, mergePreview: h.mergePreview, merge: h.merge } },
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showPrompt: h.showPrompt, showConfirm: h.showConfirm }),
}));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => ({ flushAutoSave: h.flushAutoSave }),
}));
vi.mock('../../../src/renderer/lib/stores/busy.svelte', () => ({
  getBusyStore: () => ({ withBusy: <T>(_l: string, fn: () => Promise<T>) => fn() }),
}));

import { getTagMergeStore, describeTagMerge } from '../../../src/renderer/lib/stores/tag-merge.svelte';
import { CONFIRM_KEYS } from '../../../src/renderer/lib/confirm-keys';

const PREVIEW = { notes: 42, sources: 3, sourcesBodyOnly: 0, nestedTags: ['ml/nlp'], isRename: false };
const store = getTagMergeStore();

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  h.flushAutoSave.mockImplementation(() => { h.order.push('flush'); });
  h.allNames.mockImplementation(() => { h.order.push('allNames'); return Promise.resolve(['ml', 'machine-learning', 'stats']); });
  h.showPrompt.mockResolvedValue('#machine-learning');
  h.mergePreview.mockResolvedValue(PREVIEW);
  h.showConfirm.mockResolvedValue(true);
  h.merge.mockResolvedValue({ notePaths: ['a.md'], sourceIds: ['s1'], errors: [] });
});

describe('tag-merge store (#2430)', () => {
  it('flushes autosave, prompts with the other tags, previews, confirms with counts, then merges', async () => {
    const before = store.revision;
    const result = await store.mergeInteractive('ml');

    expect(h.order.slice(0, 2)).toEqual(['flush', 'allNames']);
    expect(h.showPrompt).toHaveBeenCalledWith(expect.stringContaining('#ml'), { suggestions: ['machine-learning', 'stats'] });
    expect(h.mergePreview).toHaveBeenCalledWith('ml', 'machine-learning');
    const [message, key, label] = h.showConfirm.mock.calls[0]!;
    expect(message).toContain('Merge #ml into #machine-learning: 42 notes, 3 sources.');
    expect(message).toContain('Local History');
    expect(key).toBe(CONFIRM_KEYS.mergeTag);
    expect(label).toBe('Merge');
    expect(h.merge).toHaveBeenCalledWith('ml', 'machine-learning');
    expect(result).toEqual({ notePaths: ['a.md'], sourceIds: ['s1'], errors: [] });
    expect(store.revision).toBe(before + 1);
  });

  it.each([
    ['cancelled prompt', null],
    ['empty answer', '  #  '],
    ['same tag', 'ml'],
  ])('stops at a %s without counting or writing', async (_label, answer) => {
    h.showPrompt.mockResolvedValue(answer);
    expect(await store.mergeInteractive('ml')).toBeNull();
    expect(h.mergePreview).not.toHaveBeenCalled();
    expect(h.merge).not.toHaveBeenCalled();
  });

  it('writes nothing when the confirm is declined', async () => {
    h.showConfirm.mockResolvedValue(false);
    expect(await store.mergeInteractive('ml')).toBeNull();
    expect(h.merge).not.toHaveBeenCalled();
  });

  it('labels the confirm "Rename" when the target is new', async () => {
    h.mergePreview.mockResolvedValue({ ...PREVIEW, isRename: true });
    await store.mergeInteractive('ml');
    const [message, , label] = h.showConfirm.mock.calls[0]!;
    expect(message).toMatch(/^Rename #ml to #machine-learning/);
    expect(label).toBe('Rename');
  });

  it('reports a refused merge instead of throwing', async () => {
    h.mergePreview.mockRejectedValue(new Error('"a b" is not a valid tag name.'));
    expect(await store.mergeInteractive('ml')).toBeNull();
    expect(h.showConfirm).toHaveBeenCalledWith(expect.stringMatching(/not a valid tag name/), CONFIRM_KEYS.mergeTagFailed, 'OK');
    expect(h.merge).not.toHaveBeenCalled();
  });

  it('lists per-item failures after a partial merge', async () => {
    h.merge.mockResolvedValue({ notePaths: ['a.md'], sourceIds: [], errors: [{ path: 'c.md', error: 'EACCES' }] });
    await store.mergeInteractive('ml');
    expect(h.showConfirm).toHaveBeenLastCalledWith(expect.stringContaining('c.md: EACCES'), CONFIRM_KEYS.mergeTagFailed, 'OK');
  });
});

describe('describeTagMerge', () => {
  it('names nested tags that move and sources whose captured text keeps the tag', () => {
    const text = describeTagMerge('ml', 'ai', {
      notes: 1, sources: 0, sourcesBodyOnly: 2, nestedTags: ['ml/a', 'ml/b', 'ml/c', 'ml/d'], isRename: false,
    });
    expect(text).toContain('Merge #ml into #ai: 1 note, 0 sources.');
    expect(text).toContain('#ml/a, #ml/b, #ml/c, and 1 more');
    expect(text).toContain('2 sources only mention #ml in captured text');
  });
});
