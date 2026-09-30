/**
 * Types for `first-paint-report.mjs` (#2384). The implementation stays plain
 * `.mjs` so `scripts/first-paint-report.mjs` runs on the CI runner without a
 * transpile step.
 */
export interface FirstPaintSample {
  trigger: string;
  uptimeMs: number;
  spawnToPaintMs: number;
}

export interface FirstPaintRow {
  test: string;
  retry: number;
  sample: FirstPaintSample | null;
}

export function parseFirstPaintRows(text: string): FirstPaintRow[];

export function formatFirstPaintReport(
  rows: FirstPaintRow[],
  options?: { label?: string },
): { markdown: string; annotations: string[] };
