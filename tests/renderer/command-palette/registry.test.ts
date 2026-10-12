/**
 * Command-palette registry (#463 / extracted in #670; on the command registry
 * since #2625).
 *
 * Pins the command set, its order, and the `enabled` predicate wiring. What a
 * command DOES is the shared action table's, tested in command-keymap.test.ts;
 * the palette's part is to run the right id.
 */
import { describe, it, expect } from 'vitest';
import { buildCommandRegistry, type PaletteState } from '../../../src/renderer/lib/command-palette/registry';

// Every predicate true unless a test overrides it.
function makeState(overrides: Partial<PaletteState> = {}): PaletteState {
  return {
    hasProject: () => true,
    hasNote: () => true,
    hasActiveNoteTab: () => true,
    canGoBack: () => true,
    canGoForward: () => true,
    currentTheme: () => 'dark',
    ...overrides,
  };
}

const build = (overrides: Partial<PaletteState> = {}, run: (id: string) => void = () => {}) =>
  buildCommandRegistry(makeState(overrides), run);

describe('buildCommandRegistry', () => {
  it('returns the full command set with stable ids', () => {
    const ids = build().map((c) => c.id);
    expect(ids).toEqual([
      'file.newNote', 'file.save', 'file.openProject', 'file.newProject',
      'file.closeProject', 'file.editThoughtbaseGuide', 'file.print', 'file.saveAsTemplate', 'edit.insertTemplate',
      'edit.dictate', 'file.newAudioRecording', 'edit.transcribeRecording', 'edit.summarizeRecording',
      'edit.find', 'edit.findReplace', 'edit.findInNotes', 'edit.replaceInNotes',
      'edit.gotoLine', 'edit.sortLines', 'view.toggleSidebar', 'view.toggleRightSidebar',
      'view.togglePreview', 'view.toggleConversations',
      'view.theme.dark', 'view.theme.light', 'view.theme.contrast', 'view.theme.system',
      'view.fontIncrease', 'view.fontDecrease', 'view.fontReset', 'learning.askQuestion', 'nav.quickOpen',
      'nav.back', 'nav.forward', 'refactor.rename', 'refactor.move', 'refactor.copy',
      'refactor.extract', 'refactor.splitHere', 'refactor.splitByHeading',
      'refactor.autoTag', 'objects.promoteToType', 'objects.saveAsObjectType', 'refactor.autoLink', 'refactor.autoLinkInbound',
      'refactor.decompose', 'refactor.format', 'research.ingestUrl',
      'research.ingestIdentifier', 'research.ingestFile', 'research.ingestBulk', 'research.importBibtex',
      'research.importZoteroRdf', 'research.bibliography', 'query.new',
      'query.editSaved', 'app.settings',
    ]);
  });

  it('every command has a category and a run thunk', () => {
    for (const cmd of build()) {
      expect(cmd.category).toBeTruthy();
      expect(typeof cmd.run).toBe('function');
    }
  });

  it('gates project-scoped commands on hasProject()', () => {
    const cmds = build({ hasProject: () => false });
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('file.newNote').enabled).toBe(false);
    expect(byId('edit.findInNotes').enabled).toBe(false);
    expect(byId('nav.quickOpen').enabled).toBe(false);
    expect(byId('research.ingestUrl').enabled).toBe(false);
    expect(byId('query.new').enabled).toBe(false);
    // Project-independent commands stay enabled.
    expect(byId('file.openProject').enabled).toBe(true);
    expect(byId('app.settings').enabled).toBe(true);
    expect(byId('view.toggleSidebar').enabled).toBe(true);
  });

  it('gates note-scoped commands on hasNote()', () => {
    const cmds = build({ hasNote: () => false });
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('file.save').enabled).toBe(false);
    expect(byId('edit.find').enabled).toBe(false);
    expect(byId('refactor.rename').enabled).toBe(false);
    expect(byId('refactor.format').enabled).toBe(false);
    expect(byId('research.bibliography').enabled).toBe(false);
  });

  it('gates active-note-tab commands on hasActiveNoteTab()', () => {
    const cmds = build({ hasActiveNoteTab: () => false });
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('file.saveAsTemplate').enabled).toBe(false);
    expect(byId('edit.insertTemplate').enabled).toBe(false);
    expect(byId('refactor.extract').enabled).toBe(false);
    expect(byId('refactor.splitHere').enabled).toBe(false);
    expect(byId('refactor.splitByHeading').enabled).toBe(false);
  });

  it('gates nav commands on canGoBack()/canGoForward()', () => {
    const cmds = build({ canGoBack: () => false, canGoForward: () => true });
    expect(cmds.find((c) => c.id === 'nav.back')!.enabled).toBe(false);
    expect(cmds.find((c) => c.id === 'nav.forward')!.enabled).toBe(true);
  });

  it('runs a command by its id — the action table is shared with the menu bar (#2625)', () => {
    const ran: string[] = [];
    const cmds = build({}, (id) => ran.push(id));
    cmds.find((c) => c.id === 'refactor.rename')!.run();
    cmds.find((c) => c.id === 'view.theme.light')!.run();
    expect(ran).toEqual(['refactor.rename', 'view.theme.light']);
  });

  it('shows the shortcut each command is bound to', () => {
    const byId = (id: string) => build().find((c) => c.id === id)!;
    expect(byId('view.toggleSidebar').keybinding).not.toBeNull();
    expect(byId('file.newProject').keybinding).toBeNull();
  });

  it('lists no menu-only command', () => {
    const ids = new Set(build().map((c) => c.id));
    for (const id of ['view.splitRight', 'app.about', 'file.revealFile', 'view.commandPalette']) {
      expect(ids.has(id), id).toBe(false);
    }
  });

  it('marks the current theme in the entry title', () => {
    const cmds = build({ currentTheme: () => 'contrast' });
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('view.theme.contrast').title).toBe('Theme: High Contrast (current)');
    expect(byId('view.theme.dark').title).toBe('Theme: Dark');
  });
});
