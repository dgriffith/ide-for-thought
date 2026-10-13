/**
 * @vitest-environment jsdom
 *
 * Behavioral net for the command action table + keymap extracted from
 * App.svelte (#1084). Since #2625 the action table is what BOTH the palette
 * and the menu bar's `menu:command` run, so the menu-binding cases that used to
 * live in ipc-wiring.test.ts are here too. Mocks the four stores the factory pulls internally
 * and the dictation helper. Verifies the real logic the module owns — the
 * store-derived predicates, the active-note guards, close-project, the
 * font-size dance, quick-open, and that the ctx handlers are dispatched — not
 * merely that the objects have the right keys (tsc already guarantees that).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const notebase = { meta: null as unknown, close: vi.fn() };
  const editor = {
    activeFilePath: null as string | null,
    activeTab: undefined as unknown,
    activeIndex: -1,
    activeGroupId: 'g1',
    splitGroup: vi.fn(), focusNextGroup: vi.fn(), focusPreviousGroup: vi.fn(), closeActiveGroup: vi.fn(),
    clear: vi.fn(),
    closeTab: vi.fn(),
    openQuery: vi.fn(),
  };
  const nav = { canGoBack: false, canGoForward: false };
  const conversations = { toggle: vi.fn() };
  const toggleEditorDictation = vi.fn();
  const recordings = { toggle: vi.fn(), transcribeAtCursor: vi.fn(), summarizeAtCursor: vi.fn() };
  const api = {
    notebase: { clearRecent: vi.fn() },
    shell: { revealFile: vi.fn(), openInDefault: vi.fn(), openInTerminal: vi.fn() },
  };
  return { notebase, editor, nav, conversations, toggleEditorDictation, recordings, api };
});

vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/navigation.svelte', () => ({ getNavigationStore: () => h.nav }));
vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.conversations }));
vi.mock('../../../src/renderer/lib/editor/dictation', () => ({ toggleEditorDictation: h.toggleEditorDictation }));
vi.mock('../../../src/renderer/lib/voice/audio-recording.svelte', () => ({ getAudioRecordingStore: () => h.recordings }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
// Every editor command as a spy, so its action's dispatch can be observed.
vi.mock('../../../src/renderer/lib/editor/command-registry', async () => {
  const { COMMANDS } = await vi.importActual<typeof import('../../../src/shared/commands')>('../../../src/shared/commands');
  return { EDITOR_COMMANDS: Object.fromEntries(COMMANDS.filter((c) => 'editor' in c).map((c) => [c.id, vi.fn(() => true)])) };
});
import { EDITOR_COMMANDS } from '../../../src/renderer/lib/editor/command-registry';

import { createCommandKeymap, type CommandKeymapCtx } from '../../../src/renderer/lib/app/command-keymap';

// A spy for every ctx member so each binding's dispatch can be asserted.
function makeCtx() {
  const editorComponent = {
    getView: vi.fn(() => undefined),
    openFind: vi.fn(),
    openFindReplace: vi.fn(),
    runSortLines: vi.fn(),
    changeFontSize: vi.fn(),
    currentFontSize: vi.fn(() => 17),
    resetFontSize: vi.fn(),
  };
  let editorFontSize = 14;
  const spies = {
    newNote: vi.fn(), save: vi.fn(), openProject: vi.fn(), newProject: vi.fn(),
    editThoughtbaseGuide: vi.fn(), openThoughtbaseProperties: vi.fn(), installTutorial: vi.fn(),
    saveAsTemplate: vi.fn(), insertTemplate: vi.fn(), promoteToType: vi.fn(), saveNoteAsObjectType: vi.fn(),
    setShowAbout: vi.fn(), setShowShortcuts: vi.fn(), setPublishDialogOpen: vi.fn(),
    extractSelection: vi.fn(), splitHere: vi.fn(), splitByHeading: vi.fn(),
    format: vi.fn(), bibliography: vi.fn(), newConversation: vi.fn(), openConversation: vi.fn(),
    ingestUrl: vi.fn(), ingestIdentifier: vi.fn(), ingestFile: vi.fn(), ingestBulk: vi.fn(),
    importBibtex: vi.fn(), importZoteroRdf: vi.fn(), navBack: vi.fn(), navForward: vi.fn(),
    rename: vi.fn(), move: vi.fn(), copy: vi.fn(), autoTag: vi.fn(), autoLink: vi.fn(),
    autoLinkInbound: vi.fn(), decompose: vi.fn(), invokeTool: vi.fn(),
    selectTheme: vi.fn(), cycleTheme: vi.fn(), cycleViewMode: vi.fn(),
    refreshSourcesCache: vi.fn(), refreshSavedQueriesCache: vi.fn(),
    setFindInNotesMode: vi.fn(), setShowGotoLine: vi.fn(),
    toggleQuickOpen: vi.fn(), setShowEditSavedQueries: vi.fn(), setShowSettings: vi.fn(),
    toggleSidebar: vi.fn(), toggleRightSidebar: vi.fn(), toggleCommandPalette: vi.fn(),
    setEditorFontSize: vi.fn((n: number) => { editorFontSize = n; }),
  };
  const ctx: CommandKeymapCtx = {
    getEditorComponent: () => editorComponent,
    getThemeLabel: () => 'dark',
    hasSelection: () => false,
    getEditorFontSize: () => editorFontSize,
    ...spies,
  };
  return { ctx, editorComponent, spies, getFontSize: () => editorFontSize };
}

let built: ReturnType<typeof makeCtx>;
let paletteState: ReturnType<typeof createCommandKeymap>['paletteState'];
let commandActions: ReturnType<typeof createCommandKeymap>['commandActions'];
let keymapDeps: ReturnType<typeof createCommandKeymap>['keymapDeps'];

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = null;
  h.editor.activeFilePath = null;
  h.editor.activeTab = undefined;
  h.editor.activeIndex = -1;
  h.nav.canGoBack = false;
  h.nav.canGoForward = false;
  built = makeCtx();
  ({ paletteState, commandActions, keymapDeps } = createCommandKeymap(built.ctx));
});

describe('store-derived predicates', () => {
  it('read live store state at call time', () => {
    expect(paletteState.hasProject()).toBe(false);
    h.notebase.meta = { rootPath: '/p' };
    expect(paletteState.hasProject()).toBe(true);

    h.editor.activeFilePath = 'a.md';
    expect(paletteState.hasNote()).toBe(true);
    h.editor.activeTab = { type: 'note' };
    expect(paletteState.hasActiveNoteTab()).toBe(true);

    h.nav.canGoBack = true;
    expect(paletteState.canGoBack()).toBe(true);
    expect(paletteState.canGoForward()).toBe(false);
  });
});

describe('active-note guards', () => {
  it('renameActive dispatches ctx.rename with the active path', () => {
    h.editor.activeFilePath = 'notes/x.md';
    commandActions['refactor.rename']();
    expect(built.spies.rename).toHaveBeenCalledWith('notes/x.md');
  });

  it('decomposeActive is a no-op when nothing is active', () => {
    h.editor.activeFilePath = null;
    commandActions['refactor.decompose']();
    expect(built.spies.decompose).not.toHaveBeenCalled();
  });

  it('autoLinkInboundActive guards then dispatches', () => {
    h.editor.activeFilePath = 'y.md';
    commandActions['refactor.autoLinkInbound']();
    expect(built.spies.autoLinkInbound).toHaveBeenCalledWith('y.md');
  });
});

describe('store actions owned by the factory', () => {
  it('closeProject closes the notebase and clears the editor', () => {
    commandActions['file.closeProject']();
    expect(h.notebase.close).toHaveBeenCalled();
    expect(h.editor.clear).toHaveBeenCalled();
  });

  it('toggleConversations toggles the conversations store', () => {
    commandActions['view.toggleConversations']();
    expect(h.conversations.toggle).toHaveBeenCalled();
  });

  it('newQuery opens a query tab', () => {
    commandActions['query.new']();
    expect(h.editor.openQuery).toHaveBeenCalled();
  });
});

describe('editor-ref driven commands', () => {
  it('dictate targets the focused pane view', () => {
    commandActions['edit.dictate']();
    expect(built.editorComponent.getView).toHaveBeenCalled();
    expect(h.toggleEditorDictation).toHaveBeenCalledWith(null);
  });

  it('record / transcribe resolve the focused pane view when they run (#2428)', () => {
    const view = { id: 'focused' };
    built.editorComponent.getView.mockReturnValue(view as never);
    commandActions['file.newAudioRecording']();
    commandActions['edit.transcribeRecording']();
    const recordGetter = h.recordings.toggle.mock.calls[0]![0] as () => unknown;
    const transcribeGetter = h.recordings.transcribeAtCursor.mock.calls[0]![0] as () => unknown;
    expect(recordGetter()).toBe(view);
    expect(transcribeGetter()).toBe(view);
  });

  it('summarize hands the recordings store the skill runner from ctx (#2729)', () => {
    commandActions['edit.summarizeRecording']();
    const [, invoke] = h.recordings.summarizeAtCursor.mock.calls[0]! as [unknown, (id: string) => void];
    invoke('x');
    expect(built.spies.invokeTool).toHaveBeenCalledWith('x');
  });

  it('find / findReplace / sortLines reach the editor component', () => {
    commandActions['edit.find']();
    commandActions['edit.findReplace']();
    commandActions['edit.sortLines']();
    expect(built.editorComponent.openFind).toHaveBeenCalled();
    expect(built.editorComponent.openFindReplace).toHaveBeenCalled();
    expect(built.editorComponent.runSortLines).toHaveBeenCalled();
  });

  it('fontIncrease bumps the editor and mirrors its reported size back to App state', () => {
    commandActions['view.fontIncrease']();
    expect(built.editorComponent.changeFontSize).toHaveBeenCalledWith(1);
    expect(built.spies.setEditorFontSize).toHaveBeenCalledWith(17);
  });

  it('fontReset resets to 14', () => {
    commandActions['view.fontReset']();
    expect(built.editorComponent.resetFontSize).toHaveBeenCalled();
    expect(built.spies.setEditorFontSize).toHaveBeenCalledWith(14);
  });
});

describe('UI-chrome commands', () => {
  it('quickOpen refreshes the palette caches and toggles goto-note', () => {
    commandActions['nav.quickOpen']();
    expect(built.spies.refreshSourcesCache).toHaveBeenCalled();
    expect(built.spies.refreshSavedQueriesCache).toHaveBeenCalled();
    expect(built.spies.toggleQuickOpen).toHaveBeenCalledTimes(1);
  });

  it('findInNotes / replaceInNotes set the mode', () => {
    commandActions['edit.findInNotes']();
    expect(built.spies.setFindInNotesMode).toHaveBeenCalledWith('find');
    commandActions['edit.replaceInNotes']();
    expect(built.spies.setFindInNotesMode).toHaveBeenCalledWith('replace');
  });

  it('a theme command selects its mode; currentTheme reads the label', () => {
    commandActions['view.theme.light']();
    expect(built.spies.selectTheme).toHaveBeenCalledWith('light');
    expect(paletteState.currentTheme()).toBe('dark');
  });
});

describe('research commands', () => {
  it('ingestBulk dispatches straight through to ctx.ingestBulk (#2087)', () => {
    commandActions['research.ingestBulk']();
    expect(built.spies.ingestBulk).toHaveBeenCalled();
  });
});

describe('commands that dispatch straight to a ctx handler', () => {
  // command id -> ctx spy. One row per command whose action IS the handler.
  const table: Array<[keyof typeof commandActions, string]> = [
    ['file.newNote', 'newNote'], ['file.save', 'save'],
    ['file.openProject', 'openProject'], ['file.newProject', 'newProject'],
    ['file.editThoughtbaseGuide', 'editThoughtbaseGuide'], ['file.thoughtbaseProperties', 'openThoughtbaseProperties'],
    ['file.saveAsTemplate', 'saveAsTemplate'], ['edit.insertTemplate', 'insertTemplate'],
    ['objects.promoteToType', 'promoteToType'], ['objects.saveAsObjectType', 'saveNoteAsObjectType'],
    ['view.cycleTheme', 'cycleTheme'], ['view.togglePreview', 'cycleViewMode'],
    ['view.toggleSidebar', 'toggleSidebar'], ['view.toggleRightSidebar', 'toggleRightSidebar'],
    // #2256 — the palette's menu item runs the same toggle as Cmd+K.
    ['view.commandPalette', 'toggleCommandPalette'],
    ['learning.askQuestion', 'newConversation'],
    ['nav.back', 'navBack'], ['nav.forward', 'navForward'],
    ['refactor.extract', 'extractSelection'], ['refactor.splitHere', 'splitHere'],
    ['refactor.splitByHeading', 'splitByHeading'], ['refactor.format', 'format'],
    ['research.ingestUrl', 'ingestUrl'], ['research.ingestIdentifier', 'ingestIdentifier'],
    ['research.ingestFile', 'ingestFile'], ['research.importBibtex', 'importBibtex'],
    ['research.importZoteroRdf', 'importZoteroRdf'], ['research.bibliography', 'bibliography'],
    ['query.editSaved', 'setShowEditSavedQueries'], ['export.publish', 'setPublishDialogOpen'],
    ['app.settings', 'setShowSettings'], ['app.about', 'setShowAbout'],
    ['app.shortcuts', 'setShowShortcuts'], ['app.installTutorial', 'installTutorial'],
  ];
  it.each(table)('%s -> ctx.%s', (id, spy) => {
    commandActions[id]();
    expect(built.spies[spy as keyof typeof built.spies]).toHaveBeenCalledTimes(1);
  });
});

describe('commands backed by stores / api', () => {
  it('splits and group focus drive the editor store', () => {
    commandActions['view.splitRight']();
    expect(h.editor.splitGroup).toHaveBeenCalledWith('g1', 'horizontal');
    commandActions['view.splitDown']();
    expect(h.editor.splitGroup).toHaveBeenCalledWith('g1', 'vertical');
    commandActions['view.focusNextGroup']();
    commandActions['view.focusPrevGroup']();
    commandActions['view.closeGroup']();
    expect(h.editor.focusNextGroup).toHaveBeenCalled();
    expect(h.editor.focusPreviousGroup).toHaveBeenCalled();
    expect(h.editor.closeActiveGroup).toHaveBeenCalled();
  });

  it('clear recent / print reach the api and the window', () => {
    window.print = vi.fn();
    commandActions['file.clearRecent']();
    expect(h.api.notebase.clearRecent).toHaveBeenCalled();
    commandActions['file.print']();
    expect(window.print).toHaveBeenCalled();
  });

  it('go to line opens the dialog only when a tab is active', () => {
    commandActions['edit.gotoLine']();
    expect(built.spies.setShowGotoLine).not.toHaveBeenCalled();
    h.editor.activeTab = { type: 'note' };
    commandActions['edit.gotoLine']();
    expect(built.spies.setShowGotoLine).toHaveBeenCalledWith(true);
  });

  it('open in default app needs an active file; open in terminal always runs', () => {
    commandActions['file.openInDefault']();
    expect(h.api.shell.openInDefault).not.toHaveBeenCalled();
    commandActions['file.openInTerminal']();
    expect(h.api.shell.openInTerminal).toHaveBeenCalledWith(undefined);
    h.editor.activeFilePath = 'a.md';
    commandActions['file.openInDefault']();
    expect(h.api.shell.openInDefault).toHaveBeenCalledWith('a.md');
  });

  it('reveal in Finder reveals the active note, and is a silent no-op without one (#2411)', () => {
    commandActions['file.revealFile']();
    expect(h.api.shell.revealFile).not.toHaveBeenCalled();
    h.editor.activeFilePath = 'notes/b.md';
    commandActions['file.revealFile']();
    expect(h.api.shell.revealFile).toHaveBeenCalledWith('notes/b.md');
  });
});

describe('keymapDeps', () => {
  it('runs commands from the action table', () => {
    h.editor.activeIndex = 3;
    keymapDeps.run('view.closeTab');
    expect(h.editor.closeTab).toHaveBeenCalledWith(3);
    keymapDeps.run('nav.back');
    expect(built.spies.navBack).toHaveBeenCalled();
  });

  it('hasActiveIndex reflects the editor store', () => {
    h.editor.activeIndex = -1;
    expect(keymapDeps.hasActiveIndex()).toBe(false);
    h.editor.activeIndex = 0;
    expect(keymapDeps.hasActiveIndex()).toBe(true);
  });
});

describe('editor commands run on the focused pane (#2625)', () => {
  it('runs the CodeMirror command against the focused view, and is a no-op without one', () => {
    const bold = EDITOR_COMMANDS['editor.toggleBold'] as unknown as ReturnType<typeof vi.fn>;
    const view = { id: 'v' };
    built.editorComponent.getView.mockReturnValue(view as never);
    commandActions['editor.toggleBold']();
    expect(bold).toHaveBeenCalledExactlyOnceWith(view);
    built.editorComponent.getView.mockReturnValue(undefined);
    commandActions['editor.toggleBold']();
    expect(bold).toHaveBeenCalledTimes(1);
  });
});
