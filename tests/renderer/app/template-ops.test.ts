/**
 * Behavioral net for the template / note-creation handlers extracted from
 * App.svelte (#670). Mocks the api client + notebase / editor / dialog stores,
 * and the refactor template-planning helpers (create-from-conversation /
 * settings). Verifies the moved handler bodies (save-as / insert template,
 * new-about-source note, excerpt append, create-from-conversation collision
 * loop), not just that menus reach them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const api = {
    templates: { list: vi.fn(), get: vi.fn(), saveAs: vi.fn() },
    graph: { sourceDetail: vi.fn() },
    sources: { getExcerptNoteFolder: vi.fn() },
    notebase: { fileExists: vi.fn(), writeFile: vi.fn() },
  };
  const notebase = {
    meta: { rootPath: '/p', name: 'p' } as unknown,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const editor = {
    openFile: vi.fn(),
    setContent: vi.fn(),
    switchTab: vi.fn(),
    activeTab: undefined as unknown,
    activeFilePath: null as string | null,
    activeNoteTab: undefined as unknown,
    tabs: [] as unknown[],
  };
  const dialog = { showPrompt: vi.fn(), showConfirm: vi.fn(), showSnippetPicker: vi.fn() };
  return { api, notebase, editor, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));

import { createTemplateOps, type TemplateOpsCtx } from '../../../src/renderer/lib/app/template-ops';

const sidebar = { refreshTags: vi.fn() };
const editorComponent = { getSelectedText: vi.fn(() => ''), insertText: vi.fn() };
let lastNotePath: string | null = null;
let ctx: TemplateOpsCtx;
let ops: ReturnType<typeof createTemplateOps>;

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.editor.activeTab = undefined;
  h.editor.activeFilePath = null;
  h.editor.activeNoteTab = undefined;
  h.editor.tabs = [];
  lastNotePath = null;
  ctx = {
    getSidebar: () => sidebar,
    getEditorComponent: () => editorComponent,
    getLastNotePath: () => lastNotePath,
  };
  ops = createTemplateOps(ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleSaveAsTemplate', () => {
  it('prompts for a name and saves the active note body', async () => {
    h.editor.activeTab = { type: 'note', relativePath: 'foo/bar.md', content: '# body' };
    h.dialog.showPrompt.mockResolvedValue('my-template');
    await ops.handleSaveAsTemplate();
    expect(h.api.templates.saveAs).toHaveBeenCalledWith('my-template', '# body');
  });

  it('does nothing when the prompt is cancelled', async () => {
    h.editor.activeTab = { type: 'note', relativePath: 'a.md', content: 'x' };
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleSaveAsTemplate();
    expect(h.api.templates.saveAs).not.toHaveBeenCalled();
  });
});

describe('handleInsertTemplate', () => {
  it('does nothing when there are no templates', async () => {
    h.editor.activeTab = { type: 'note', relativePath: 'a.md', content: '' };
    h.api.templates.list.mockResolvedValue([]);
    await ops.handleInsertTemplate();
    expect(h.dialog.showSnippetPicker).not.toHaveBeenCalled();
    expect(editorComponent.insertText).not.toHaveBeenCalled();
  });

  it('inserts the picked template body via the ctx editor component', async () => {
    h.editor.activeTab = { type: 'note', relativePath: 'a.md', content: '' };
    h.editor.activeFilePath = 'a.md';
    h.api.templates.list.mockResolvedValue([{ filename: 't.md', name: 't' }]);
    h.dialog.showSnippetPicker.mockResolvedValue({ filename: 't.md', name: 't' });
    h.api.templates.get.mockResolvedValue('hello body');
    await ops.handleInsertTemplate();
    expect(editorComponent.insertText).toHaveBeenCalled();
    expect(editorComponent.insertText.mock.calls[0][0]).toContain('hello body');
  });
});

describe('handleNewAboutSourceNote', () => {
  it('writes an about: frontmatter note and opens it', async () => {
    h.dialog.showPrompt.mockResolvedValue('On Raft');
    const result = await ops.handleNewAboutSourceNote('src-1');
    expect(result).toBe('On Raft.md');
    expect(h.api.notebase.writeFile).toHaveBeenCalledWith(
      'On Raft.md',
      expect.stringContaining('about: [[sources/src-1]]'),
    );
    expect(h.editor.openFile).toHaveBeenCalledWith('On Raft.md');
    expect(sidebar.refreshTags).toHaveBeenCalled();
  });

  it('returns null when the prompt is cancelled', async () => {
    h.dialog.showPrompt.mockResolvedValue(null);
    const result = await ops.handleNewAboutSourceNote('src-1');
    expect(result).toBeNull();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleAppendExcerptToCurrent', () => {
  const excerpt = { excerptId: 'e1', text: 'quote', sourceId: 's1' } as never;

  it('appends to the active note tab via editor.setContent', () => {
    h.editor.activeNoteTab = { type: 'note', relativePath: 'cur.md', content: 'existing' };
    const ok = ops.handleAppendExcerptToCurrent(excerpt);
    expect(ok).toBe(true);
    expect(h.editor.setContent).toHaveBeenCalledWith(expect.stringContaining('existing'));
  });

  it('with no active note, switches to lastNotePath (via ctx) then appends', () => {
    h.editor.activeNoteTab = undefined;
    lastNotePath = 'prev.md';
    h.editor.tabs = [{ type: 'note', relativePath: 'prev.md', content: 'prev body' }];
    const ok = ops.handleAppendExcerptToCurrent(excerpt);
    expect(ok).toBe(true);
    expect(h.editor.switchTab).toHaveBeenCalledWith(0);
    expect(h.editor.setContent).toHaveBeenCalledWith(expect.stringContaining('prev body'));
  });

  it('returns false with no active note and no lastNotePath', () => {
    h.editor.activeNoteTab = undefined;
    lastNotePath = null;
    const ok = ops.handleAppendExcerptToCurrent(excerpt);
    expect(ok).toBe(false);
    expect(h.editor.setContent).not.toHaveBeenCalled();
  });
});

describe('handleCreateNoteFromConversation', () => {
  const conversation = {
    id: 'conv-1',
    contextBundle: { notePath: 'notes/origin.md' },
  } as never;

  it('confirms (and creates nothing) when there is no body text', async () => {
    await ops.handleCreateNoteFromConversation({
      conversation,
      selectionText: '   ',
      fallbackText: '',
    });
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });

  it('writes + opens the note, bumping the name on collision', async () => {
    h.dialog.showPrompt.mockResolvedValue('My Note');
    // First candidate path exists, second does not — exercises the bump loop.
    h.api.notebase.fileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await ops.handleCreateNoteFromConversation({
      conversation,
      selectionText: 'some assistant prose to file away',
      fallbackText: '',
    });
    expect(h.api.notebase.writeFile).toHaveBeenCalledTimes(1);
    const writtenPath = h.api.notebase.writeFile.mock.calls[0][0] as string;
    // The bumped name carries the `-2` collision suffix before `.md`.
    expect(writtenPath).toMatch(/-2\.md$/);
    expect(h.editor.openFile).toHaveBeenCalledWith(writtenPath);
    expect(sidebar.refreshTags).toHaveBeenCalled();
  });
});
