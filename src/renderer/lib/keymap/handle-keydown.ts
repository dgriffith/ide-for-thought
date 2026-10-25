/**
 * Global keyboard shortcuts (#463; extracted from App.svelte in #670; on the
 * command registry since #2625).
 *
 * The window-level keymap is a list of command ids (`KEYMAP`). Each row's key
 * is that command's declared `key` in `shared/commands.ts` — the same one its
 * menu item shows — and running it calls the shared action table, so this
 * keymap can't bind a different key, or do a different thing, than the menu
 * and the palette.
 *
 * Some rows guard on state before claiming the key: with the guard unmet the
 * event isn't `preventDefault`ed, so it falls through to the browser or the
 * editor (⌘G with no tab open, ⌘K with no thoughtbase).
 */
import { commandDef, type CommandId } from '../../../shared/commands';

export interface KeymapDeps {
  /** Run a registered command. */
  run: (id: CommandId) => void;
  hasProject: () => boolean;
  hasActiveTab: () => boolean;
  hasActiveIndex: () => boolean;
}

type Guard = 'hasProject' | 'hasActiveTab' | 'hasActiveIndex';

/** The window's shortcuts, in match order. */
export const KEYMAP: ReadonlyArray<{ command: CommandId; when?: Guard }> = [
  // ⌘K opens the command palette (#463) — the Linear / VS Code convention,
  // since ⌘⇧P cycles the view mode and ⌘P is quick-open.
  { command: 'view.commandPalette', when: 'hasProject' },
  { command: 'nav.back' },
  { command: 'nav.forward' },
  { command: 'view.togglePreview' },
  { command: 'view.toggleRightSidebar' },
  { command: 'view.cycleTheme' },
  { command: 'file.newNote' },
  { command: 'view.closeTab', when: 'hasActiveIndex' },
  { command: 'nav.quickOpen', when: 'hasProject' },
  { command: 'edit.gotoLine', when: 'hasActiveTab' },
  { command: 'query.new', when: 'hasProject' },
  { command: 'learning.openConversation' },
];

/** Does `e` press `accelerator` (`CmdOrCtrl+Shift+P`)? `CmdOrCtrl` is either
 *  ⌘ or Ctrl; Shift and Alt must match exactly. */
export function matchesAccelerator(e: KeyboardEvent, accelerator: string): boolean {
  const parts = accelerator.split('+');
  const key = parts.pop()!.toLowerCase();
  const mods = new Set(parts);
  if (mods.has('CmdOrCtrl') && !(e.metaKey || e.ctrlKey)) return false;
  if (mods.has('Shift') !== e.shiftKey) return false;
  if (mods.has('Alt') !== e.altKey) return false;
  if (e.key.toLowerCase() === key) return true;
  // With Alt held, macOS types a different character (⌥B is "∫"): match the
  // key itself for a letter or a digit (#2879, where plugins may claim one).
  return e.altKey && /^[a-z0-9]$/.test(key) && e.code === `${/\d/.test(key) ? 'Digit' : 'Key'}${key.toUpperCase()}`;
}

export function handleKeydown(e: KeyboardEvent, deps: KeymapDeps): void {
  for (const row of KEYMAP) {
    const key = commandDef(row.command).key;
    if (!key || !matchesAccelerator(e, key)) continue;
    if (row.when && !deps[row.when]()) return;
    e.preventDefault();
    deps.run(row.command);
    return;
  }
}

/**
 * A plugin command's key (#2879), once Minerva's own keys have had their
 * chance: `keys` is `pluginId/commandId → key`, as `resolvePluginKeys`
 * settled it. Whether it did.
 */
export function handlePluginKeydown(e: KeyboardEvent, keys: ReadonlyMap<string, string>, run: (pluginId: string, commandId: string) => void): boolean {
  if (e.defaultPrevented) return false;
  for (const [ref, key] of keys) {
    if (!matchesAccelerator(e, key)) continue;
    e.preventDefault();
    const at = ref.indexOf('/');
    run(ref.slice(0, at), ref.slice(at + 1));
    return true;
  }
  return false;
}

