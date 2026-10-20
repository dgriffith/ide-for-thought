/**
 * The app's commands (#2625, epic #2622): one list, declared once, which every
 * surface places by id.
 *
 * - The native menu bar (`src/main/menu.ts`) places a command with
 *   `command(id)`: the item takes its label, accelerator, tooltip and gate
 *   from here, and clicking it sends `menu:command` with the id — still
 *   "a menu item sends a channel" (#2233), one channel for all of them.
 * - The command palette lists every entry with `palette`, in this order.
 * - The renderer runs a command by id from ONE action table
 *   (`renderer/lib/app/command-actions.ts`), a `Record<CommandId, …>` — so a
 *   command declared here without an action doesn't compile, and the menu and
 *   the palette can't run different code for the same command.
 *
 * - The window keymap (`renderer/lib/keymap/handle-keydown.ts`) binds rows of
 *   command ids; each row's key is the command's `key` here.
 * - The editor's CodeMirror keymap binds every `editor` command's key, and
 *   the editor's right-click menu runs the same commands.
 *
 * Plain data, no Electron and no DOM: both processes import it. A plugin's
 * commands (#2615) will register here.
 */
import { THEME_MODES } from './theme';

/** When a palette entry is enabled. */
export type PaletteWhen =
  | 'always'
  | 'project'
  /** A note (or other file) is the active tab's file. */
  | 'note'
  /** The active tab is a note tab specifically. */
  | 'noteTab'
  | 'canGoBack'
  | 'canGoForward';

/** What a menu item needs beyond an open thoughtbase. */
export interface MenuGate {
  /** Any editor tab open (note / query / source). */
  editor?: boolean;
  /** A note tab active. */
  note?: boolean;
  /** A non-empty text selection. */
  selection?: boolean;
}

export interface CommandDef {
  /** `category.action`; the palette's recently-used key. */
  id: string;
  /** The palette's title, and the menu's label unless `menu.label` says otherwise. */
  title: string;
  /** The palette's grouping line. */
  category: string;
  /** Electron accelerator — the menu item's, and the shortcut the palette shows. */
  key?: string;
  /** Listed in the command palette, enabled `when`. */
  palette?: { when: PaletteWhen };
  /**
   * A CodeMirror command, run on the focused editor (#2625): what the editor's
   * keymap binds, and what the editor's right-click menu runs. `key` is
   * CodeMirror syntax (`Mod-b`); a user's override keys on the command's id.
   */
  editor?: { key?: string };
  /**
   * A plugin view may run it with a shortcut it didn't handle itself (#2827).
   * A plugin can fake a keystroke, so only commands that move around the app
   * or show something — never ones that change a note or the thoughtbase.
   */
  fromPluginViews?: true;
  /** How the command looks as a menu item, wherever `menu.ts` places it. */
  menu?: {
    label?: string;
    toolTip?: string;
    /** `false`: enabled with no thoughtbase open. Otherwise it needs one, plus these. */
    gate?: MenuGate | false;
  };
}

const NOTE: MenuGate = { note: true };

