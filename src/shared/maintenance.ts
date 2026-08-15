/**
 * Progress + completion reporting for the File ▸ maintenance operations
 * (#1814).
 *
 * These run entirely in main, kicked off from the native menu, so before this
 * the renderer had no idea they were happening: "Rebuild All Indexes" on a
 * large thoughtbase ran for a long stretch with nothing on screen, finished
 * with nothing on screen, and failed with nothing on screen either. A user
 * can't tell "working" from "the menu item does nothing".
 *
 * One event carries all of it. Frames are a discriminated union on `running`,
 * so the terminal frame is the ONLY one that reports an outcome, and there is
 * always exactly one of them (main emits it from a `finally`) — the renderer
 * can therefore clear its in-progress affordance without a timeout guard.
 */

/** Which maintenance operation a frame belongs to. */
export type MaintenanceTask =
  | 'rebuildIndexes'
  | 'rebuildSemanticIndex'
  | 'restartKernel'
  | 'interruptCell';

/**
 * How the renderer should show a task while it runs.
 *
 * `blocking` operations leave the thoughtbase mid-rebuild — the graph store is
 * reset and refilled — so the app is genuinely not usable while they run, and
 * the modal overlay says so honestly (the same call the bulk importers make).
 * `background` ones don't disturb anything the user can see, and get the quiet
 * status-bar treatment instead.
 */
export type MaintenanceStyle = 'blocking' | 'background';

export interface MaintenanceRunning {
  task: MaintenanceTask;
  running: true;
  style: MaintenanceStyle;
  /** Human-readable, already phrased for display ("Rebuilding indexes"). */
  label: string;
  /** Determinate progress, when the operation knows its own size. */
  done?: number;
  total?: number;
}

export interface MaintenanceFinished {
  task: MaintenanceTask;
  running: false;
  style: MaintenanceStyle;
  label: string;
  /**
   * What happened. A failure is reported, not swallowed: these handlers used to
   * be bare `async` menu callbacks whose rejection went nowhere at all.
   */
  outcome: { ok: true; summary: string } | { ok: false; error: string };
}

export type MaintenanceProgress = MaintenanceRunning | MaintenanceFinished;

/** Text for the in-progress affordance: the label, plus a count when known. */
export function maintenanceLabel(p: MaintenanceRunning): string {
  if (typeof p.done === 'number' && typeof p.total === 'number' && p.total > 0) {
    return `${p.label} ${p.done}/${p.total}…`;
  }
  return `${p.label}…`;
}

/** Text for the completion affordance — the summary, or why it failed. */
export function maintenanceOutcomeMessage(p: MaintenanceFinished): string {
  return p.outcome.ok ? p.outcome.summary : `${p.label} failed: ${p.outcome.error}`;
}
