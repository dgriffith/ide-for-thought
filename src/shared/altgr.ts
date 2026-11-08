/**
 * Ctrl+Alt is AltGr off macOS (#2986).
 *
 * On Windows, and on Linux under most layouts, the right Alt key (AltGr)
 * arrives as Ctrl+Alt, and AltGr+<key> is how people type `@` and `€` on a
 * German keyboard, `ł` and `ć` on a Polish one, `{` `[` `|` on many more. A
 * shortcut bound to Ctrl+Alt+<printable key> there swallows that typing.
 *
 * So off macOS no Minerva or plugin shortcut may be Ctrl+Alt plus a key that
 * types something — with or without Shift, since AltGr+Shift types too.
 * Arrows, function keys and the like type nothing, so Ctrl+Alt+Left is fine.
 * macOS has no AltGr: ⌘⌥ never types, and its keys are untouched.
 */

const CTRL = new Set(['cmdorctrl', 'commandorcontrol', 'ctrl', 'control']);
const ALT = new Set(['alt', 'option', 'altgr']);

/** Would `accelerator` (Electron's syntax) catch an AltGr character off macOS? */
export function capturesAltGr(accelerator: string): boolean {
  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase());
  // `CmdOrCtrl+Alt++` names the plus key: the split leaves two empty parts.
  const key = accelerator.endsWith('++') ? '+' : parts.pop() ?? '';
  const mods = parts.filter((p) => p !== '');
  return mods.some((m) => CTRL.has(m)) && mods.some((m) => ALT.has(m)) && isPrintable(key);
}

/** A key that types a character: one character, or Electron's names for two. */
function isPrintable(key: string): boolean {
  return [...key].length === 1 || key === 'plus' || key === 'space';
}
