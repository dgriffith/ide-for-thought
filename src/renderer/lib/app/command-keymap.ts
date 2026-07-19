/**
 * Command-palette registry + global-keymap dependency tables, extracted from
 * App.svelte (#1084). These two objects (`CommandDeps` / `KeymapDeps`) are the
 * app's action surface — the wiring from every command / shortcut to the store
 * call, ops handler, or UI-state mutation it triggers.
 *
 * Both interfaces are fully typed, so tsc enforces that every field is present
 * and correctly shaped — a mis-wired binding here is a compile error, not a
 * silent runtime break (which is why this lifts out safely where the untyped
 * `api.menu.on*` wiring does not).
 *
 * The factory pulls the singleton stores internally, so the store-derived
 * predicates (`hasProject`, `canGoBack`, …), the active-note guards
 * (`renameActive` → guarded `rename(path)`), `closeProject`, `newQuery`,
 * `toggleConversations`, and the font-size dance live here as real logic.
 * Everything the factory can't reach — App-local ops handlers, the focused
 * pane's editor ref, the theme label, and the UI-chrome `$state` — arrives via
 * `ctx`. App keeps the `commands` `$derived` (a rune must stay in the component)
 * and passes `commandDeps` into it.
 */
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getNavigationStore } from '../stores/navigation.svelte';
import { getConversationsStore } from '../stores/conversations.svelte';
import { toggleEditorDictation } from '../editor/dictation';
import type { EditorView } from '@codemirror/view';
import type { ThemeMode } from '../theme';
import type { CommandDeps } from '../command-palette/registry';
import type { KeymapDeps } from '../keymap/handle-keydown';

/** Minimal structural view of the focused pane's Editor instance — only the
 *  methods the command table drives. */
interface EditorRef {
  getView(): EditorView | undefined;
  openFind(): void;
  openFindReplace(): void;
  runSortLines(): void;
  changeFontSize(delta: number): void;
  currentFontSize(): number;
  resetFontSize(): void;
}

export interface CommandKeymapCtx {
  /** The focused pane's editor instance (App-owned `$derived` ref). */
  getEditorComponent: () => EditorRef | undefined;

  // App-local / other-cluster handlers, invoked as-is.
  newNote: () => void;
  save: () => void;
  openProject: () => void;
  newProject: () => void;
  editThoughtbaseGuide: () => void;
  saveAsTemplate: () => void;
  insertTemplate: () => void;
  extractSelection: () => void;
  splitHere: () => void;
  splitByHeading: () => void;
  format: () => void;
  bibliography: () => void;
  newConversation: () => void;
  openConversation: () => void;
  ingestUrl: () => void;
  ingestIdentifier: () => void;
  ingestFile: () => void;
  importBibtex: () => void;
  importZoteroRdf: () => void;
  navBack: () => void;
  navForward: () => void;

  // Active-note handlers — the factory supplies the guarded path.
  rename: (path: string) => void;
  move: (path: string) => void;
  copy: (path: string) => void;
  autoTag: (path: string) => void;
  autoLink: (path: string) => void;
  autoLinkInbound: (path: string) => void;
  decompose: (path: string) => void;

  // Theme — the label + surface re-tint stay in App.
  selectTheme: (mode: ThemeMode) => void;
  cycleTheme: () => void;
  getThemeLabel: () => ThemeMode;

  // View-mode cycle + the palette's backing caches.
  cycleViewMode: () => void;
  refreshSourcesCache: () => void;
  refreshSavedQueriesCache: () => void;

  // Editor font size (App `$state`, also read by the status bar).
  getEditorFontSize: () => number;
  setEditorFontSize: (n: number) => void;

  // UI chrome / dialog visibility (App `$state`).
  setFindInNotesMode: (mode: 'find' | 'replace') => void;
  setShowGotoLine: (v: boolean) => void;
  setShowGotoNote: (v: boolean) => void;
  toggleQuickOpen: () => void;
  setShowEditSavedQueries: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  toggleSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleCommandPalette: () => void;
}

