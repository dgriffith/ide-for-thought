/** Types for `bench-report.mjs` (#2386). */
export function benchMeansFromReport(json: unknown): Map<string, { mean: number; hz: number | undefined }>;
