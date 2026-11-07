/**
 * Squirrel.Windows install hooks (#2181).
 *
 * The Windows installer and updater don't run an install script: they launch
 * Minerva itself with one of `--squirrel-install`, `--squirrel-updated`,
 * `--squirrel-uninstall` or `--squirrel-obsolete` as its first argument, and
 * wait for it to exit. An app that ignores them opens a full window in the
 * middle of an install, never gets a Start-menu or desktop shortcut, and
 * leaves the shortcuts behind on uninstall.
 *
 * So `main.ts` checks for one right after CLI mode and, when there is one,
 * never starts the app: it asks Squirrel's own `Update.exe` (one folder up
 * from the versioned app folder) to create or remove the shortcuts, then
 * quits. Nothing here touches userData, takes the single-instance lock or
 * makes a window. `--squirrel-firstrun` is not an event here: it is the first
 * real launch after install, and the app starts normally.
 *
 * This is what the `electron-squirrel-startup` package does, written out so
 * it can be tested and so a hook can't hang the installer: the app quits when
 * `Update.exe` exits, or after `HOOK_TIMEOUT_MS` regardless.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { logger } from '../shared/logger';

export type SquirrelEvent = 'install' | 'updated' | 'uninstall' | 'obsolete';

/** Squirrel waits on a hook; never longer than this for Update.exe. */
export const HOOK_TIMEOUT_MS = 10_000;

/** The Squirrel event this launch is, or null for an ordinary launch. */
export function squirrelEvent(argv: readonly string[], platform: NodeJS.Platform): SquirrelEvent | null {
  if (platform !== 'win32') return null;
  const m = /^--squirrel-(install|updated|uninstall|obsolete)$/.exec(argv[1] ?? '');
  return m ? (m[1] as SquirrelEvent) : null;
}

/** What `Update.exe` is asked to do for `event`, or null when nothing is. */
export function updateExeArgs(event: SquirrelEvent, exePath: string): string[] | null {
  const exe = path.win32.basename(exePath);
  switch (event) {
    case 'install':
    case 'updated':
      return [`--createShortcut=${exe}`];
    case 'uninstall':
      return [`--removeShortcut=${exe}`];
    case 'obsolete':
      return null;
  }
}

/** `Update.exe` sits beside the `app-<version>` folder the running exe is in. */
export function updateExePath(exePath: string): string {
  return path.win32.resolve(path.win32.dirname(exePath), '..', 'Update.exe');
}

export interface SquirrelDeps {
  exePath: string;
  quit: () => void;
  spawn?: typeof nodeSpawn;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/** Run `event`'s hook, then quit — once, whichever comes first of Update.exe
 *  exiting, failing to start, or the timeout. */
export function handleSquirrelEvent(event: SquirrelEvent, deps: SquirrelDeps): void {
  const { exePath, quit, spawn = nodeSpawn, setTimer = setTimeout } = deps;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    quit();
  };
  const args = updateExeArgs(event, exePath);
  if (!args) {
    finish();
    return;
  }
  try {
    const child = spawn(updateExePath(exePath), args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (err) => {
      logger('entrypoint').warn(`squirrel ${event}: Update.exe failed to start`, err);
      finish();
    });
    child.on('exit', finish);
  } catch (err) {
    logger('entrypoint').warn(`squirrel ${event}: Update.exe failed to start`, err);
    finish();
    return;
  }
  setTimer(finish, HOOK_TIMEOUT_MS);
}
