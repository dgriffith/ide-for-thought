/**
 * Plugin commands in the native menu bar and on the keyboard (#2879). Pure,
 * and shared: main builds the menu from it, the renderer its keymap and
 * Settings' notes on it, so both resolve a key the same way.
 *
 * - **A command names a menu** (`menu`), one of `PLUGIN_COMMAND_MENUS`, and
 *   goes under a separator at its end.
 * - **A command may declare a key** (`key`, an Electron accelerator with
 *   `CmdOrCtrl`): a key Minerva uses (its commands', the editor's — Bold,
 *   Italic, Insert Link… — and the menu roles' undo, copy, zoom…) is refused
 *   in the manifest. Between plugins, the first
 *   to claim a key keeps it, built-in plugins first, in Settings' order; a
 *   later one runs from the palette and its menu, with no key, and Settings
 *   says which plugin has it.
 */
import { COMMANDS } from '../commands';

export { PLUGIN_COMMAND_MENUS, type PluginCommandMenu } from './format';

const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|[,./;'[\]\\=`-])$/;

/**
 * An accelerator in one spelling: `CmdOrCtrl`, then `Alt`, then `Shift`, then
 * the key (a letter in upper case). Null when it isn't one a plugin may use:
 * it must hold `CmdOrCtrl`, so it never takes typing.
 */
export function normalizeAccelerator(accelerator: string): string | null {
  const parts = accelerator.split('+').map((p) => p.trim());
  const raw = parts.pop();
  if (!raw) return null;
  const key = raw.length === 1 ? raw.toUpperCase() : raw;
  const MODS: Record<string, string> = {
    cmdorctrl: 'CmdOrCtrl', commandorcontrol: 'CmdOrCtrl', cmd: 'CmdOrCtrl', command: 'CmdOrCtrl', ctrl: 'CmdOrCtrl', control: 'CmdOrCtrl',
    alt: 'Alt', option: 'Alt', shift: 'Shift',
  };
  const mods = new Set(parts.map((m) => MODS[m.toLowerCase()] ?? m));
  if (!mods.has('CmdOrCtrl') || [...mods].some((m) => m !== 'CmdOrCtrl' && m !== 'Alt' && m !== 'Shift') || mods.size !== parts.length) return null;
  if (!KEY.test(key)) return null;
  return ['CmdOrCtrl', ...(mods.has('Alt') ? ['Alt'] : []), ...(mods.has('Shift') ? ['Shift'] : []), key].join('+');
}

/** Keys the menu's roles hold (undo, cut, copy, paste, select all, zoom, quit, hide…), as normalized. */
const ROLE_KEYS = [
  'CmdOrCtrl+Z', 'CmdOrCtrl+Shift+Z', 'CmdOrCtrl+Y', 'CmdOrCtrl+X', 'CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+A',
  'CmdOrCtrl+0', 'CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+Q', 'CmdOrCtrl+W', 'CmdOrCtrl+H', 'CmdOrCtrl+Alt+H',
  'CmdOrCtrl+M', 'CmdOrCtrl+Alt+I', 'CmdOrCtrl+,', 'CmdOrCtrl+R', 'CmdOrCtrl+Shift+R',
];

let minerva: Set<string> | null = null;

/** A CodeMirror key (`Mod-Shift-v`) as an accelerator (`CmdOrCtrl+Shift+v`). */
const editorKeyAsAccelerator = (key: string) => key.split('-').map((t) => (t === 'Mod' ? 'CmdOrCtrl' : t)).join('+');

/**
 * Every key Minerva itself uses: its commands', its editor's and its menu
 * roles'. The editor's count since #2758: they were left out, so a plugin
 * could take ⌘I or ⌘E from Italic and Code.
 */
export function minervaKeys(): ReadonlySet<string> {
  const asKey = (accelerator: string) => normalizeAccelerator(accelerator) ?? accelerator;
  minerva ??= new Set([
    ...COMMANDS.flatMap((c) => ('key' in c && c.key ? [asKey(c.key)] : [])),
    ...COMMANDS.flatMap((c) => ('editor' in c && 'key' in c.editor && c.editor.key ? [asKey(editorKeyAsAccelerator(c.editor.key))] : [])),
    ...ROLE_KEYS,
  ]);
  return minerva;
}

export interface KeyedCommand {
  pluginId: string;
  pluginName: string;
  commandId: string;
  title: string;
  key?: string;
}

/** A plugin command's key that another plugin already has. */
export interface PluginKeyConflict {
  pluginId: string;
  commandId: string;
  title: string;
  key: string;
  takenBy: string;
}

/**
 * Which plugin command gets each key: `commands` in Settings' order (built-in
 * plugins first). Answers `pluginId/commandId → key` for the winners, and the
 * losers. A key Minerva uses never reaches here (the manifest refuses it), but
 * is skipped too, so nothing a plugin says can take one.
 */
export function resolvePluginKeys(commands: readonly KeyedCommand[]): { keys: Map<string, string>; conflicts: PluginKeyConflict[] } {
  const keys = new Map<string, string>();
  const owner = new Map<string, string>();
  const conflicts: PluginKeyConflict[] = [];
  for (const c of commands) {
    const key = c.key ? normalizeAccelerator(c.key) : null;
    if (!key || minervaKeys().has(key)) continue;
    const taken = owner.get(key);
    if (taken !== undefined) {
      conflicts.push({ pluginId: c.pluginId, commandId: c.commandId, title: c.title, key, takenBy: taken });
      continue;
    }
    owner.set(key, c.pluginName);
    keys.set(`${c.pluginId}/${c.commandId}`, key);
  }
  return { keys, conflicts };
}
