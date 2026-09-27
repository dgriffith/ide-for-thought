/**
 * One way to boot Minerva under Playwright (#1928).
 *
 * Every e2e spec used to call `electron.launch` directly with a hand-assembled
 * options object. Eight of the nine launch sites passed `--user-data-dir` and
 * one did not — `smoke.spec.ts`'s first test — so that test booted the
 * *developer's real Electron profile*. Two consequences, measured rather than
 * assumed:
 *
 *  - It **wrote to the real profile**: `Preferences`, `DIPS-wal` and
 *    `Session Storage/` all took the run's timestamp.
 *  - Its premise ("a fresh launch yields the Open Thoughtbase shell") became a
 *    *race* rather than a fact. With a project in the profile the welcome
 *    screen is still on screen at `domcontentloaded` and the assertion lands
 *    ~1.8s in; session restore replaces it around the 6s mark. So the test won
 *    the race and stayed green — but it was asserting a transient state, and a
 *    slower boot or a faster restore flips it red for reasons unrelated to the
 *    regression it exists to catch.
 *
 * Two things are therefore not optional here:
 *
 *  - **`userDataDir` is a required parameter.** Omitting it is a type error,
 *    not a silently-different test. `tests/architecture/e2e-launch-hygiene.test.ts`
 *    holds the other half by failing if a spec calls `electron.launch` directly.
 *  - **The environment is filtered.** Specs forwarded `...process.env` wholesale,
 *    handing the app under test the developer's real `GH_TOKEN` / `GITHUB_TOKEN`
 *    (both of which `src/main/git/` actually reads) along with any model API
 *    keys. A test run should not be able to authenticate as the developer.
 */

import {
  _electron as electron,
  chromium,
  type Browser,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Playwright transpiles tests as CJS (no `"type": "module"` in package.json),
// so `__dirname` is available — `import.meta.url` would force ESM and trip
// Playwright's loader.
export const projectRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Names that never reach the app under test. Suffix-matched rather than
 * enumerated so a newly-exported credential is excluded by default — the
 * failure mode worth guarding is the one nobody remembers to add to a list.
 */
const SECRET_PATTERN = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_SESSION)$/i;
const SECRET_PREFIX = /^(AWS_|AZURE_|GCP_|GOOGLE_)/i;

/** `process.env` minus anything that looks like a credential. */
export function scrubbedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SECRET_PATTERN.test(k) || SECRET_PREFIX.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * A fresh, empty temp directory. Used for both the isolated userData profile
 * and the throwaway project a spec operates on. The caller owns removing it.
 */
export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Seed a session so the app restores `projectDir` on launch. Without this the
 * app boots to the welcome screen — which is what the smoke test wants, and
 * exactly what it was not getting.
 */
export function seedSession(userDataDir: string, projectDir: string): void {
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1000, height: 700, rootPath: projectDir }]),
  );
}


export interface LaunchOptions {
  /** Required: the profile this run may read and write. */
  userDataDir: string;
  /**
   * Packaged-binary path. Omit to boot the in-tree `.vite/build/main.js`.
   * Given, the launch attaches over CDP instead of Playwright's Electron
   * driver — see `launchPackaged` for why.
   */
  executablePath?: string;
  /** Extra env on top of the scrubbed base (e.g. `MINERVA_E2E: '1'`). */
  env?: Record<string, string>;
  /** Defaults to 60s — local boot is ~3s; a cold CI runner needs the headroom. */
  timeout?: number;
}

/**
 * The slice of `ElectronApplication` the packaged-app specs use. Renderer
 * `Page`s are fully functional; there is no main-process handle (no
 * `app.evaluate`), because the packaged binary refuses the Node inspector that
 * handle is built on (#2366).
 */
export interface PackagedMinerva {
  firstWindow(options?: { timeout?: number }): Promise<Page>;
  process(): ChildProcess;
  close(): Promise<void>;
}

