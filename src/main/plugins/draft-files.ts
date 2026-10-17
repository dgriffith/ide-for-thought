/**
 * Writing a set of files into a NEW folder: a drafted plugin's (#2652), or a
 * scaffold's (#2650). The folder must not exist yet, so this never overwrites
 * anything, and every path is checked again here (`draftPathProblem`), so a
 * caller that skipped the check still can't write outside the folder.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { draftPathProblem } from '../../shared/extensions/drafts';

/** Throws an `EEXIST` error, untouched, when `folder` already exists. */
export async function writeDraftFiles(folder: string, files: Iterable<{ path: string; content: string }>): Promise<void> {
  const list = [...files];
  for (const f of list) {
    const problem = draftPathProblem(f.path);
    if (problem) throw new Error(problem);
  }
  await fs.mkdir(folder);
  for (const f of list) {
    const target = path.join(folder, ...f.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.content, { flag: 'wx' });
  }
}
