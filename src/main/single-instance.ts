/**
 * One Minerva per profile (#2982).
 *
 * Without a lock, launching Minerva while it runs — the Start menu, a desktop
 * entry, a file association, a terminal on Windows or Linux — started a second
 * process on the same `userData`: two writers to `session.json`, the recent
 * list, plugin state and the MCP token stores, and two watchers on one
 * thoughtbase. macOS usually reactivates the running app instead, but not
 * always (`open -n`, a second copy of the bundle).
 *
 * The second launch now hands its argv to the first through `second-instance`
 * and quits. The first focuses a window, or — when the launch named a folder —
 * opens that thoughtbase (focusing the window that already has it open).
 *
 * Only a packaged app takes the lock: `pnpm dev` shares `userData` with an
 * installed Minerva, and a dev build that quit whenever the installed one was
 * running would be worse than today. CLI mode never gets here (main.ts decides
 * it first).
 */
import path from 'node:path';
import fs from 'node:fs';
import type { BrowserWindow } from 'electron';

/**
 * The folder a launch asked for, if any: the first non-option argument after
 * the executable that names an existing directory. Options (`--inspect`,
 * macOS's `-psn_…`) and anything that isn't a directory are skipped.
 */
export function folderFromArgv(
  argv: readonly string[],
  cwd: string,
  isDirectory: (p: string) => boolean = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false,
): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const abs = path.resolve(cwd, arg);
    if (isDirectory(abs)) return abs;
  }
  return null;
}

export interface SecondInstanceDeps {
  windows: () => BrowserWindow[];
  focused: () => BrowserWindow | null;
  windowsForProject: (rootPath: string) => BrowserWindow[];
  createWindow: () => BrowserWindow;
  openProject: (win: BrowserWindow, rootPath: string) => void;
}

function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** What the running app does when another launch hands it `argv`. */
export function handleSecondInstance(argv: readonly string[], cwd: string, deps: SecondInstanceDeps): void {
  const folder = folderFromArgv(argv, cwd);
  if (folder) {
    const open = deps.windowsForProject(folder)[0];
    if (open) return bringToFront(open);
    const win = deps.createWindow();
    deps.openProject(win, folder);
    return;
  }
  const win = deps.focused() ?? deps.windows()[0];
  if (win) bringToFront(win);
  else deps.createWindow();
}
