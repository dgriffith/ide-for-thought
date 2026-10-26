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
import { getAudioRecordingStore } from '../voice/audio-recording.svelte';
import type { EditorView } from '@codemirror/view';
import type { ThemeMode } from '../theme';
import type { PaletteState } from '../command-palette/registry';
import type { CommandId, EditorCommandId } from '../../../shared/commands';
import { EDITOR_COMMANDS } from '../editor/command-registry';
import { api } from '../ipc/client';
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
  openThoughtbaseProperties: () => void;
  installTutorial: () => void;
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
  ingestBulk: () => void;
  importBibtex: () => void;
  importZoteroRdf: () => void;
  navBack: () => void;
  navForward: () => void;

  // Active-note handlers — the factory supplies the guarded path.
  rename: (path: string) => void;
  move: (path: string) => void;
  copy: (path: string) => void;
  autoTag: (path: string) => void;
  promoteToType: () => void;
  saveNoteAsObjectType: () => void;
  autoLink: (path: string) => void;
  autoLinkInbound: (path: string) => void;
  decompose: (path: string) => void;
  /** Run a skill by id, gathering context from the focused editor. */
  invokeTool: (toolId: string) => void;

  // Theme — the label + surface re-tint stay in App.
  selectTheme: (mode: ThemeMode) => void;
  cycleTheme: () => void;
  getThemeLabel: () => ThemeMode;
  /** The focused editor has a non-empty text selection (App's cursor info). */
  hasSelection: () => boolean;

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
  toggleQuickOpen: () => void;
  setShowEditSavedQueries: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowAbout: (v: boolean) => void;
  setShowShortcuts: (v: boolean) => void;
  setPublishDialogOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleCommandPalette: () => void;
}

