/**
 * Python fence executor (#241/#242). Routes a `python` cell through
 * the persistent per-project kernel rather than spawning fresh per
 * cell — preserves namespace state across cells in the same notebook.
 */

import { runPython } from '../python-kernel';
import type { ExecutorFn } from '../registry';

export const executePython: ExecutorFn = async (code, ctx) => {
  const notebook = ctx.notePath ?? '__default__';
  return runPython(ctx.rootPath, notebook, code);
};
