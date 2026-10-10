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
import type { ThinkingToolInfo } from '../../../src/shared/tools/types';

// Every predicate true unless a test overrides it.
function makeState(overrides: Partial<PaletteState> = {}): PaletteState {
  return {
    hasProject: () => true,
    hasNote: () => true,
    hasActiveNoteTab: () => true,
    canGoBack: () => true,
    canGoForward: () => true,
    hasSelection: () => true,
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
      'edit.dictate', 'file.newAudioRecording', 'edit.transcribeRecording', 'file.newMeetingRecording', 'edit.summarizeRecording',
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

  describe('skills (#2766)', () => {
    const skill = (o: Partial<ThinkingToolInfo>) => ({ context: [], requiresSelection: false, category: 'learning', ...o }) as ThinkingToolInfo;
    const SKILLS = [
      skill({ id: 'a', name: 'Analyse', category: 'analysis' }),
      skill({ id: 'n', name: 'Note Skill', category: 'research', context: ['fullNote'] }),
      skill({ id: 's', name: 'Selection Skill', requiresSelection: true }),
      skill({ id: 'src', name: 'Source Skill', category: 'research', scope: 'source' }),
    ];
    const skills = (overrides: Partial<PaletteState> = {}) =>
      buildCommandRegistry(makeState(overrides), () => {}, SKILLS, () => {}).filter((c) => c.id.startsWith('skill:'));

    it('come after the commands, Learning → Research → Analysis, and leave source-scoped ones out', () => {
      expect(skills().map((c) => c.id)).toEqual(['skill:s', 'skill:n', 'skill:a']);
      const all = buildCommandRegistry(makeState(), () => {}, SKILLS, () => {});
      expect(all.findIndex((c) => c.id.startsWith('skill:'))).toBe(all.length - 3);
    });

    it('are enabled exactly when their menu item is', () => {
      const byId = (cmds: ReturnType<typeof skills>) => Object.fromEntries(cmds.map((c) => [c.id, c.enabled]));
      expect(byId(skills({ hasProject: () => false }))).toEqual({ 'skill:s': false, 'skill:n': false, 'skill:a': false });
      expect(byId(skills({ hasActiveNoteTab: () => false, hasSelection: () => false }))).toEqual({ 'skill:s': false, 'skill:n': false, 'skill:a': true });
      expect(byId(skills({ hasSelection: () => false }))).toEqual({ 'skill:s': false, 'skill:n': true, 'skill:a': true });
    });

    it('run the skill by its own id', () => {
      const ran: string[] = [];
      const cmds = buildCommandRegistry(makeState(), () => {}, SKILLS, (id) => ran.push(id));
      cmds.find((c) => c.id === 'skill:n')!.run();
      expect(ran).toEqual(['n']);
    });

    it('show their group in the category', () => {
      const grouped = buildCommandRegistry(makeState(), () => {}, [skill({ id: 'g', name: 'G', group: 'Reading' })], () => {});
      expect(grouped.find((c) => c.id === 'skill:g')?.category).toBe('Learning › Reading');
    });
  });

  it("lists each plugin's global view as Open <title>, needing a thoughtbase, and opens it (#2640)", () => {
    const opened: string[] = [];
    const views = [{ pluginId: 'reading-queue', pluginName: 'Reading Queue', viewId: 'queue', title: 'Reading Queue', place: 'left-sidebar' as const }];
    const cmds = (hasProject: boolean) => buildCommandRegistry(makeState({ hasProject: () => hasProject }), () => {}, [], () => {}, [], () => {}, views, (v) => opened.push(v.viewId));
    const entry = cmds(true).find((c) => c.id === 'plugin-view:reading-queue:queue')!;
    expect(entry).toMatchObject({ title: 'Open Reading Queue', category: 'Plugins › Reading Queue', enabled: true });
    entry.run();
    expect(opened).toEqual(['queue']);
    expect(cmds(false).find((c) => c.id === 'plugin-view:reading-queue:queue')!.enabled).toBe(false);
  });

  it("lists each plugin command under its plugin, enabled when what it runs on is there, and runs it (#2643)", () => {
    const ran: string[] = [];
    const commands = [
      { pluginId: 'list-tools', pluginName: 'List Tools', commandId: 'sort-selection', title: 'Sort List in Selection', when: 'selection' as const },
      { pluginId: 'lab', pluginName: 'Lab', commandId: 'note', title: 'On a Note', when: 'note' as const },
      { pluginId: 'lab', pluginName: 'Lab', commandId: 'any', title: 'Anywhere', when: 'project' as const },
    ];
    const enabledWith = (overrides: Partial<PaletteState>) => Object.fromEntries(
      buildCommandRegistry(makeState(overrides), () => {}, [], () => {}, [], () => {}, [], () => {}, commands, (c) => ran.push(c.commandId))
        .filter((c) => c.id.startsWith('plugin-command:')).map((c) => [c.title, c.enabled]));
    expect(enabledWith({})).toEqual({ 'Sort List in Selection': true, 'On a Note': true, Anywhere: true });
    expect(enabledWith({ hasSelection: () => false })).toEqual({ 'Sort List in Selection': false, 'On a Note': true, Anywhere: true });
    expect(enabledWith({ hasActiveNoteTab: () => false })).toEqual({ 'Sort List in Selection': false, 'On a Note': false, Anywhere: true });
    expect(enabledWith({ hasProject: () => false })).toEqual({ 'Sort List in Selection': false, 'On a Note': false, Anywhere: false });
    const entry = buildCommandRegistry(makeState(), () => {}, [], () => {}, [], () => {}, [], () => {}, commands, (c) => ran.push(c.commandId))
      .find((c) => c.id === 'plugin-command:list-tools:sort-selection')!;
    expect(entry.category).toBe('Plugins › List Tools');
    entry.run();
    expect(ran).toEqual(['sort-selection']);
  });

  it('lists each plugin theme after the commands, marks the current one, and picks it (#2787)', () => {
    const picked: string[] = [];
    const themes = [{ mode: 'plugin:solarized/solarized-dark' as const, label: 'Solarized Dark', plugin: 'Solarized' }];
    const cmds = buildCommandRegistry(makeState({ currentTheme: () => 'plugin:solarized/solarized-dark' }), () => {}, [], () => {}, themes, (m) => picked.push(m));
    const entry = cmds.find((c) => c.id === 'theme:plugin:solarized/solarized-dark')!;
    expect(entry).toMatchObject({ title: 'Theme: Solarized Dark (Solarized) (current)', category: 'View', enabled: true });
    entry.run();
    expect(picked).toEqual(['plugin:solarized/solarized-dark']);
    expect(cmds.find((c) => c.id === 'view.theme.dark')!.title).toBe('Theme: Dark');
  });
});
