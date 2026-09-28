export interface BaselineEntry {
  name: string;
  gate?: boolean;
  issue?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}
export interface Baseline {
  benchmarks?: BaselineEntry[];
  [key: string]: unknown;
}
export function ungatedEntries(baseline: Baseline): BaselineEntry[];
export function findUntrackedUngated(baseline: Baseline): Array<{ name: string; problem: string }>;
export function findClosedLinks(
  baseline: Baseline,
  stateOf: (issue: number) => string,
): Array<{ name: string; issue: number; state: string }>;
