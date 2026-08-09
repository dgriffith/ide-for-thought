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
    types: { list: vi.fn() },
  };
  const notebase = { meta: { rootPath: '/p', name: 'p' } as unknown, files: [] as NoteFile[], refresh: vi.fn() };
  const editor = {
    openFile: vi.fn(), tabs: [] as unknown[], closeTabsForDeletedPath: vi.fn(), flushAutoSave: vi.fn(),
    activeFilePath: 'Note.md' as string | null, activeTab: { type: 'note' } as { type: string } | null,
    content: '', setContent: vi.fn(),
    applyRenameTransitions: vi.fn(),
    viewMode: 'source' as string, setViewMode: vi.fn(),
  };
  const dialog = {
    showPrompt: vi.fn(), showConfirm: vi.fn(), showNewNoteDialog: vi.fn(), showSnippetPicker: vi.fn(),
    showTypePicker: vi.fn(),
  };
  return { api, notebase, editor, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));

import { createNoteOps, type NoteOpsCtx } from '../../../src/renderer/lib/app/note-ops';
import { getNavigationStore } from '../../../src/renderer/lib/stores/navigation.svelte';
import { getClipboardStore } from '../../../src/renderer/lib/stores/clipboard.svelte';
import { CONFIRM_KEYS } from '../../../src/renderer/lib/confirm-keys';

function dir(name: string, children: NoteFile[]): NoteFile {
  return { name, relativePath: name, isDirectory: true, children };
}
function file(relativePath: string): NoteFile {
  return { name: relativePath.split('/').pop()!, relativePath, isDirectory: false };
}

