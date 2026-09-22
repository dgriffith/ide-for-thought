/**
 * Execution deadlines for compute cells (#2218).
 *
 * ── The bug this exists to stop ─────────────────────────────────────────────
 *
 * The Python kernel is ONE process per project and its `main()` loop is
 * strictly serial: read a request line, run it to completion, go back to
 * `sys.stdin.readline()`. `runPython` handed back a promise that settled only
 * on the kernel's `done` event and armed nothing else, so a cell containing
 * `while True: pass` produced two failures at once:
 *
 *   1. that promise never settled — the cell spins forever with no error; and
 *   2. the kernel never returned to `readline()`, so every LATER cell in the
 *      project queued invisibly in the pipe buffer — including cells in other
 *      notebooks, because the kernel is per-project, not per-notebook. Run-All
 *      (`run-all-cells.ts`) is serial, so it stops dead at the first one.
 *
 * Restarting the kernel was the only way out, and nothing told the user that.
 * This is a reliability defect wearing performance clothing: the cost isn't
 * slowness, it's a project whose compute is wedged until someone guesses.
 *
 * ── Why the policy lives here and not in `python-kernel.ts` ─────────────────
 *
 * Deadline policy is separable from kernel transport, and it's the half worth
 * testing hard: arming the wrong cell, or failing to disarm a finished one,
 * means SIGINT-ing innocent work. Behind this interface it's exercised with
 * fake timers and no Python at all, deterministically, in milliseconds.
 *
 * ── Why the HEAD of the queue, not every submitted cell ─────────────────────
 *
 * The obvious implementation — arm a timer when a cell's request is written —
 * measures the wrong interval. Two concurrent `runPython` calls both write
 * immediately, but the kernel runs them one after the other, so the second
 * cell's clock would be counting the first cell's execution. Given a long
 * (but honest) first cell, the second one "times out" while it has not
 * executed a single statement — and the SIGINT that followed would land on the
 * first cell, which was never over budget. Every symptom misattributed.
 *
 * Because the kernel is serial and the pending map is insertion-ordered, the
 * head of that map IS the cell the kernel is executing. Arming only the head,
 * and re-syncing whenever one completes, makes the budget mean "wall-clock
 * time this cell spent running", which is what a user setting "120 seconds"
 * is asking for.
 *
 * ── Why interrupt first and kill only if that fails ─────────────────────────
 *
 * The SIGINT machinery already existed and works (#372): POSIX delivers it to
 * the kernel's main thread, user code surfaces it as `KeyboardInterrupt`, and
 * `exec_cell` catches it and emits a structured error + `done`. It costs the
 * user nothing — every other notebook's variables survive. It had no automatic
 * trigger; this supplies one.
 *
 * But SIGINT is not guaranteed to land. `while True:\n  try: pass\n  except
 * KeyboardInterrupt: pass` swallows it, a C extension that never returns to
 * the interpreter never checks for signals, and Windows has no supported child
 * interrupt at all (`interruptKernel` returns `unsupported-platform`). So the
 * escalation is mandatory, not decorative: if the cell is still pending after
 * the grace window, the kernel is torn down. That's the expensive answer — it
 * wipes every notebook's namespace — which is exactly why it is second, and
 * why the resulting message says so rather than leaving the user to discover
 * their variables are gone.
 */

import { logger } from '../../shared/logger';
import { getPythonSettings } from './python-settings';

/**
 * How long to let an interrupted cell wind down before concluding SIGINT
 * didn't take and killing the kernel.
 *
 * Five seconds: the kernel's own `KeyboardInterrupt` handler does nothing but
 * format a traceback and write two JSON lines, so a signal that landed is
 * answered in milliseconds. The window is generous only against a machine
 * under heavy load — it is not "maybe the cell will finish", because a cell
 * that ignored SIGINT will go on ignoring it.
 */
export const INTERRUPT_GRACE_MS = 5_000;

/**
 * The kernel-shaped operations the deadline policy needs. Narrow on purpose:
 * everything here is trivially fakeable, which is what lets the policy be
 * tested without spawning a process.
 */
