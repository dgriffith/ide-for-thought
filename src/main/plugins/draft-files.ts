/**
 * Writing a set of files into a NEW folder: a drafted plugin's (#2652), or a
 * scaffold's (#2650). The folder must not exist yet, so this never overwrites
 * anything, and every path is checked again here (`draftPathProblem`), so a
 * caller that skipped the check still can't write outside the folder.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { draftPathProblem, EXTENSION_DRAFT_LIMITS } from '../../shared/extensions/drafts';

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

/**
 * An installed plugin's files as a draft's (#2890): what an agent's edit is
 * diffed against, and checked is still there when it's approved. Null when
 * the folder isn't one a draft could have made — more files or bytes than a
 * draft may hold, a binary file, a link, a path a draft couldn't name — so
 * an agent can't propose an edit to it.
 */
export async function readDraftFiles(folder: string): Promise<{ path: string; content: string }[] | null> {
  const out: { path: string; content: string }[] = [];
  let total = 0;
  const walk = async (rel: string): Promise<boolean> => {
    for (const entry of await fs.readdir(path.join(folder, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!(await walk(child))) return false; continue; }
      if (!entry.isFile() || draftPathProblem(child)) return false;
      const bytes = await fs.readFile(path.join(folder, child));
      total += bytes.length;
      if (out.length >= EXTENSION_DRAFT_LIMITS.files || bytes.length > EXTENSION_DRAFT_LIMITS.fileBytes || total > EXTENSION_DRAFT_LIMITS.totalBytes) return false;
      const content = bytes.toString('utf8');
      if (content.includes('\u0000') || !Buffer.from(content, 'utf8').equals(bytes)) return false;
      out.push({ path: child, content });
    }
    return true;
  };
  if (!(await walk(''))) return null;
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
