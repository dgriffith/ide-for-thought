/**
 * Persistent Python subprocess per project (#241).
 *
 * Spawns a single Python process — the kernel — on first execution for
 * each project, multiplexes JSON-line requests/events over its stdio,
 * and tears down on project release / app quit.
 *
 * Per-notebook namespaces live inside the kernel itself (kernel keys a
 * dict on `notebookPath`), so cells in the same notebook share state
 * and cells in different notebooks don't.
 *
 * Every cell carries an execution deadline (#2218) — see `cell-deadline.ts`
 * for why it is armed against the head of the queue and why it interrupts
 * before it kills.
 *
 * v1 buffers events per-cell and resolves a single CellResult on `done`,
 * so the existing executor signature works unchanged. The kernel
 * already streams events at the protocol level — surfacing them
 * incrementally to the renderer is a future hook.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { CellOutput, CellResult, KernelMimeBundle } from '../../shared/compute/types';
import { startRpcServer, type RpcServer } from './rpc-server';
import os from 'node:os';
import { resolvePythonInterpreter, getPythonSettings } from './python-settings';
import { planKernelLaunch, resolveRealPath } from './sandbox';
import {
  createCellDeadlines, cellTimeoutMessage, resolveCellBudgetMs, type CellDeadlines,
} from './cell-deadline';
import { logger } from '../../shared/logger';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

interface PendingCell {
  resolve: (result: CellResult) => void;
  stdout: string[];
  stderr: string[];
  result?: unknown;
  error?: { ename: string; evalue: string; traceback: string[] } | undefined;
  /** Execution budget in ms, captured at submit (#2218). `0` = no limit.
   *  Captured rather than re-read so a settings change mid-flight can't move
   *  a deadline that is already counting. */
  timeoutMs: number;
  /** Set once the budget expired, so `finalizeCell` reports the timeout
   *  instead of the bare `KeyboardInterrupt` the kernel will send back. */
  timedOut?: boolean;
}

interface KernelEvent {
  cellId?: string;
  type:
    | 'ready' | 'stdout' | 'stderr' | 'result' | 'error' | 'done'
    | 'protocol-error' | 'reset-ack';
  payload?: unknown;
  executionTimeMs?: number;
  message?: string;
}

interface KernelState {
  /** Carried on the state so a deadline that fires can tear THIS kernel
   *  down without re-deriving the key — and can check it is still the
   *  kernel registered for the project before doing so. */
  rootPath: string;
  proc: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  /** Insertion-ordered, and the kernel executes in that order — so the
   *  first entry is the cell currently running. `cell-deadline.ts` relies
   *  on exactly that; see its header. */
  pending: Map<string, PendingCell>;
  rpc: RpcServer;
  deadlines: CellDeadlines;
}

const kernels = new Map<string, KernelState>();

/**
 * Resolve the Python interpreter to invoke (#374). Discovery order:
 *   1. Per-machine Settings override stored under userData.
 *   2. `$MINERVA_PYTHON` env var (legacy / CI / scripting escape hatch).
 *   3. `python3` on PATH.
 *
 * Async since the Settings file lives on disk; the kernel spawn path
 * awaits this on every fresh spawn (cheap — a single fs.readFile).
 */
async function resolvePythonBin(): Promise<string> {
  return resolvePythonInterpreter();
}

/**
 * Where the kernel script lives. In dev (Vite serves the renderer from
 * a localhost origin) the repo root is `process.cwd()`; in a packaged
 * build, electron-forge stages `resources/` next to the main bundle.
 */
/** Root of the bundled Python resources tree. Exported for #808 regression
 *  coverage — the packaged path must include the `resources/` nesting that
 *  `extraResource` produces. */
export function pythonResourcesRoot(): string {
  // The build-time global is undefined in the test runner — guard so a
  // ReferenceError doesn't kill the import. In dev (or in tests) the
  // repo's `resources/` is reachable from cwd; in a packaged build,
  // process.resourcesPath points at the .app's Resources dir.
  const isDev =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
      ? Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : !app?.isPackaged;
  // `extraResource: ['resources']` (forge.config.ts) copies the whole
  // `resources/` dir verbatim into the bundle, so the packaged kernel lands at
  // `<Resources>/resources/python/…`, NOT `<Resources>/python/…`. The missing
  // `resources` segment meant the packaged kernel path didn't exist (#808);
  // app-icon.ts already resolves the icons the corrected way.
  return isDev
    ? path.join(process.cwd(), 'resources', 'python')
    : path.join(process.resourcesPath, 'resources', 'python');
}

