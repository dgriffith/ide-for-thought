/**
 * Compute-shell builtin executor registrations. Called once at
 * app-ready; concrete executor modules slot in here.
 */

import { registerExecutor } from '../registry';
import { executeSparql } from './sparql';

export function registerBuiltinExecutors(): void {
  registerExecutor('sparql', executeSparql);
}
