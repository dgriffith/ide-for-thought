/**
 * Compute-shell builtin executor registrations. Called once at
 * app-ready; concrete executor modules slot in here.
 */

import { registerExecutor } from '../registry';
import { executeSparql } from './sparql';
import { executeSql } from './sql';
import { executePython } from './python';

export function registerBuiltinExecutors(): void {
  registerExecutor('sparql', executeSparql);
  registerExecutor('sql', executeSql);
  registerExecutor('python', executePython);
  // Common aliases users actually type — markdown-it-fence picks up the
  // info string verbatim, so register `py` and `python3` too.
  registerExecutor('py', executePython);
  registerExecutor('python3', executePython);
}