export function kernelScriptPath(): string {
  return path.join(pythonResourcesRoot(), 'minerva_kernel.py');
}

interface KernelEnvOptions {
  /** The project's directory — appended to PYTHONPATH and exposed to the
   *  kernel so it knows which notebase it's running against. */
  rootPath: string;
  /** Path of the RPC socket the kernel connects back to on first import. */
  socketPath: string;
  /** Whether network egress is allowed for this kernel (#1413). */
  allowNetwork: boolean;
}

/**
 * Build the `env` passed to the kernel subprocess. Extracted from
 * `spawnKernel` (#2105) as a pure function of its inputs so the
 * environment-construction logic — a missed var here silently breaks every
 * compute cell — is testable independent of actually spawning a process.
 */
export function buildKernelEnv({ rootPath, socketPath, allowNetwork }: KernelEnvOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // PYTHONUNBUFFERED ensures the kernel's stdout writes flush
    // immediately — without it, Python's buffering would hold each
    // event line until 4KB accumulated, breaking the line-protocol.
    PYTHONUNBUFFERED: '1',
    // PYTHONPATH = bundled-libs ++ project-root.
    //   1. `pythonResourcesRoot()` is where the bundled `minerva`
    //      package lives — listed first so the user can never shadow
    //      `import minerva` with their own `minerva.py`.
    //   2. `rootPath` is the project's directory, so any `.py` file
    //      the user puts in their notebase is importable from a
    //      ```python cell (`from helpers import foo` for `helpers.py`
    //      at the root; `from python.utils import foo` for
    //      `python/utils.py`). Mirrors how `.csv` and `.ttl` files
    //      are first-class in the notebase.
    PYTHONPATH: pythonResourcesRoot() + path.delimiter + rootPath,
    MINERVA_IPC_SOCKET: socketPath,
    MINERVA_PROJECT_ROOT: rootPath,
    // Network egress off by default (#1413). The kernel bootstrap installs a
    // socket guard unless this is exactly '1'; the RPC channel + loopback are
    // always allowed so the guard never severs the kernel's own connection.
    ...(allowNetwork ? { MINERVA_ALLOW_NETWORK: '1' } : {}),
    // Force matplotlib's non-interactive Agg backend (#243). Without
    // this, importing pyplot on macOS spawns a Cocoa GUI process
    // that bounces in the dock and leaks across app sessions; we
    // render figures to PNG bytes inside the kernel, so the GUI
    // backend is pure overhead. Reading MPLBACKEND on import is
    // matplotlib's documented config seam — no user code change.
    MPLBACKEND: 'Agg',
    // Point matplotlib's font/config cache at a writable temp dir (#1329 P2).
    // Its default (~/.matplotlib or ~/.cache) is outside the sandbox's
    // write-allowed regions, so without this the first import fails to build
    // its font cache. os.tmpdir() resolves under /private/var/folders, which
    // the profile permits.
    MPLCONFIGDIR: path.join(os.tmpdir(), 'minerva-matplotlib'),
  };
}

