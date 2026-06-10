/**
 * LLM write guard (#671, extracted from graph/index.ts).
 *
 * Tracks whether the current call path originates from an LLM operation.
 * Direct graph writes from LLM context that bypass the approval engine are
 * logged as warnings during development. The approval engine wraps its own
 * writes in the *trusted* counter so its in-LLM-context writes don't trigger
 * the warning.
 *
 * This is a development-time guardrail, not a runtime security boundary — the
 * goal is to catch accidental approval-engine bypasses during development. It
 * lives in its own module (with no dependency on GraphState) so it can be
 * unit-tested in isolation; the graph indexers import `checkLLMWriteGuard`,
 * and the public enter/exit/is helpers are re-exported from graph/index.ts so
 * existing `graph.enterLLMContext()` call sites are unchanged.
 */

let llmContextDepth = 0;
let trustedContextDepth = 0;

/** Mark the start of an LLM-originated operation. Nest-safe. */
export function enterLLMContext(): void {
  llmContextDepth++;
}

/** Mark the end of an LLM-originated operation. */
export function exitLLMContext(): void {
  if (llmContextDepth > 0) llmContextDepth--;
}

/** Returns true if currently in an LLM call path. */
export function isInLLMContext(): boolean {
  return llmContextDepth > 0;
}

/**
 * Mark the start of a trusted graph mutation — i.e. one going through the
 * approval engine. Used by approval.ts to wrap its own parseIntoStore /
 * removeMatchingTriples calls so the write guard doesn't flag them.
 */
export function enterTrustedContext(): void {
  trustedContextDepth++;
}

export function exitTrustedContext(): void {
  if (trustedContextDepth > 0) trustedContextDepth--;
}

/** True while inside an approval-engine (trusted) mutation. */
export function isInTrustedContext(): boolean {
  return trustedContextDepth > 0;
}

/** Dev-time guard. Logs once per offending call when an LLM-originated
 *  call path mutates the graph without going through the approval engine.
 *  No-op in trusted context (proposeWrite / approveProposal / approval-only
 *  mutators) and outside LLM context. */
export function checkLLMWriteGuard(operation: string): void {
  if (!isInLLMContext()) return;
  if (trustedContextDepth > 0) return;
  console.warn(
    `[trust-guard] ${operation} called from LLM context outside the approval engine. ` +
    `LLM-originated writes must go through proposeWrite()/approveProposal().`,
  );
}

/** Test-only: reset both counters between cases. */
export function __resetWriteGuardForTests(): void {
  llmContextDepth = 0;
  trustedContextDepth = 0;
}