export function createCommandKeymap(ctx: CommandKeymapCtx): {
  commandDeps: CommandDeps;
  keymapDeps: KeymapDeps;
} {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const nav = getNavigationStore();
  const conversationsStore = getConversationsStore();

  const commandDeps: CommandDeps = {
    hasProject: () => !!notebase.meta,
    hasNote: () => !!editor.activeFilePath,
    hasActiveNoteTab: () => editor.activeTab?.type === 'note',
    canGoBack: () => nav.canGoBack,
    canGoForward: () => nav.canGoForward,
    newNote: ctx.newNote,
    save: ctx.save,
    openProject: ctx.openProject,
    newProject: ctx.newProject,
    closeProject: () => { notebase.close(); editor.clear(); },
    editThoughtbaseGuide: ctx.editThoughtbaseGuide,
    print: () => window.print(),
    saveAsTemplate: ctx.saveAsTemplate,
    insertTemplate: ctx.insertTemplate,
    dictate: () => { void toggleEditorDictation(ctx.getEditorComponent()?.getView() ?? null); },
    find: () => ctx.getEditorComponent()?.openFind(),
    findReplace: () => ctx.getEditorComponent()?.openFindReplace(),
    findInNotes: () => ctx.setFindInNotesMode('find'),
    replaceInNotes: () => ctx.setFindInNotesMode('replace'),
    gotoLine: () => ctx.setShowGotoLine(true),
    sortLines: () => ctx.getEditorComponent()?.runSortLines(),
    toggleSidebar: ctx.toggleSidebar,
    toggleRightSidebar: ctx.toggleRightSidebar,
    togglePreview: ctx.cycleViewMode,
    toggleConversations: () => conversationsStore.toggle(),
    newConversation: ctx.newConversation,
    setTheme: (mode) => ctx.selectTheme(mode),
    currentTheme: () => ctx.getThemeLabel(),
    fontIncrease: () => {
      const ec = ctx.getEditorComponent();
      ec?.changeFontSize(1);
      ctx.setEditorFontSize(ec?.currentFontSize() ?? ctx.getEditorFontSize());
    },
    fontDecrease: () => {
      const ec = ctx.getEditorComponent();
      ec?.changeFontSize(-1);
      ctx.setEditorFontSize(ec?.currentFontSize() ?? ctx.getEditorFontSize());
    },
    fontReset: () => { ctx.getEditorComponent()?.resetFontSize(); ctx.setEditorFontSize(14); },
    quickOpen: () => {
      ctx.refreshSourcesCache();
      ctx.refreshSavedQueriesCache();
      ctx.setShowGotoNote(true);
    },
    navBack: ctx.navBack,
    navForward: ctx.navForward,
    renameActive: () => { if (editor.activeFilePath) ctx.rename(editor.activeFilePath); },
    moveActive: () => { if (editor.activeFilePath) ctx.move(editor.activeFilePath); },
    copyActive: () => { if (editor.activeFilePath) ctx.copy(editor.activeFilePath); },
    extractSelection: ctx.extractSelection,
    splitHere: ctx.splitHere,
    splitByHeading: ctx.splitByHeading,
    autoTagActive: () => { if (editor.activeFilePath) ctx.autoTag(editor.activeFilePath); },
    autoLinkActive: () => { if (editor.activeFilePath) ctx.autoLink(editor.activeFilePath); },
    autoLinkInboundActive: () => { if (editor.activeFilePath) ctx.autoLinkInbound(editor.activeFilePath); },
    decomposeActive: () => { if (editor.activeFilePath) ctx.decompose(editor.activeFilePath); },
    format: ctx.format,
    ingestUrl: ctx.ingestUrl,
    ingestIdentifier: ctx.ingestIdentifier,
    ingestFile: ctx.ingestFile,
    importBibtex: ctx.importBibtex,
    importZoteroRdf: ctx.importZoteroRdf,
    bibliography: ctx.bibliography,
    newQuery: () => editor.openQuery(),
    editSavedQueries: () => ctx.setShowEditSavedQueries(true),
    openSettings: () => ctx.setShowSettings(true),
  };

  const keymapDeps: KeymapDeps = {
    hasProject: () => !!notebase.meta,
    hasActiveTab: () => !!editor.activeTab,
    hasActiveIndex: () => editor.activeIndex >= 0,
    toggleCommandPalette: ctx.toggleCommandPalette,
    navBack: ctx.navBack,
    navForward: ctx.navForward,
    cyclePreview: ctx.cycleViewMode,
    toggleRightSidebar: ctx.toggleRightSidebar,
    cycleTheme: ctx.cycleTheme,
    newNote: ctx.newNote,
    closeActiveTab: () => { editor.closeTab(editor.activeIndex); },
    toggleQuickOpen: ctx.toggleQuickOpen,
    openGotoLine: () => ctx.setShowGotoLine(true),
    newQuery: () => editor.openQuery(),
    openConversation: ctx.openConversation,
  };

  return { commandDeps, keymapDeps };
}
