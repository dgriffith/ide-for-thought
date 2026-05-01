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

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

interface PendingCell {
  resolve: (result: CellResult) => void;
  stdout: string[];
  stderr: string[];
  result?: unknown;
  error?: { ename: string; evalue: string; traceback: string[] };
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
  proc: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  pending: Map<string, PendingCell>;
  rpc: RpcServer;
}

const kernels = new Map<string, KernelState>();

/**
 * Resolve the Python interpreter to invoke. v1 honours $MINERVA_PYTHON
 * and falls back to `python3` on PATH. Bundled-Python + a Settings
 * UI override are tracked in #374.
 */
function resolvePythonBin(): string {
  return process.env.MINERVA_PYTHON ?? 'python3';
}

/**
 * Where the kernel script lives. In dev (Vite serves the renderer from
 * a localhost origin) the repo root is `process.cwd()`; in a packaged
 * build, electron-forge stages `resources/` next to the main bundle.
 */
/** Root of the bundled Python resources tree. */
function pythonResourcesRoot(): string {
  // The build-time global is undefined in the test runner — guard so a
  // ReferenceError doesn't kill the import. In dev (or in tests) the
  // repo's `resources/` is reachable from cwd; in a packaged build,
  // process.resourcesPath points at the .app's Resources dir.
  const isDev =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
      ? Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : !app?.isPackaged;
  return isDev
    ? path.join(process.cwd(), 'resources', 'python')
    : path.join(process.resourcesPath, 'python');
}

function kernelScriptPath(): string {
  return path.join(pythonResourcesRoot(), 'minerva_kernel.py');
}

async function spawnKernel(rootPath: string): Promise<KernelState> {
  const py = resolvePythonBin();
  const script = kernelScriptPath();
  // RPC server up first so the kernel can connect on first import.
  const rpc = await startRpcServer(rootPath);
  const proc = spawn(py, [script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // PYTHONUNBUFFERED ensures the kernel's stdout writes flush
      // immediately — without it, Python's buffering would hold each
      // event line until 4KB accumulated, breaking the line-protocol.
      PYTHONUNBUFFERED: '1',
      // The bundled `minerva` package lives next to the kernel script;
      // putting its parent on PYTHONPATH lets `import minerva` resolve
      // without a pip install (#242).
      PYTHONPATH: pythonResourcesRoot(),
      MINERVA_IPC_SOCKET: rpc.socketPath,
      MINERVA_PROJECT_ROOT: rootPath,
      // Force matplotlib's non-interactive Agg backend (#243). Without
      // this, importing pyplot on macOS spawns a Cocoa GUI process
      // that bounces in the dock and leaks across app sessions; we
      // render figures to PNG bytes inside the kernel, so the GUI
      // backend is pure overhead. Reading MPLBACKEND on import is
      // matplotlib's documented config seam — no user code change.
      MPLBACKEND: 'Agg',
    },
  });

  const pending = new Map<string, PendingCell>();
  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    let event: KernelEvent;
    try {
      event = JSON.parse(line) as KernelEvent;
    } catch {
      console.warn('[python-kernel] non-JSON event line:', line);
      return;
    }
    if (event.type === 'ready') {
      resolveReady();
      return;
    }
    if (event.type === 'protocol-error') {
      console.warn('[python-kernel] protocol error:', event.message);
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
        finalizeCell(cell);
        pending.delete(event.cellId);
        break;
    }
  });

  // Forward kernel stderr (Python tracebacks from kernel-side bugs, not
  // from user cells — the latter are caught and emitted via `error`
  // events) to the main-process console so they're not silently lost.
  const errRl = readline.createInterface({ input: proc.stderr });
  errRl.on('line', (line) => {
    if (line.trim()) console.warn('[python-kernel:stderr]', line);
  });

  proc.on('exit', (code, signal) => {
    // Any in-flight cells get a synthetic error and the project's
    // kernel slot clears so the next runPython call respawns.
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    for (const cell of pending.values()) {
      cell.resolve({ ok: false, error: `Python kernel exited (${reason}) before cell finished` });
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

  return { proc, ready, pending, rpc };
}

function finalizeCell(cell: PendingCell): void {
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
 * Run a Python cell. Spawns the project's kernel on first call. A
 * crashed kernel is detected on the next call and respawned.
 */
export async function runPython(
  rootPath: string,
  notebookPath: string,
  code: string,
): Promise<CellResult> {
  let state = kernels.get(rootPath);
  if (!state || state.proc.killed || state.proc.exitCode !== null) {
    state = await spawnKernel(rootPath);
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
  return new Promise<CellResult>((resolve) => {
    state.pending.set(cellId, { resolve, stdout: [], stderr: [] });
    const req = JSON.stringify({ op: 'exec', cellId, notebookPath, code });
    state.proc.stdin.write(req + '\n');
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
  if (!state || state.proc.exitCode !== null) return { ok: false, reason: 'no-kernel' };
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
