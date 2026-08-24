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

import { _electron as electron, type ElectronApplication } from '@playwright/test';
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
  /** Packaged-binary path. Omit to boot the in-tree `.vite/build/main.js`. */
  executablePath?: string;
  /** Extra env on top of the scrubbed base (e.g. `MINERVA_E2E: '1'`). */
  env?: Record<string, string>;
  /** Defaults to 60s — local boot is ~3s; a cold CI runner needs the headroom. */
  timeout?: number;
}

/**
 * Boot Minerva against an isolated profile. `ELECTRON_ENABLE_LOGGING` is always
 * on so a failing launch has main-process output to show for it.
 */
export async function launchMinerva(opts: LaunchOptions): Promise<ElectronApplication> {
  const { userDataDir, executablePath, env = {}, timeout = 60_000 } = opts;
  const userDataArg = `--user-data-dir=${userDataDir}`;

  return electron.launch({
    ...(executablePath
      ? { executablePath, args: [userDataArg] }
      : { args: [projectRoot, userDataArg], cwd: projectRoot }),
    timeout,
    env: { ...scrubbedEnv(), ELECTRON_ENABLE_LOGGING: '1', ...env },
  });
}
