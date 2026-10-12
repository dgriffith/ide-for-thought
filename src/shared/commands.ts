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
  { id: 'edit.findInNotes', title: 'Find in Notes…', category: 'Edit', key: 'CmdOrCtrl+Shift+F', palette: { when: 'project' }, menu: {} },
  { id: 'edit.replaceInNotes', title: 'Replace in Notes…', category: 'Edit', key: 'CmdOrCtrl+Shift+H', palette: { when: 'project' }, menu: {} },
  { id: 'edit.gotoLine', title: 'Go to Line…', category: 'Edit', key: 'CmdOrCtrl+G', palette: { when: 'note' }, menu: { label: 'Go to Line', gate: NOTE } },
  { id: 'edit.sortLines', title: 'Sort Lines', category: 'Edit', palette: { when: 'note' }, menu: { gate: NOTE } },
  // ── View ──
  { id: 'view.toggleSidebar', title: 'Toggle Left Sidebar', category: 'View', key: 'CmdOrCtrl+B', palette: { when: 'always' }, menu: {} },
  { id: 'view.toggleRightSidebar', title: 'Toggle Right Sidebar', category: 'View', key: 'CmdOrCtrl+Shift+B', palette: { when: 'always' }, menu: {} },
  { id: 'view.togglePreview', title: 'Toggle Preview Mode', category: 'View', key: 'CmdOrCtrl+Shift+P', palette: { when: 'note' }, menu: { label: 'Cycle Preview Mode', gate: NOTE } },
  { id: 'view.toggleConversations', title: 'Toggle Conversations', category: 'View', key: 'CmdOrCtrl+Shift+K', palette: { when: 'always' }, menu: {} },
  // One directly selectable entry per theme (#1139); the menu's Theme submenu
  // is a radio group with the mode as its payload, so it isn't one of these.
  ...THEME_MODES.map((m) => ({ id: `view.theme.${m.value}` as const, title: `Theme: ${m.label}`, category: 'View', palette: { when: 'always' as const } })),
  { id: 'view.fontIncrease', title: 'Increase Font Size', category: 'View', key: 'CmdOrCtrl+Shift+=', palette: { when: 'always' }, menu: { label: 'Increase Editor Font Size' } },
  { id: 'view.fontDecrease', title: 'Decrease Font Size', category: 'View', key: 'CmdOrCtrl+Shift+-', palette: { when: 'always' }, menu: { label: 'Decrease Editor Font Size' } },
  { id: 'view.fontReset', title: 'Reset Font Size', category: 'View', palette: { when: 'always' }, menu: { label: 'Reset Editor Font Size' } },
  // ── Learning ──
  { id: 'learning.askQuestion', title: 'Ask a Question', category: 'Learning', palette: { when: 'project' }, menu: {} },
  // ── Navigate ──
  { id: 'nav.quickOpen', title: 'Go to…', category: 'Navigate', key: 'CmdOrCtrl+P', palette: { when: 'project' }, menu: { label: 'Quick Open' } },
  { id: 'nav.back', title: 'Navigate Back', category: 'Navigate', key: 'CmdOrCtrl+[', palette: { when: 'canGoBack' }, menu: { label: 'Back' } },
  { id: 'nav.forward', title: 'Navigate Forward', category: 'Navigate', key: 'CmdOrCtrl+]', palette: { when: 'canGoForward' }, menu: { label: 'Forward' } },
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
  { id: 'app.shortcuts', title: 'Keyboard Shortcuts…', category: 'App', key: 'CmdOrCtrl+/', menu: { gate: false } },
  { id: 'app.installTutorial', title: 'Install Tutorial Thoughtbase…', category: 'App', menu: { gate: false } },
  { id: 'file.clearRecent', title: 'Clear Recent Thoughtbases', category: 'File', menu: { gate: false } },
  { id: 'file.thoughtbaseProperties', title: 'Thoughtbase Properties…', category: 'File',
    menu: { toolTip: 'Rename the thoughtbase and (advanced) set its knowledge-graph base IRI.' } },
  { id: 'file.revealFile', title: 'Reveal in Finder', category: 'File', key: 'CmdOrCtrl+Shift+R', menu: { gate: NOTE } },
  { id: 'file.openInDefault', title: 'Open in Default App', category: 'File', menu: { gate: NOTE } },
  { id: 'file.openInTerminal', title: 'Open in Terminal', category: 'File', menu: {} },
  { id: 'view.commandPalette', title: 'Command Palette', category: 'View', key: 'CmdOrCtrl+K', menu: {} },
  { id: 'view.splitRight', title: 'Split Editor Right', category: 'View', key: 'CmdOrCtrl+\\', menu: {} },
  { id: 'view.splitDown', title: 'Split Editor Down', category: 'View', key: 'CmdOrCtrl+Shift+\\', menu: {} },
  { id: 'view.focusNextGroup', title: 'Focus Next Group', category: 'View', key: 'CmdOrCtrl+Alt+Right', menu: { gate: { editor: true } } },
  { id: 'view.focusPrevGroup', title: 'Focus Previous Group', category: 'View', key: 'CmdOrCtrl+Alt+Left', menu: { gate: { editor: true } } },
  { id: 'view.closeGroup', title: 'Close Group', category: 'View', key: 'CmdOrCtrl+Shift+W', menu: { gate: { editor: true } } },
  { id: 'view.cycleTheme', title: 'Cycle Theme', category: 'View', key: 'CmdOrCtrl+Shift+T', menu: { gate: false } },
  { id: 'export.publish', title: 'Publish to Web…', category: 'Export', menu: {} },
] as const satisfies readonly CommandDef[];

export type CommandId = (typeof COMMANDS)[number]['id'];
/** The commands that can be placed in a menu. */
export type MenuCommandId = Extract<(typeof COMMANDS)[number], { menu: object }>['id'];

const BY_ID: ReadonlyMap<string, CommandDef> = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandDef(id: CommandId): CommandDef {
  return BY_ID.get(id)!;
}

export function isCommandId(id: unknown): id is CommandId {
  return typeof id === 'string' && BY_ID.has(id);
}
