/**
 * The `minerva` CLI runs inside the app's own binary, as Minerva — not as
 * plain Node (#2565).
 *
 * The CLI shim used to be `ELECTRON_RUN_AS_NODE=1 <Minerva> <cli.js>`, which is
 * why the `RunAsNode` fuse had to stay on. On, it let anything on the machine
 * run `ELECTRON_RUN_AS_NODE=1 <Minerva> -e '<any JS>'`: arbitrary code in a
 * notarized "Minerva" process, inheriting its microphone and Files & Folders
 * grants and slipping past naive allowlisting.
 *
 * Now the shim is `<Minerva> --minerva-cli -- <args>`. `main.ts` checks
 * `cliModeArgs` before anything else; in CLI mode it never starts the app —
 * no window, no menu, no dock icon — and just runs the bundled `cli.js` (the
 * same file the old shim ran) with the user's arguments, exiting with its exit
 * code. The binary only ever runs Minerva's own CLI commands this way; the
 * fuse is off, so `ELECTRON_RUN_AS_NODE` is ignored entirely.
 *
 * `--` after the flag stops Chromium reading the user's arguments as browser
 * switches (an argument like `--remote-debugging-port=…` must stay an
 * argument). An already-installed OLD shim still works: with the fuse off,
 * Electron ignores the variable and starts main with `argv[1]` = the path to
 * `cli.js`, which `cliModeArgs` recognises.
 */
import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

export const CLI_MODE_FLAG = '--minerva-cli';

/** Where the bundled CLI lives: beside this main bundle, in `.vite/build/`. */
export function bundledCliPath(): string {
  return path.join(__dirname, 'cli.js');
}

/**
 * The CLI arguments if this process was started as the CLI, else null.
 *
 *  - `<exe> --minerva-cli [--] <args>` — the current shim.
 *  - `<exe> <…/.vite/build/cli.js> <args>` with `ELECTRON_RUN_AS_NODE=1` in
 *    the environment — a shim installed before #2565, running against a binary
 *    whose RunAsNode fuse is now off.
 */
export function cliModeArgs(argv: readonly string[], env: NodeJS.ProcessEnv): string[] | null {
  const flagAt = argv.indexOf(CLI_MODE_FLAG);
  if (flagAt === 1) {
    const rest = argv.slice(flagAt + 1);
    return rest[0] === '--' ? rest.slice(1) : rest;
  }
  const first = argv[1] ?? '';
  const legacy = env.ELECTRON_RUN_AS_NODE === '1' && /[/\\]\.vite[/\\]build[/\\]cli\.js$/.test(first);
  return legacy ? argv.slice(2) : null;
}

/** Run the bundled CLI in this process with `args`. It exits the process itself. */
export function runCliMode(args: string[]): void {
  // A command-line tool: no dock icon, no app switcher entry.
  app.dock?.hide();
  const cli = bundledCliPath();
  // `cli.js` reads `process.argv.slice(2)`, as it did under RunAsNode.
  process.argv = [process.execPath, cli, ...args];
  createRequire(__filename)(cli);
}
