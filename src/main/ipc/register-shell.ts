import { ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Channels } from '../../shared/channels';
import { rootPathFromEvent, winFromEvent } from './helpers';

export function registerShell(): void {
  // Export
  ipcMain.handle(Channels.EXPORT_CSV, async (e, csv: string) => {
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

  // Shell
  ipcMain.handle(Channels.SHELL_REVEAL_FILE, (e, relativePath?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const fullPath = relativePath
      ? path.join(rootPath, relativePath)
      : rootPath;
    shell.showItemInFolder(fullPath);
  });

  ipcMain.handle(Channels.SHELL_OPEN_IN_DEFAULT, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    void shell.openPath(path.join(rootPath, relativePath));
  });

  ipcMain.handle(Channels.SHELL_OPEN_IN_TERMINAL, (e, relativePath?: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return;
    const dir = relativePath
      ? path.join(rootPath, path.dirname(relativePath))
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
  });

  ipcMain.handle(Channels.SHELL_OPEN_EXTERNAL, async (_e, url: string) => {
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
}
