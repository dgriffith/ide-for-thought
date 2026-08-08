import { app, shell, dialog } from 'electron';
import { handle } from './typed-ipc';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Channels } from '../../shared/channels';
import { assertSafePath } from '../notebase/fs';
import { winFromEvent, withRootPathOr } from './helpers';

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

  handle(Channels.SHELL_OPEN_IN_DEFAULT, withRootPathOr(undefined, (rootPath, relativePath: string) => {
    void shell.openPath(assertSafePath(rootPath, relativePath));
  }));

  handle(Channels.SHELL_OPEN_IN_TERMINAL, withRootPathOr(undefined, (rootPath, relativePath?: string) => {
    // Validate the full path is in-root, then open its containing dir —
    // dirname of an in-root path is itself in-root.
    const dir = relativePath
      ? path.dirname(assertSafePath(rootPath, relativePath))
      : rootPath;
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