/**
 * Boot Minerva against an isolated profile. `ELECTRON_ENABLE_LOGGING` is always
 * on so a failing launch has main-process output to show for it.
 */
export function launchMinerva(opts: LaunchOptions & { executablePath: string }): Promise<PackagedMinerva>;
export function launchMinerva(opts: LaunchOptions & { executablePath?: undefined }): Promise<ElectronApplication>;
export async function launchMinerva(opts: LaunchOptions): Promise<ElectronApplication | PackagedMinerva> {
  const { userDataDir, executablePath, env = {}, timeout = 60_000 } = opts;
  const userDataArg = `--user-data-dir=${userDataDir}`;
  const launchEnv = { ...scrubbedEnv(), ELECTRON_ENABLE_LOGGING: '1', ...env };

  if (executablePath) {
    return launchPackaged(executablePath, [userDataArg], launchEnv, timeout);
  }
  return electron.launch({
    args: [projectRoot, userDataArg],
    cwd: projectRoot,
    timeout,
    env: launchEnv,
  });
}

/**
 * Launch the packaged binary and attach over the Chrome DevTools Protocol.
 *
 * Playwright's `_electron.launch` always prepends `--inspect=0` and does not
 * return until the main process's Node inspector answers. The packaged app is
 * built with the `EnableNodeCliInspectArguments` fuse OFF (#2366) — which is
 * the point of the fuse: `Minerva --inspect` must not hand whoever launches it
 * a debugger in the main process, where `safeStorage` decrypts the user's
 * stored credentials. So that driver can never attach to what we ship, and
 * flipping the fuse back on for a test copy would mean smoke-booting a binary
 * that isn't the one released.
 *
 * `--remote-debugging-port` is a Chromium switch no fuse governs, and it
 * reaches exactly what these specs drive: the renderer.
 */
async function launchPackaged(
  executablePath: string,
  args: string[],
  env: Record<string, string>,
  timeout: number,
): Promise<PackagedMinerva> {
  const child = spawn(executablePath, ['--remote-debugging-port=0', ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Keep both pipes draining for the life of the process, whoever else is
  // listening: an unread pipe fills (64 KB) and then blocks the app mid-write,
  // and ELECTRON_ENABLE_LOGGING is chatty. Callers attach their own 'data'
  // listeners on top of these.
  child.stdout.on('data', () => { /* drain */ });
  child.stderr.on('data', () => { /* drain */ });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const isRunning = () => child.exitCode === null && child.signalCode === null;

  async function stop(): Promise<void> {
    if (isRunning()) {
      child.kill('SIGTERM');
      const gone = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 10_000)),
      ]);
      if (!gone) child.kill('SIGKILL');
    }
    await exited;
  }

  let browser: Browser;
  try {
    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => {
        reject(new Error(`packaged app printed no DevTools endpoint within ${timeout}ms:\n${seen}`));
      }, timeout);
      const onData = (chunk: Buffer) => {
        seen += chunk.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
        if (m) {
          clearTimeout(timer);
          child.stderr.off('data', onData);
          resolve(m[1]);
        }
      };
      child.stderr.on('data', onData);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`packaged app exited (code ${code}, signal ${signal}) before DevTools came up:\n${seen}`));
      });
    });
    browser = await chromium.connectOverCDP(wsEndpoint, { timeout });
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    process: () => child,

    async firstWindow({ timeout: windowTimeout = 30_000 } = {}) {
      const deadline = Date.now() + windowTimeout;
      for (;;) {
        const page = browser.contexts().flatMap((c) => c.pages())[0];
        if (page) return page;
        if (!isRunning()) throw new Error('packaged app exited before opening a window');
        if (Date.now() > deadline) throw new Error(`packaged app opened no window within ${windowTimeout}ms`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },

    async close() {
      // Disconnecting a CDP browser leaves the app running; the process is
      // what has to go.
      await browser.close().catch(() => { /* already disconnected */ });
      await stop();
    },
  };
}
