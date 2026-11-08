/**
 * The CLI's stdin (#3026).
 *
 * In CLI mode the CLI runs inside the packaged app's main process
 * (`main/cli-mode.ts`), and on Windows Electron replaces that process's
 * `process.stdin` with a stand-in that ends at once, with no data, whatever
 * was piped in. Measured on a Windows runner: `process.stdin` read nothing,
 * while fd 0 itself — `fs.readSync(0)` or a read stream on it — had every
 * byte. So `minerva mcp` answered nothing there and `propose-note` got an
 * empty body.
 *
 * Under Electron on Windows the CLI reads fd 0 directly; everywhere else,
 * including plain Node, `process.stdin` is right and keeps its TTY flag.
 */
import fs from 'node:fs';

type Env = { platform: NodeJS.Platform; electron: string | undefined };

export function cliStdin(env: Env = { platform: process.platform, electron: process.versions.electron }): NodeJS.ReadableStream {
  if (env.platform === 'win32' && env.electron) return fs.createReadStream('', { fd: 0, autoClose: false });
  return process.stdin;
}
