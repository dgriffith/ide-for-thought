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
 *  - **HOME is isolated too (#2466).** Scrubbing credentials left the real
 *    `HOME`, and the app reads `~/.minerva/` from it: user skills (a different
 *    skill catalog, menus and slash commands under test), `menu-config.json`,
 *    and `mcp-servers.json` — whose servers it spawns at startup, which on the
 *    maintainer's machine meant an `npx github:…` download per launch. CI's
 *    HOME is clean, so local and CI runs disagreed. `minervaEnv` points HOME at
 *    an empty directory inside the profile; a spec that needs something there
 *    seeds it under `isolatedHome(userDataDir)` before launching.
 */

import {
  _electron as electron,
  chromium,
  expect,
  test,
  type Browser,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotate, captureProcessState, inTest, probeApp, settlesWithin, withinBound } from './bounded';
import { watchFirstPaint, type FirstPaintSample } from './first-paint';

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
 * The HOME a launch against `userDataDir` sees (#2466): an empty directory
 * inside the profile, so it is removed with it and a relaunch against the same
 * profile sees the same HOME. Created on demand; seed `.minerva/` here when a
 * spec needs user skills or config.
 */
export function isolatedHome(userDataDir: string): string {
  const home = path.join(userDataDir, 'e2e-home');
  fs.mkdirSync(home, { recursive: true });
  return home;
}

/**
 * The environment every Minerva process under test gets: credentials
 * scrubbed, HOME isolated to `home`, then `extra` on top. Specs build env
 * through this, never `scrubbedEnv()` directly — that leaves the real HOME.
 */
export function minervaEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...scrubbedEnv(), HOME: home, ...extra };
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
   * Packaged-binary path. Omit to boot the in-tree `.vite/build/main.cjs`.
   * Given, the launch attaches over CDP instead of Playwright's Electron
   * driver — see `launchPackaged` for why.
   */
  executablePath?: string;
  /** Extra env on top of the scrubbed base (e.g. `MINERVA_E2E: '1'`). */
  env?: Record<string, string>;
  /** Extra Chromium/Electron switches after the profile flag (e.g. the docs
   *  screenshot harness's `--force-device-scale-factor=2`). */
  args?: string[];
  /** Node arguments before the app path (dev launches only), e.g. a `-r`
   *  shim. Only the ready-gate regression spec uses it (#2595). */
  nodeArgs?: string[];
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
  const { userDataDir, executablePath, env = {}, args = [], nodeArgs = [], timeout = 60_000 } = opts;
  const userDataArg = `--user-data-dir=${userDataDir}`;
  const launchEnv = minervaEnv(isolatedHome(userDataDir), { ELECTRON_ENABLE_LOGGING: '1', ...env });

  // A step, so a report of a slow or hung attempt says whether launch is where
  // the time went (#2458).
  const app = await test.step(executablePath ? 'launch Minerva (packaged)' : 'launch Minerva', () =>
    executablePath
      ? launchPackaged(executablePath, [userDataArg, ...args], launchEnv, timeout)
      : electron.launch({
        args: [...nodeArgs, projectRoot, userDataArg, ...args],
        cwd: projectRoot,
        timeout,
        env: launchEnv,
      }));
  track(app);
  if (!executablePath) {
    await test.step('wait for Electron ready', () => releaseReadyGate(app as ElectronApplication));
    applyNavigationTimeout(app as ElectronApplication);
    await startTrace(app as ElectronApplication);
  }
  return app;
}

// ── Playwright's ready gate (#2595) ─────────────────────────────────────────
//
// Playwright's Electron loader (`-r …/electron/loader.js`) swallows Electron's
// `ready` and replays it only when the runner sends
// `Runtime.evaluate("__playwright_run()")`. That send is fire-and-forget. If it
// arrives before the loader has defined `__playwright_run`, or is otherwise
// lost, it fails silently: Electron is ready, but the app never sees `ready`,
// creates no window, and `firstWindow()` times out. A quit then hangs too,
// because the app never finished starting. CI saw this about 3 times in ~900
// launches, on different specs. The trace's stderr stopped at
// `boot +0ms: main module loaded`, with the main thread idle.
//
// The loader replaces `app.isReady` with its gated flag. Electron's own
// readiness is still observable: `session.defaultSession` throws until the app
// is natively ready. So the two can be told apart:
//  - native ready, gate still closed 2s later: the release was lost. Repair it
//    by calling `__playwright_run()` and annotate `ready-gate-repaired`, which
//    the flake report raises as a ::warning;
//  - native never ready: Electron itself didn't start. That's a real hang, so
//    fail, naming it, rather than repairing anything.
// Measured normal: the gate is already open, or opens within ~1s of launch.

