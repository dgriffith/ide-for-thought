/**
 * Command-palette registry (#463 / extracted in #670).
 *
 * This is the behavioral safety net for the App.svelte decomposition: it
 * pins the command set, the `enabled` predicate wiring, and — crucially —
 * that each command's `run()` dispatches to the right injected dependency.
 * A future refactor that re-points a command at the wrong handler, drops a
 * command, or breaks an `enabled` predicate fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCommandRegistry, type CommandDeps } from '../../../src/renderer/lib/command-palette/registry';

// Every CommandDeps method, as a spy. Predicates default to true so every
// command is enabled unless a test overrides them.
function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  const actionNames = [
    'newNote', 'save', 'openProject', 'newProject', 'closeProject', 'print',
    'saveAsTemplate', 'insertTemplate', 'find', 'findReplace', 'findInNotes',
    'replaceInNotes', 'gotoLine', 'sortLines', 'toggleSidebar', 'toggleRightSidebar',
    'togglePreview', 'toggleConversations', 'cycleTheme', 'fontIncrease', 'fontDecrease',
    'fontReset', 'quickOpen', 'navBack', 'navForward', 'renameActive', 'moveActive',
    'copyActive', 'extractSelection', 'splitHere', 'splitByHeading', 'autoTagActive',
    'autoLinkActive', 'autoLinkInboundActive', 'decomposeActive', 'format', 'ingestUrl',
    'ingestIdentifier', 'ingestFile', 'importBibtex', 'importZoteroRdf', 'bibliography',
    'newQuery', 'editSavedQueries', 'openSettings',
  ] as const;
  const deps = {
    hasProject: () => true,
    hasNote: () => true,
    hasActiveNoteTab: () => true,
    canGoBack: () => true,
    canGoForward: () => true,
  } as Record<string, unknown>;
  for (const name of actionNames) deps[name] = vi.fn();
  return { ...deps, ...overrides } as CommandDeps;
}

describe('buildCommandRegistry', () => {
  it('returns the full command set with stable ids', () => {
    const ids = buildCommandRegistry(makeDeps()).map((c) => c.id);
    expect(ids).toEqual([
      'file.newNote', 'file.save', 'file.openProject', 'file.newProject',
      'file.closeProject', 'file.print', 'file.saveAsTemplate', 'edit.insertTemplate',
      'edit.find', 'edit.findReplace', 'edit.findInNotes', 'edit.replaceInNotes',
      'edit.gotoLine', 'edit.sortLines', 'view.toggleSidebar', 'view.toggleRightSidebar',
      'view.togglePreview', 'view.toggleConversations', 'view.cycleTheme',
      'view.fontIncrease', 'view.fontDecrease', 'view.fontReset', 'nav.quickOpen',
      'nav.back', 'nav.forward', 'refactor.rename', 'refactor.move', 'refactor.copy',
      'refactor.extract', 'refactor.splitHere', 'refactor.splitByHeading',
      'refactor.autoTag', 'refactor.autoLink', 'refactor.autoLinkInbound',
      'refactor.decompose', 'refactor.format', 'research.ingestUrl',
      'research.ingestIdentifier', 'research.ingestFile', 'research.importBibtex',
      'research.importZoteroRdf', 'research.bibliography', 'query.new',
      'query.editSaved', 'app.settings',
    ]);
  });

  it('every command has a category and a run thunk', () => {
    for (const cmd of buildCommandRegistry(makeDeps())) {
      expect(cmd.category).toBeTruthy();
      expect(typeof cmd.run).toBe('function');
    }
  });

  it('gates project-scoped commands on hasProject()', () => {
    const cmds = buildCommandRegistry(makeDeps({ hasProject: () => false }));
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
    const cmds = buildCommandRegistry(makeDeps({ hasNote: () => false }));
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('file.save').enabled).toBe(false);
    expect(byId('edit.find').enabled).toBe(false);
    expect(byId('refactor.rename').enabled).toBe(false);
    expect(byId('refactor.format').enabled).toBe(false);
    expect(byId('research.bibliography').enabled).toBe(false);
  });

  it('gates active-note-tab commands on hasActiveNoteTab()', () => {
    const cmds = buildCommandRegistry(makeDeps({ hasActiveNoteTab: () => false }));
    const byId = (id: string) => cmds.find((c) => c.id === id)!;
    expect(byId('file.saveAsTemplate').enabled).toBe(false);
    expect(byId('edit.insertTemplate').enabled).toBe(false);
    expect(byId('refactor.extract').enabled).toBe(false);
    expect(byId('refactor.splitHere').enabled).toBe(false);
    expect(byId('refactor.splitByHeading').enabled).toBe(false);
  });

  it('gates nav commands on canGoBack()/canGoForward()', () => {
    const cmds = buildCommandRegistry(makeDeps({ canGoBack: () => false, canGoForward: () => true }));
    expect(cmds.find((c) => c.id === 'nav.back')!.enabled).toBe(false);
    expect(cmds.find((c) => c.id === 'nav.forward')!.enabled).toBe(true);
  });

  it('dispatches each command run() to its corresponding dependency', () => {
    // Map of command id → the dep method it must call.
    const wiring: Record<string, keyof CommandDeps> = {
      'file.newNote': 'newNote', 'file.save': 'save', 'file.openProject': 'openProject',
      'file.newProject': 'newProject', 'file.closeProject': 'closeProject',
      'file.print': 'print', 'file.saveAsTemplate': 'saveAsTemplate',
      'edit.insertTemplate': 'insertTemplate', 'edit.find': 'find',
      'edit.findReplace': 'findReplace', 'edit.findInNotes': 'findInNotes',
      'edit.replaceInNotes': 'replaceInNotes', 'edit.gotoLine': 'gotoLine',
      'edit.sortLines': 'sortLines', 'view.toggleSidebar': 'toggleSidebar',
      'view.toggleRightSidebar': 'toggleRightSidebar', 'view.togglePreview': 'togglePreview',
      'view.toggleConversations': 'toggleConversations', 'view.cycleTheme': 'cycleTheme',
      'view.fontIncrease': 'fontIncrease', 'view.fontDecrease': 'fontDecrease',
      'view.fontReset': 'fontReset', 'nav.quickOpen': 'quickOpen', 'nav.back': 'navBack',
      'nav.forward': 'navForward', 'refactor.rename': 'renameActive',
      'refactor.move': 'moveActive', 'refactor.copy': 'copyActive',
      'refactor.extract': 'extractSelection', 'refactor.splitHere': 'splitHere',
      'refactor.splitByHeading': 'splitByHeading', 'refactor.autoTag': 'autoTagActive',
      'refactor.autoLink': 'autoLinkActive', 'refactor.autoLinkInbound': 'autoLinkInboundActive',
      'refactor.decompose': 'decomposeActive', 'refactor.format': 'format',
      'research.ingestUrl': 'ingestUrl', 'research.ingestIdentifier': 'ingestIdentifier',
      'research.ingestFile': 'ingestFile', 'research.importBibtex': 'importBibtex',
      'research.importZoteroRdf': 'importZoteroRdf', 'research.bibliography': 'bibliography',
      'query.new': 'newQuery', 'query.editSaved': 'editSavedQueries',
      'app.settings': 'openSettings',
    };
    const deps = makeDeps();
    const cmds = buildCommandRegistry(deps);
    // Every command must appear in the wiring map (catches a new command
    // that forgot a dispatch assertion).
    expect(new Set(cmds.map((c) => c.id))).toEqual(new Set(Object.keys(wiring)));
    for (const cmd of cmds) {
      cmd.run();
      const depMethod = deps[wiring[cmd.id]] as ReturnType<typeof vi.fn>;
      expect(depMethod, `command ${cmd.id} should call deps.${wiring[cmd.id]}`).toHaveBeenCalledTimes(1);
    }
  });
});