async function spawnKernel(rootPath: string): Promise<KernelState> {
  const py = await resolvePythonBin();
  // Network posture is read at spawn time (#1413) — so toggling it in Settings
  // takes effect on the next kernel start / restart, not mid-session.
  const { allowNetwork } = await getPythonSettings();
  const script = kernelScriptPath();
  // OS sandbox (#1329): wrap the interpreter in sandbox-exec on macOS. This is
  // computed BEFORE the RPC server starts and can throw (fail-closed if the
  // sandbox is unavailable) — doing it first means there's no RPC socket to
  // clean up on that path. Paths are resolved (realpath) because Seatbelt
  // matches on the canonical path (/var → /private/var, etc.).
  const launch = planKernelLaunch(py, script, {
    allowNetwork,
    projectRoot: resolveRealPath(rootPath),
    homeDir: resolveRealPath(os.homedir()),
  });
  // RPC server up first so the kernel can connect on first import.
  const rpc = await startRpcServer(rootPath);
  const proc = spawn(launch.command, launch.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildKernelEnv({ rootPath, socketPath: rpc.socketPath, allowNetwork }),
  });

  const pending = new Map<string, PendingCell>();
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  // The host's closures name `state`, which is declared just below them:
  // legal because none of them RUNS before the kernel has produced an
  // event, by which point `state` is long since bound.
  const deadlines = createCellDeadlines({
    pendingCellIds: () => [...pending.keys()],
    budgetMs: (cellId) => pending.get(cellId)?.timeoutMs ?? 0,
    interrupt: () => sendInterrupt(state).ok,
    markTimedOut: (cellId) => { const c = pending.get(cellId); if (c) c.timedOut = true; },
    hardReset: () => { hardResetKernel(state); },
  });
  const state: KernelState = { rootPath, proc, ready, pending, rpc, deadlines };

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    let event: KernelEvent;
    try {
      event = JSON.parse(line) as KernelEvent;
    } catch {
      logger('python-kernel').warn('non-JSON event line:', line);
      return;
    }
    if (event.type === 'ready') {
      resolveReady();
      return;
    }
    if (event.type === 'protocol-error') {
      logger('python-kernel').warn('protocol error:', event.message);
      return;
    }
    if (!event.cellId) return;
    const cell = pending.get(event.cellId);
    if (!cell) return;
    switch (event.type) {
      case 'stdout':
        cell.stdout.push(typeof event.payload === 'string' ? event.payload : '');
        break;
      case 'stderr':
        cell.stderr.push(typeof event.payload === 'string' ? event.payload : '');
        break;
      case 'result':
        cell.result = event.payload;
        break;
      case 'error':
        cell.error = event.payload as PendingCell['error'];
        break;
      case 'done':
        // Disarm BEFORE resolving: a timer left live here is the nastiest
        // failure this feature could introduce — it would SIGINT whichever
        // innocent cell the kernel had moved on to.
        state.deadlines.clear(event.cellId);
        finalizeCell(cell);
        pending.delete(event.cellId);
        // The next queued cell is now the one executing; give it its own
        // budget rather than the remains of this one's.
        state.deadlines.syncHead();
        break;
    }
  });

  // Forward kernel stderr (Python tracebacks from kernel-side bugs, not
  // from user cells — the latter are caught and emitted via `error`
  // events) to the main-process console so they're not silently lost.
  const errRl = readline.createInterface({ input: proc.stderr });
  errRl.on('line', (line) => {
    if (line.trim()) logger('python-kernel').warn('stderr:', line);
  });

  proc.on('exit', (code, signal) => {
    // Any in-flight cells get a synthetic error and the project's
    // kernel slot clears so the next runPython call respawns.
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    state.deadlines.clearAll();
    for (const cell of pending.values()) {
      // A cell we deliberately killed after its interrupt was ignored gets
      // the timeout message, not "the kernel exited" — the latter reads as
      // a crash, and hides both the cause and the namespace loss (#2218).
      cell.resolve(cell.timedOut
        ? { ok: false, error: cellTimeoutMessage(cell.timeoutMs, true) }
        : { ok: false, error: `Python kernel exited (${reason}) before cell finished` });
    }
    pending.clear();
    rejectReady(new Error(`Python kernel exited before ready (${reason})`));
    if (kernels.get(rootPath)?.proc === proc) {
      kernels.delete(rootPath);
    }
    // Close the RPC socket on crash too — terminate() handles it on the
    // graceful path, but a kernel that exits before terminate runs (e.g.
    // os._exit, segfault) needs the socket cleaned up here.
    void rpc.close().catch(() => undefined);
  });

  proc.on('error', (err) => {
    rejectReady(err);
  });

  return state;
}

/**
 * Drop a kernel that ignored its interrupt (#2218). Deliberately not
 * `stopKernel(rootPath)`: by the time the grace window elapses the project's
 * registered kernel may already be a DIFFERENT process (the old one crashed
 * and a later cell respawned it), and killing that one would be a fresh bug
 * introduced by the fix for this one.
 */
