/**
 * Compute-shell builtin executor registrations. Called once at app-ready.
 *
 * Python is the exception (#2822): it's a built-in plugin, off by default,
 * so its executor is registered by the plugin's activation
 * (`registerPythonExecutor`) and removed when it's turned off. SQL and
 * SPARQL are read-only and locked down (#2437, #2442), and stay core.
 *
 * Keyed by the shared language list (`shared/compute/fences.ts`,
 * `COMPUTE_LANGUAGES`, #2630): a language registered there without an
 * executor here doesn't compile, and each one's fence aliases register with
 * it, so the renderer's run affordance and the backend can't disagree.
 */

import { registerExecutor, unregisterExecutor, type ExecutorFn } from '../registry';
import { COMPUTE_LANGUAGES, type ComputeLanguage } from '../../../shared/compute/fences';
import { executeSparql } from './sparql';
import { executeSql } from './sql';
import { executePython } from './python';

export const BUILTIN_EXECUTORS: Record<ComputeLanguage, ExecutorFn> = {
  sparql: executeSparql,
  sql: executeSql,
  python: executePython,
};

/** The languages a built-in plugin registers, not app-ready (#2822). */
const PLUGIN_LANGUAGES: ReadonlySet<ComputeLanguage> = new Set(['python']);

const namesOf = (id: ComputeLanguage): string[] => {
  const lang = COMPUTE_LANGUAGES.find((l) => l.id === id)!;
  return [lang.id, ...lang.aliases];
};

export function registerBuiltinExecutors(): void {
  for (const lang of COMPUTE_LANGUAGES) {
    if (PLUGIN_LANGUAGES.has(lang.id)) continue;
    for (const name of namesOf(lang.id)) registerExecutor(name, BUILTIN_EXECUTORS[lang.id]);
  }
}

/** Register Python and its aliases (`py`, `python3`); the result removes them again. */
export function registerPythonExecutor(): () => void {
  for (const name of namesOf('python')) registerExecutor(name, BUILTIN_EXECUTORS.python);
  return () => { for (const name of namesOf('python')) unregisterExecutor(name); };
}
