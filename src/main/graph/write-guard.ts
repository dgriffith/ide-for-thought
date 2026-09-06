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
 *
 * ── Ambient context, carried as ASYNC CONTEXT (#2053) ───────────────────────
 * This used to be a pair of `let …Depth = 0` module counters, incremented and
 * decremented around each guarded operation. That's the identical hazard
 * `history/index.ts` fixed in #1833: the Electron main process is
 * single-threaded, but async operations still interleave, and a module
 * counter is shared by EVERY concurrent call path. Two unrelated operations
 * in flight at once — an LLM auto-tag and a concurrent approval-engine
 * `applyBundle` from the user approving a different pending proposal, say —
 * shared the same `trustedContextDepth`, so one path's trusted-context window
 * could mask (or a stale decrement could falsely re-arm) the guard for a
 * completely unrelated path. `AsyncLocalStorage` gives each root-level async
 * call tree its own depth, immune to whatever an unrelated concurrent tree is
 * doing — same fix, same primitive, converged onto one pattern instead of two.
 *
 * `withLLMContext(fn)` / `withTrustedContext(fn)` wrap `AsyncLocalStorage#run`
 * — full isolation, the store is scoped exactly to `fn` (and whatever it
 * awaits) and is restored the INSTANT `fn`'s synchronous portion suspends
 * (its first `await`) or returns, not just "eventually". That's what makes
 * `.run()` safe even for two operations kicked off back-to-back with no
 * intervening await from a shared caller (`Promise.all([a(), b()])`
 * synchronously calls `a()` then `b()` before either awaits) — `a()`'s store
 * is already unwound by the time `b()` starts, whichever primitive `b()`
 * uses. Every production call site is converted to this form; the imperative
 * `enterLLMContext()` / `exitLLMContext()` / `enterTrustedContext()` /
 * `exitTrustedContext()` pairs remain exported (via `AsyncLocalStorage#enterWith`)
 * only because `write-guard.test.ts` exercises the counter semantics directly
 * in synchronous test bodies, where `enterWith` behaves identically to `.run()`
 * — new call sites should reach for the `with*Context(fn)` form.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../../shared/logger';

const llmContextDepth = new AsyncLocalStorage<number>();
const trustedContextDepth = new AsyncLocalStorage<number>();

function depth(storage: AsyncLocalStorage<number>): number {
  return storage.getStore() ?? 0;
}

/** Mark the start of an LLM-originated operation. Nest-safe. */
export function enterLLMContext(): void {
  llmContextDepth.enterWith(depth(llmContextDepth) + 1);
}

/** Mark the end of an LLM-originated operation. */
export function exitLLMContext(): void {
  const d = depth(llmContextDepth);
  if (d > 0) llmContextDepth.enterWith(d - 1);
}

/** Returns true if currently in an LLM call path. */
export function isInLLMContext(): boolean {
  return depth(llmContextDepth) > 0;
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
  return llmContextDepth.run(depth(llmContextDepth) + 1, fn);
}

/**
 * Mark the start of a trusted graph mutation — i.e. one going through the
 * approval engine. Used by approval.ts to wrap its own parseIntoStore /
 * removeMatchingTriples calls so the write guard doesn't flag them.
 */
export function enterTrustedContext(): void {
  trustedContextDepth.enterWith(depth(trustedContextDepth) + 1);
}

export function exitTrustedContext(): void {
  const d = depth(trustedContextDepth);
  if (d > 0) trustedContextDepth.enterWith(d - 1);
}

/**
 * Run an approval-engine mutation with trusted context armed. Exception-safe:
 * the context is always exited, even on rollback. See `withLLMContext` for
 * why `.run()` — not `enterWith` — is the primitive every new call site
 * should use.
 *
 * Generic over a plain return, not just `Promise<T>` — a couple of trusted
 * blocks (`updateProposalStatus`, `applyTurtle`) wrap a single synchronous
 * `parseIntoStore`/`removeMatchingTriples` call with no `await` of their own,
 * and forcing `async () => …` on those trips `require-await` for no benefit.
 */
export function withTrustedContext<T>(fn: () => T): T {
  return trustedContextDepth.run(depth(trustedContextDepth) + 1, fn);
}

/** True while inside an approval-engine (trusted) mutation. */
export function isInTrustedContext(): boolean {
  return depth(trustedContextDepth) > 0;
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
  if (isInTrustedContext()) return;
  const message =
    `[trust-guard] ${operation} called from LLM context outside the approval engine. ` +
    `LLM-originated writes must go through proposeWrite()/approveProposal().`;
  if (guardIsFatal()) throw new Error(message);
  logger('write-guard').warn(message);
}

/** Test-only: reset both counters between cases. */
export function __resetWriteGuardForTests(): void {
  llmContextDepth.enterWith(0);
  trustedContextDepth.enterWith(0);
}