export interface DeadlineHost {
  /** Cell ids the kernel still owes a `done` for, in submission order. */
  pendingCellIds(): string[];
  /** This cell's budget in milliseconds; `0` means no limit. */
  budgetMs(cellId: string): number;
  /** Deliver an interrupt. Returns false when no signal could be sent at all
   *  (Windows, dead process) — which escalates immediately rather than
   *  burning the grace window waiting for a signal nobody delivered. */
  interrupt(): boolean;
  /** Mark the cell so its eventual result reads as a timeout rather than as
   *  the bare `KeyboardInterrupt` the kernel will report. */
  markTimedOut(cellId: string): void;
  /** Last resort: tear the kernel down so the queue behind it can drain. */
  hardReset(): void;
}

export interface CellDeadlines {
  /**
   * Arm the deadline for whichever cell is now at the head of the queue.
   * Idempotent — call it after every submission and every completion; a head
   * that already has a live timer keeps it (re-arming would hand a long cell
   * a fresh budget every time something else finished).
   */
  syncHead(): void;
  /** Disarm `cellId` — it finished, one way or another. */
  clear(cellId: string): void;
  /** Disarm everything (kernel exit / shutdown). */
  clearAll(): void;
}

export function createCellDeadlines(
  host: DeadlineHost,
  graceMs: number = INTERRUPT_GRACE_MS,
): CellDeadlines {
  const timers = new Map<string, NodeJS.Timeout>();

  function clear(cellId: string): void {
    const t = timers.get(cellId);
    if (t === undefined) return;
    clearTimeout(t);
    timers.delete(cellId);
  }

  function escalate(cellId: string): void {
    timers.delete(cellId);
    // The interrupt landed after all and the cell finished — nothing to do.
    // Checked here rather than trusted, because `clear` runs on the `done`
    // event and this callback may already have been queued when it did.
    if (!host.pendingCellIds().includes(cellId)) return;
    logger('python-kernel').warn(
      'cell ignored the interrupt — restarting the kernel so the project is not wedged',
    );
    host.hardReset();
  }

  function fire(cellId: string): void {
    timers.delete(cellId);
    // Same race as above, in the common direction: the cell completed in the
    // same tick the timer expired. Bailing out matters because the SIGINT
    // would otherwise arrive while the kernel sits in `readline()` — harmless
    // (the loop swallows a between-cells SIGINT, #372) but the cell would
    // still be reported as timed out when it had in fact succeeded.
    if (!host.pendingCellIds().includes(cellId)) return;
    host.markTimedOut(cellId);
    logger('python-kernel').warn('cell exceeded its execution budget — interrupting');
    const signalled = host.interrupt();
    // No signal went out (Windows / dead process): don't wait out a grace
    // period for a response that cannot come.
    timers.set(cellId, setTimeout(() => { escalate(cellId); }, signalled ? graceMs : 0));
  }

  return {
    syncHead(): void {
      const head = host.pendingCellIds()[0];
      if (head === undefined || timers.has(head)) return;
      const budget = host.budgetMs(head);
      if (budget <= 0) return;
      timers.set(head, setTimeout(() => { fire(head); }, budget));
    },
    clear,
    clearAll(): void {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

/**
 * The user-facing text for a cell that ran out of budget.
 *
 * It deliberately REPLACES the kernel's own `KeyboardInterrupt: Cell
 * interrupted` traceback rather than appending to it. That message is correct
 * about the mechanism and misleading about the cause: it's the same wording
 * the manual "Compute: Interrupt Cell" command produces, so a user who never
 * touched that command would reasonably conclude something else interrupted
 * them. Naming the budget, and where to change it, is the difference between
 * an error they can act on and one they can only be puzzled by.
 */
export function cellTimeoutMessage(timeoutMs: number, restarted: boolean): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const limit = `Cell exceeded the ${seconds}s execution limit`;
  const where = 'Change or disable the limit in Settings → Compute.';
  return restarted
    ? `${limit} and did not respond to an interrupt, so the Python kernel was restarted — `
      + `every notebook's variables in this thoughtbase have been cleared. ${where}`
    : `${limit} and was interrupted. ${where}`;
}

/**
 * The configured budget in milliseconds, or `0` for "no limit".
 *
 * Read per cell run rather than cached at kernel spawn (the way `allowNetwork`
 * is, because that one is baked into the sandbox profile): someone who just
 * watched a cell get cut off wants the new number to apply to their next run,
 * not after a kernel restart that would also wipe every namespace. One small
 * `readFile` against a Python process launch is not a cost worth optimising.
 */
export async function resolveCellBudgetMs(): Promise<number> {
  const { cellTimeoutSeconds } = await getPythonSettings();
  return cellTimeoutSeconds > 0 ? cellTimeoutSeconds * 1000 : 0;
}
