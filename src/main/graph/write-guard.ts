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

import { logger } from '../../shared/logger';

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
 * Run an LLM-originated operation with the guard armed (#944). Exception-safe:
 * the context is always exited. Any graph write inside `fn` that doesn't route
 * through the approval engine (trusted context) trips checkLLMWriteGuard — so
 * the converged apply helpers (auto-tag/-link, set/source properties, note-body)
 * are wrapped in this, and a regression that writes directly instead of via
 * proposeWrite() fails CI.
 */
export async function withLLMContext<T>(fn: () => Promise<T>): Promise<T> {
  enterLLMContext();
  try {
    return await fn();
  } finally {
    exitLLMContext();
  }
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

/** True when running under the test runner, where the guard is FATAL (throws)
 *  so an accidental approval-engine bypass fails CI instead of scrolling past in
 *  a warning. In dev + production it stays a non-fatal warning — a development
 *  guardrail must never crash the user's app (per CLAUDE.md). */
function guardIsFatal(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/**
 * Trust guard. Fires when an LLM-originated call path mutates the graph without
 * going through the approval engine. No-op in trusted context (proposeWrite /
 * approveProposal / approval-only mutators) and outside LLM context.
 *
 * Under test it THROWS — the invariant "every LLM-originated write goes through
 * proposeWrite()/approveProposal()" (#935) is enforced, not merely observed, so
 * a sixth bypass can't be added silently. In dev/prod it warns (#671).
 */
export function checkLLMWriteGuard(operation: string): void {
  if (!isInLLMContext()) return;
  if (trustedContextDepth > 0) return;
  const message =
    `[trust-guard] ${operation} called from LLM context outside the approval engine. ` +
    `LLM-originated writes must go through proposeWrite()/approveProposal().`;
  if (guardIsFatal()) throw new Error(message);
  logger('write-guard').warn(message);
}

/** Test-only: reset both counters between cases. */
export function __resetWriteGuardForTests(): void {
  llmContextDepth = 0;
  trustedContextDepth = 0;
}
