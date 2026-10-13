/**
 * The command palette's list (#463; on the command registry since #2625).
 *
 * Every command in `shared/commands.ts` with a `palette` entry, in declared
 * order, then every skill (#2766): its title, category and shortcut come from the declaration, its
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
import { isSourceScoped, toolRequiresNote, toolRequiresSelection, type ThinkingToolInfo } from '../../../shared/tools/types';
import { CATEGORIES } from '../../../shared/tools/registry';

/** What the palette's enablement and the current-theme mark read. */
export interface PaletteState {
  hasProject(): boolean;
  /** A file is open in the active tab. */
  hasNote(): boolean;
  /** The active tab is a note. */
  hasActiveNoteTab(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
  /** The active note has a non-empty text selection — what a selection skill needs. */
  hasSelection(): boolean;
  currentTheme(): ThemeMode;
}

/** The menus skills sit in, in the menu bar's order (`menu.ts` buildToolMenus). */
const SKILL_MENUS = ['learning', 'research', 'analysis'] as const;

/**
 * One entry per skill (#2766), after the commands: titled with its name, under
 * its menu (and group), enabled exactly when its menu item is — a thoughtbase,
 * plus a note and/or a selection when the skill needs them. `skills` is the
 * renderer's registry, which already has the per-machine menu config applied
 * (disabled skills absent, reassigned ones under their new menu). Source-scoped
 * skills run from the Source viewer, against a source, so they aren't listed.
 */
function skillCommands(state: PaletteState, skills: readonly ThinkingToolInfo[], runSkill: (id: string) => void): Command[] {
  const label = (c: string) => CATEGORIES.find((x) => x.id === c)?.label ?? c;
  return SKILL_MENUS.flatMap((menu) => skills
    .filter((t) => t.category === menu && !isSourceScoped(t))
    .map((t): Command => ({
      id: `skill:${t.id}`,
      title: t.name,
      category: t.group ? `${label(menu)} › ${t.group}` : label(menu),
      keybinding: null,
      enabled: state.hasProject()
        && (!toolRequiresNote(t) || state.hasActiveNoteTab())
        && (!toolRequiresSelection(t) || state.hasSelection()),
      run: () => runSkill(t.id),
    })));
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

export function buildCommandRegistry(
  state: PaletteState,
  run: (id: CommandId) => void,
  skills: readonly ThinkingToolInfo[] = [],
  runSkill: (id: string) => void = () => {},
): Command[] {
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
  return [...out, ...skillCommands(state, skills, runSkill)];
}
