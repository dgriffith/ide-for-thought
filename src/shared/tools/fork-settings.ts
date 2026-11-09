/**
 * The bounds of Settings → AI's fork settings (#2971), shared by the fields
 * and main's fork runner (`llm/fork.ts`).
 *
 * - **Branches per fork:** the most branches one `fork` call may start.
 * - **Ask before a fork costing more than:** a fork estimated above this many
 *   dollars asks the user first; 0 asks every time.
 */
export const DEFAULT_FORK_MAX_BRANCHES = 4;
export const MIN_FORK_MAX_BRANCHES = 1;
export const MAX_FORK_MAX_BRANCHES = 8;
export const DEFAULT_FORK_CONFIRM_ABOVE_USD = 0.5;

export function resolveForkMaxBranches(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_FORK_MAX_BRANCHES;
  return Math.min(MAX_FORK_MAX_BRANCHES, Math.max(MIN_FORK_MAX_BRANCHES, Math.round(raw)));
}

export function resolveForkConfirmAboveUsd(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return DEFAULT_FORK_CONFIRM_ABOVE_USD;
  return Math.round(raw * 100) / 100;
}
