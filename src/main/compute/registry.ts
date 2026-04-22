/**
 * Compute cell registry (#238).
 *
 * The notebook-execution shell is language-agnostic. Each fence language
 * that wants to be executable registers its executor here; the shell calls
 * `runCell(language, code)` and dispatches through this map.
 *
 * Subsequent tickets (#239 SPARQL, #240 SQL, #242 Python) slot into this
 * same registry. Languages without a registered executor — including every
 * language in v1 until those tickets land — get a structured `ok: false`
 * result the shell surfaces as an error output block.
 */

export type { CellOutput, CellResult } from '../../shared/compute/types';
import type { CellResult } from '../../shared/compute/types';

export interface ExecutorContext {
  /** Absolute path to the project root, so executors can read/write files. */
  rootPath: string;
  /** Relative path of the note the cell lives in, for scoped operations. */
  notePath?: string;
}

export type ExecutorFn = (code: string, ctx: ExecutorContext) => Promise<CellResult>;

const executors = new Map<string, ExecutorFn>();

/**
 * Register an executor for a fence language. Re-registering replaces the
 * prior entry — useful for tests; production registrations happen once
 * at startup.
 */
export function registerExecutor(language: string, fn: ExecutorFn): void {
  executors.set(language.toLowerCase(), fn);
}

/** Whether `language` has a registered executor. */
export function hasExecutor(language: string): boolean {
  return executors.has(language.toLowerCase());
}

/** Every registered language, lowercase, sorted. */
export function registeredLanguages(): string[] {
  return [...executors.keys()].sort();
}

/**
 * Dispatch to the registered executor for `language`. Returns a structured
 * result rather than throwing so per-cell failures don't take down the
 * caller's whole flow. A missing executor is reported as a normal
 * `ok: false` — the shell writes it as an error output block.
 */
export async function runCell(
  language: string,
  code: string,
  ctx: ExecutorContext,
): Promise<CellResult> {
  const key = language.toLowerCase();
  const fn = executors.get(key);
  if (!fn) {
    return { ok: false, error: `No executor registered for language "${language}"` };
  }
  try {
    return await fn(code, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Exposed for tests that need a clean registry between cases. */
export function _clearRegistry(): void {
  executors.clear();
}
