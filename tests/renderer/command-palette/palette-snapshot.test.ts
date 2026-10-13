/**
 * The command palette's whole list, pinned (#2625): every command's id, title,
 * category, shortcut and enablement (nothing open, and everything open).
 * Taken before the palette moved onto the command registry, so a refactor
 * that changes any of it shows up as a snapshot diff. What each entry RUNS is
 * the action table's business (`app/command-keymap.ts`), shared with the menu
 * bar; here it's enough that an entry runs its own id.
 */
import { describe, it, expect } from 'vitest';
import { buildCommandRegistry, type PaletteState } from '../../../src/renderer/lib/command-palette/registry';
import type { ThinkingToolInfo } from '../../../src/shared/tools/types';

/** A spread of skills: each menu, a group, a note- and a selection-needer, and a
 *  source-scoped one the palette leaves out (#2766). */
const SKILLS = [
  { id: 'ask', name: 'Ask Anything', category: 'learning', context: [], requiresSelection: false },
  { id: 'steelman', name: 'Steelman', category: 'analysis', context: ['fullNote'], requiresSelection: false },
  { id: 'explain', name: 'Explain Selection', category: 'learning', group: 'Reading', context: ['selection'], requiresSelection: true },
  { id: 'cite', name: 'Find Sources', category: 'research', context: [], requiresSelection: false },
  { id: 'summarize-source', name: 'Summarize Source', category: 'research', scope: 'source', context: [], requiresSelection: false },
] as unknown as ThinkingToolInfo[];

function state(open: boolean): PaletteState {
  return {
    hasProject: () => open,
    hasNote: () => open,
    hasActiveNoteTab: () => open,
    canGoBack: () => open,
    canGoForward: () => open,
    hasSelection: () => open,
    currentTheme: () => 'dark',
  };
}

function describePalette(open: boolean): string {
  return buildCommandRegistry(state(open), () => {}).map((c) =>
    `${c.id} | ${c.title} | ${c.category} | ${c.keybinding ?? '-'} | ${c.enabled ? 'enabled' : 'disabled'}`,
  ).join('\n');
}

function describeSkills(open: boolean): string {
  return buildCommandRegistry(state(open), () => {}, SKILLS, () => {})
    .filter((c) => c.id.startsWith('skill:'))
    .map((c) => `${c.id} | ${c.title} | ${c.category} | ${c.enabled ? 'enabled' : 'disabled'}`)
    .join('\n');
}

describe('the command palette (#2625)', () => {
  it('lists skills after the commands, in menu-bar order (#2766)', () => {
    expect(describeSkills(false)).toMatchSnapshot();
    expect(describeSkills(true)).toMatchSnapshot();
  });

  it('with nothing open', () => {
    expect(describePalette(false)).toMatchSnapshot();
  });
  it('with a thoughtbase, a note tab and history both ways', () => {
    expect(describePalette(true)).toMatchSnapshot();
  });
  it('runs each entry by its own id', () => {
    const ran: string[] = [];
    const commands = buildCommandRegistry(state(true), (id) => ran.push(id));
    for (const c of commands) void c.run();
    expect(ran).toEqual(commands.map((c) => c.id));
  });
});
