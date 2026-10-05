import { app, shell, dialog } from 'electron';
import { handle } from './typed-ipc';
import path from 'node:path';
import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Channels } from '../../shared/channels';
import { assertSafePath } from '../notebase/fs';
import { winFromEvent, withRootPathOr } from './helpers';
import { confirmNative } from '../native-confirm';

/** Extensions that run (or install) something when opened, on macOS / Windows / Linux. */
const LAUNCHABLE_EXTENSIONS = new Set([
  '.app', '.command', '.tool', '.terminal', '.workflow', '.action', '.scpt', '.scptd', '.applescript',
  '.pkg', '.mpkg', '.dmg', '.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.py', '.pyw', '.rb', '.pl', '.php',
  '.jar', '.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.lnk', '.desktop', '.appimage', '.run',
  '.url', '.webloc', '.inetloc', '.fileloc',
]);

/** True for a file that opening would run: an app/script type, or anything executable. */
export function isLaunchable(fullPath: string): boolean {
  if (LAUNCHABLE_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) return true;
  const st = statSync(fullPath, { throwIfNoEntry: false });
  if (!st) return false;
  // A bundle directory (`Foo.app/`) is caught by its extension above; any
  // other directory just opens in the file manager.
  if (st.isDirectory()) return false;
  return process.platform !== 'win32' && (st.mode & 0o111) !== 0;
}

export function registerShell(): void {
  // Export
  handle(Channels.EXPORT_CSV, async (e, csv: string) => {
    const win = winFromEvent(e);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export as CSV',
      defaultPath: 'query-results.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!result.canceled && result.filePath) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(result.filePath, csv, 'utf-8');
    }
  });

  // Shell. All three resolve renderer-supplied relative paths through
  // `assertSafePath` before handing them to `shell.*` / `spawn`, so a
  // `../` escape can't launch or reveal a file outside the project root —
  // the same path-traversal invariant `fs.ts` enforces (#1328). A
  // traversal attempt throws, which rejects the invoke and performs no
  // shell action.
  handle(Channels.SHELL_REVEAL_FILE, withRootPathOr(undefined, (rootPath, relativePath?: string) => {
    const fullPath = relativePath
      ? assertSafePath(rootPath, relativePath)
      : rootPath;
    shell.showItemInFolder(fullPath);
  }));

  handle(Channels.SHELL_OPEN_IN_DEFAULT, withRootPathOr(undefined, (rootPath, relativePath: string): void | Promise<void> => {
    const full = assertSafePath(rootPath, relativePath);
    // Opening an app, a script or an installer RUNS it (#2568) — and a shared
    // thoughtbase can carry one. Main confirms those; documents open as before.
    if (!isLaunchable(full)) {
      void shell.openPath(full);
      return;
    }
    return confirmNative(null, {
      message: `Run "${path.basename(full)}"?`,
      detail: `It's a program or script, so opening it runs it on your machine:\n\n${full}`,
      confirmLabel: 'Run',
    }).then((answer) => {
      if (answer.confirmed) void shell.openPath(full);
    });
  }));

  handle(Channels.SHELL_OPEN_IN_TERMINAL, withRootPathOr(undefined, (rootPath, relativePath?: string) => {
    // Validate the full path is in-root, then open the folder itself, or a
    // note's containing folder — dirname of an in-root path is itself in-root.
    // A folder used to open its parent, because this always took the dirname.
    let dir = rootPath;
    if (relativePath) {
      const full = assertSafePath(rootPath, relativePath);
      dir = statSync(full, { throwIfNoEntry: false })?.isDirectory() ? full : path.dirname(full);
    }
    // Use spawn with explicit args (no shell) so a filename containing
    // shell metacharacters can't inject. Detached + unref so closing the
    // app doesn't kill the user's terminal session.
    const detached = { stdio: 'ignore' as const, detached: true };
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Terminal', dir], detached).unref();
    } else if (process.platform === 'win32') {
      // `start` is a cmd.exe builtin; the empty title arg is start's
      // documented quirk for paths-with-spaces. /D sets the new
      // window's starting directory — no string interpolation needed.
      spawn('cmd.exe', ['/c', 'start', '', '/D', dir, 'cmd.exe', '/K'], detached).unref();
    } else {
      // Try the Debian-style chooser first, fall back to xterm on
      // spawn-error (binary missing). Both get the directory through
      // explicit args / cwd, never the shell.
      const child = spawn('x-terminal-emulator', [`--working-directory=${dir}`], detached);
      child.once('error', () => {
        const shellPath = process.env.SHELL ?? '/bin/sh';
        spawn('xterm', ['-e', shellPath], { ...detached, cwd: dir }).unref();
      });
      child.unref();
    }
  }));

  handle(Channels.SHELL_OPEN_EXTERNAL, async (_e, url: string) => {
    // Only http(s) — don't let anyone (or the LLM) coerce us into opening
    // file://, javascript:, etc.
    if (typeof url !== 'string') return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    await shell.openExternal(parsed.toString());
  });

  // Native emoji picker for the object-type icon field. The panel types into
  // whatever text field has focus, so the renderer focuses the input first and
  // we just raise the panel. macOS-only — `showEmojiPanel` doesn't exist on
  // other platforms, and there's no Electron equivalent to fall back to, so
  // this is a deliberate no-op there rather than a throw: the renderer already
  // hides the button off-macOS, and a stray call shouldn't reject.
  handle(Channels.SHELL_SHOW_EMOJI_PANEL, () => {
    if (process.platform === 'darwin') app.showEmojiPanel();
  });
}
