/**
 * Compute-shell builtin executor registrations. Called once at app-ready.
 *
 * Keyed by the shared language list (`shared/compute/fences.ts`,
 * `COMPUTE_LANGUAGES`, #2630): a language registered there without an
 * executor here doesn't compile, and each one's fence aliases register with
 * it, so the renderer's run affordance and the backend can't disagree.
 */

import { registerExecutor, type ExecutorFn } from '../registry';
import { COMPUTE_LANGUAGES, type ComputeLanguage } from '../../../shared/compute/fences';
import { executeSparql } from './sparql';
import { executeSql } from './sql';
import { executePython } from './python';

export const BUILTIN_EXECUTORS: Record<ComputeLanguage, ExecutorFn> = {
  sparql: executeSparql,
  sql: executeSql,
  python: executePython,
};

export function registerBuiltinExecutors(): void {
  for (const lang of COMPUTE_LANGUAGES) {
    for (const name of [lang.id, ...lang.aliases]) registerExecutor(name, BUILTIN_EXECUTORS[lang.id]);
  }
}