export function createCommandKeymap(ctx: CommandKeymapCtx): {
  paletteState: PaletteState;
  commandActions: Record<CommandId, () => void>;
  keymapDeps: KeymapDeps;
} {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const nav = getNavigationStore();
  const conversationsStore = getConversationsStore();
  const recordings = getAudioRecordingStore();
  const focusedView = () => ctx.getEditorComponent()?.getView() ?? null;

  const paletteState: PaletteState = {
    hasProject: () => !!notebase.meta,
    hasNote: () => !!editor.activeFilePath,
    hasActiveNoteTab: () => editor.activeTab?.type === 'note',
    canGoBack: () => nav.canGoBack,
    canGoForward: () => nav.canGoForward,
    hasSelection: () => editor.activeTab?.type === 'note' && ctx.hasSelection(),
    currentTheme: () => ctx.getThemeLabel(),
  };

  /** Run `fn` on the active note's path, if there is one. */
  const onActive = (fn: (path: string) => void) => () => { if (editor.activeFilePath) fn(editor.activeFilePath); };
  const fontStep = (delta: number) => () => {
    const ec = ctx.getEditorComponent();
    ec?.changeFontSize(delta);
    ctx.setEditorFontSize(ec?.currentFontSize() ?? ctx.getEditorFontSize());
  };
  const theme = (mode: ThemeMode) => () => ctx.selectTheme(mode);

  const editorActions = Object.fromEntries(
    (Object.entries(EDITOR_COMMANDS) as Array<[EditorCommandId, (v: EditorView) => boolean]>).map(([id, run]) => [id, () => {
      const view = focusedView();
      if (view) run(view);
    }]),
  ) as Record<EditorCommandId, () => void>;

  // What each command does (#2625) — the one place, whichever surface runs it:
  // the menu bar (`menu:command`) or the palette. Keyed by `CommandId`, so a
  // command declared in `shared/commands.ts` without an action here doesn't
  // compile.
  const commandActions: Record<CommandId, () => void> = {
    // ── File ──
    'file.newNote': ctx.newNote,
    'file.save': ctx.save,
    'file.openProject': ctx.openProject,
    'file.newProject': ctx.newProject,
    'file.closeProject': () => { notebase.close(); editor.clear(); },
    'file.editThoughtbaseGuide': ctx.editThoughtbaseGuide,
    'file.print': () => window.print(),
    'file.saveAsTemplate': ctx.saveAsTemplate,
    'edit.insertTemplate': ctx.insertTemplate,
    'file.newAudioRecording': () => { void recordings.toggle(focusedView); },
    'edit.transcribeRecording': () => { void recordings.transcribeAtCursor(focusedView); },
    'edit.summarizeRecording': () => { recordings.summarizeAtCursor(focusedView, ctx.invokeTool); },
    'file.clearRecent': () => { void api.notebase.clearRecent(); },
    'file.thoughtbaseProperties': ctx.openThoughtbaseProperties,
    // No active file → nothing to reveal; a silent no-op.
    'file.revealFile': onActive((p) => { void api.shell.revealFile(p); }),
    'file.openInDefault': onActive((p) => { void api.shell.openInDefault(p); }),
    'file.openInTerminal': () => { void api.shell.openInTerminal(editor.activeFilePath ?? undefined); },
    // ── Edit ──
    'edit.find': () => ctx.getEditorComponent()?.openFind(),
    'edit.findReplace': () => ctx.getEditorComponent()?.openFindReplace(),
    'edit.findInNotes': () => ctx.setFindInNotesMode('find'),
    'edit.replaceInNotes': () => ctx.setFindInNotesMode('replace'),
    'edit.gotoLine': () => { if (editor.activeTab) ctx.setShowGotoLine(true); },
    'edit.sortLines': () => ctx.getEditorComponent()?.runSortLines(),
    // ── View ──
    'view.commandPalette': ctx.toggleCommandPalette,
    'view.toggleSidebar': ctx.toggleSidebar,
    'view.toggleRightSidebar': ctx.toggleRightSidebar,
    'view.togglePreview': ctx.cycleViewMode,
    'view.toggleConversations': () => conversationsStore.toggle(),
    'view.theme.dark': theme('dark'),
    'view.theme.light': theme('light'),
    'view.theme.contrast': theme('contrast'),
    'view.theme.system': theme('system'),
    'view.cycleTheme': ctx.cycleTheme,
    'view.fontIncrease': fontStep(1),
    'view.fontDecrease': fontStep(-1),
    'view.fontReset': () => { ctx.getEditorComponent()?.resetFontSize(); ctx.setEditorFontSize(14); },
    // Editor split — pane focus & layout (#814).
    'view.splitRight': () => editor.splitGroup(editor.activeGroupId, 'horizontal'),
    'view.splitDown': () => editor.splitGroup(editor.activeGroupId, 'vertical'),
    'view.focusNextGroup': () => editor.focusNextGroup(),
    'view.focusPrevGroup': () => editor.focusPreviousGroup(),
    'view.closeGroup': () => editor.closeActiveGroup(),
    // ── Learning ──
    'learning.askQuestion': ctx.newConversation,
    // ── Navigate ──
    'nav.quickOpen': () => {
      // Refresh the palette's source + query backing data so its scope chip
      // counts are fresh when it opens. Toggles, as ⌘P always has.
      ctx.refreshSourcesCache();
      ctx.refreshSavedQueriesCache();
      ctx.toggleQuickOpen();
    },
    'nav.back': ctx.navBack,
    'nav.forward': ctx.navForward,
    // ── Refactor ──
    'refactor.rename': onActive(ctx.rename),
    'refactor.move': onActive(ctx.move),
    'refactor.copy': onActive(ctx.copy),
    'refactor.extract': ctx.extractSelection,
    'refactor.splitHere': ctx.splitHere,
    'refactor.splitByHeading': ctx.splitByHeading,
    'refactor.autoTag': onActive(ctx.autoTag),
    'objects.promoteToType': () => ctx.promoteToType(),
    'objects.saveAsObjectType': () => ctx.saveNoteAsObjectType(),
    'refactor.autoLink': onActive(ctx.autoLink),
    'refactor.autoLinkInbound': onActive(ctx.autoLinkInbound),
    'refactor.decompose': onActive(ctx.decompose),
    'refactor.format': ctx.format,
    // ── Research ──
    'research.ingestUrl': ctx.ingestUrl,
    'research.ingestIdentifier': ctx.ingestIdentifier,
    'research.ingestFile': ctx.ingestFile,
    'research.ingestBulk': ctx.ingestBulk,
    'research.importBibtex': ctx.importBibtex,
    'research.importZoteroRdf': ctx.importZoteroRdf,
    'research.bibliography': ctx.bibliography,
    // ── Query / Export ──
    'query.new': () => editor.openQuery(),
    'query.editSaved': () => ctx.setShowEditSavedQueries(true),
    'export.publish': () => ctx.setPublishDialogOpen(true),
    // ── App ──
    'app.settings': () => ctx.setShowSettings(true),
    'app.about': () => ctx.setShowAbout(true),
    'app.shortcuts': () => ctx.setShowShortcuts(true),
    'app.installTutorial': ctx.installTutorial,
    // ── Window keymap only ──
    'view.closeTab': () => { editor.closeTab(editor.activeIndex); },
    'learning.openConversation': ctx.openConversation,
    // ── Editor commands, run on the focused pane's editor ──
    ...editorActions,
    // After the spread, so it wins over the editor's own (#2758): from the
    // palette there may be no focused editor, and dictation still has to stop
    // a recording it started, so this passes null rather than doing nothing.
    'edit.dictate': () => { void toggleEditorDictation(ctx.getEditorComponent()?.getView() ?? null); },
  };

  const keymapDeps: KeymapDeps = {
    run: (id) => commandActions[id](),
    hasProject: () => !!notebase.meta,
    hasActiveTab: () => !!editor.activeTab,
    hasActiveIndex: () => editor.activeIndex >= 0,
  };

  return { paletteState, commandActions, keymapDeps };
}
