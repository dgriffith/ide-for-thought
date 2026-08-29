/**
 * Menu accelerator utilities (#1906 — split out of menu.ts).
 *
 * Pure and Electron-free: given a menu template (plain data — an array of
 * `MenuItemConstructorOptions`) or an accelerator string, these compute a
 * result with no Electron runtime dependency. `menu.ts` builds the actual
 * template (which DOES need Electron); this module only reads it back.
 */
import type { MenuItemConstructorOptions } from 'electron';

/** Render an Electron accelerator string for display on the current platform
 *  (⌘⇧S on macOS, Ctrl+Shift+S elsewhere). */
export function formatAccelerator(accelerator: string, platform: NodeJS.Platform = process.platform): string {
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

/**
 * Walk a menu template tree and collect every accelerator under each
 * top-level menu. Returns a Map keyed by top-level menu label. Pure;
 * no Electron runtime dependency. Used by the accelerator-collision
 * test (#398).
 */
export function collectAcceleratorsByMenu(
  template: MenuItemConstructorOptions[],
): Map<string, Array<{ accelerator: string; path: string[] }>> {
  const out = new Map<string, Array<{ accelerator: string; path: string[] }>>();
  for (const top of template) {
    const topLabel = String(top.label ?? top.role ?? '(unnamed)');
    const found: Array<{ accelerator: string; path: string[] }> = [];
    walkInto(top, [topLabel], found);
    if (found.length > 0) out.set(topLabel, found);
  }
  return out;
}

function walkInto(
  item: MenuItemConstructorOptions,
  path: string[],
  out: Array<{ accelerator: string; path: string[] }>,
): void {
  if (typeof item.accelerator === 'string') {
    out.push({ accelerator: item.accelerator, path });
  }
  const sub = item.submenu;
  if (Array.isArray(sub)) {
    for (const child of sub) {
      const childLabel = String(child.label ?? child.role ?? '(unnamed)');
      walkInto(child, [...path, childLabel], out);
    }
  }
}