export const COMMANDS = [
  // ── File ──
  { id: 'file.newNote', title: 'New Note', category: 'File', key: 'CmdOrCtrl+N', palette: { when: 'project' }, menu: {} },
  { id: 'file.save', title: 'Save', category: 'File', key: 'CmdOrCtrl+S', palette: { when: 'note' }, menu: { gate: NOTE } },
  { id: 'file.openProject', title: 'Open Thoughtbase…', category: 'File', key: 'CmdOrCtrl+O', palette: { when: 'always' }, menu: { gate: false } },
  { id: 'file.newProject', title: 'New Thoughtbase…', category: 'File', palette: { when: 'always' }, menu: { gate: false } },
  { id: 'file.closeProject', title: 'Close Thoughtbase', category: 'File', key: 'CmdOrCtrl+Shift+W', palette: { when: 'project' }, menu: {} },
  { id: 'file.editThoughtbaseGuide', title: 'Edit Thoughtbase Guide…', category: 'File', palette: { when: 'project' },
    menu: { toolTip: 'Open thoughtbase.md — the plain-English guide (structure, intent, conventions) shown to the assistant at the start of every conversation. Created from a template if it doesn\'t exist yet.' } },
  { id: 'file.print', title: 'Print…', category: 'File', palette: { when: 'note' }, menu: { gate: NOTE } },
  { id: 'file.saveAsTemplate', title: 'Save as Template…', category: 'File', palette: { when: 'noteTab' }, menu: { gate: NOTE } },
  { id: 'edit.insertTemplate', title: 'Insert Template…', category: 'Edit', palette: { when: 'noteTab' }, menu: { gate: NOTE } },
  { id: 'edit.dictate', title: 'Dictate (Voice to Text)', category: 'Edit', key: 'CmdOrCtrl+Shift+V', palette: { when: 'noteTab' } },
  { id: 'file.newAudioRecording', title: 'New Audio Recording (Start / Stop)', category: 'File', palette: { when: 'project' },
    menu: { label: 'New Audio Recording', toolTip: 'Record from the microphone into a file in the thoughtbase, embedded in the open note. Choose it again to stop.' } },
  { id: 'edit.transcribeRecording', title: 'Transcribe Audio Recording', category: 'Edit', palette: { when: 'noteTab' } },
  { id: 'edit.summarizeRecording', title: 'Summarize Audio Recording…', category: 'Edit', palette: { when: 'noteTab' } },
  // ── Edit / search ──
  { id: 'edit.find', title: 'Find', category: 'Edit', key: 'CmdOrCtrl+F', palette: { when: 'note' }, menu: { gate: NOTE } },
  { id: 'edit.findReplace', title: 'Find and Replace', category: 'Edit', key: 'CmdOrCtrl+H', palette: { when: 'note' }, menu: { gate: NOTE } },
  { id: 'edit.findInNotes', fromPluginViews: true, title: 'Find in Notes…', category: 'Edit', key: 'CmdOrCtrl+Shift+F', palette: { when: 'project' }, menu: {} },
  { id: 'edit.replaceInNotes', title: 'Replace in Notes…', category: 'Edit', key: 'CmdOrCtrl+Shift+H', palette: { when: 'project' }, menu: {} },
  { id: 'edit.gotoLine', title: 'Go to Line…', category: 'Edit', key: 'CmdOrCtrl+G', palette: { when: 'note' }, menu: { label: 'Go to Line', gate: NOTE } },
  { id: 'edit.sortLines', title: 'Sort Lines', category: 'Edit', palette: { when: 'note' }, menu: { gate: NOTE } },
  // ── View ──
  { id: 'view.toggleSidebar', fromPluginViews: true, title: 'Toggle Left Sidebar', category: 'View', key: 'CmdOrCtrl+B', palette: { when: 'always' }, menu: {} },
  { id: 'view.toggleRightSidebar', fromPluginViews: true, title: 'Toggle Right Sidebar', category: 'View', key: 'CmdOrCtrl+Shift+B', palette: { when: 'always' }, menu: {} },
  { id: 'view.togglePreview', title: 'Toggle Preview Mode', category: 'View', key: 'CmdOrCtrl+Shift+P', palette: { when: 'note' }, menu: { label: 'Cycle Preview Mode', gate: NOTE } },
  { id: 'view.toggleConversations', fromPluginViews: true, title: 'Toggle Conversations', category: 'View', key: 'CmdOrCtrl+Shift+K', palette: { when: 'always' }, menu: {} },
  // One directly selectable entry per theme (#1139); the menu's Theme submenu
  // is a radio group with the mode as its payload, so it isn't one of these.
  ...THEME_MODES.map((m) => ({ id: `view.theme.${m.value}` as const, title: `Theme: ${m.label}`, category: 'View', palette: { when: 'always' as const } })),
  { id: 'view.fontIncrease', title: 'Increase Font Size', category: 'View', key: 'CmdOrCtrl+Shift+=', palette: { when: 'always' }, menu: { label: 'Increase Editor Font Size' } },
  { id: 'view.fontDecrease', title: 'Decrease Font Size', category: 'View', key: 'CmdOrCtrl+Shift+-', palette: { when: 'always' }, menu: { label: 'Decrease Editor Font Size' } },
  { id: 'view.fontReset', title: 'Reset Font Size', category: 'View', palette: { when: 'always' }, menu: { label: 'Reset Editor Font Size' } },
  // ── Learning ──
  { id: 'learning.askQuestion', title: 'Ask a Question', category: 'Learning', palette: { when: 'project' }, menu: {} },
  // ── Navigate ──
  { id: 'nav.quickOpen', fromPluginViews: true, title: 'Go to…', category: 'Navigate', key: 'CmdOrCtrl+P', palette: { when: 'project' }, menu: { label: 'Quick Open' } },
  { id: 'nav.back', fromPluginViews: true, title: 'Navigate Back', category: 'Navigate', key: 'CmdOrCtrl+[', palette: { when: 'canGoBack' }, menu: { label: 'Back' } },
  { id: 'nav.forward', fromPluginViews: true, title: 'Navigate Forward', category: 'Navigate', key: 'CmdOrCtrl+]', palette: { when: 'canGoForward' }, menu: { label: 'Forward' } },
  // ── Refactor ──
  { id: 'refactor.rename', title: 'Rename Note…', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Rename…', gate: NOTE } },
  { id: 'refactor.move', title: 'Move Note…', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Move…', gate: NOTE } },
  { id: 'refactor.copy', title: 'Copy Note…', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Copy…', gate: NOTE } },
  { id: 'refactor.extract', title: 'Extract Selection to New Note', category: 'Refactor', palette: { when: 'noteTab' }, menu: { gate: { note: true, selection: true } } },
  { id: 'refactor.splitHere', title: 'Split Here', category: 'Refactor', palette: { when: 'noteTab' }, menu: { label: 'Split Note Here', gate: NOTE } },
  { id: 'refactor.splitByHeading', title: 'Split by Heading…', category: 'Refactor', palette: { when: 'noteTab' }, menu: { gate: NOTE } },
  { id: 'refactor.autoTag', title: 'Auto-tag Note', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Auto-tag', gate: NOTE } },
  { id: 'objects.promoteToType', title: 'Treat This Note as a Type…', category: 'Refactor', palette: { when: 'noteTab' } },
  { id: 'objects.saveAsObjectType', title: 'Save Note as Object Type…', category: 'File', palette: { when: 'noteTab' }, menu: { gate: NOTE } },
  { id: 'refactor.autoLink', title: 'Auto-link Outbound', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Auto-link outbound…', gate: NOTE } },
  { id: 'refactor.autoLinkInbound', title: 'Auto-link Inbound', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Auto-link inbound…', gate: NOTE } },
  { id: 'refactor.decompose', title: 'Decompose into Claims', category: 'Refactor', palette: { when: 'note' }, menu: { label: 'Decompose Note…', gate: NOTE } },
  { id: 'refactor.format', title: 'Format', category: 'Refactor', palette: { when: 'note' },
    menu: { toolTip: 'Format the active note, or every note in the left-sidebar selection (use ⌘-click / shift-click to multi-select, ⌘-A to select all).' } },
  // ── Research ──
  { id: 'research.ingestUrl', title: 'Ingest URL as Source…', category: 'Research', key: 'CmdOrCtrl+Shift+I', palette: { when: 'project' }, menu: {} },
  { id: 'research.ingestIdentifier', title: 'Ingest Identifier…', category: 'Research', key: 'CmdOrCtrl+Shift+D', palette: { when: 'project' }, menu: {} },
  { id: 'research.ingestFile', title: 'Ingest File as Source…', category: 'Research', palette: { when: 'project' }, menu: {} },
  { id: 'research.ingestBulk', title: 'Ingest Zip or Folder as Sources…', category: 'Research', palette: { when: 'project' }, menu: {} },
  { id: 'research.importBibtex', title: 'Import BibTeX…', category: 'Research', palette: { when: 'project' }, menu: {} },
  { id: 'research.importZoteroRdf', title: 'Import Zotero RDF…', category: 'Research', palette: { when: 'project' }, menu: {} },
  { id: 'research.bibliography', title: 'Insert/Update Bibliography', category: 'Research', palette: { when: 'note' },
    menu: { gate: NOTE, toolTip: 'Render a References section listing every source the active note cites, in the project’s configured CSL style.' } },
  // ── Query ──
  { id: 'query.new', title: 'New Query', category: 'Query', key: 'CmdOrCtrl+Shift+Q', palette: { when: 'project' }, menu: {} },
  { id: 'query.editSaved', title: 'Edit Saved Queries…', category: 'Query', palette: { when: 'project' }, menu: { gate: false } },
  // ── App ──
  { id: 'app.settings', title: 'Settings…', category: 'App', key: 'CmdOrCtrl+,', palette: { when: 'always' }, menu: { label: 'Preferences…', gate: false } },

  // ── Menu only ──
  { id: 'app.about', title: 'About Minerva', category: 'App', menu: { gate: false } },
  { id: 'app.shortcuts', fromPluginViews: true, title: 'Keyboard Shortcuts…', category: 'App', key: 'CmdOrCtrl+/', menu: { gate: false } },
  { id: 'app.installTutorial', title: 'Install Tutorial Thoughtbase…', category: 'App', menu: { gate: false } },
  { id: 'file.clearRecent', title: 'Clear Recent Thoughtbases', category: 'File', menu: { gate: false } },
  { id: 'file.thoughtbaseProperties', title: 'Thoughtbase Properties…', category: 'File',
    menu: { toolTip: 'Rename the thoughtbase and (advanced) set its knowledge-graph base IRI.' } },
  { id: 'file.revealFile', title: 'Reveal in Finder', category: 'File', key: 'CmdOrCtrl+Shift+R', menu: { gate: NOTE } },
  { id: 'file.openInDefault', title: 'Open in Default App', category: 'File', menu: { gate: NOTE } },
  { id: 'file.openInTerminal', title: 'Open in Terminal', category: 'File', menu: {} },
  { id: 'view.commandPalette', fromPluginViews: true, title: 'Command Palette', category: 'View', key: 'CmdOrCtrl+K', menu: {} },
  { id: 'view.splitRight', title: 'Split Editor Right', category: 'View', key: 'CmdOrCtrl+\\', menu: {} },
  { id: 'view.splitDown', title: 'Split Editor Down', category: 'View', key: 'CmdOrCtrl+Shift+\\', menu: {} },
  { id: 'view.focusNextGroup', fromPluginViews: true, title: 'Focus Next Group', category: 'View', key: 'CmdOrCtrl+Alt+Right', menu: { gate: { editor: true } } },
  { id: 'view.focusPrevGroup', fromPluginViews: true, title: 'Focus Previous Group', category: 'View', key: 'CmdOrCtrl+Alt+Left', menu: { gate: { editor: true } } },
  { id: 'view.closeGroup', title: 'Close Group', category: 'View', key: 'CmdOrCtrl+Shift+W', menu: { gate: { editor: true } } },
  { id: 'view.cycleTheme', title: 'Cycle Theme', category: 'View', key: 'CmdOrCtrl+Shift+T', menu: { gate: false } },
  { id: 'export.publish', title: 'Publish to Web…', category: 'Export', menu: {} },

  // ── Window keymap only (`renderer/lib/keymap/handle-keydown.ts`) ──
  { id: 'view.closeTab', fromPluginViews: true, title: 'Close Tab', category: 'View', key: 'CmdOrCtrl+W' },
  { id: 'learning.openConversation', title: 'Open Conversation', category: 'Learning', key: 'CmdOrCtrl+Shift+I' },

  // ── Editor (CodeMirror) commands ──
  // Text
  { id: 'editor.toggleCase', title: 'Toggle Case', category: 'Editor', editor: { key: 'Mod-Shift-u' } },
  { id: 'editor.joinLines', title: 'Join Lines', category: 'Editor', editor: { key: 'Ctrl-Shift-j' } },
  { id: 'editor.duplicateLine', title: 'Duplicate Line', category: 'Editor', editor: { key: 'Mod-d' } },
  { id: 'editor.sortLines', title: 'Sort Lines', category: 'Editor', editor: {} },
  // Selection
  { id: 'editor.extendSelection', title: 'Extend Selection', category: 'Editor', editor: { key: 'Alt-ArrowUp' } },
  { id: 'editor.shrinkSelection', title: 'Shrink Selection', category: 'Editor', editor: { key: 'Alt-ArrowDown' } },
  // Accessibility — releases Tab so keyboard users can move focus out of the
  // editor now that Tab indents. CodeMirror's default is `Ctrl-m`, but its
  // `mac: 'Shift-Alt-m'` override can never fire: Option composes characters on
  // macOS, so the browser reports "Â" rather than "m". `Ctrl-m` everywhere is a
  // no-op off macOS (defaultKeymap already binds it) and fixes it on macOS.
  { id: 'editor.toggleTabFocusMode', title: 'Toggle Tab Moves Focus', category: 'Editor', editor: { key: 'Ctrl-m' } },
  // Inline formatting
  { id: 'editor.toggleBold', title: 'Bold', category: 'Editor', editor: { key: 'Mod-b' } },
  { id: 'editor.toggleItalic', title: 'Italic', category: 'Editor', editor: { key: 'Mod-i' } },
  { id: 'editor.toggleCode', title: 'Code', category: 'Editor', editor: { key: 'Mod-e' } },
  { id: 'editor.toggleStrikethrough', title: 'Strikethrough', category: 'Editor', editor: { key: 'Mod-Shift-x' } },
  // `Mod-Shift-h` would collide with the menu's "Replace in Notes…"
  // accelerator (matches VS Code's Replace-in-Files). Y → yellow, the
  // default highlight color, gives the shortcut a mnemonic anchor.
  { id: 'editor.toggleHighlight', title: 'Highlight (cycle color)', category: 'Editor', editor: { key: 'Mod-Shift-y' } },
  // Paragraph
  { id: 'editor.toggleH1', title: 'Heading 1', category: 'Editor', editor: {} },
  { id: 'editor.toggleH2', title: 'Heading 2', category: 'Editor', editor: {} },
  { id: 'editor.toggleH3', title: 'Heading 3', category: 'Editor', editor: {} },
  { id: 'editor.toggleQuote', title: 'Quote', category: 'Editor', editor: {} },
  { id: 'editor.toggleBulletList', title: 'Bulleted List', category: 'Editor', editor: {} },
  { id: 'editor.toggleNumberedList', title: 'Numbered List', category: 'Editor', editor: {} },
  { id: 'editor.toggleTaskList', title: 'Task List', category: 'Editor', editor: {} },
  // Voice
  { id: 'editor.dictate', title: 'Dictate (Voice to Text)', category: 'Editor', editor: { key: 'Mod-Shift-v' } },
  { id: 'editor.recordAudio', title: 'Record Audio', category: 'Editor', editor: {} },
  { id: 'editor.transcribeRecording', title: 'Transcribe Recording', category: 'Editor', editor: {} },
  // Insert
  { id: 'editor.insertLink', title: 'Insert Link', category: 'Editor', editor: { key: 'Mod-k' } },
  { id: 'editor.insertWikiLink', title: 'Insert Wiki Link', category: 'Editor', editor: {} },
  { id: 'editor.insertImage', title: 'Insert Image', category: 'Editor', editor: {} },
  { id: 'editor.insertTable', title: 'Insert Table', category: 'Editor', editor: {} },
  { id: 'editor.insertHorizontalRule', title: 'Insert Horizontal Rule', category: 'Editor', editor: {} },
  { id: 'editor.insertFootnote', title: 'Insert Footnote', category: 'Editor', editor: {} },
] as const satisfies readonly CommandDef[];

export type CommandId = (typeof COMMANDS)[number]['id'];
/** The CodeMirror commands — run on the focused editor. */
export type EditorCommandId = Extract<(typeof COMMANDS)[number], { editor: object }>['id'];
/** The commands that can be placed in a menu. */
export type MenuCommandId = Extract<(typeof COMMANDS)[number], { menu: object }>['id'];

const BY_ID: ReadonlyMap<string, CommandDef> = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandDef(id: CommandId): CommandDef {
  return BY_ID.get(id)!;
}

export function isCommandId(id: unknown): id is CommandId {
  return typeof id === 'string' && BY_ID.has(id);
}
