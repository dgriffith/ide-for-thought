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
      autoTag: vi.fn(),
      autoLinkSuggest: vi.fn(),
      autoLinkInboundSuggest: vi.fn(),
      autoLinkApply: vi.fn(),
      autoLinkInboundApply: vi.fn(),
    },
    notebase: { readFile: vi.fn(), writeFile: vi.fn() },
    tags: { list: vi.fn() },
    formatter: { formatFile: vi.fn(), formatContent: vi.fn() },
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
  const dialog = { showPrompt: vi.fn(), showConfirm: vi.fn() };
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
}

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.notebase.files = [];
  h.editor.activeNoteTab = null;
  h.editor.activeTab = null;
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

describe('handleAutoTag', () => {
  it('calls api.refactor.autoTag on the success path', async () => {
    h.api.refactor.autoTag.mockResolvedValue({ added: ['x'] });
    await ops.handleAutoTag('note.md');
    expect(h.api.refactor.autoTag).toHaveBeenCalledWith('note.md');
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
  });

  it('shows a notice when nothing was added', async () => {
    h.api.refactor.autoTag.mockResolvedValue({ added: [] });
    await ops.handleAutoTag('note.md');
    expect(h.dialog.showConfirm).toHaveBeenCalled();
  });

  it('skips the failure dialog when the error is a missing API key', async () => {
    h.api.refactor.autoTag.mockRejectedValue(new Error('no key'));
    maybeMissing.mockResolvedValue(true);
    await ops.handleAutoTag('note.md');
    expect(maybeMissing).toHaveBeenCalled();
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
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
});
