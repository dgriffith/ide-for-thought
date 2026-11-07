/**
 * The Python to run when nobody has chosen one (#2188).
 *
 * On macOS and Linux that is `python3` on PATH, as it always was. A stock
 * Windows install has no `python3`: python.org's installer puts `python.exe`
 * and the `py` launcher on PATH, and the Microsoft Store puts `python3.exe` /
 * `python.exe` *stubs* in `WindowsApps` that open the Store instead of running
 * anything. So on Windows the chain is:
 *
 *   1. `python3`, then `python`, on PATH — skipping the Store stubs;
 *   2. the `py` launcher, asked for its Python 3 (`py -3`) and answered with
 *      that interpreter's full path, so every caller still gets ONE command
 *      string it can spawn with no extra arguments;
 *   3. `python`, so a failure names the interpreter a Windows user expects.
 *
 * Found by reading PATH, not by spawning each candidate: only the launcher is
 * run, once, and the answer is kept for the life of the process. A Settings
 * override or `$MINERVA_PYTHON` comes before all of this
 * (`resolvePythonInterpreter`).
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export interface DiscoveryDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  isFile: (p: string) => boolean;
  /** Run the `py` launcher found at `exe`; its stdout, or null when it failed. */
  runLauncher: (exe: string) => string | null;
}

const realDeps = (): DiscoveryDeps => ({
  platform: process.platform,
  env: process.env,
  isFile: (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false,
  // A launcher with no Python 3 behind it exits non-zero: an answer, not an error.
  runLauncher: (exe) => {
    const r = spawnSync(exe, ['-3', '-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return r.status === 0 ? r.stdout : null;
  },
});

/** The Microsoft Store's app-execution aliases: they open the Store, not Python. */
function isStoreStub(p: string): boolean {
  return /[\\/]microsoft[\\/]windowsapps[\\/]/i.test(p);
}

/** `name` resolved through PATH and PATHEXT, as Windows would, or null. */
function onWindowsPath(name: string, deps: DiscoveryDeps): string | null {
  const dirs = (deps.env.PATH ?? deps.env.Path ?? '').split(';').filter(Boolean);
  const exts = (deps.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.win32.join(dir, name + ext.toLowerCase());
      if (deps.isFile(candidate) && !isStoreStub(candidate)) return candidate;
    }
  }
  return null;
}

export function discoverDefaultPython(deps: DiscoveryDeps = realDeps()): string {
  if (deps.platform !== 'win32') return 'python3';
  for (const name of ['python3', 'python']) {
    if (onWindowsPath(name, deps)) return name;
  }
  const launcher = onWindowsPath('py', deps);
  if (launcher) {
    const exe = deps.runLauncher(launcher)?.trim();
    if (exe && path.win32.isAbsolute(exe) && !isStoreStub(exe)) return exe;
  }
  return 'python';
}

let cached: string | null = null;

/** `discoverDefaultPython` for this process, worked out once. */
export function defaultPython(): string {
  cached ??= discoverDefaultPython();
  return cached;
}

export function _resetDefaultPythonForTests(): void {
  cached = null;
}
