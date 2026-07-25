/**
 * "Install `minerva` Command in PATH" (#1437, epic #1145 — Substrate).
 *
 * The packaged app bundles the headless CLI at `<app>/.vite/build/cli.js`
 * (forge.config `copyCliBundle`). This writes a small launcher to
 * `~/.local/bin/minerva` that runs the app's own Electron binary as Node
 * (`ELECTRON_RUN_AS_NODE`) against that bundle — so `minerva query …` /
 * `minerva mcp …` work with no separate Node and no dev checkout.
 *
 * `~/.local/bin` is user-writable (no admin prompt); if it isn't on PATH we say
 * so, and always surface the absolute path for MCP clients (e.g. Claude
 * Desktop) that launch from a bare environment. macOS/Linux (sh); Windows is a
 * follow-up.
 */
import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface MinervaCliPaths {
  electronBinary: string;
  cliJs: string;
  binDir: string;
  shimPath: string;
}

export function minervaCliPaths(): MinervaCliPaths {
  const binDir = path.join(os.homedir(), '.local', 'bin');
  return {
    electronBinary: process.execPath,
    cliJs: path.join(app.getAppPath(), '.vite', 'build', 'cli.js'),
    binDir,
    shimPath: path.join(binDir, 'minerva'),
  };
}

/** Single-quote a path for /bin/sh, escaping embedded single quotes. */
function shQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Write `~/.local/bin/minerva` and report where it went (with a PATH hint). */
export async function installMinervaCommand(): Promise<void> {
  const { electronBinary, cliJs, binDir, shimPath } = minervaCliPaths();

  if (!fs.existsSync(cliJs)) {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Minerva CLI not found in this build',
      detail: `Expected the bundled CLI at:\n  ${cliJs}\n\nThe “minerva” command is only available in a packaged build of Minerva.`,
    });
    return;
  }

  const shim =
    '#!/bin/sh\n' +
    '# Minerva CLI launcher — installed by Minerva.app (#1437). Re-run\n' +
    '# “Install ‘minerva’ Command in PATH…” from the Help menu if you\n' +
    '# move or reinstall the app.\n' +
    `exec env ELECTRON_RUN_AS_NODE=1 ${shQuote(electronBinary)} ${shQuote(cliJs)} "$@"\n`;

  try {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(shimPath, shim, { mode: 0o755 });
    fs.chmodSync(shimPath, 0o755); // ensure exec bit even if the file pre-existed
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      message: 'Could not install the minerva command',
      detail: `Writing ${shimPath} failed:\n${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const onPath = (process.env.PATH ?? '').split(path.delimiter).includes(binDir);
  const detail =
    `Installed the “minerva” command at:\n  ${shimPath}\n\n` +
    (onPath
      ? 'It’s on your PATH — open a new terminal and run:\n  minerva --help'
      : `Add ${binDir} to your PATH to run it as “minerva”. In ~/.zshrc (or ~/.bashrc):\n  export PATH="$HOME/.local/bin:$PATH"\n\nThen open a new terminal and run “minerva --help”.`) +
    `\n\nFor MCP clients that don’t use your shell PATH (e.g. Claude Desktop), point them at the full path:\n  ${shimPath}`;

  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: 'minerva command installed',
    detail,
    buttons: ['OK', 'Reveal in Finder'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response === 1) shell.showItemInFolder(shimPath);
}
