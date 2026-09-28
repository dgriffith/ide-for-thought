/**
 * Every `gate: false` bench entry names an owner (#2358).
 *
 * `gate: false` in `tests/main/bench-baseline.json` means "measure this, never
 * fail on it". That is a legitimate state for a bench that measures known-slow
 * code — but it is also the one state in the file that fails nothing when it is
 * forgotten. #2211 added six of them with a sentence in `_comment` saying "turn
 * gating on in the PR that fixes each"; the fixes landed and the entries stayed
 * ungated until #2331, because a sentence in a comment has no one to remind.
 *
 * So an ungated entry must carry a structured link to the issue that owns
 * arming it:
 *
 *   { "name": "...", "gate": false, "issue": 1234, "reason": "why it isn't gated yet" }
 *
 * Two halves, split by what can be checked where:
 *
 *   - `findUntrackedUngated` — offline, run by
 *     `tests/architecture/bench-ungated-entries-tracked.test.ts` inside
 *     `pnpm test`: the link and reason exist and are well-formed.
 *   - `findClosedLinks` — needs the network, so it runs in `bench.yml` via
 *     `scripts/check-bench-ungated.mjs`: the linked issue is still OPEN. A
 *     closed issue means nobody owns the ungated bench any more, which is
 *     exactly the forgotten state this exists to catch.
 *
 * Pure (the state lookup is injected) so both halves are testable without `gh`.
 */

/**
 * @typedef {{ name: string, gate?: boolean, issue?: unknown, reason?: unknown }} BaselineEntry
 * @typedef {{ benchmarks?: BaselineEntry[] }} Baseline
 */

/** Entries the gate skips. Mirrors `bench-check.mjs`: only an explicit `false` ungates. */
export function ungatedEntries(baseline) {
  return (baseline.benchmarks ?? []).filter((b) => b.gate === false);
}

/**
 * Ungated entries missing a well-formed `issue` (positive integer) or a
 * non-empty `reason`. Returns one human-readable problem per offending entry.
 *
 * @param {Baseline} baseline
 * @returns {Array<{ name: string, problem: string }>}
 */
export function findUntrackedUngated(baseline) {
  const problems = [];
  for (const b of ungatedEntries(baseline)) {
    const missing = [];
    if (!Number.isInteger(b.issue) || b.issue <= 0) missing.push('`issue` (a GitHub issue number)');
    if (typeof b.reason !== 'string' || b.reason.trim() === '') missing.push('`reason` (why it is not gated yet)');
    if (missing.length) problems.push({ name: b.name, problem: `missing ${missing.join(' and ')}` });
  }
  return problems;
}

/**
 * Ungated entries whose linked issue is not OPEN.
 *
 * @param {Baseline} baseline
 * @param {(issue: number) => string} stateOf  e.g. `gh issue view <n> --json state` → "OPEN" | "CLOSED"
 * @returns {Array<{ name: string, issue: number, state: string }>}
 */
export function findClosedLinks(baseline, stateOf) {
  const cache = new Map();
  const out = [];
  for (const b of ungatedEntries(baseline)) {
    if (!Number.isInteger(b.issue)) continue; // the offline check reports this one
    if (!cache.has(b.issue)) cache.set(b.issue, String(stateOf(b.issue)).toUpperCase());
    const state = cache.get(b.issue);
    if (state !== 'OPEN') out.push({ name: b.name, issue: b.issue, state });
  }
  return out;
}
