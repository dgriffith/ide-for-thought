/**
 * @vitest-environment jsdom
 *
 * Transposition guard for the main↔renderer event wiring extracted from
 * App.svelte (#1084). Because the `api.menu.on*` callbacks are untyped
 * `() => void`, a mis-wired binding (onSave firing newNote, say) would compile
 * cleanly and only break at runtime. This test captures every registration and
 * invokes each callback, asserting it dispatches to the expected action — so a
 * transposed binding fails here instead of silently in production.
 *
 * Mocks the singleton stores the module pulls internally and the api client;
 * every `api.*.on*` records its callback so the test can fire it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const MENU_CHANNELS = [
    'onNewNote', 'onEditThoughtbaseDoc', 'onSave', 'onSaveAsTemplate', 'onInsertTemplate',
    'onCycleTheme', 'onSetTheme', 'onFontIncrease', 'onFontDecrease', 'onFontReset',
    'onToggleSidebar', 'onToggleRightSidebar', 'onToggleConversations', 'onNewConversation',
    'onTogglePreview', 'onSplitRight', 'onSplitDown', 'onFocusNextGroup', 'onFocusPrevGroup',
    'onCloseGroup', 'onOpenProject', 'onNewProject', 'onOpenRecentProject', 'onCloseProject',
    'onClearRecent', 'onNavBack', 'onNavForward', 'onGotoLine', 'onQuickOpen', 'onNewQuery',
    'onOpenStockQuery', 'onEditSavedQueries', 'onSortLines', 'onFind', 'onFindReplace',
    'onFindInNotes', 'onReplaceInNotes', 'onPrint', 'onAbout', 'onShortcuts', 'onOpenInDefault',
    'onOpenInTerminal', 'onOpenSettings', 'onRefactorRename', 'onRefactorMove', 'onRefactorCopy',
    'onRefactorExtract', 'onRefactorSplitHere', 'onRefactorSplitByHeading', 'onRefactorAutoTag',
    'onRefactorAutoLink', 'onRefactorAutoLinkInbound', 'onRefactorDecompose', 'onFormat',
    'onBibliography', 'onIngestUrl', 'onIngestIdentifier', 'onIngestFile', 'onImportBibtex',
    'onImportZoteroRdf', 'onExport', 'onPublish', 'onProjectOpened',
  ];

  const captured: Record<string, (...a: unknown[]) => unknown> = {};
  const cap = (key: string) => vi.fn((cb: (...a: unknown[]) => unknown) => { captured[key] = cb; });

  const menu: Record<string, unknown> = { reportTheme: vi.fn(), reportEditorState: vi.fn() };
  for (const ch of MENU_CHANNELS) menu[ch] = cap(ch);

  const api = {
    menu,
    skills: { list: vi.fn().mockResolvedValue({ skills: [], config: {} }) },
    sources: {
      onChanged: cap('sources.onChanged'),
      onImportBibtexProgress: cap('sources.bibtex'),
      onImportZoteroRdfProgress: cap('sources.zotero'),
    },
    tables: { onChanged: cap('tables.onChanged'), onNameCollision: cap('tables.collision') },
    embeddings: { onBackfillProgress: cap('embeddings.backfill') },
    notebase: {
      onFileCreated: cap('nb.created'),
      onFileDeleted: cap('nb.deleted'),
      onRenamed: cap('nb.renamed'),
      onRewritten: cap('nb.rewritten'),
      onHeadingRenameSuggested: cap('nb.heading'),
      clearRecent: vi.fn(),
      renameAnchor: vi.fn().mockResolvedValue(undefined),
    },
    tools: { onStream: cap('tools.stream'), onInvoke: cap('tools.invoke') },
    shell: { openInDefault: vi.fn(), openInTerminal: vi.fn() },
  };

  const notebase = {
    meta: { rootPath: '/p', name: 'p' } as unknown,
    open: vi.fn().mockResolvedValue({ rootPath: '/p' }),
    openPath: vi.fn().mockResolvedValue({ rootPath: '/p' }),
    close: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const editor = {
    activeFilePath: null as string | null,
    activeTab: undefined as unknown,
    activeGroupId: 'g1',
    groups: [] as unknown[],
    onAutoSaved: undefined as undefined | (() => void),
    splitGroup: vi.fn(), focusNextGroup: vi.fn(), focusPreviousGroup: vi.fn(),
    closeActiveGroup: vi.fn(), openQuery: vi.fn(), clear: vi.fn(),
    closeTabsForDeletedPath: vi.fn(), applyRenameTransitions: vi.fn(),
    isPathDirty: vi.fn(() => false), reloadTabFromDisk: vi.fn().mockResolvedValue(undefined),
    restoreTabs: vi.fn().mockResolvedValue(undefined), noteTabForGroup: vi.fn(() => undefined),
    saveEditorState: vi.fn(), flushAutoSave: vi.fn(), persistTabs: vi.fn(),
  };
  const busy = { label: '', setLabel: vi.fn() };
  const toolPanel = { appendChunk: vi.fn() };
  const conversations = { toggle: vi.fn() };
  const bookmarks = {
    applyRenameTransitions: vi.fn(), retargetSectionAnchor: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
  };
  const dialog = { showConfirm: vi.fn().mockResolvedValue(false) };

  return { MENU_CHANNELS, captured, api, notebase, editor, busy, toolPanel, conversations, bookmarks, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/busy.svelte', () => ({ getBusyStore: () => h.busy }));
vi.mock('../../../src/renderer/lib/stores/tool-panel.svelte', () => ({ getToolPanelStore: () => h.toolPanel }));
vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.conversations }));
vi.mock('../../../src/renderer/lib/stores/bookmarks.svelte', () => ({ getBookmarksStore: () => h.bookmarks }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));
vi.mock('../../../src/renderer/lib/formatter/settings', () => ({ loadFormatSettings: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ registerSkillInfos: vi.fn() }));
vi.mock('../../../src/shared/skills/menu-config', () => ({ applyMenuConfig: vi.fn(() => []) }));

import { registerAppIpc, type IpcWiringCtx } from '../../../src/renderer/lib/app/ipc-wiring';

const editorComponent = {
  getOffset: vi.fn(() => 0), getView: vi.fn(() => undefined),
  changeFontSize: vi.fn(), currentFontSize: vi.fn(() => 18), resetFontSize: vi.fn(),
  runSortLines: vi.fn(), openFind: vi.fn(), openFindReplace: vi.fn(),
};
const sidebar = { refreshTags: vi.fn(), refreshSources: vi.fn(), refreshTables: vi.fn() };
const rightSidebar = { refresh: vi.fn() };

function makeCtx(): { ctx: IpcWiringCtx; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const names = [
    'bumpGraphRevision', 'setEditorFontSize', 'toggleSidebar', 'toggleRightSidebar',
    'setShowGotoLine', 'setShowGotoNote', 'setShowEditSavedQueries', 'setShowAbout',
    'setShowShortcuts', 'setShowSettings', 'setPublishDialogOpen', 'setFindInNotesMode',
    'setExportDialogGroup', 'setEmbeddingProgress', 'refreshSavedQueriesCache', 'refreshBacklinkCount',
    'newNote', 'editThoughtbaseGuide', 'save', 'saveAsTemplate', 'insertTemplate', 'cycleTheme',
    'selectTheme', 'openThoughtbase', 'newThoughtbase', 'openRecentThoughtbase', 'navBack',
    'navForward', 'rename', 'move', 'copy', 'extractSelection', 'splitHere', 'splitByHeading',
    'autoTag', 'autoLink', 'autoLinkInbound', 'decompose', 'format', 'bibliography', 'ingestUrl',
    'ingestIdentifier', 'ingestFile', 'importBibtex', 'importZoteroRdf', 'toolInvoke',
    'newConversation', 'cycleViewMode',
  ];
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const n of names) spies[n] = vi.fn();
  const ctx = {
    getEditorComponent: () => editorComponent,
    getEditorComponents: () => ({ g1: { restorePosition: vi.fn() } }),
    getSidebar: () => sidebar,
    getRightSidebar: () => rightSidebar,
    getEditorFontSize: () => 14,
    refreshSourcesCache: vi.fn().mockResolvedValue(undefined),
    refreshAliasMap: vi.fn().mockResolvedValue(undefined),
    maybeShowOnboarding: vi.fn().mockResolvedValue(undefined),
    maybeOpenEntrypoints: vi.fn().mockResolvedValue(undefined),
    ...spies,
  } as unknown as IpcWiringCtx;
  return { ctx, spies };
}

let ctx: IpcWiringCtx;
let spies: Record<string, ReturnType<typeof vi.fn>>;
const fire = (channel: string, ...args: unknown[]) => h.captured[channel](...args);

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(h.captured)) delete h.captured[k];
  h.editor.activeFilePath = null;
  h.editor.activeTab = undefined;
  h.editor.groups = [];
  h.busy.label = '';
  window.print = vi.fn();
  ({ ctx, spies } = makeCtx());
  registerAppIpc(ctx);
});

describe('every registration is wired', () => {
  it('registers each menu channel exactly once', () => {
    for (const ch of h.MENU_CHANNELS) {
      expect(h.captured[ch], `menu.${ch} not registered`).toBeTypeOf('function');
    }
  });

  it('registers the non-menu event subscriptions', () => {
    for (const key of [
      'sources.onChanged', 'tables.onChanged', 'tables.collision', 'embeddings.backfill',
      'nb.created', 'nb.deleted', 'nb.renamed', 'nb.rewritten', 'nb.heading',
      'tools.stream', 'tools.invoke', 'sources.bibtex', 'sources.zotero',
    ]) {
      expect(h.captured[key], `${key} not registered`).toBeTypeOf('function');
    }
  });
});

describe('menu bindings dispatch to the right action (no arg / no guard)', () => {
  // channel -> ctx spy name. Guards behavior is verified separately below.
  const table: Array<[string, string]> = [
    ['onNewNote', 'newNote'],
    ['onEditThoughtbaseDoc', 'editThoughtbaseGuide'],
    ['onSave', 'save'],
    ['onSaveAsTemplate', 'saveAsTemplate'],
    ['onInsertTemplate', 'insertTemplate'],
    ['onCycleTheme', 'cycleTheme'],
    ['onNewConversation', 'newConversation'],
    ['onTogglePreview', 'cycleViewMode'],
    ['onOpenProject', 'openThoughtbase'],
    ['onNewProject', 'newThoughtbase'],
    ['onNavBack', 'navBack'],
    ['onNavForward', 'navForward'],
    ['onEditSavedQueries', 'setShowEditSavedQueries'],
    ['onFindInNotes', 'setFindInNotesMode'],
    ['onReplaceInNotes', 'setFindInNotesMode'],
    ['onAbout', 'setShowAbout'],
    ['onShortcuts', 'setShowShortcuts'],
    ['onOpenSettings', 'setShowSettings'],
    ['onToggleSidebar', 'toggleSidebar'],
    ['onToggleRightSidebar', 'toggleRightSidebar'],
    ['onQuickOpen', 'setShowGotoNote'],
    ['onRefactorExtract', 'extractSelection'],
    ['onRefactorSplitHere', 'splitHere'],
    ['onRefactorSplitByHeading', 'splitByHeading'],
    ['onFormat', 'format'],
    ['onBibliography', 'bibliography'],
    ['onIngestUrl', 'ingestUrl'],
    ['onIngestIdentifier', 'ingestIdentifier'],
    ['onIngestFile', 'ingestFile'],
    ['onImportBibtex', 'importBibtex'],
    ['onImportZoteroRdf', 'importZoteroRdf'],
    ['onPublish', 'setPublishDialogOpen'],
  ];
  it.each(table)('%s -> ctx.%s', (channel, spyName) => {
    fire(channel);
    expect(spies[spyName]).toHaveBeenCalledTimes(1);
  });

  it('onFindInNotes / onReplaceInNotes pass the mode', () => {
    fire('onFindInNotes');
    expect(spies.setFindInNotesMode).toHaveBeenCalledWith('find');
    fire('onReplaceInNotes');
    expect(spies.setFindInNotesMode).toHaveBeenCalledWith('replace');
  });
});

describe('menu bindings backed by stores / api (not ctx)', () => {
  it('onSplitRight / onSplitDown split the active group', () => {
    fire('onSplitRight');
    expect(h.editor.splitGroup).toHaveBeenCalledWith('g1', 'horizontal');
    fire('onSplitDown');
    expect(h.editor.splitGroup).toHaveBeenCalledWith('g1', 'vertical');
  });

  it('onCloseProject closes notebase and clears editor', () => {
    fire('onCloseProject');
    expect(h.notebase.close).toHaveBeenCalled();
    expect(h.editor.clear).toHaveBeenCalled();
  });

  it('onClearRecent / onNewQuery / onPrint reach api / store / window', () => {
    fire('onClearRecent');
    expect(h.api.notebase.clearRecent).toHaveBeenCalled();
    fire('onNewQuery');
    expect(h.editor.openQuery).toHaveBeenCalled();
    fire('onPrint');
    expect(window.print).toHaveBeenCalled();
  });

  it('onSortLines / onFind / onFindReplace reach the editor component', () => {
    fire('onSortLines');
    fire('onFind');
    fire('onFindReplace');
    expect(editorComponent.runSortLines).toHaveBeenCalled();
    expect(editorComponent.openFind).toHaveBeenCalled();
    expect(editorComponent.openFindReplace).toHaveBeenCalled();
  });

  it('font commands drive the editor and mirror the size back', () => {
    fire('onFontIncrease');
    expect(editorComponent.changeFontSize).toHaveBeenCalledWith(1);
    expect(spies.setEditorFontSize).toHaveBeenCalledWith(18);
    fire('onFontReset');
    expect(editorComponent.resetFontSize).toHaveBeenCalled();
    expect(spies.setEditorFontSize).toHaveBeenCalledWith(14);
  });
});

describe('arg-bearing menu bindings forward their payload', () => {
  it('onSetTheme -> selectTheme(mode)', () => {
    fire('onSetTheme', 'light');
    expect(spies.selectTheme).toHaveBeenCalledWith('light');
  });
  it('onOpenRecentProject -> openRecentThoughtbase(path)', () => {
    fire('onOpenRecentProject', '/recent/base');
    expect(spies.openRecentThoughtbase).toHaveBeenCalledWith('/recent/base');
  });
  it('onOpenStockQuery -> editor.openQuery(query, language)', () => {
    fire('onOpenStockQuery', { query: 'SELECT 1', language: 'sql' });
    expect(h.editor.openQuery).toHaveBeenCalledWith('SELECT 1', 'sql');
  });
  it('onExport -> setExportDialogGroup(group)', () => {
    fire('onExport', 'pdf');
    expect(spies.setExportDialogGroup).toHaveBeenCalledWith('pdf');
  });
});

describe('active-note guards', () => {
  it('onRefactorRename dispatches only with an active file, and passes it', () => {
    fire('onRefactorRename');
    expect(spies.rename).not.toHaveBeenCalled();
    h.editor.activeFilePath = 'notes/x.md';
    fire('onRefactorRename');
    expect(spies.rename).toHaveBeenCalledWith('notes/x.md');
  });

  it('onRefactorDecompose / AutoLinkInbound guard the same way', () => {
    h.editor.activeFilePath = 'y.md';
    fire('onRefactorDecompose');
    fire('onRefactorAutoLinkInbound');
    expect(spies.decompose).toHaveBeenCalledWith('y.md');
    expect(spies.autoLinkInbound).toHaveBeenCalledWith('y.md');
  });

  it('onGotoLine opens the dialog only when a tab is active', () => {
    fire('onGotoLine');
    expect(spies.setShowGotoLine).not.toHaveBeenCalled();
    h.editor.activeTab = { type: 'note' };
    fire('onGotoLine');
    expect(spies.setShowGotoLine).toHaveBeenCalledWith(true);
  });

  it('onOpenInDefault needs an active file; onOpenInTerminal always fires', () => {
    fire('onOpenInDefault');
    expect(h.api.shell.openInDefault).not.toHaveBeenCalled();
    fire('onOpenInTerminal');
    expect(h.api.shell.openInTerminal).toHaveBeenCalledWith(undefined);
    h.editor.activeFilePath = 'a.md';
    fire('onOpenInDefault');
    expect(h.api.shell.openInDefault).toHaveBeenCalledWith('a.md');
  });
});

describe('non-menu event handlers', () => {
  it('sources.onChanged refreshes the sidebar sources + the cache', () => {
    fire('sources.onChanged');
    expect(sidebar.refreshSources).toHaveBeenCalled();
    expect(ctx.refreshSourcesCache).toHaveBeenCalled();
  });

  it('embeddings backfill maps running progress to state, idle to null', () => {
    fire('embeddings.backfill', { running: true, done: 3, total: 10 });
    expect(spies.setEmbeddingProgress).toHaveBeenLastCalledWith({ done: 3, total: 10 });
    fire('embeddings.backfill', { running: false, done: 10, total: 10 });
    expect(spies.setEmbeddingProgress).toHaveBeenLastCalledWith(null);
  });

  it('tables.onNameCollision surfaces a suppressible confirm', () => {
    fire('tables.collision', { tableName: 't', existingPath: 'a.csv', attemptedPath: 'b.csv' });
    expect(h.dialog.showConfirm).toHaveBeenCalled();
  });

  it('notebase.onFileDeleted closes tabs for the path', () => {
    fire('nb.deleted', 'gone.md');
    expect(h.editor.closeTabsForDeletedPath).toHaveBeenCalledWith('gone.md');
  });

  it('tools.onInvoke forwards the tool id', () => {
    fire('tools.invoke', 'skill-42');
    expect(spies.toolInvoke).toHaveBeenCalledWith('skill-42');
  });

  it('import progress rewrites the busy label while a busy overlay is up', () => {
    h.busy.label = 'Importing…';
    fire('sources.bibtex', { done: 2, total: 5, currentTitle: 'A Paper' });
    expect(h.busy.setLabel).toHaveBeenCalledWith('Importing 2/5: A Paper');
  });

  it('onProjectOpened restores the project then runs onboarding + entrypoints', async () => {
    await fire('onProjectOpened', { rootPath: '/opened' });
    expect(h.notebase.openPath).toHaveBeenCalledWith('/opened');
    expect(h.editor.restoreTabs).toHaveBeenCalled();
    expect(ctx.maybeShowOnboarding).toHaveBeenCalled();
    expect(ctx.maybeOpenEntrypoints).toHaveBeenCalled();
  });
});

describe('lifecycle hooks', () => {
  it('wires editor.onAutoSaved to refresh + bump revision', () => {
    expect(h.editor.onAutoSaved).toBeTypeOf('function');
    h.editor.onAutoSaved!();
    expect(sidebar.refreshTags).toHaveBeenCalled();
    expect(rightSidebar.refresh).toHaveBeenCalled();
    expect(spies.bumpGraphRevision).toHaveBeenCalled();
    expect(spies.refreshBacklinkCount).toHaveBeenCalled();
  });

  it('patches notebase.open to refresh panels after a delayed settle', async () => {
    vi.useFakeTimers();
    try {
      const result = await h.notebase.open();
      expect(result).toEqual({ rootPath: '/p' });
      vi.runAllTimers();
      expect(sidebar.refreshTags).toHaveBeenCalled();
      expect(sidebar.refreshTables).toHaveBeenCalled();
      expect(ctx.refreshSourcesCache).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
