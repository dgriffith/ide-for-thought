/**
 * Command-palette registry (#463, extracted from App.svelte in #670).
 *
 * `buildCommandRegistry(deps)` is a pure mapping from injected dependencies
 * to the `Command[]` the palette (and, later, a custom-keybinding UI) draws
 * from. App.svelte calls it inside a `$derived`, so the `enabled` predicates
 * are passed as GETTER FUNCTIONS rather than plain booleans — the derived
 * re-tracks them on each recompute, keeping the palette from ever offering an
 * action that would silently no-op. The `run` callbacks fire later, on user
 * action, so they're plain thunks.
 *
 * Keeping this a pure function of `deps` (no store/component imports) makes the
 * command set and its dispatch unit-testable without mounting the app — the
 * safety net the #670 decomposition is built against.
 *
 * Adding a command: append a row here and a matching field to `CommandDeps`.
 * The Electron menu still lives in `src/main/menu.ts`.
 */
import type { Command } from './types';
import { formatAccelerator } from './format-accelerator';

/** Dependencies the command registry needs from the host component. */
export interface CommandDeps {
  // ── reactive state predicates (read inside App's $derived) ──
  hasProject(): boolean;
  hasNote(): boolean;
  hasActiveNoteTab(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  // ── File ──
  newNote(): void;
  save(): void;
  openProject(): void;
  newProject(): void;
  closeProject(): void;
  print(): void;
  saveAsTemplate(): void;
  // ── Edit ──
  insertTemplate(): void;
  find(): void;
  findReplace(): void;
  findInNotes(): void;
  replaceInNotes(): void;
  gotoLine(): void;
  sortLines(): void;
  // ── View ──
  toggleSidebar(): void;
  toggleRightSidebar(): void;
  togglePreview(): void;
  toggleConversations(): void;
  newConversation(): void;
  cycleTheme(): void;
  fontIncrease(): void;
  fontDecrease(): void;
  fontReset(): void;
  // ── Navigate ──
  quickOpen(): void;
  navBack(): void;
  navForward(): void;
  // ── Refactor (operate on the active note) ──
  renameActive(): void;
  moveActive(): void;
  copyActive(): void;
  extractSelection(): void;
  splitHere(): void;
  splitByHeading(): void;
  autoTagActive(): void;
  autoLinkActive(): void;
  autoLinkInboundActive(): void;
  decomposeActive(): void;
  format(): void;
  // ── Research ──
  ingestUrl(): void;
  ingestIdentifier(): void;
  ingestFile(): void;
  importBibtex(): void;
  importZoteroRdf(): void;
  bibliography(): void;
  // ── Query ──
  newQuery(): void;
  editSavedQueries(): void;
  // ── App ──
  openSettings(): void;
}

export function buildCommandRegistry(deps: CommandDeps): Command[] {
  const hasProject = deps.hasProject();
  const hasNote = deps.hasNote();
  const hasActiveNoteTab = deps.hasActiveNoteTab();
  return [
    // ── File ──
    { id: 'file.newNote', title: 'New Note', category: 'File',
      keybinding: formatAccelerator('CmdOrCtrl+N'),
      enabled: hasProject, run: () => deps.newNote() },
    { id: 'file.save', title: 'Save', category: 'File',
      keybinding: formatAccelerator('CmdOrCtrl+S'),
      enabled: hasNote, run: () => deps.save() },
    { id: 'file.openProject', title: 'Open Thoughtbase…', category: 'File',
      keybinding: formatAccelerator('CmdOrCtrl+O'),
      enabled: true, run: () => deps.openProject() },
    { id: 'file.newProject', title: 'New Thoughtbase…', category: 'File',
      keybinding: null, enabled: true, run: () => deps.newProject() },
    { id: 'file.closeProject', title: 'Close Thoughtbase', category: 'File',
      keybinding: formatAccelerator('CmdOrCtrl+Shift+W'),
      enabled: hasProject, run: () => deps.closeProject() },
    { id: 'file.print', title: 'Print…', category: 'File',
      keybinding: null, enabled: hasNote, run: () => deps.print() },
    { id: 'file.saveAsTemplate', title: 'Save as Template…', category: 'File',
      keybinding: null, enabled: hasActiveNoteTab,
      run: () => deps.saveAsTemplate() },
    { id: 'edit.insertTemplate', title: 'Insert Template…', category: 'Edit',
      keybinding: null, enabled: hasActiveNoteTab,
      run: () => deps.insertTemplate() },
    // ── Edit / search ──
    { id: 'edit.find', title: 'Find', category: 'Edit',
      keybinding: formatAccelerator('CmdOrCtrl+F'),
      enabled: hasNote, run: () => deps.find() },
    { id: 'edit.findReplace', title: 'Find and Replace', category: 'Edit',
      keybinding: formatAccelerator('CmdOrCtrl+H'),
      enabled: hasNote, run: () => deps.findReplace() },
    { id: 'edit.findInNotes', title: 'Find in Notes…', category: 'Edit',
      keybinding: formatAccelerator('CmdOrCtrl+Shift+F'),
      enabled: hasProject, run: () => deps.findInNotes() },
    { id: 'edit.replaceInNotes', title: 'Replace in Notes…', category: 'Edit',
      keybinding: formatAccelerator('CmdOrCtrl+Shift+H'),
      enabled: hasProject, run: () => deps.replaceInNotes() },
    { id: 'edit.gotoLine', title: 'Go to Line…', category: 'Edit',
      keybinding: null, enabled: hasNote, run: () => deps.gotoLine() },
    { id: 'edit.sortLines', title: 'Sort Lines', category: 'Edit',
      keybinding: null, enabled: hasNote, run: () => deps.sortLines() },
    // ── View ──
    { id: 'view.toggleSidebar', title: 'Toggle Left Sidebar', category: 'View',
      keybinding: null, enabled: true, run: () => deps.toggleSidebar() },
    { id: 'view.toggleRightSidebar', title: 'Toggle Right Sidebar', category: 'View',
      keybinding: null, enabled: true, run: () => deps.toggleRightSidebar() },
    { id: 'view.togglePreview', title: 'Toggle Preview Mode', category: 'View',
      keybinding: null, enabled: hasNote, run: () => deps.togglePreview() },
    { id: 'view.toggleConversations', title: 'Toggle Conversations', category: 'View',
      keybinding: null, enabled: true, run: () => deps.toggleConversations() },
    { id: 'view.newConversation', title: 'New Conversation', category: 'View',
      keybinding: null, enabled: hasProject, run: () => deps.newConversation() },
    { id: 'view.cycleTheme', title: 'Cycle Theme', category: 'View',
      keybinding: null, enabled: true, run: () => deps.cycleTheme() },
    { id: 'view.fontIncrease', title: 'Increase Font Size', category: 'View',
      keybinding: null, enabled: true, run: () => deps.fontIncrease() },
    { id: 'view.fontDecrease', title: 'Decrease Font Size', category: 'View',
      keybinding: null, enabled: true, run: () => deps.fontDecrease() },
    { id: 'view.fontReset', title: 'Reset Font Size', category: 'View',
      keybinding: null, enabled: true, run: () => deps.fontReset() },
    // ── Navigate ──
    { id: 'nav.quickOpen', title: 'Go to…', category: 'Navigate',
      keybinding: formatAccelerator('CmdOrCtrl+P'),
      enabled: hasProject, run: () => deps.quickOpen() },
    { id: 'nav.back', title: 'Navigate Back', category: 'Navigate',
      keybinding: formatAccelerator('CmdOrCtrl+['),
      enabled: deps.canGoBack(), run: () => deps.navBack() },
    { id: 'nav.forward', title: 'Navigate Forward', category: 'Navigate',
      keybinding: formatAccelerator('CmdOrCtrl+]'),
      enabled: deps.canGoForward(), run: () => deps.navForward() },
    // ── Refactor ──
    { id: 'refactor.rename', title: 'Rename Note…', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.renameActive() },
    { id: 'refactor.move', title: 'Move Note…', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.moveActive() },
    { id: 'refactor.copy', title: 'Copy Note…', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.copyActive() },
    { id: 'refactor.extract', title: 'Extract Selection to New Note', category: 'Refactor',
      keybinding: null, enabled: hasActiveNoteTab, run: () => deps.extractSelection() },
    { id: 'refactor.splitHere', title: 'Split Here', category: 'Refactor',
      keybinding: null, enabled: hasActiveNoteTab, run: () => deps.splitHere() },
    { id: 'refactor.splitByHeading', title: 'Split by Heading…', category: 'Refactor',
      keybinding: null, enabled: hasActiveNoteTab, run: () => deps.splitByHeading() },
    { id: 'refactor.autoTag', title: 'Auto-tag Note', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.autoTagActive() },
    { id: 'refactor.autoLink', title: 'Auto-link Outbound', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.autoLinkActive() },
    { id: 'refactor.autoLinkInbound', title: 'Auto-link Inbound', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.autoLinkInboundActive() },
    { id: 'refactor.decompose', title: 'Decompose into Claims', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.decomposeActive() },
    { id: 'refactor.format', title: 'Format', category: 'Refactor',
      keybinding: null, enabled: hasNote, run: () => deps.format() },
    // ── Research ──
    { id: 'research.ingestUrl', title: 'Ingest URL as Source…', category: 'Research',
      keybinding: formatAccelerator('CmdOrCtrl+Shift+I'),
      enabled: hasProject, run: () => deps.ingestUrl() },
    { id: 'research.ingestIdentifier', title: 'Ingest Identifier…', category: 'Research',
      keybinding: formatAccelerator('CmdOrCtrl+Shift+D'),
      enabled: hasProject, run: () => deps.ingestIdentifier() },
    { id: 'research.ingestFile', title: 'Ingest File as Source…', category: 'Research',
      keybinding: null, enabled: hasProject, run: () => deps.ingestFile() },
    { id: 'research.importBibtex', title: 'Import BibTeX…', category: 'Research',
      keybinding: null, enabled: hasProject, run: () => deps.importBibtex() },
    { id: 'research.importZoteroRdf', title: 'Import Zotero RDF…', category: 'Research',
      keybinding: null, enabled: hasProject, run: () => deps.importZoteroRdf() },
    { id: 'research.bibliography', title: 'Insert/Update Bibliography', category: 'Research',
      keybinding: null, enabled: hasNote, run: () => deps.bibliography() },
    // ── Query ──
    { id: 'query.new', title: 'New Query', category: 'Query',
      keybinding: null, enabled: hasProject, run: () => deps.newQuery() },
    { id: 'query.editSaved', title: 'Edit Saved Queries…', category: 'Query',
      keybinding: null, enabled: hasProject, run: () => deps.editSavedQueries() },
    // ── Settings / app ──
    { id: 'app.settings', title: 'Settings…', category: 'App',
      keybinding: formatAccelerator('CmdOrCtrl+,'),
      enabled: true, run: () => deps.openSettings() },
  ];
}
