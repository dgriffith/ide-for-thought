/**
 * Render an Electron accelerator string (`"CmdOrCtrl+Shift+P"`) as
 * the platform-appropriate display form (`"⌘ ⇧ P"` on macOS,
 * `"Ctrl Shift P"` elsewhere). Used by the palette to right-align
 * keybindings next to each command. (#463)
 */

/** Whether to use macOS glyphs (⌘ / ⌥ / ⇧ / ⌃). Determined once at
 *  module load; tests can override by passing `isMac` directly. */
const IS_MAC = typeof navigator !== 'undefined'
  ? /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
  : process.platform === 'darwin';

/** Map of token (lowercased) → its display form on macOS. */
const MAC_GLYPHS: Record<string, string> = {
  cmdorctrl: '⌘',
  cmd: '⌘',
  command: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  meta: '⌘',
  super: '⌘',
};

/** Map of token (lowercased) → its display form on non-mac. */
const NON_MAC_LABELS: Record<string, string> = {
  cmdorctrl: 'Ctrl',
  cmd: 'Ctrl',
  command: 'Ctrl',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Win',
  super: 'Win',
};

/** Final-key normalisation — Electron's accelerator vocabulary
 *  includes some words we want to render shorter. */
const KEY_LABELS: Record<string, string> = {
  return: '↵',
  enter: '↵',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Space',
  tab: '⇥',
  backspace: '⌫',
  delete: '⌦',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  plus: '+',
  minus: '-',
};

export function formatAccelerator(accel: string, isMac: boolean = IS_MAC): string {
  if (!accel) return '';
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const modifiers = parts.slice(0, -1);
  const finalKey = parts[parts.length - 1];

  const modifierMap = isMac ? MAC_GLYPHS : NON_MAC_LABELS;
  const renderedModifiers = modifiers.map((m) => modifierMap[m.toLowerCase()] ?? m);

  const finalLower = finalKey.toLowerCase();
  const renderedFinal = KEY_LABELS[finalLower]
    ?? (finalKey.length === 1 ? finalKey.toUpperCase() : finalKey);

  const sep = isMac ? ' ' : ' ';
  return [...renderedModifiers, renderedFinal].join(sep);
}
