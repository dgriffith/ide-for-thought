/**
 * The command palette's list (#463; on the command registry since #2625).
 *
 * Every command in `shared/commands.ts` with a `palette` entry, in declared
 * order: its title, category and shortcut come from the declaration, its
 * enablement from `PaletteState`, and running it calls `run(id)` — the same
 * action table (`app/command-keymap.ts`) the menu bar's `menu:command` runs,
 * so the two surfaces can't do different things for one command.
 *
 * App.svelte calls this inside a `$derived`, so the predicates are GETTER
 * FUNCTIONS, re-read on each recompute — the palette never offers an action
 * that would silently no-op.
 */
import type { Command } from './types';
import { formatAccelerator } from './format-accelerator';
import { COMMANDS, type CommandId, type PaletteWhen } from '../../../shared/commands';
import type { ThemeMode } from '../theme';

/** What the palette's enablement and the current-theme mark read. */
export interface PaletteState {
  hasProject(): boolean;
  /** A file is open in the active tab. */
  hasNote(): boolean;
  /** The active tab is a note. */
  hasActiveNoteTab(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  currentTheme(): ThemeMode;
}

function enabled(when: PaletteWhen, state: PaletteState): boolean {
  switch (when) {
    case 'always': return true;
    case 'project': return state.hasProject();
    case 'note': return state.hasNote();
    case 'noteTab': return state.hasActiveNoteTab();
    case 'canGoBack': return state.canGoBack();
    case 'canGoForward': return state.canGoForward();
  }
}

export function buildCommandRegistry(state: PaletteState, run: (id: CommandId) => void): Command[] {
  const currentThemeId = `view.theme.${state.currentTheme()}`;
  const out: Command[] = [];
  for (const def of COMMANDS) {
    if (!('palette' in def)) continue;
    out.push({
      id: def.id,
      title: def.id === currentThemeId ? `${def.title} (current)` : def.title,
      category: def.category,
      keybinding: 'key' in def ? formatAccelerator(def.key) : null,
      enabled: enabled(def.palette.when, state),
      run: () => run(def.id),
    });
  }
  return out;
}