function hardResetKernel(state: KernelState): void {
  if (kernels.get(state.rootPath) === state) kernels.delete(state.rootPath);
  // The `exit` handler resolves every still-pending cell and closes the RPC
  // socket, so there is nothing to await here. A failure to terminate is
  // logged rather than swallowed: it means a spinning kernel is still
  // holding a CPU with nothing left to read its stdin, which is worth a
  // line in the log even though there is no further recovery to attempt.
  void terminate(state).catch((err: unknown) => {
    logger('python-kernel').warn('failed to terminate an unresponsive kernel:', err);
  });
}

function finalizeCell(cell: PendingCell): void {
  // Ahead of `cell.error`: the kernel DID send an error for this cell — a
  // `KeyboardInterrupt` traceback, since the deadline interrupted it — and
  // that traceback is exactly what the manual Interrupt Cell command
  // produces, so surfacing it here would tell the user nothing about why
  // their cell stopped (#2218).
  if (cell.timedOut) {
    cell.resolve({ ok: false, error: cellTimeoutMessage(cell.timeoutMs, false) });
    return;
  }
  if (cell.error) {
    const tb = cell.error.traceback.join('\n');
    cell.resolve({
      ok: false,
      error: tb || `${cell.error.ename}: ${cell.error.evalue}`,
    });
    return;
  }
  // Output precedence: a `result` payload (last-expression value) wins;
  // otherwise stdout+stderr concatenated as text.
  if (cell.result !== undefined) {
    cell.resolve({ ok: true, output: bundleToOutput(cell.result) });
    return;
  }
  const text = (cell.stdout.join('') + cell.stderr.join('')).replace(/\n+$/, '');
  cell.resolve({ ok: true, output: { type: 'text', value: text } });
}

/**
 * Translate a kernel-emitted MIME bundle into a typed CellOutput (#243).
 *
 * The kernel sends `{mime, data}` for every last-expression result —
 * pandas DataFrame, matplotlib Figure, PIL Image, `_repr_html_`,
 * `_repr_png_`, `_repr_svg_`, and JSON-roundtrippable scalars all
 * route through here. Anything we don't recognise falls through to
 * `text` (or `json` for JSON-roundtrippable payloads) so the renderer
 * always has something to display.
 *
 * Defensive against pre-#243 kernels (or non-Python executors) that
 * still emit a bare value: detect the bundle shape, fall back to
 * wrapping as a `json` output otherwise.
 */
export function bundleToOutput(raw: unknown): CellOutput {
  if (!isMimeBundle(raw)) {
    // Pre-#243 shape: bare value, treat as JSON.
    return { type: 'json', value: raw };
  }
  const { mime, data } = raw;
  switch (mime) {
    case 'application/vnd.minerva.dataframe+json': {
      const d = data as { columns: string[]; rows: Array<Array<string | number | boolean | null>>; totalRows: number; truncated: boolean };
      return {
        type: 'table',
        columns: d.columns,
        rows: d.rows,
        totalRows: d.totalRows,
        truncated: d.truncated,
      };
    }
    case 'image/png':
    case 'image/svg+xml':
      return { type: 'image', mime, data: data as string };
    case 'text/html':
      return { type: 'html', html: data as string };
    case 'text/plain':
      return { type: 'text', value: data as string };
    case 'application/json':
      return { type: 'json', value: data };
    default:
      // Unknown MIME: surface the raw payload as JSON so the user
      // can see what came back rather than silently dropping it.
      return { type: 'json', value: raw };
  }
}

function isMimeBundle(value: unknown): value is KernelMimeBundle {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as Record<string, unknown>).mime === 'string'
    && 'data' in (value as Record<string, unknown>)
  );
}

/**
 * Convert a project-relative `.py` path to the dotted module name Python
 * uses in `sys.modules` (#529). Strips the `.py` extension and turns
 * path separators into dots so `python/utils.py → python.utils`.
 *
 * Returns null for paths that don't look like a Python module:
 *   - non-`.py` extensions
 *   - `__init__.py` (those make a package; the package name is the
 *     parent directory, not the file)
 *   - paths containing segments that aren't valid Python identifiers
 *     (e.g. `2024/notes.py` — the leading digit makes `2024` invalid
 *     as a module name, and Python wouldn't have imported it anyway)
 *
 * Exported so the watcher can pre-filter before sending an invalidate
 * request — keeps the kernel from churning on edits to `.py` files
 * the user is unlikely to have imported as a module.
 */
