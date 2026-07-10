/**
 * Behavioral net for the note-ops handlers extracted from App.svelte (#670).
 * Mocks the api client + notebase/editor/dialog stores; uses the real
 * busy/clipboard runes stores. Verifies the moved handler bodies, not just
 * that the command palette / keymap reach them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NoteFile } from '../../../src/shared/types';

const h = vi.hoisted(() => {
  const api = {
    notebase: {
      createFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), copy: vi.fn(),
      deleteFile: vi.fn(), deleteFolder: vi.fn(), createFolder: vi.fn(),
      readFile: vi.fn(), mergePreview: vi.fn(), merge: vi.fn(),
    },
    links: { externalInbound: vi.fn() },
    templates: { get: vi.fn() },
  };
  const notebase = { meta: { rootPath: '/p', name: 'p' } as unknown, files: [] as NoteFile[], refresh: vi.fn() };
  const editor = { openFile: vi.fn(), tabs: [] as unknown[], closeTabsForDeletedPath: vi.fn(), flushAutoSave: vi.fn() };
  const dialog = {
    showPrompt: vi.fn(), showConfirm: vi.fn(), showNewNoteDialog: vi.fn(), showSnippetPicker: vi.fn(),
  };
  return { api, notebase, editor, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));

import { createNoteOps, type NoteOpsCtx } from '../../../src/renderer/lib/app/note-ops';
import { getClipboardStore } from '../../../src/renderer/lib/stores/clipboard.svelte';

function dir(name: string, children: NoteFile[]): NoteFile {
  return { name, relativePath: name, isDirectory: true, children };
}
function file(relativePath: string): NoteFile {
  return { name: relativePath.split('/').pop()!, relativePath, isDirectory: false };
}

const sidebar = { getSelectionPaths: vi.fn(() => [] as string[]), refreshTags: vi.fn(), clearSelection: vi.fn() };
let ctx: NoteOpsCtx;
let ops: ReturnType<typeof createNoteOps>;

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.notebase.files = [];
  h.editor.tabs = [];
  sidebar.getSelectionPaths.mockReturnValue([]);
  getClipboardStore().clear();
  ctx = {
    getSidebar: () => sidebar,
    getEditorComponent: () => undefined,
    setSafeDeleteState: vi.fn(),
    setMergePickerSource: vi.fn(),
  };
  ops = createNoteOps(ctx);
});

describe('handleRename', () => {
  it('preserves the original extension when the user omits one', async () => {
    h.dialog.showPrompt.mockResolvedValue('renamed');
    await ops.handleRename('notes/foo.md');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('notes/foo.md', 'notes/renamed.md');
    expect(h.notebase.refresh).toHaveBeenCalled();
  });

  it('respects an explicit extension the user types', async () => {
    h.dialog.showPrompt.mockResolvedValue('renamed.ttl');
    await ops.handleRename('foo.md');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('foo.md', 'renamed.ttl');
  });

  it('does nothing on cancel or an unchanged name', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleRename('foo.md');
    h.dialog.showPrompt.mockResolvedValue('foo.md');
    await ops.handleRename('foo.md');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
  });

  it('seeds the prompt with the current name and selects the stem (#1143)', async () => {
    h.dialog.showPrompt.mockResolvedValue('renamed');
    await ops.handleRename('notes/foo.md');
    expect(h.dialog.showPrompt).toHaveBeenCalledWith('New name:', {
      initial: 'foo.md',
      selectStem: true,
    });
  });
});

describe('handleNewNote', () => {
  it('creates the file in the target directory and opens it', async () => {
    h.dialog.showNewNoteDialog.mockResolvedValue({ name: 'fresh', ext: '.md' });
    await ops.handleNewNote('folder');
    expect(h.api.notebase.createFile).toHaveBeenCalledWith('folder/fresh.md');
    expect(h.notebase.refresh).toHaveBeenCalled();
    expect(h.editor.openFile).toHaveBeenCalledWith('folder/fresh.md');
    expect(sidebar.refreshTags).toHaveBeenCalled();
  });

  it('does nothing when the dialog is cancelled', async () => {
    h.dialog.showNewNoteDialog.mockResolvedValue(null);
    await ops.handleNewNote();
    expect(h.api.notebase.createFile).not.toHaveBeenCalled();
  });
});

describe('handleDelete', () => {
  it('confirms then deletes when there are no inbound-link blockers', async () => {
    h.dialog.showConfirm.mockResolvedValue(true);
    await ops.handleDelete('notes/x.md', false);
    expect(ctx.setSafeDeleteState).not.toHaveBeenCalled();
    expect(h.api.notebase.deleteFile).toHaveBeenCalledWith('notes/x.md');
    expect(h.editor.closeTabsForDeletedPath).toHaveBeenCalledWith('notes/x.md');
    expect(h.notebase.refresh).toHaveBeenCalled();
  });

  it('does not delete when the user cancels the confirm', async () => {
    h.dialog.showConfirm.mockResolvedValue(false);
    await ops.handleDelete('notes/x.md', false);
    expect(h.api.notebase.deleteFile).not.toHaveBeenCalled();
  });

  it('shows the safe-delete blocker dialog instead of deleting when external links exist', async () => {
    h.notebase.files = [dir('notes', [file('notes/x.md')])];
    sidebar.getSelectionPaths.mockReturnValue(['notes/x.md']);
    h.api.links.externalInbound.mockResolvedValue([
      { source: 'notes/y.md', target: 'notes/x.md', occurrences: 1 },
    ]);
    await ops.handleDelete('notes/x.md', false);
    expect(ctx.setSafeDeleteState).toHaveBeenCalledTimes(1);
    expect(h.api.notebase.deleteFile).not.toHaveBeenCalled();
    expect(h.dialog.showConfirm).not.toHaveBeenCalled();
  });
});

describe('handlePaste', () => {
  it('cut: renames each item into the destination and clears the clipboard', async () => {
    getClipboardStore().set({ items: [{ relativePath: 'a.md', isDirectory: false }], mode: 'cut' });
    await ops.handlePaste('dest');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('a.md', 'dest/a.md');
    expect(getClipboardStore().current).toBeNull();
  });

  it('copy: copies each item and leaves the clipboard intact', async () => {
    getClipboardStore().set({ items: [{ relativePath: 'a.md', isDirectory: false }], mode: 'copy' });
    await ops.handlePaste('dest');
    expect(h.api.notebase.copy).toHaveBeenCalledWith('a.md', 'dest/a.md');
    expect(getClipboardStore().current).not.toBeNull();
  });

  it('does nothing with an empty clipboard', async () => {
    await ops.handlePaste('dest');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
    expect(h.api.notebase.copy).not.toHaveBeenCalled();
  });
});

describe('handleCopyWithPrompt', () => {
  it('copies to the prompted name (extension preserved) when no collision', async () => {
    h.dialog.showPrompt.mockResolvedValue('dup');
    h.api.notebase.readFile.mockRejectedValue(new Error('ENOENT')); // dest does not exist
    await ops.handleCopyWithPrompt('a.md');
    expect(h.api.notebase.copy).toHaveBeenCalledWith('a.md', 'dup.md');
  });

  it('aborts with a notice when the destination already exists', async () => {
    h.dialog.showPrompt.mockResolvedValue('dup');
    h.api.notebase.readFile.mockResolvedValue('existing content'); // dest exists → collision
    await ops.handleCopyWithPrompt('a.md');
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.api.notebase.copy).not.toHaveBeenCalled();
  });
});
