/**
 * Build a git repository for a test (#2634) with isomorphic-git's low-level
 * writers, so a test can make trees `git add` never would: a symlink entry, a
 * submodule. One commit, no checkout.
 */
import fs from 'node:fs';
import git from 'isomorphic-git';

export type RepoNode = string | { link: string } | { submodule: string } | { [name: string]: RepoNode };

/** Write `tree` as a commit in a fresh repository; returns [repoDir, commit]. */
export async function buildRepo(dir: string, tree: { [name: string]: RepoNode }): Promise<[string, string]> {
  await git.init({ fs, dir });
  const write = async (t: { [name: string]: RepoNode }): Promise<string> => {
    const entries = [];
    for (const [name, node] of Object.entries(t)) {
      if (typeof node === 'string') {
        entries.push({ mode: '100644', path: name, type: 'blob' as const, oid: await git.writeBlob({ fs, dir, blob: Buffer.from(node) }) });
      } else if ('link' in node && typeof node.link === 'string') {
        entries.push({ mode: '120000', path: name, type: 'blob' as const, oid: await git.writeBlob({ fs, dir, blob: Buffer.from(node.link) }) });
      } else if ('submodule' in node && typeof node.submodule === 'string') {
        entries.push({ mode: '160000', path: name, type: 'commit' as const, oid: node.submodule });
      } else {
        entries.push({ mode: '040000', path: name, type: 'tree' as const, oid: await write(node) });
      }
    }
    return git.writeTree({ fs, dir, tree: entries });
  };
  const author = { name: 'T', email: 't@example.com', timestamp: 0, timezoneOffset: 0 };
  const commit = await git.writeCommit({ fs, dir, commit: { message: 'x\n', tree: await write(tree), parent: [], author, committer: author } });
  return [dir, commit];
}