export function pathToModuleName(relativePath: string): string | null {
  if (!relativePath.toLowerCase().endsWith('.py')) return null;
  // Normalise both separators since chokidar reports forward slashes on
  // POSIX and backslashes on Windows. Strip leading `./` if present.
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  // __init__.py marks a package; the package's importable name is the
  // parent directory. An invalidate on the parent dir's module name
  // handles the package itself + every submodule.
  const segments = cleaned.split('/');
  const last = segments[segments.length - 1];
  if (last === '__init__.py') {
    segments.pop();
  } else {
    segments[segments.length - 1] = last!.slice(0, -3); // drop `.py`
  }
  if (segments.length === 0) return null;
  // Each segment must be a valid Python identifier (ASCII letter/_ start,
  // then letters/digits/_). Reject paths that couldn't have been imported
  // anyway so we don't pollute sys.modules churn with no-op invalidates.
  for (const seg of segments) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg)) return null;
  }
  return segments.join('.');
}

/**
 * Invalidate Python modules in `rootPath`'s kernel so the next `import`
 * re-reads from disk (#529). Fire-and-forget: if no kernel is running
 * there's nothing to invalidate; if the kernel hasn't reached `ready`
 * yet we silently drop (it can't have imported anything either).
 *
 * Module-name conversion happens here so the kernel-side handler stays
 * simple and the path-handling logic is testable from TypeScript.
 */
export function invalidate(rootPath: string, relativePaths: string[]): void {
  const state = kernels.get(rootPath);
  if (!state || state.proc.exitCode !== null) return;
  const modules = relativePaths
    .map(pathToModuleName)
    .filter((m): m is string => m !== null);
  if (modules.length === 0) return;
  const req = JSON.stringify({ op: 'invalidate', modules });
  try {
    state.proc.stdin.write(req + '\n');
  } catch {
    // Kernel died between the kernels.get check and the write — the
    // exit handler will reap state; the next runPython respawns. Nothing
    // to invalidate against the dead kernel anyway.
  }
}

/**
 * Has the kernel process actually terminated?
 *
 * NOT `proc.killed`, which is what this check used to read (#2218). Node
 * sets `killed` to true as soon as `subprocess.kill()` successfully *sends*
 * a signal — its own docs are explicit that it "does not indicate that the
 * child process has been terminated". SIGINT is a signal a process is
 * expected to survive, and the kernel does survive it: `exec_cell` catches
 * the `KeyboardInterrupt` and `main()` goes back to reading stdin.
 *
 * So every interrupt permanently poisoned the liveness check. The NEXT cell
 * saw `killed === true`, spawned a second kernel, and left the first one
 * running with nothing holding its stdin — which is why "Compute: Interrupt
 * Cell" (#372) silently wiped every notebook's variables and leaked a
 * process, rather than doing the one thing it exists to do: stop the cell
 * and keep the session. Measured, not inferred: the kernel's `os.getpid()`
 * changes across an interrupt on `main`, and doesn't with this check.
 *
 * `exitCode` and `signalCode` are the two honest answers — one or the other
 * is non-null exactly when the process is gone.
 */
function isDead(proc: ChildProcessWithoutNullStreams): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/**
 * Run a Python cell. Spawns the project's kernel on first call. A
 * crashed kernel is detected on the next call and respawned.
 */
