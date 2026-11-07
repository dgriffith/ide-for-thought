/**
 * An Electron accelerator for display: `⌘⇧S` on macOS, `Ctrl+Shift+S`
 * elsewhere. Pure — the platform is passed in, so main (the menu, the built-in
 * plugins' descriptions, #2987) can use it with `process.platform`.
 */
export function acceleratorLabel(accelerator: string, platform: string): string {
  const isMac = platform === 'darwin';
  const mac: Record<string, string> = {
    CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃',
    Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘', Plus: '+', Minus: '−',
  };
  const other: Record<string, string> = {
    CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl', Command: 'Ctrl', Ctrl: 'Ctrl', Control: 'Ctrl',
    Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Super: 'Win', Plus: '+', Minus: '−',
  };
  const map = isMac ? mac : other;
  const tokens = accelerator.split('+').map((t) => map[t] ?? t);
  return isMac ? tokens.join('') : tokens.join('+');
}
