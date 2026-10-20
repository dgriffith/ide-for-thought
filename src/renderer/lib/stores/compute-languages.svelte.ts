/**
 * Which compute languages can run on this machine (#2822). SQL and SPARQL
 * always can; Python only while the built-in Python plugin is on, because
 * off means its executor isn't registered at all. Read from main's
 * registered-executor list, and read again whenever the plugins change.
 *
 * Until the first answer lands every runnable language counts as available:
 * a ▶ that appears a moment early fails safe (main refuses the run), while a
 * "Python is off" note flashing up for someone who has it on would be wrong.
 */
import { api } from '../ipc/client';
import { RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';
import { logger } from '../../../shared/logger';

let registered = $state<ReadonlySet<string> | null>(null);
let started = false;

async function refresh(): Promise<void> {
  try {
    registered = new Set((await api.compute.languages()).map((l) => l.toLowerCase()));
  } catch (e) {
    logger('compute').warn('could not read which languages can run:', e);
  }
}

function start(): void {
  if (started) return;
  started = true;
  void refresh();
  api.plugins.onChanged(() => { void refresh(); });
}

export const computeLanguagesStore = {
  /** Whether a fence in `language` can run on this machine now. Reactive. */
  isRunnable(language: string): boolean {
    start();
    const lang = language.toLowerCase();
    return registered === null ? RUNNABLE_LANGUAGE_SET.has(lang) : registered.has(lang);
  },
  /** Whether `language` is a compute language that's switched off here (Python, #2822). Reactive. */
  isTurnedOff(language: string): boolean {
    const lang = language.toLowerCase();
    return RUNNABLE_LANGUAGE_SET.has(lang) && !this.isRunnable(lang);
  },
  /** Changes whenever the answer does, for a renderer that has to re-run. */
  get version(): ReadonlySet<string> | null {
    start();
    return registered;
  },
};

/** Back to the first-load state. Tests only. */
export function _resetComputeLanguagesForTests(): void {
  registered = null;
  started = false;
}