export async function runPython(
  rootPath: string,
  notebookPath: string,
  code: string,
): Promise<CellResult> {
  let state = kernels.get(rootPath);
  if (!state || isDead(state.proc)) {
    try {
      state = await spawnKernel(rootPath);
    } catch (err) {
      // Fail-closed (#1329): sandbox unavailable → refuse to run rather than
      // fall back to an unsandboxed interpreter. Surfaced as a normal cell error.
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    kernels.set(rootPath, state);
  }
  try {
    await state.ready;
  } catch (err) {
    return {
      ok: false,
      error: `Python kernel failed to start: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const cellId = randomUUID();
  // Resolved BEFORE the promise body so the insert + write stay one
  // synchronous block: `pending`'s insertion order has to match the order
  // the kernel receives requests in, or the head-of-queue deadline arms the
  // wrong cell (#2218).
  const timeoutMs = await resolveCellBudgetMs();
  const live = state;
  return new Promise<CellResult>((resolve) => {
    live.pending.set(cellId, { resolve, stdout: [], stderr: [], timeoutMs });
    const req = JSON.stringify({ op: 'exec', cellId, notebookPath, code });
    live.proc.stdin.write(req + '\n');
    live.deadlines.syncHead();
  });
}

/**
 * Result of an interrupt request — distinguishes the cases that
 * matter for UX (success, no kernel running, platform unsupported)
 * so the caller can surface the right message.
 */
export type InterruptResult =
  | { ok: true }
  | { ok: false; reason: 'no-kernel' | 'unsupported-platform' | 'signal-failed' };

/**
 * Interrupt the running cell in `rootPath`'s kernel without
 * restarting (#372). POSIX SIGINT delivers asynchronously to the
 * Python process; the cell's main thread sees it as
 * `KeyboardInterrupt` regardless of where it's blocked, and the
 * exec loop's catch handler surfaces a structured error event.
 *
 * Windows is gated for now — a reliable child-process interrupt
 * requires either a separate process group + CTRL_BREAK_EVENT or a
 * threaded stdin reader inside the kernel that can dispatch
 * `_thread.interrupt_main()` mid-user-code. Both belong to a
 * follow-up; until then Windows callers see `unsupported-platform`
 * and the UI can suggest Restart instead.
 *
 * Returns `no-kernel` for a project with no live kernel — there's
 * nothing to interrupt, and a missing-kernel error would be noise
 * from a hot keypress immediately after startup or after Restart.
 */
export function interruptKernel(rootPath: string): InterruptResult {
  const state = kernels.get(rootPath);
  if (!state) return { ok: false, reason: 'no-kernel' };
  return sendInterrupt(state);
}

/** The signal half of `interruptKernel`, against a state we already hold.
 *  The automatic deadline (#2218) must interrupt the kernel it armed against,
 *  not whatever `kernels` maps the project to by the time it fires. */
function sendInterrupt(state: KernelState): InterruptResult {
  if (isDead(state.proc)) return { ok: false, reason: 'no-kernel' };
  if (process.platform === 'win32') {
    return { ok: false, reason: 'unsupported-platform' };
  }
  try {
    state.proc.kill('SIGINT');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'signal-failed' };
  }
}

/**
 * Tear down the kernel for `rootPath`. SIGTERM with a 2s grace before
 * SIGKILL. Used by `Compute: Restart Python Kernel` and as the per-
 * project unit of `shutdownAllKernels`.
 */
export async function stopKernel(rootPath: string): Promise<void> {
  const state = kernels.get(rootPath);
  if (!state) return;
  kernels.delete(rootPath);
  await terminate(state);
}

/**
 * Restart: kill the current kernel; the next runPython call lazy-spawns
 * a fresh one. Wipes every notebook's namespace.
 */
export async function restartKernel(rootPath: string): Promise<void> {
  await stopKernel(rootPath);
}

/**
 * App-quit hook target. Stops every project's kernel concurrently; the
 * grace period applies per-kernel.
 */
export async function shutdownAllKernels(): Promise<void> {
  const states = [...kernels.values()];
  kernels.clear();
  await Promise.all(states.map(terminate));
}

async function terminate(state: KernelState): Promise<void> {
  await new Promise<void>((resolve) => {
    if (state.proc.exitCode !== null) {
      resolve();
      return;
    }
    state.proc.kill('SIGTERM');
    const t = setTimeout(() => {
      try { state.proc.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, 2000);
    state.proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
  // Close the RPC socket once the kernel is gone (#242). Best-effort:
  // a stale .sock inode in /tmp is harmless but unsightly.
  await state.rpc.close().catch(() => undefined);
}

/** Test/diagnostic visibility — projects with a live kernel. */
export function activeKernels(): string[] {
  return [...kernels.keys()];
}