const sidebar = { getSelectionPaths: vi.fn(() => [] as string[]), refreshTags: vi.fn(), clearSelection: vi.fn() };
const editorComp = { restorePosition: vi.fn(), gotoLineColumn: vi.fn(), getOffset: vi.fn(() => 0), focus: vi.fn() };
let editorCompRef: typeof editorComp | undefined;
let ctx: NoteOpsCtx;
let ops: ReturnType<typeof createNoteOps>;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): several tests install one-shot
  // mockRejectedValue/mockResolvedValue implementations that would otherwise
  // leak into later tests (clearAllMocks resets call history but not impls).
  vi.resetAllMocks();
  // Run requestAnimationFrame callbacks synchronously so the caret-restore /
  // goto-line side effects (restorePosition / gotoLineColumn) are observable
  // immediately after the awaited handler resolves.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.notebase.files = [];
  h.editor.tabs = [];
  h.editor.activeFilePath = 'Note.md';
  h.editor.activeTab = { type: 'note' };
  h.editor.viewMode = 'source';
  sidebar.getSelectionPaths.mockReturnValue([]);
  editorCompRef = undefined;
  getClipboardStore().clear();
  ctx = {
    getSidebar: () => sidebar,
    getEditorComponent: () => editorCompRef,
    setSafeDeleteState: vi.fn(),
    setMergePickerSource: vi.fn(),
    openTypeFields: vi.fn(),
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

describe('handleNewNote — the caret lands in the editor (#1561)', () => {
  beforeEach(() => {
    editorCompRef = editorComp;
    h.dialog.showNewNoteDialog.mockResolvedValue({ name: 'fresh', ext: '.md' });
  });

  it('focuses the editor so a plain new note is typeable without clicking', async () => {
    await ops.handleNewNote('folder');
    expect(editorComp.focus).toHaveBeenCalled();
    // Nothing to restore on an empty note — no caret dispatch.
    expect(editorComp.restorePosition).not.toHaveBeenCalled();
  });

  it('gives a preview-only pane an editor to focus, keeping the reading pane', async () => {
    h.editor.viewMode = 'preview';
    await ops.handleNewNote('folder');
    expect(h.editor.setViewMode).toHaveBeenCalledWith('editor-preview');
    expect(editorComp.focus).toHaveBeenCalled();
  });

  it('leaves the view mode alone when the pane already has an editor', async () => {
    for (const mode of ['source', 'editor-preview']) {
      h.editor.viewMode = mode;
      await ops.handleNewNote('folder');
      expect(h.editor.setViewMode).not.toHaveBeenCalled();
    }
  });

  it('lets a template caret win over a bare focus', async () => {
    h.dialog.showNewNoteDialog.mockResolvedValue({ name: 'fresh', ext: '.md', templateFilename: 'daily.md' });
    h.api.templates.get.mockResolvedValue('Hello {{title}}{{cursor}} world');
    await ops.handleNewNote('folder');
    // restorePosition focuses as part of placing the caret.
    expect(editorComp.restorePosition).toHaveBeenCalledWith(11, 0);
    expect(editorComp.focus).not.toHaveBeenCalled();
  });

  it('survives a pane with no editor mounted', async () => {
    editorCompRef = undefined;
    await expect(ops.handleNewNote('folder')).resolves.toBeUndefined();
  });

  it('focuses the editor for the broken-link quick-fix too (#1446 create-from-reference)', async () => {
    await ops.createNoteFromReference('folder/Missing.md');
    expect(h.api.notebase.createFile).toHaveBeenCalledWith('folder/Missing.md');
    expect(editorComp.focus).toHaveBeenCalled();
  });
});

describe('createNoteFromReference — nav history (#1446)', () => {
  it('records the referencing note so Back returns to it after opening the new note', async () => {
    const nav = getNavigationStore();
    nav.clear();
    nav.doneNavigating();
    h.editor.activeFilePath = 'topic/Referrer.md';
    (h.editor as unknown as { activeTab: { type: string } }).activeTab = { type: 'note' };
    h.notebase.files = []; // target doesn't exist yet → gets created

    await ops.createNoteFromReference('topic/New.md');

    expect(h.api.notebase.createFile).toHaveBeenCalledWith('topic/New.md');
    expect(h.editor.openFile).toHaveBeenCalledWith('topic/New.md');
    // The referencing note is on the back stack, so Back returns to it — the
    // bug was that createNoteFromReference bypassed nav recording entirely.
    expect(nav.goBack()).toEqual({ type: 'note', relativePath: 'topic/Referrer.md', offset: 0 });
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

  it('treats a path-like input (dir/name) as project-root relative', async () => {
    h.dialog.showPrompt.mockResolvedValue('sub/dup');
    h.api.notebase.readFile.mockRejectedValue(new Error('ENOENT'));
    await ops.handleCopyWithPrompt('notes/a.md');
    // extension preserved on the last segment; leading dir is project-root
    expect(h.api.notebase.copy).toHaveBeenCalledWith('notes/a.md', 'sub/dup.md');
  });

  it('does nothing on cancel or when no thoughtbase is open', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleCopyWithPrompt('a.md');
    expect(h.api.notebase.copy).not.toHaveBeenCalled();

    h.dialog.showPrompt.mockClear();
    h.notebase.meta = null;
    h.dialog.showPrompt.mockResolvedValue('dup');
    await ops.handleCopyWithPrompt('a.md');
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
    expect(h.api.notebase.copy).not.toHaveBeenCalled();
  });
});

describe('handleNewNote — template & guard paths', () => {
  it('bails out when no thoughtbase is open', async () => {
    h.notebase.meta = null;
    await ops.handleNewNote('folder');
    expect(h.dialog.showNewNoteDialog).not.toHaveBeenCalled();
    expect(h.api.notebase.createFile).not.toHaveBeenCalled();
  });

  it('writes the substituted template body and restores the caret offset', async () => {
    editorCompRef = editorComp;
    h.dialog.showNewNoteDialog.mockResolvedValue({ name: 'fresh', ext: '.md', templateFilename: 'daily.md' });
    h.api.templates.get.mockResolvedValue('Hello {{title}}{{cursor}} world');
    await ops.handleNewNote('folder');
    // Non-empty content routes through writeFile, not createFile.
    expect(h.api.notebase.writeFile).toHaveBeenCalledWith('folder/fresh.md', 'Hello fresh world');
    expect(h.api.notebase.createFile).not.toHaveBeenCalled();
    expect(h.editor.openFile).toHaveBeenCalledWith('folder/fresh.md');
    // {{cursor}} sits right after "Hello fresh" → offset 11.
    expect(editorComp.restorePosition).toHaveBeenCalledWith(11, 0);
  });

  it('creates a note *as* a type — type: frontmatter + property scaffold + template body (#1064)', async () => {
    h.dialog.showNewNoteDialog.mockResolvedValue({
      name: 'Dune', ext: '.md', templateFilename: null,
      type: {
        id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock',
        template: '## Summary',
        properties: [{ name: 'author', type: 'text' }, { name: 'rating', type: 'number' }],
      },
    });
    await ops.handleNewNote('');
    const [pathArg, contentArg] = h.api.notebase.writeFile.mock.calls[0] as [string, string];
    expect(pathArg).toBe('Dune.md');
    expect(contentArg).toMatch(/^---\ntype: book\nauthor:\nrating:\n---/);
    expect(contentArg).toContain('## Summary');
    expect(h.api.notebase.createFile).not.toHaveBeenCalled();
    expect(h.api.templates.get).not.toHaveBeenCalled(); // type template, not a file template
  });

  it('cancels silently (no write) when an interactive {{prompt:…}} is dismissed', async () => {
    h.dialog.showNewNoteDialog.mockResolvedValue({ name: 'fresh', ext: '.md', templateFilename: 'daily.md' });
    h.api.templates.get.mockResolvedValue('a{{prompt:Label}}b');
    h.dialog.showPrompt.mockResolvedValue(null); // user cancels the template prompt
    await ops.handleNewNote();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
    expect(h.api.notebase.createFile).not.toHaveBeenCalled();
    expect(h.editor.openFile).not.toHaveBeenCalled();
  });

  it('falls back to createFile when the template file is missing', async () => {
    h.dialog.showNewNoteDialog.mockResolvedValue({ name: 'fresh', ext: '.md', templateFilename: 'gone.md' });
    h.api.templates.get.mockResolvedValue(null); // template not found
    await ops.handleNewNote('');
    expect(h.api.notebase.createFile).toHaveBeenCalledWith('fresh.md');
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleInlineTypeCreate (#1065)', () => {
  const book = {
    id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock' as const,
    template: '## Summary',
    properties: [{ name: 'author', type: 'text' as const }],
  };

  it('creates a typed note and returns its wiki-link target', async () => {
    h.notebase.files = [];
    h.dialog.showPrompt.mockResolvedValue('Ada Lovelace');
    const target = await ops.handleInlineTypeCreate(book);
    expect(target).toBe('Ada Lovelace');
    const [p, c] = h.api.notebase.writeFile.mock.calls[0] as [string, string];
    expect(p).toBe('Ada Lovelace.md');
    expect(c).toMatch(/^---\ntype: book\nauthor:\n---/);
    expect(c).toContain('## Summary');
  });

  it('links an existing note instead of duplicating', async () => {
    h.notebase.files = [file('Ada Lovelace.md')];
    h.dialog.showPrompt.mockResolvedValue('Ada Lovelace');
    const target = await ops.handleInlineTypeCreate(book);
    expect(target).toBe('Ada Lovelace'); // resolves to the existing note
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('returns null (no write) when the title prompt is cancelled', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    expect(await ops.handleInlineTypeCreate(book)).toBeNull();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handlePromoteToType (#1067)', () => {
  const book = { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock' as const, properties: [] };

  it('sets type: on the active note (body + keys intact) and opens the Fields form', async () => {
    h.editor.activeFilePath = 'Note.md';
    h.editor.content = '---\ntitle: Existing\n---\n# Body\n';
    h.api.types.list.mockResolvedValue({ types: [book], errors: [] });
    h.dialog.showTypePicker.mockResolvedValue(book);
    await ops.handlePromoteToType();
    const [text] = h.editor.setContent.mock.calls[0] as [string];
    expect(text).toContain('type: book');
    expect(text).toContain('title: Existing'); // existing frontmatter untouched
    expect(text).toContain('# Body');
    expect(ctx.openTypeFields).toHaveBeenCalled();
  });

  it('is a no-op when the picker is cancelled', async () => {
    h.editor.activeFilePath = 'Note.md';
    h.editor.content = '# Body\n';
    h.api.types.list.mockResolvedValue({ types: [book], errors: [] });
    h.dialog.showTypePicker.mockResolvedValue(null);
    await ops.handlePromoteToType();
    expect(h.editor.setContent).not.toHaveBeenCalled();
    expect(ctx.openTypeFields).not.toHaveBeenCalled();
  });

  it('bails when no note is active', async () => {
    h.editor.activeFilePath = null;
    await ops.handlePromoteToType();
    expect(h.dialog.showTypePicker).not.toHaveBeenCalled();
  });
});

describe('handleNewFolder', () => {
  it('creates the folder under the target directory', async () => {
    h.dialog.showPrompt.mockResolvedValue('Ideas');
    await ops.handleNewFolder('notes');
    expect(h.api.notebase.createFolder).toHaveBeenCalledWith('notes/Ideas');
    expect(h.notebase.refresh).toHaveBeenCalled();
  });

  it('creates at the root when no directory is passed', async () => {
    h.dialog.showPrompt.mockResolvedValue('Ideas');
    await ops.handleNewFolder();
    expect(h.api.notebase.createFolder).toHaveBeenCalledWith('Ideas');
  });

  it('does nothing on cancel or without a thoughtbase', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleNewFolder('notes');
    expect(h.api.notebase.createFolder).not.toHaveBeenCalled();

    h.notebase.meta = null;
    h.dialog.showPrompt.mockResolvedValue('Ideas');
    await ops.handleNewFolder('notes');
    expect(h.api.notebase.createFolder).not.toHaveBeenCalled();
  });
});

describe('handleDelete / executeDeletes — folders, multi-select, failures', () => {
  it('routes a directory target through deleteFolder', async () => {
    h.dialog.showConfirm.mockResolvedValue(true);
    await ops.handleDelete('archive', true);
    expect(h.api.notebase.deleteFolder).toHaveBeenCalledWith('archive');
    expect(h.api.notebase.deleteFile).not.toHaveBeenCalled();
    expect(sidebar.clearSelection).toHaveBeenCalled();
  });

  it('deletes every resolved selection target', async () => {
    h.notebase.files = [dir('notes', [file('notes/a.md'), file('notes/b.md')])];
    sidebar.getSelectionPaths.mockReturnValue(['notes/a.md', 'notes/b.md']);
    h.api.links.externalInbound.mockResolvedValue([]); // no blockers
    h.dialog.showConfirm.mockResolvedValue(true);
    await ops.handleDelete('notes/a.md', false);
    expect(h.api.notebase.deleteFile).toHaveBeenCalledWith('notes/a.md');
    expect(h.api.notebase.deleteFile).toHaveBeenCalledWith('notes/b.md');
  });

  it('fails open (deletes) when the inbound-link probe throws', async () => {
    h.notebase.files = [dir('notes', [file('notes/x.md')])];
    sidebar.getSelectionPaths.mockReturnValue(['notes/x.md']);
    h.api.links.externalInbound.mockRejectedValue(new Error('graph down'));
    h.dialog.showConfirm.mockResolvedValue(true);
    await ops.handleDelete('notes/x.md', false);
    expect(ctx.setSafeDeleteState).not.toHaveBeenCalled();
    expect(h.api.notebase.deleteFile).toHaveBeenCalledWith('notes/x.md');
  });

  it('reports a summary dialog when a delete fails mid-batch', async () => {
    h.dialog.showConfirm.mockResolvedValue(true);
    h.api.notebase.deleteFile.mockRejectedValueOnce(new Error('EBUSY'));
    await ops.handleDelete('notes/locked.md', false);
    // First showConfirm = delete confirmation; second = the failure summary.
    expect(h.dialog.showConfirm).toHaveBeenLastCalledWith(
      expect.stringContaining('EBUSY'),
      CONFIRM_KEYS.deletePartialFailure,
      'OK',
    );
    expect(h.notebase.refresh).toHaveBeenCalled();
  });

  it('bails out without a thoughtbase', async () => {
    h.notebase.meta = null;
    await ops.handleDelete('x.md', false);
    expect(h.api.notebase.deleteFile).not.toHaveBeenCalled();
  });
});

describe('openFirstReferenceFromSafeDelete', () => {
  it('clears the safe-delete state, opens the source, and jumps to the link site', async () => {
    editorCompRef = editorComp;
    h.api.notebase.readFile.mockResolvedValue('line one\nsee [[x]] here');
    await ops.openFirstReferenceFromSafeDelete('notes/y.md', 'notes/x.md');
    expect(ctx.setSafeDeleteState).toHaveBeenCalledWith(null);
    expect(h.editor.openFile).toHaveBeenCalledWith('notes/y.md');
    // "[[x]]" starts at column 5 of line 2 → gotoLineColumn(2, col+1).
    expect(editorComp.gotoLineColumn).toHaveBeenCalledWith(2, 5);
  });

  it('still opens the source (offset 0) when the reference read fails', async () => {
    editorCompRef = editorComp;
    h.api.notebase.readFile.mockRejectedValue(new Error('gone'));
    await ops.openFirstReferenceFromSafeDelete('notes/y.md', 'notes/x.md');
    expect(h.editor.openFile).toHaveBeenCalledWith('notes/y.md');
    expect(editorComp.gotoLineColumn).not.toHaveBeenCalled();
  });

  it('records nav history so Back returns to where the user was (#1446)', async () => {
    const nav = getNavigationStore();
    nav.clear(); nav.doneNavigating();
    h.editor.activeFilePath = 'notes/current.md';
    h.api.notebase.readFile.mockResolvedValue('see [[x]]');
    await ops.openFirstReferenceFromSafeDelete('notes/y.md', 'notes/x.md');
    expect(nav.goBack()).toEqual({ type: 'note', relativePath: 'notes/current.md', offset: 0 });
  });
});

describe('handleCut / handleCopy', () => {
  it('cut captures the fallback item when nothing is selected', () => {
    ops.handleCut('a.md', false);
    expect(getClipboardStore().current).toEqual({
      items: [{ relativePath: 'a.md', isDirectory: false }],
      mode: 'cut',
    });
  });

  it('cut captures the resolved sidebar selection when present', () => {
    h.notebase.files = [dir('notes', [file('notes/a.md'), file('notes/b.md')])];
    sidebar.getSelectionPaths.mockReturnValue(['notes/a.md', 'notes/b.md']);
    ops.handleCut('notes/a.md', false);
    expect(getClipboardStore().current?.mode).toBe('cut');
    expect(getClipboardStore().current?.items).toEqual([
      { relativePath: 'notes/a.md', isDirectory: false },
      { relativePath: 'notes/b.md', isDirectory: false },
    ]);
  });

  it('copy sets copy mode on the clipboard', () => {
    ops.handleCopy('a.md', false);
    expect(getClipboardStore().current?.mode).toBe('copy');
  });
});

describe('handleMove (drag-move)', () => {
  it('moves a single dragged file and retargets its open tab via the store', async () => {
    h.notebase.files = [file('a.md')];
    await ops.handleMove('a.md', 'dest');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('a.md', 'dest/a.md');
    // Retarget goes through the store (fixes unsupported-file ext + re-persists
    // the session), not a direct editor.tabs mutation (#1595).
    expect(h.editor.applyRenameTransitions).toHaveBeenCalledWith([{ old: 'a.md', new: 'dest/a.md' }]);
    expect(sidebar.clearSelection).toHaveBeenCalled();
  });

  it('moves the whole selection when the dragged path is part of a multi-selection', async () => {
    h.notebase.files = [file('a.md'), file('b.md')];
    sidebar.getSelectionPaths.mockReturnValue(['a.md', 'b.md']);
    await ops.handleMove('a.md', 'dest');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('a.md', 'dest/a.md');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('b.md', 'dest/b.md');
  });

  it('skips a same-directory no-op move', async () => {
    h.notebase.files = [dir('dir', [file('dir/a.md')])];
    await ops.handleMove('dir/a.md', 'dir');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
    expect(h.notebase.refresh).toHaveBeenCalled();
  });

  it('collects a collision and surfaces the summary dialog', async () => {
    h.notebase.files = [file('a.md'), dir('dest', [file('dest/a.md')])];
    await ops.handleMove('a.md', 'dest');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('Move complete'),
      CONFIRM_KEYS.moveCollision,
      'OK',
    );
  });

  it('reports a failure summary when the rename rejects', async () => {
    h.notebase.files = [file('a.md')];
    h.api.notebase.rename.mockRejectedValue(new Error('EPERM'));
    await ops.handleMove('a.md', 'dest');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('EPERM'),
      CONFIRM_KEYS.moveCollision,
      'OK',
    );
  });

  it('does nothing when the dragged path is not in the tree', async () => {
    h.notebase.files = [];
    await ops.handleMove('ghost.md', 'dest');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
  });

  it('bails out without a thoughtbase', async () => {
    h.notebase.meta = null;
    await ops.handleMove('a.md', 'dest');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
  });
});

describe('handlePaste — collisions, failures, tab retarget', () => {
  it('cut+paste retargets an open tab for the moved item via the store', async () => {
    getClipboardStore().set({ items: [{ relativePath: 'a.md', isDirectory: false }], mode: 'cut' });
    await ops.handlePaste('dest');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('a.md', 'dest/a.md');
    // Retarget goes through the store, not a direct editor.tabs mutation (#1595).
    expect(h.editor.applyRenameTransitions).toHaveBeenCalledWith([{ old: 'a.md', new: 'dest/a.md' }]);
  });

  it('skips a collision and reports the Copy summary', async () => {
    h.notebase.files = [dir('dest', [file('dest/a.md')])];
    getClipboardStore().set({ items: [{ relativePath: 'a.md', isDirectory: false }], mode: 'copy' });
    await ops.handlePaste('dest');
    expect(h.api.notebase.copy).not.toHaveBeenCalled();
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('Copy complete'),
      CONFIRM_KEYS.copyCollision,
      'OK',
    );
  });

  it('reports a per-item failure summary', async () => {
    h.api.notebase.copy.mockRejectedValue(new Error('ENOSPC'));
    getClipboardStore().set({ items: [{ relativePath: 'a.md', isDirectory: false }], mode: 'copy' });
    await ops.handlePaste('dest');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('ENOSPC'),
      CONFIRM_KEYS.copyCollision,
      'OK',
    );
  });

  it('skips a same-directory no-op paste target', async () => {
    getClipboardStore().set({ items: [{ relativePath: 'dir/a.md', isDirectory: false }], mode: 'copy' });
    await ops.handlePaste('dir');
    expect(h.api.notebase.copy).not.toHaveBeenCalled();
  });
});

describe('handleMerge / performMerge', () => {
  it('handleMerge flushes autosave and opens the merge picker', () => {
    ops.handleMerge('notes/a.md');
    expect(h.editor.flushAutoSave).toHaveBeenCalled();
    expect(ctx.setMergePickerSource).toHaveBeenCalledWith('notes/a.md');
  });

  it('handleMerge is a no-op without a thoughtbase', () => {
    h.notebase.meta = null;
    ops.handleMerge('notes/a.md');
    expect(ctx.setMergePickerSource).not.toHaveBeenCalled();
  });

  it('performMerge returns early when source === target', async () => {
    await ops.performMerge('a.md', 'a.md');
    expect(h.api.notebase.mergePreview).not.toHaveBeenCalled();
    expect(h.api.notebase.merge).not.toHaveBeenCalled();
  });

  it('performMerge previews, confirms, merges, and jumps to the merge point', async () => {
    editorCompRef = editorComp;
    h.api.notebase.mergePreview.mockResolvedValue({ linkOccurrences: 2, affectedFiles: 1 });
    h.dialog.showConfirm.mockResolvedValue(true);
    h.api.notebase.merge.mockResolvedValue({ targetPath: 'notes/target.md', mergeLine: 12 });
    await ops.performMerge('notes/src.md', 'notes/target.md');
    expect(h.api.notebase.mergePreview).toHaveBeenCalledWith('notes/src.md', 'notes/target.md');
    expect(h.api.notebase.merge).toHaveBeenCalledWith('notes/src.md', 'notes/target.md');
    expect(h.editor.openFile).toHaveBeenCalledWith('notes/target.md');
    expect(editorComp.gotoLineColumn).toHaveBeenCalledWith(12, 1);
    expect(h.notebase.refresh).toHaveBeenCalled();
  });

  it('performMerge records nav history, but never Back to the deleted source (#1446)', async () => {
    const nav = getNavigationStore();
    h.api.notebase.mergePreview.mockResolvedValue({ linkOccurrences: 0, affectedFiles: 0 });
    h.dialog.showConfirm.mockResolvedValue(true);
    h.api.notebase.merge.mockResolvedValue({ targetPath: 'notes/target.md', mergeLine: 1 });

    // From an unrelated note → Back returns to it.
    nav.clear(); nav.doneNavigating();
    h.editor.activeFilePath = 'notes/elsewhere.md';
    await ops.performMerge('notes/src.md', 'notes/target.md');
    expect(nav.goBack()).toEqual({ type: 'note', relativePath: 'notes/elsewhere.md', offset: 0 });

    // From the source being merged (deleted) → its from-position is NOT recorded,
    // so Back has no dead-note entry to land on.
    nav.clear(); nav.doneNavigating();
    h.editor.activeFilePath = 'notes/src.md';
    await ops.performMerge('notes/src.md', 'notes/target.md');
    expect(nav.canGoBack).toBe(false);
  });

  it('performMerge handles the no-incoming-links preview branch', async () => {
    h.api.notebase.mergePreview.mockResolvedValue({ linkOccurrences: 0, affectedFiles: 0 });
    h.dialog.showConfirm.mockResolvedValue(true);
    h.api.notebase.merge.mockResolvedValue({ targetPath: 'notes/target.md', mergeLine: 1 });
    await ops.performMerge('notes/src.md', 'notes/target.md');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('No incoming links'),
      CONFIRM_KEYS.mergeNote,
      'Merge',
    );
    expect(h.api.notebase.merge).toHaveBeenCalled();
  });

  it('performMerge aborts when the confirm is declined', async () => {
    h.api.notebase.mergePreview.mockResolvedValue({ linkOccurrences: 1, affectedFiles: 1 });
    h.dialog.showConfirm.mockResolvedValue(false);
    await ops.performMerge('notes/src.md', 'notes/target.md');
    expect(h.api.notebase.merge).not.toHaveBeenCalled();
  });

  it('performMerge surfaces a failure dialog when the IPC throws', async () => {
    h.api.notebase.mergePreview.mockRejectedValue(new Error('merge boom'));
    await ops.performMerge('notes/src.md', 'notes/target.md');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('merge boom'),
      CONFIRM_KEYS.mergeFailed,
      'OK',
    );
    expect(h.api.notebase.merge).not.toHaveBeenCalled();
  });
});

describe('handleMoveWithPrompt', () => {
  it('moves to the prompted folder when there is no collision', async () => {
    h.notebase.files = [file('a.md')];
    h.dialog.showPrompt.mockResolvedValue('dest');
    h.api.notebase.readFile.mockRejectedValue(new Error('ENOENT')); // dest free
    await ops.handleMoveWithPrompt('a.md');
    expect(h.api.notebase.rename).toHaveBeenCalledWith('a.md', 'dest/a.md');
  });

  it('aborts with a notice when the destination already exists', async () => {
    h.dialog.showPrompt.mockResolvedValue('dest');
    h.api.notebase.readFile.mockResolvedValue('existing'); // collision
    await ops.handleMoveWithPrompt('a.md');
    expect(h.dialog.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
      CONFIRM_KEYS.moveCollision,
      'OK',
    );
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
  });

  it('does nothing on cancel (null prompt) or an unchanged directory', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleMoveWithPrompt('a.md');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();

    // currentDir '' === destDir '' → no-op
    h.dialog.showPrompt.mockResolvedValue('');
    await ops.handleMoveWithPrompt('a.md');
    expect(h.api.notebase.rename).not.toHaveBeenCalled();
  });

  it('bails out without a thoughtbase', async () => {
    h.notebase.meta = null;
    await ops.handleMoveWithPrompt('a.md');
    expect(h.dialog.showPrompt).not.toHaveBeenCalled();
  });
});
