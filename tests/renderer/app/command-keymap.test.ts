/**
 * Behavioral net for the command-palette + keymap dependency tables extracted
 * from App.svelte (#1084). Mocks the four stores the factory pulls internally
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
    clear: vi.fn(),
    closeTab: vi.fn(),
    openQuery: vi.fn(),
  };
  const nav = { canGoBack: false, canGoForward: false };
  const conversations = { toggle: vi.fn() };
  const toggleEditorDictation = vi.fn();
  return { notebase, editor, nav, conversations, toggleEditorDictation };
});

vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/navigation.svelte', () => ({ getNavigationStore: () => h.nav }));
vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.conversations }));
vi.mock('../../../src/renderer/lib/editor/dictation', () => ({ toggleEditorDictation: h.toggleEditorDictation }));

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
    editThoughtbaseGuide: vi.fn(), saveAsTemplate: vi.fn(), insertTemplate: vi.fn(),
    extractSelection: vi.fn(), splitHere: vi.fn(), splitByHeading: vi.fn(),
    format: vi.fn(), bibliography: vi.fn(), newConversation: vi.fn(), openConversation: vi.fn(),
    ingestUrl: vi.fn(), ingestIdentifier: vi.fn(), ingestFile: vi.fn(),
    importBibtex: vi.fn(), importZoteroRdf: vi.fn(), navBack: vi.fn(), navForward: vi.fn(),
    rename: vi.fn(), move: vi.fn(), copy: vi.fn(), autoTag: vi.fn(), autoLink: vi.fn(),
    autoLinkInbound: vi.fn(), decompose: vi.fn(),
    selectTheme: vi.fn(), cycleTheme: vi.fn(), cycleViewMode: vi.fn(),
    refreshSourcesCache: vi.fn(), refreshSavedQueriesCache: vi.fn(),
    setFindInNotesMode: vi.fn(), setShowGotoLine: vi.fn(), setShowGotoNote: vi.fn(),
    toggleQuickOpen: vi.fn(), setShowEditSavedQueries: vi.fn(), setShowSettings: vi.fn(),
    toggleSidebar: vi.fn(), toggleRightSidebar: vi.fn(), toggleCommandPalette: vi.fn(),
    setEditorFontSize: vi.fn((n: number) => { editorFontSize = n; }),
  };
  const ctx: CommandKeymapCtx = {
    getEditorComponent: () => editorComponent,
    getThemeLabel: () => 'dark',
    getEditorFontSize: () => editorFontSize,
    ...spies,
  };
  return { ctx, editorComponent, spies, getFontSize: () => editorFontSize };
}

let built: ReturnType<typeof makeCtx>;
let commandDeps: ReturnType<typeof createCommandKeymap>['commandDeps'];
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
  ({ commandDeps, keymapDeps } = createCommandKeymap(built.ctx));
});

describe('store-derived predicates', () => {
  it('read live store state at call time', () => {
    expect(commandDeps.hasProject()).toBe(false);
    h.notebase.meta = { rootPath: '/p' };
    expect(commandDeps.hasProject()).toBe(true);

    h.editor.activeFilePath = 'a.md';
    expect(commandDeps.hasNote()).toBe(true);
    h.editor.activeTab = { type: 'note' };
    expect(commandDeps.hasActiveNoteTab()).toBe(true);

    h.nav.canGoBack = true;
    expect(commandDeps.canGoBack()).toBe(true);
    expect(commandDeps.canGoForward()).toBe(false);
  });
});

describe('active-note guards', () => {
  it('renameActive dispatches ctx.rename with the active path', () => {
    h.editor.activeFilePath = 'notes/x.md';
    commandDeps.renameActive();
    expect(built.spies.rename).toHaveBeenCalledWith('notes/x.md');
  });

  it('decomposeActive is a no-op when nothing is active', () => {
    h.editor.activeFilePath = null;
    commandDeps.decomposeActive();
    expect(built.spies.decompose).not.toHaveBeenCalled();
  });

  it('autoLinkInboundActive guards then dispatches', () => {
    h.editor.activeFilePath = 'y.md';
    commandDeps.autoLinkInboundActive();
    expect(built.spies.autoLinkInbound).toHaveBeenCalledWith('y.md');
  });
});

describe('store actions owned by the factory', () => {
  it('closeProject closes the notebase and clears the editor', () => {
    commandDeps.closeProject();
    expect(h.notebase.close).toHaveBeenCalled();
    expect(h.editor.clear).toHaveBeenCalled();
  });

  it('toggleConversations toggles the conversations store', () => {
    commandDeps.toggleConversations();
    expect(h.conversations.toggle).toHaveBeenCalled();
  });

  it('newQuery opens a query tab', () => {
    commandDeps.newQuery();
    expect(h.editor.openQuery).toHaveBeenCalled();
  });
});

describe('editor-ref driven commands', () => {
  it('dictate targets the focused pane view', () => {
    commandDeps.dictate();
    expect(built.editorComponent.getView).toHaveBeenCalled();
    expect(h.toggleEditorDictation).toHaveBeenCalledWith(null);
  });

  it('find / findReplace / sortLines reach the editor component', () => {
    commandDeps.find();
    commandDeps.findReplace();
    commandDeps.sortLines();
    expect(built.editorComponent.openFind).toHaveBeenCalled();
    expect(built.editorComponent.openFindReplace).toHaveBeenCalled();
    expect(built.editorComponent.runSortLines).toHaveBeenCalled();
  });

  it('fontIncrease bumps the editor and mirrors its reported size back to App state', () => {
    commandDeps.fontIncrease();
    expect(built.editorComponent.changeFontSize).toHaveBeenCalledWith(1);
    expect(built.spies.setEditorFontSize).toHaveBeenCalledWith(17);
  });

  it('fontReset resets to 14', () => {
    commandDeps.fontReset();
    expect(built.editorComponent.resetFontSize).toHaveBeenCalled();
    expect(built.spies.setEditorFontSize).toHaveBeenCalledWith(14);
  });
});

describe('UI-chrome commands', () => {
  it('quickOpen refreshes the palette caches and opens goto-note', () => {
    commandDeps.quickOpen();
    expect(built.spies.refreshSourcesCache).toHaveBeenCalled();
    expect(built.spies.refreshSavedQueriesCache).toHaveBeenCalled();
    expect(built.spies.setShowGotoNote).toHaveBeenCalledWith(true);
  });

  it('findInNotes / replaceInNotes set the mode', () => {
    commandDeps.findInNotes();
    expect(built.spies.setFindInNotesMode).toHaveBeenCalledWith('find');
    commandDeps.replaceInNotes();
    expect(built.spies.setFindInNotesMode).toHaveBeenCalledWith('replace');
  });

  it('setTheme forwards to ctx.selectTheme; currentTheme reads the label', () => {
    commandDeps.setTheme('light');
    expect(built.spies.selectTheme).toHaveBeenCalledWith('light');
    expect(commandDeps.currentTheme()).toBe('dark');
  });
});

describe('keymapDeps', () => {
  it('closeActiveTab closes the active index', () => {
    h.editor.activeIndex = 3;
    keymapDeps.closeActiveTab();
    expect(h.editor.closeTab).toHaveBeenCalledWith(3);
  });

  it('shares wiring with the command table (navBack, toggleQuickOpen, cyclePreview)', () => {
    keymapDeps.navBack();
    keymapDeps.toggleQuickOpen();
    keymapDeps.cyclePreview();
    expect(built.spies.navBack).toHaveBeenCalled();
    expect(built.spies.toggleQuickOpen).toHaveBeenCalled();
    expect(built.spies.cycleViewMode).toHaveBeenCalled();
  });

  it('hasActiveIndex reflects the editor store', () => {
    h.editor.activeIndex = -1;
    expect(keymapDeps.hasActiveIndex()).toBe(false);
    h.editor.activeIndex = 0;
    expect(keymapDeps.hasActiveIndex()).toBe(true);
  });
});