const READY_POLL_MS = 250;
const GATE_GRACE_MS = 2_000;
const NATIVE_READY_LIMIT_MS = 30_000;

interface ReadyState { gated: boolean; native: boolean; hasRun: boolean }

async function readyState(app: ElectronApplication): Promise<ReadyState> {
  return app.evaluate(({ app: a, session }) => {
    // The loader replaced app.isReady itself. `session.defaultSession` throws
    // until Electron is natively ready, and the app uses that session anyway,
    // so reading it changes nothing. (An earlier version probed `screen`,
    // which creates the screen module and its display observers in main. That
    // perturbed later specs: 3 of 5 full runs failed, against 0 of 3 without.)
    let native: boolean;
    try { native = !!session.defaultSession; } catch { native = false; }
    return {
      gated: a.isReady(),
      native,
      hasRun: typeof (globalThis as { __playwright_run?: unknown }).__playwright_run === 'function',
    };
  });
}

async function releaseReadyGate(app: ElectronApplication): Promise<void> {
  const start = Date.now();
  let nativeSince: number | null = null;
  for (;;) {
    const s = await readyState(app);
    if (s.gated) return;
    const now = Date.now();
    if (s.native) {
      nativeSince ??= now;
      if (now - nativeSince >= GATE_GRACE_MS && s.hasRun) {
        const note = `Electron was ready but Playwright's ready release never landed; called __playwright_run() after ${((now - start) / 1000).toFixed(1)}s`;
        console.warn(`[e2e] ⚠ ${note}`);
        annotate('ready-gate-repaired', note);
        await app.evaluate(() => (globalThis as unknown as { __playwright_run(): Promise<void> }).__playwright_run());
        return;
      }
    } else if (now - start >= NATIVE_READY_LIMIT_MS) {
      throw new Error(`Electron never became ready within ${NATIVE_READY_LIMIT_MS / 1000}s of launch (native app.isReady() still false). A real startup hang, not Playwright's ready gate (#2595).`);
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
}

/**
 * `use.navigationTimeout` in playwright.config.ts only reaches contexts
 * Playwright Test creates; an Electron app's pages kept the library default
 * (measured: `waitForURL` gave up at exactly 30000ms with the config at 20s).
 * Apply the configured value to the app's context so the config is what
 * bounds `reload` / `waitForLoadState` / `waitForURL` here too (#2458).
 */
function applyNavigationTimeout(app: ElectronApplication): void {
  if (!inTest()) return;
  const ms = test.info().project.use.navigationTimeout;
  if (typeof ms === 'number' && ms > 0) app.context().setDefaultNavigationTimeout(ms);
}

// ── Traces of the Electron renderer (#2458) ─────────────────────────────────
//
// `use.trace` in playwright.config.ts only instruments the contexts Playwright
// Test creates itself (the `page`/`context` fixtures). An Electron app's context
// is created by `_electron.launch`, so on its own the config yields a runner-only
// trace — steps and errors, no DOM snapshots or action log. So the helper
// records the app's context itself, under the same mode, and the `test.ts`
// fixture keeps or discards the file once the attempt's outcome is known.
// Packaged launches (CDP-attached, no Electron handle) aren't traced.
//
// Snapshots, not screenshots. Measured on the full suite, 53 tests, green:
// 101s untraced, 119s with snapshots (+17%), 141s with screenshots too (+38%).
// The screencast is the expensive half and the less useful one for a hang —
// a wedged main process stops producing frames anyway.

const traced = new Set<ElectronApplication>();
const pendingTraces: string[] = [];

type TraceSetting = string | { mode?: string } | undefined;

/** The configured trace mode, as a plain string. */
function traceMode(): string {
  const t = test.info().project.use.trace as TraceSetting;
  return (typeof t === 'string' ? t : t?.mode) ?? 'off';
}

function shouldRecordTrace(): boolean {
  const mode = traceMode();
  if (mode === 'off') return false;
  // Only the first attempt's trace can be kept in this mode — don't pay for
  // recording on a retry.
  if (mode === 'retain-on-first-failure') return test.info().retry === 0;
  return true;
}

async function startTrace(app: ElectronApplication): Promise<void> {
  if (!inTest() || !shouldRecordTrace()) return;
  await app.context().tracing.start({ screenshots: false, snapshots: true, title: test.info().title });
  traced.add(app);
}

/** Stop recording into the attempt's output dir. Bounded: when main is wedged
 *  the stop may never answer, and a missing trace beats a hung teardown. */
async function stopTrace(app: ElectronApplication): Promise<void> {
  if (!traced.delete(app) || !inTest()) return;
  const file = test.info().outputPath(`electron-trace-${pendingTraces.length + 1}.zip`);
  await settlesWithin(app.context().tracing.stop({ path: file }), 5_000);
  if (fs.existsSync(file)) pendingTraces.push(file);
}

/**
 * Keep this attempt's Electron traces if the configured mode says so, as
 * `electron-trace` attachments (open with `npx playwright show-trace`);
 * otherwise delete them. Called by the `test.ts` fixture after the test.
 */
export async function settleTraces(): Promise<void> {
  const files = pendingTraces.splice(0);
  if (files.length === 0 || !inTest()) return;
  const info = test.info();
  const failed = info.status !== info.expectedStatus;
  const mode = traceMode();
  const keep = mode === 'on' || (failed && (mode !== 'retain-on-first-failure' || info.retry === 0));
  for (const file of files) {
    // `attach` copies into the attempt's attachments/, so the original goes
    // either way — one copy per kept trace, none per discarded one.
    if (keep) await info.attach('electron-trace', { path: file, contentType: 'application/zip' });
    fs.rmSync(file, { force: true });
  }
}

// ── Teardown that cannot hang (#2458) ───────────────────────────────────────
//
// `ElectronApplication.close()` asks the main process to quit and waits for
// the child to exit — with no timeout. When main is wedged it never returns;
// the test's `finally` stalls, and if the test already timed out, Playwright's
// own worker teardown tries the same graceful close and stalls too: "Worker
// teardown timeout of 60000ms exceeded", an error outside any test that fails
// the job whatever the retries did (#2458, 1 in 46 CI runs).
//
// So every close goes through `closeMinerva`: `close()`, bounded; on a miss,
// SIGKILL the child — the way `launchPackaged`'s `stop()` already did — and
// say so loudly: a console line, an `app-killed` annotation the flake report
// prints, and a soft failure so the attempt is red. A wedged app becomes a
// failed (then, on retry, flaky) test inside the #2379 budget, never a silent
// one.
//
// `test.ts`'s auto fixture runs the same close on any app still alive when a
// test ends — which is the case that matters most: a test that TIMED OUT never
// reaches its own `finally`, because the await it is stuck in never settles.

/**
 * How long `close()` may take before the child is killed. Measured (#2458):
 * 0.07-0.2s on a quiet machine across the whole suite, up to ~2s under normal
 * load. Under deliberate CPU starvation (load 30-50 on 10 cores) a healthy quit
 * took up to 11.8s — the JS side finishes in <0.2s and the rest is Electron's
 * native shutdown waiting on starved helper processes — so a kill at 10s can
 * fire on a merely-starved runner too. The report says which: see the probe.
 */
export const CLOSE_BOUND_MS = 10_000;

/** What both launch flavours share, as far as teardown is concerned. */
export type MinervaApp = ElectronApplication | PackagedMinerva;

const liveApps = new Set<MinervaApp>();

function track(app: MinervaApp): void {
  liveApps.add(app);
  app.process().once('exit', () => liveApps.delete(app));
}

/** Apps launched in this worker whose process has not exited. */
export function liveMinervaApps(): MinervaApp[] {
  return [...liveApps];
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Close Minerva, and kill it if it won't close. Never throws — a failed kill
 * is recorded as a soft failure instead — so a `finally` calling it keeps the
 * test body's own error as the primary one.
 */
export async function closeMinerva(app: MinervaApp, why = 'the test'): Promise<void> {
  const child = app.process();
  const run = async () => {
    if (!isAlive(child)) {
      liveApps.delete(app);
      return;
    }
    const start = Date.now();
    if ('evaluate' in app) await stopTrace(app);
    const closed = await settlesWithin(app.close(), CLOSE_BOUND_MS);
    if (closed && !isAlive(child)) {
      liveApps.delete(app);
      return;
    }
    // close() settled but the child lingers, or close() never returned.
    const exited = new Promise<void>((r) => {
      if (!isAlive(child)) r();
      else child.once('exit', () => r());
    });
    if (closed) await settlesWithin(exited, 2_000);
    if (!isAlive(child)) {
      liveApps.delete(app);
      return;
    }
    const title = inTest() ? test.info().titlePath.slice(1).join(' › ') : 'a test that already ended';
    // Probe BEFORE the kill: whether main still answers is the one fact that
    // says what wedged, and a stack sample of the live process says where.
    // The main probe is skipped for the packaged flavour (no main handle).
    const probe = 'evaluate' in app ? await probeApp(app).catch(() => '') : '';
    // probeApp already sampled the stacks if main was wedged; otherwise do it
    // here — a process that answered app.quit() but won't exit is its own case.
    const state = [probe, probe.includes('process-state') ? '' : await captureProcessState(child, 'close')]
      .filter(Boolean).join('\n');
    child.kill('SIGKILL');
    await settlesWithin(exited, 5_000);
    liveApps.delete(app);
    const msg =
      `app did not quit within ${CLOSE_BOUND_MS / 1000}s after ${title} (closed by ${why}) — killed ` +
      `(SIGKILL, pid ${child.pid}, after ${((Date.now() - start) / 1000).toFixed(1)}s)` +
      (state ? `\n${state}` : '');
    // Loud on purpose: this is the line to grep a CI log for.
    console.error(`\n[e2e] ✗ ${msg}\n`);
    annotate('app-killed', msg);
    if (inTest()) expect.soft(false, msg).toBe(true);
  };
  if (inTest()) await test.step('close Minerva', run);
  else await run();
}

// ── The main-process e2e hooks, bounded (#2458) ─────────────────────────────

/**
 * `seedProposal` runs a Turtle parse, a graph persist and a broadcast. Measured
 * (#2458): 9-24ms across ~90 local runs, and 12-30ms under deliberate CPU
 * starvation. 15s is ~500x that and far below the 60s test timeout, so a hang
 * fails here — step named, main probed — instead of eating the whole test
 * budget in silence.
 */
export const SEED_BOUND_MS = 15_000;

/** File a pending proposal (src/main/e2e-hooks.ts) and return its URI — the
 *  fixed claim by default, or `write` (e.g. a note/folder move, #2541). */
export async function seedProposal(app: ElectronApplication, write?: Record<string, unknown>): Promise<string | null> {
  return test.step('seed proposal (main-process hook)', () =>
    withinBound(
      'seedProposal (app.evaluate in the main process)',
      SEED_BOUND_MS,
      app.evaluate(async (_electron, w) => {
        const g = globalThis as typeof globalThis & { __minervaE2E?: { seedProposal(write?: unknown): Promise<string | null> } };
        if (!g.__minervaE2E) throw new Error('e2e hook missing — MINERVA_E2E not set?');
        return g.__minervaE2E.seedProposal(w);
      }, write),
      () => probeApp(app),
    ));
}

/** Ingest the fixed offline source (src/main/e2e-hooks.ts). */
export async function ingestSource(app: ElectronApplication): Promise<{ sourceId: string; title: string }> {
  return test.step('ingest source (main-process hook)', () =>
    withinBound(
      'ingestSource (app.evaluate in the main process)',
      SEED_BOUND_MS,
      app.evaluate(async () => {
        const g = globalThis as typeof globalThis & {
          __minervaE2E?: { ingestSource(): Promise<{ sourceId: string; title: string }> };
        };
        if (!g.__minervaE2E) throw new Error('e2e hook missing — MINERVA_E2E not set?');
        return g.__minervaE2E.ingestSource();
      }),
      () => probeApp(app),
    ));
}

const firstPaintWatchers = new WeakMap<ChildProcess, ReturnType<typeof watchFirstPaint>>();

/**
 * A packaged app's first-paint mark (#2384), or `null` if none arrived within
 * `timeoutMs`. The app prints it only when launched with
 * `env: { MINERVA_BOOT_TIMING: '1' }`; see `helpers/first-paint.ts`.
 */
export function firstPaintOf(app: PackagedMinerva, timeoutMs = 10_000): Promise<FirstPaintSample | null> {
  return firstPaintWatchers.get(app.process())?.waitFor(timeoutMs) ?? Promise.resolve(null);
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
  const spawnedAt = performance.now();
  const child = spawn(executablePath, ['--remote-debugging-port=0', ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Watching from spawn, before any await, so an early mark can't be missed.
  firstPaintWatchers.set(child, watchFirstPaint(child, spawnedAt));
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
