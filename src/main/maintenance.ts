/**
 * Runs a File ▸ maintenance operation with progress + completion reporting
 * (#1814).
 *
 * The menu handlers used to be bare `async` callbacks: no start signal, no
 * finish signal, and a rejection that went nowhere — a failed rebuild was
 * indistinguishable from a menu item that did nothing. This wraps one in the
 * frames `shared/maintenance.ts` defines.
 *
 * Electron-free on purpose: `emit` is injected, so the sequencing invariants
 * (a first running frame, a terminal frame exactly once, a failure reported
 * rather than thrown away) are unit-testable without a BrowserWindow.
 */
import type {
  MaintenanceProgress,
  MaintenanceStyle,
  MaintenanceTask,
} from '../shared/maintenance';
import { logger } from '../shared/logger';

export interface MaintenanceRun<T> {
  task: MaintenanceTask;
  /** Display text, without punctuation — the renderer adds the ellipsis. */
  label: string;
  style: MaintenanceStyle;
  emit: (p: MaintenanceProgress) => void;
  /**
   * The work. `report` publishes determinate progress for operations that know
   * their own size; operations that don't simply never call it, and the
   * renderer shows an indeterminate affordance.
   */
  run: (report: (done: number, total: number) => void) => Promise<T>;
  /** One line for the completion affordance, e.g. "Rebuilt indexes — 210 notes". */
  summary: (result: T) => string;
}

/**
 * Never throws: the failure is a frame, because the caller is a menu click with
 * nobody to catch it. Returns the result on success and `undefined` on failure,
 * so a caller that wants to chain (broadcast a tables refresh, say) can still
 * tell the difference.
 */
export async function runMaintenance<T>(opts: MaintenanceRun<T>): Promise<T | undefined> {
  const { task, label, style, emit } = opts;
  emit({ task, running: true, style, label });
  try {
    const result = await opts.run((done, total) => {
      emit({ task, running: true, style, label, done, total });
    });
    emit({
      task, running: false, style, label,
      outcome: { ok: true, summary: opts.summary(result) },
    });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Still log for a developer with the console open; the UI no longer
    // depends on anyone having it open.
    logger('maintenance').error(`${task} failed:`, err);
    emit({ task, running: false, style, label, outcome: { ok: false, error } });
    return undefined;
  }
}

/** "210 notes" / "1 note" — used in completion summaries. */
export function pluralizeNotes(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'}`;
}
