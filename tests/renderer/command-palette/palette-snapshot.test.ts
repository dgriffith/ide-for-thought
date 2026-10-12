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

function state(open: boolean): PaletteState {
  return {
    hasProject: () => open,
    hasNote: () => open,
    hasActiveNoteTab: () => open,
    canGoBack: () => open,
    canGoForward: () => open,
    currentTheme: () => 'dark',
  };
}

function describePalette(open: boolean): string {
  return buildCommandRegistry(state(open), () => {}).map((c) =>
    `${c.id} | ${c.title} | ${c.category} | ${c.keybinding ?? '-'} | ${c.enabled ? 'enabled' : 'disabled'}`,
  ).join('\n');
}

describe('the command palette (#2625)', () => {
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
