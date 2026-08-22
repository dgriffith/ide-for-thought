/**
 * Behavioral net for the refactor-ops handlers extracted from App.svelte (#670).
 * Mocks the api client + notebase/editor/dialog stores; uses the real busy +
 * refactor-flow runes stores. Verifies the moved handler bodies (auto-tag,
 * auto-link review + apply, bulk tagging, bibliography), not just that menus
 * reach them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const api = {
    refactor: {
      autoTagSuggest: vi.fn(),
      autoTagApply: vi.fn(),
      autoLinkSuggest: vi.fn(),
      autoLinkInboundSuggest: vi.fn(),
      autoLinkApply: vi.fn(),
      autoLinkInboundApply: vi.fn(),
    },
    notebase: { readFile: vi.fn(), writeFile: vi.fn() },
    tags: { list: vi.fn() },
    graph: { frontmatterKeys: vi.fn() },
    formatter: { formatFile: vi.fn(), formatContent: vi.fn() },
    history: { labelNotes: vi.fn() },
    bibliography: { generate: vi.fn() },
  };
  const notebase = {
    meta: { rootPath: '/p', name: 'p' } as unknown,
    files: [] as unknown[],
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const editor = {
    activeNoteTab: null as unknown,
    activeTab: null as unknown,
    flushAutoSave: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    reloadTabFromDisk: vi.fn().mockResolvedValue(undefined),
    isPathDirty: vi.fn(() => false),
    openFile: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn(),
  };
  const dialog = { showPrompt: vi.fn(), showConfirm: vi.fn(), showAddPropertyDialog: vi.fn() };
  return { api, notebase, editor, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));

import { createRefactorOps, type RefactorOpsCtx } from '../../../src/renderer/lib/app/refactor-ops.svelte';
import { getRefactorFlowStore } from '../../../src/renderer/lib/stores/refactor-flow.svelte';

const flow = getRefactorFlowStore();
const sidebar = { getSelectionPaths: vi.fn(() => [] as string[]), refreshTags: vi.fn() };
const editorComponent = { getSelectionRange: vi.fn(() => null), getOffset: vi.fn(() => 0) };
let ctx: RefactorOpsCtx;
let ops: ReturnType<typeof createRefactorOps>;
let maybeMissing: ReturnType<typeof vi.fn>;

function resetFlow() {
  flow.setAutoLinkReview(null);
  flow.setAutoLinkInboundReview(null);
  flow.setAutoLinkBusy(false);
  flow.setAutoTagReview(null);
  flow.setAutoTagBusy(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.notebase.files = [];
  h.editor.activeNoteTab = null;
  h.editor.activeTab = null;
  // clearAllMocks() resets call history but not a mockReturnValue override, so
  // re-pin the isPathDirty default (a later test flips it to true).
  h.editor.isPathDirty.mockReturnValue(false);
  sidebar.getSelectionPaths.mockReturnValue([]);
  resetFlow();
  maybeMissing = vi.fn().mockResolvedValue(false);
  ctx = {
    getSidebar: () => sidebar,
    getEditorComponent: () => editorComponent,
    maybeHandleMissingApiKey: maybeMissing,
  };
  ops = createRefactorOps(ctx);
});

describe('handleAutoTag (SUGGEST phase, #940)', () => {
  it('opens the review dialog with the suggested tags and writes nothing', async () => {
    h.api.refactor.autoTagSuggest.mockResolvedValue({ added: ['x', 'y'] });
    await ops.handleAutoTag('note.md');
    expect(h.api.refactor.autoTagSuggest).toHaveBeenCalledWith('note.md');
    // Review state is set — apply hasn't run, so nothing was written.
    expect(flow.autoTagReview?.relativePath).toBe('note.md');
    expect(flow.autoTagReview?.tags).toEqual(['x', 'y']);
    expect(h.api.refactor.autoTagApply).not.toHaveBeenCalled();
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
    expect(flow.autoTagBusy).toBe(false);
  });

  it('shows a notice and leaves review null when nothing was suggested', async () => {
    h.api.refactor.autoTagSuggest.mockResolvedValue({ added: [] });
    await ops.handleAutoTag('note.md');
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(flow.autoTagReview).toBeNull();
  });

  it('skips the failure dialog when the error is a missing API key', async () => {
    h.api.refactor.autoTagSuggest.mockRejectedValue(new Error('no key'));
    maybeMissing.mockResolvedValue(true);
    await ops.handleAutoTag('note.md');
    expect(maybeMissing).toHaveBeenCalled();
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
  });
});

describe('handleAutoTagApply (APPLY phase, #940)', () => {
  it('clears the review and files the accepted tags through approval', async () => {
    flow.setAutoTagReview({ relativePath: 'note.md', tags: ['x', 'y'] });
    h.api.refactor.autoTagApply.mockResolvedValue({ applied: ['x'] });
    await ops.handleAutoTagApply(['x']);
    expect(flow.autoTagReview).toBeNull();
    expect(h.api.refactor.autoTagApply).toHaveBeenCalledWith('note.md', ['x']);
  });

  it('does nothing when there is no pending review', async () => {
    await ops.handleAutoTagApply(['x']);
    expect(h.api.refactor.autoTagApply).not.toHaveBeenCalled();
  });
});

describe('handleAutoLink', () => {
  it('sets the review state when suggestions are found', async () => {
    h.api.refactor.autoLinkSuggest.mockResolvedValue({ suggestions: [{ anchor: 'a' }] });
    h.api.notebase.readFile.mockResolvedValue('---\ntitle: x\n---\nbody');
    await ops.handleAutoLink('note.md');
    expect(flow.autoLinkReview?.relativePath).toBe('note.md');
    expect(flow.autoLinkReview?.suggestions).toHaveLength(1);
    expect(flow.autoLinkReview?.activeBody).toBe('body');
    expect(flow.autoLinkBusy).toBe(false);
  });

  it('shows a notice and leaves review null when none found', async () => {
    h.api.refactor.autoLinkSuggest.mockResolvedValue({ suggestions: [] });
    await ops.handleAutoLink('note.md');
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(flow.autoLinkReview).toBeNull();
  });
});

describe('handleAutoLinkApply', () => {
  it('clears the review and applies the snapshot', async () => {
    flow.setAutoLinkReview({ relativePath: 'note.md', suggestions: [], activeBody: '' });
    h.api.refactor.autoLinkApply.mockResolvedValue({ applied: [{}], skipped: [] });
    await ops.handleAutoLinkApply([{ anchor: 'a' }] as never);
    expect(flow.autoLinkReview).toBeNull();
    expect(h.api.refactor.autoLinkApply).toHaveBeenCalledWith('note.md', [{ anchor: 'a' }]);
  });

  it('does nothing when there is no pending review', async () => {
    await ops.handleAutoLinkApply([] as never);
    expect(h.api.refactor.autoLinkApply).not.toHaveBeenCalled();
  });
});

describe('handleAddTag', () => {
  it('confirms "no .md files" and writes nothing with an empty selection and no fallback', async () => {
    await ops.handleAddTag();
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('prompts and writes the tag to a single .md fallback target', async () => {
    h.api.tags.list.mockResolvedValue([{ tag: 'foo' }]);
    h.dialog.showPrompt.mockResolvedValue('bar');
    h.api.notebase.readFile.mockResolvedValue('body');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    // mergeTagsIntoContent (real) reports an added tag for clean content.
    await ops.handleAddTag('note.md', false);
    expect(h.dialog.showPrompt).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).toHaveBeenCalled();
    const [path] = h.api.notebase.writeFile.mock.calls[0];
    expect(path).toBe('note.md');
    expect(sidebar.refreshTags).toHaveBeenCalled();
  });

  it('syncs an open tab to disk after tagging so the page updates (regression)', async () => {
    h.api.tags.list.mockResolvedValue([]);
    h.dialog.showPrompt.mockResolvedValue('bar');
    h.api.notebase.readFile.mockResolvedValue('body');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleAddTag('note.md', false);
    // The whole point: the changed note's open editor buffer is reloaded.
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
  });

  it('prompts before clobbering unsaved edits in an open tab, and skips reload if declined', async () => {
    h.api.tags.list.mockResolvedValue([]);
    h.dialog.showPrompt.mockResolvedValue('bar');
    h.api.notebase.readFile.mockResolvedValue('body');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    h.editor.isPathDirty.mockReturnValue(true);
    h.dialog.showConfirm.mockResolvedValue(false); // keep my edits
    await ops.handleAddTag('note.md', false);
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.editor.reloadTabFromDisk).not.toHaveBeenCalled();
  });
});

describe('handleLabelVersion (#1158)', () => {
  it('confirms "no .md files" and labels nothing with an empty selection and no fallback', async () => {
    await ops.handleLabelVersion();
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.api.history.labelNotes).not.toHaveBeenCalled();
  });

  it('labels the whole sidebar selection under one name', async () => {
    sidebar.getSelectionPaths.mockReturnValue(['a.md', 'b.md']);
    h.notebase.files = [
      { name: 'a.md', relativePath: 'a.md', isDirectory: false },
      { name: 'b.md', relativePath: 'b.md', isDirectory: false },
    ];
    h.dialog.showPrompt.mockResolvedValue('before refactor');
    h.api.history.labelNotes.mockResolvedValue({ label: 'before refactor', labeled: ['a.md', 'b.md'], errors: [] });

    await ops.handleLabelVersion();

    expect(h.api.history.labelNotes).toHaveBeenCalledWith(['a.md', 'b.md'], 'before refactor');
    // A version label is a restore point, not a note edit — nothing is written
    // to the notes themselves.
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('does nothing when the prompt is cancelled or left empty', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleLabelVersion('note.md', false);
    h.dialog.showPrompt.mockResolvedValue('   ');
    await ops.handleLabelVersion('note.md', false);
    expect(h.api.history.labelNotes).not.toHaveBeenCalled();
  });

  it('reports per-note failures in the summary instead of failing the batch', async () => {
    h.dialog.showPrompt.mockResolvedValue('v1');
    h.api.history.labelNotes.mockResolvedValue({
      label: 'v1', labeled: [], errors: [{ path: 'note.md', error: 'ENOENT' }],
    });
    await ops.handleLabelVersion('note.md', false);
    const [msg] = h.dialog.showConfirm.mock.calls.at(-1)!;
    expect(msg).toContain('Labeled 0 of 1 note as "v1"');
    expect(msg).toContain('ENOENT');
  });
});

describe('handleBibliography', () => {
  it('confirms when there is no active note tab', async () => {
    h.editor.activeNoteTab = null;
    await ops.handleBibliography();
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.api.bibliography.generate).not.toHaveBeenCalled();
  });

  it('generates the bibliography for the active tab', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'c', savedContent: 'c' };
    h.api.bibliography.generate.mockResolvedValue({
      entriesCount: 1, changed: true, styleId: 'apa', missingIds: [],
    });
    await ops.handleBibliography();
    expect(h.api.bibliography.generate).toHaveBeenCalledWith('note.md');
  });

  it('saves the unsaved buffer before generating (disk-read generator)', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'edited', savedContent: 'old' };
    h.api.bibliography.generate.mockResolvedValue({
      entriesCount: 0, changed: false, styleId: 'apa', missingIds: [],
    });
    await ops.handleBibliography();
    expect(h.editor.save).toHaveBeenCalled();
    // "No citations found" branch still confirms.
    expect(h.dialog.showConfirm).toHaveBeenCalled();
  });

  it('surfaces the failure dialog when generate throws', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'c', savedContent: 'c' };
    h.api.bibliography.generate.mockRejectedValue(new Error('citeproc blew up'));
    await ops.handleBibliography();
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Bibliography failed');
    expect(msg).toContain('citeproc blew up');
  });
});

describe('handleExtractSelection', () => {
  it('writes the new note + rewritten source and navigates to the extract', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'alpha beta gamma' };
    editorComponent.getSelectionRange.mockReturnValue({ from: 0, to: 5 }); // "alpha" → derived title
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleExtractSelection();
    expect(h.editor.flushAutoSave).toHaveBeenCalled();
    // Two writes: the new note first, then the rewritten source.
    expect(h.api.notebase.writeFile).toHaveBeenCalledTimes(2);
    expect(h.api.notebase.writeFile.mock.calls[0][0]).toBe('alpha.md');
    expect(h.api.notebase.writeFile.mock.calls[1][0]).toBe('note.md');
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
    expect(h.notebase.refresh).toHaveBeenCalled();
    expect(h.editor.openFile).toHaveBeenCalledWith('alpha.md');
    expect(sidebar.refreshTags).toHaveBeenCalled();
  });

  it('does nothing when there is no selection', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'x' };
    editorComponent.getSelectionRange.mockReturnValue(null);
    await ops.handleExtractSelection();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('aborts when the user cancels the title prompt', async () => {
    // Long single line with no heading → deriveProposedTitle returns null → prompt.
    const longLine = 'x'.repeat(80);
    h.editor.activeNoteTab = { relativePath: 'note.md', content: longLine };
    editorComponent.getSelectionRange.mockReturnValue({ from: 0, to: longLine.length });
    h.dialog.showPrompt.mockResolvedValue(null); // cancel
    await ops.handleExtractSelection();
    expect(h.dialog.showPrompt).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleSplitByHeading', () => {
  it('writes one note per heading plus the rewritten source', async () => {
    h.editor.activeNoteTab = {
      relativePath: 'note.md',
      content: '# Title\n\n## First\naaa\n\n## Second\nbbb\n',
    };
    h.dialog.showPrompt.mockResolvedValue('2');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleSplitByHeading();
    expect(h.editor.flushAutoSave).toHaveBeenCalled();
    // 2 new section notes + 1 source rewrite.
    expect(h.api.notebase.writeFile).toHaveBeenCalledTimes(3);
    // The last write is the source note (Contents index).
    expect(h.api.notebase.writeFile.mock.calls.at(-1)?.[0]).toBe('note.md');
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
    expect(h.notebase.refresh).toHaveBeenCalled();
    expect(sidebar.refreshTags).toHaveBeenCalled();
  });

  it('aborts on an invalid heading level', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: '## H\n' };
    h.dialog.showPrompt.mockResolvedValue('9'); // not 1/2/3
    await ops.handleSplitByHeading();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('does nothing when no headings exist at that level', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'no headings here\n' };
    h.dialog.showPrompt.mockResolvedValue('2');
    await ops.handleSplitByHeading();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleSplitHere', () => {
  it('writes the tail note + truncated source and opens the new note', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'head\n\ntail line here' };
    editorComponent.getOffset.mockReturnValue(6); // start of "tail line here"
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleSplitHere();
    expect(h.editor.flushAutoSave).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).toHaveBeenCalledTimes(2);
    expect(h.api.notebase.writeFile.mock.calls[0][0]).toBe('tail-line-here.md');
    expect(h.api.notebase.writeFile.mock.calls[1][0]).toBe('note.md');
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
    expect(h.editor.openFile).toHaveBeenCalledWith('tail-line-here.md');
  });

  it('does nothing when the cursor is at/after EOF', async () => {
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'abc' };
    editorComponent.getOffset.mockReturnValue(999);
    await ops.handleSplitHere();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleAutoLinkInbound', () => {
  it('sets the inbound review state when suggestions are found', async () => {
    h.api.refactor.autoLinkInboundSuggest.mockResolvedValue({ suggestions: [{ anchor: 'a' }] });
    await ops.handleAutoLinkInbound('note.md');
    expect(h.api.refactor.autoLinkInboundSuggest).toHaveBeenCalledWith('note.md');
    expect(flow.autoLinkInboundReview?.relativePath).toBe('note.md');
    expect(flow.autoLinkInboundReview?.suggestions).toHaveLength(1);
    expect(flow.autoLinkBusy).toBe(false);
  });

  it('shows a notice and leaves review null when none found', async () => {
    h.api.refactor.autoLinkInboundSuggest.mockResolvedValue({ suggestions: [] });
    await ops.handleAutoLinkInbound('note.md');
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(flow.autoLinkInboundReview).toBeNull();
  });

  it('routes a missing API key to the ctx handler instead of the failure dialog', async () => {
    h.api.refactor.autoLinkInboundSuggest.mockRejectedValue(new Error('no key'));
    maybeMissing.mockResolvedValue(true);
    await ops.handleAutoLinkInbound('note.md');
    expect(maybeMissing).toHaveBeenCalled();
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
    expect(flow.autoLinkBusy).toBe(false);
  });

  it('shows the failure dialog on a non-key error', async () => {
    h.api.refactor.autoLinkInboundSuggest.mockRejectedValue(new Error('boom'));
    await ops.handleAutoLinkInbound('note.md');
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Auto-link failed');
    expect(msg).toContain('boom');
  });

  it('is a no-op while a suggest is already in flight', async () => {
    flow.setAutoLinkBusy(true);
    await ops.handleAutoLinkInbound('note.md');
    expect(h.api.refactor.autoLinkInboundSuggest).not.toHaveBeenCalled();
  });
});

describe('handleAutoLinkInboundApply', () => {
  it('clears the review and applies the accepted snapshot', async () => {
    flow.setAutoLinkInboundReview({ relativePath: 'note.md', suggestions: [] });
    h.api.refactor.autoLinkInboundApply.mockResolvedValue({ applied: [{}], skipped: [] });
    await ops.handleAutoLinkInboundApply([{ anchor: 'a' }] as never);
    expect(flow.autoLinkInboundReview).toBeNull();
    expect(h.api.refactor.autoLinkInboundApply).toHaveBeenCalledWith('note.md', [{ anchor: 'a' }]);
  });

  it('warns when nothing could be applied (anchors drifted)', async () => {
    flow.setAutoLinkInboundReview({ relativePath: 'note.md', suggestions: [] });
    h.api.refactor.autoLinkInboundApply.mockResolvedValue({ applied: [], skipped: [{}] });
    await ops.handleAutoLinkInboundApply([{ anchor: 'a' }] as never);
    expect(h.dialog.showConfirm).toHaveBeenCalled();
  });

  it('does nothing when there is no pending review', async () => {
    await ops.handleAutoLinkInboundApply([] as never);
    expect(h.api.refactor.autoLinkInboundApply).not.toHaveBeenCalled();
  });
});

describe('handleAutoLinkApply (error / skipped branches)', () => {
  it('warns when every suggestion was skipped', async () => {
    flow.setAutoLinkReview({ relativePath: 'note.md', suggestions: [], activeBody: '' });
    h.api.refactor.autoLinkApply.mockResolvedValue({ applied: [], skipped: [{}] });
    await ops.handleAutoLinkApply([{ anchor: 'a' }] as never);
    expect(h.dialog.showConfirm).toHaveBeenCalled();
  });

  it('surfaces a failure dialog when apply throws', async () => {
    flow.setAutoLinkReview({ relativePath: 'note.md', suggestions: [], activeBody: '' });
    h.api.refactor.autoLinkApply.mockRejectedValue(new Error('nope'));
    await ops.handleAutoLinkApply([{ anchor: 'a' }] as never);
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Auto-link failed');
    expect(msg).toContain('nope');
  });
});

describe('handleAutoLink (error branch)', () => {
  it('shows the failure dialog on a non-key error', async () => {
    h.api.refactor.autoLinkSuggest.mockRejectedValue(new Error('kaboom'));
    await ops.handleAutoLink('note.md');
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Auto-link failed');
    expect(msg).toContain('kaboom');
    expect(flow.autoLinkBusy).toBe(false);
  });
});

describe('handleAutoTag (failure branch)', () => {
  it('shows the failure dialog on a non-key error', async () => {
    h.api.refactor.autoTagSuggest.mockRejectedValue(new Error('rate limit'));
    await ops.handleAutoTag('note.md');
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Auto-tag failed');
    expect(msg).toContain('rate limit');
    expect(flow.autoTagBusy).toBe(false);
  });
});

describe('handleAutoTagApply (failure branch)', () => {
  it('surfaces a failure dialog when apply throws', async () => {
    flow.setAutoTagReview({ relativePath: 'note.md', tags: ['x'] });
    h.api.refactor.autoTagApply.mockRejectedValue(new Error('apply failed'));
    await ops.handleAutoTagApply(['x']);
    expect(flow.autoTagReview).toBeNull();
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Auto-tag failed');
  });
});

describe('handleAddTag (vocab failure)', () => {
  it('aborts with a failure dialog when the tag vocabulary fetch throws', async () => {
    h.api.tags.list.mockRejectedValue(new Error('graph down'));
    await ops.handleAddTag('note.md', false);
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Add Tag failed');
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('collects per-note failures into the summary without aborting', async () => {
    h.notebase.files = [{ relativePath: 'a.md', isDirectory: false }];
    h.api.tags.list.mockResolvedValue([]);
    h.dialog.showPrompt.mockResolvedValue('bar');
    h.api.notebase.readFile.mockRejectedValue(new Error('read fail'));
    await ops.handleAddTag('a.md', false);
    // No write happened, but the summary confirm still runs.
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('tagged 0 of 1');
    expect(msg).toContain('read fail');
  });
});

describe('handleRemoveTag', () => {
  it('removes a tag present on the target and syncs the open tab', async () => {
    h.dialog.showPrompt.mockResolvedValue('foo');
    h.api.notebase.readFile.mockResolvedValue('---\ntags:\n  - foo\n  - bar\n---\nbody');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleRemoveTag('note.md', false);
    expect(h.dialog.showPrompt).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).toHaveBeenCalled();
    expect(h.api.notebase.writeFile.mock.calls[0][0]).toBe('note.md');
    expect(sidebar.refreshTags).toHaveBeenCalled();
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
  });

  it('confirms and writes nothing when the selection has no tags', async () => {
    h.api.notebase.readFile.mockResolvedValue('no frontmatter body');
    await ops.handleRemoveTag('note.md', false);
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('tags to remove');
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('confirms "no .md files" for an empty selection with no fallback', async () => {
    await ops.handleRemoveTag();
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleAddProperty', () => {
  it('upserts the property, writes, and syncs the open tab', async () => {
    h.api.graph.frontmatterKeys.mockResolvedValue(['status', 'tags']);
    h.dialog.showAddPropertyDialog.mockResolvedValue({ name: 'status', value: 'active' });
    h.api.notebase.readFile.mockResolvedValue('body');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleAddProperty('note.md', false);
    // 'tags' is filtered out of the vocab offered to the dialog.
    expect(h.dialog.showAddPropertyDialog).toHaveBeenCalledWith('Add property to 1 note', ['status']);
    expect(h.api.notebase.writeFile).toHaveBeenCalled();
    expect(h.api.notebase.writeFile.mock.calls[0][0]).toBe('note.md');
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
  });

  it('routes a "tags" key to the Add Tag action instead of writing', async () => {
    h.api.graph.frontmatterKeys.mockResolvedValue([]);
    h.dialog.showAddPropertyDialog.mockResolvedValue({ name: 'tags', value: 'x' });
    await ops.handleAddProperty('note.md', false);
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Add Tag');
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is cancelled', async () => {
    h.api.graph.frontmatterKeys.mockResolvedValue([]);
    h.dialog.showAddPropertyDialog.mockResolvedValue(null);
    await ops.handleAddProperty('note.md', false);
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('confirms "no .md files" for an empty selection with no fallback', async () => {
    await ops.handleAddProperty();
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.dialog.showAddPropertyDialog).not.toHaveBeenCalled();
  });
});

describe('handleRemoveProperty', () => {
  it('removes a property present on the target and writes', async () => {
    h.api.notebase.readFile.mockResolvedValue('---\nstatus: active\n---\nbody');
    h.dialog.showPrompt.mockResolvedValue('status');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleRemoveProperty('note.md', false);
    expect(h.dialog.showPrompt).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).toHaveBeenCalled();
    expect(h.api.notebase.writeFile.mock.calls[0][0]).toBe('note.md');
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
  });

  it('confirms and writes nothing when the selection has no properties', async () => {
    h.api.notebase.readFile.mockResolvedValue('plain body no frontmatter');
    await ops.handleRemoveProperty('note.md', false);
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('properties to remove');
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleToggleEntrypoint', () => {
  it('adds the entrypoint tag when absent and refreshes tags', async () => {
    h.api.notebase.readFile.mockResolvedValue('body');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleToggleEntrypoint('note.md', false);
    expect(h.api.notebase.writeFile).toHaveBeenCalled();
    expect(h.api.notebase.writeFile.mock.calls[0][0]).toBe('note.md');
    // The written content carries the entrypoint tag.
    expect(h.api.notebase.writeFile.mock.calls[0][1]).toContain('entrypoint');
    expect(sidebar.refreshTags).toHaveBeenCalled();
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('note.md');
  });

  it('removes the entrypoint tag when already present', async () => {
    h.api.notebase.readFile.mockResolvedValue('---\ntags:\n  - entrypoint\n---\nbody');
    h.api.notebase.writeFile.mockResolvedValue(undefined);
    await ops.handleToggleEntrypoint('note.md', true);
    expect(h.api.notebase.writeFile).toHaveBeenCalled();
    // Removing the sole tag drops the frontmatter entirely.
    expect(h.api.notebase.writeFile.mock.calls[0][1]).not.toContain('entrypoint');
  });

  it('surfaces a failure dialog when the read throws', async () => {
    h.api.notebase.readFile.mockRejectedValue(new Error('io error'));
    await ops.handleToggleEntrypoint('note.md', false);
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Toggle entrypoint failed');
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleFormat', () => {
  it('bulk-formats the sidebar selection via formatFile and reports the summary', async () => {
    h.notebase.files = [{ relativePath: 'a.md', isDirectory: false }];
    sidebar.getSelectionPaths.mockReturnValue(['a.md']);
    h.api.formatter.formatFile.mockResolvedValue({ changed: true });
    await ops.handleFormat();
    expect(h.api.formatter.formatFile).toHaveBeenCalledWith('a.md', expect.anything());
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Formatting complete');
    expect(msg).toContain('Changed 1 of 1');
  });

  it('confirms when the selection resolves to no .md files', async () => {
    h.notebase.files = [{ relativePath: 'a.csv', isDirectory: false }];
    sidebar.getSelectionPaths.mockReturnValue(['a.csv']);
    await ops.handleFormat();
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('no .md files to format');
    expect(h.api.formatter.formatFile).not.toHaveBeenCalled();
  });

  it('falls back to formatting the active tab in-buffer when nothing is selected', async () => {
    sidebar.getSelectionPaths.mockReturnValue([]);
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'raw' };
    h.api.formatter.formatContent.mockResolvedValue('formatted');
    await ops.handleFormat();
    expect(h.api.formatter.formatContent).toHaveBeenCalledWith('raw', expect.anything(), 'note.md');
    expect(h.editor.setContent).toHaveBeenCalledWith('formatted');
  });

  it('leaves the buffer untouched when the formatter returns identical content', async () => {
    sidebar.getSelectionPaths.mockReturnValue([]);
    h.editor.activeNoteTab = { relativePath: 'note.md', content: 'same' };
    h.api.formatter.formatContent.mockResolvedValue('same');
    await ops.handleFormat();
    expect(h.editor.setContent).not.toHaveBeenCalled();
  });

  it('confirms when there is neither a selection nor an active tab', async () => {
    sidebar.getSelectionPaths.mockReturnValue([]);
    h.editor.activeNoteTab = null;
    await ops.handleFormat();
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Open a note');
    expect(h.api.formatter.formatContent).not.toHaveBeenCalled();
  });

  it('surfaces a failure dialog when the bulk formatter throws', async () => {
    h.notebase.files = [{ relativePath: 'a.md', isDirectory: false }];
    sidebar.getSelectionPaths.mockReturnValue(['a.md']);
    h.api.formatter.formatFile.mockRejectedValue(new Error('fmt error'));
    await ops.handleFormat();
    const msg = h.dialog.showConfirm.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Formatting failed');
    expect(msg).toContain('fmt error');
  });
});
