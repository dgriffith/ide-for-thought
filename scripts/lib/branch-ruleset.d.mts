/**
 * Types for `branch-ruleset.mjs` (#2353). The implementation stays plain
 * `.mjs` so `scripts/check-branch-ruleset.mjs` runs without a transpile step.
 */
export interface RulesetDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

export type RulesetComparison =
  | { ok: true }
  | { ok: false; differences: RulesetDifference[]; message: string };

export const COMPARED_FIELDS: string[];
export function normalizeRuleset(ruleset: unknown): Record<string, unknown>;
export function compareRulesets(expected: unknown, actual: unknown): RulesetComparison;
