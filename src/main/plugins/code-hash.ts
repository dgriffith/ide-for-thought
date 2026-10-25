/**
 * What a plugin with code is approved as (#2833): a SHA-256 over every file
 * it ships — the manifest, its pages and logic, and its declarative files
 * too — so any edit, an upgrade or a change in place, reads as a different
 * plugin and switches it off until it's approved again.
 *
 * The files are those the frame protocol could serve (`frame-files.ts`): no
 * dot-segment and no `node_modules/`. Each is hashed as its relative path,
 * its length and its bytes, in sorted path order, so the hash doesn't depend
 * on the order a folder lists in, and a rename is a change. Links are
 * followed only inside the folder; an escaping one is refused when the
 * package is read (`package.ts`), never hashed.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isContainedPath } from '../path-containment';

/** Bounds on what is hashed: a plugin past them can't be approved. */
export const CODE_HASH_LIMITS = { files: 5000, bytes: 200 * 1024 * 1024, depth: 16 } as const;

/** The plugin at `root` is too big to hash, and so to approve. */
export class PluginTooBigError extends Error {}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > CODE_HASH_LIMITS.depth) throw new PluginTooBigError(`it nests folders more than ${CODE_HASH_LIMITS.depth} deep`);
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const full = path.join(dir, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      let st;
      try {
        if (d.isSymbolicLink() && !isContainedPath(root, await fs.realpath(full))) continue;
        st = await fs.stat(full);
      } catch (e) {
        // A dangling link ships nothing to hash.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw e;
      }
      if (st.isDirectory()) await walk(full, childRel, depth + 1);
      else if (st.isFile()) {
        out.push(childRel);
        if (out.length > CODE_HASH_LIMITS.files) throw new PluginTooBigError(`it has more than ${CODE_HASH_LIMITS.files} files`);
      }
    }
  };
  await walk(root, '', 0);
  return out.sort();
}

/** The approval hash of the plugin folder at `root` (links resolved), hex. */
export async function pluginCodeHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  let total = 0;
  for (const rel of await listFiles(root)) {
    const bytes = await fs.readFile(path.join(root, rel));
    total += bytes.length;
    if (total > CODE_HASH_LIMITS.bytes) throw new PluginTooBigError(`its files come to more than ${CODE_HASH_LIMITS.bytes / 1024 / 1024} MB`);
    hash.update(`${rel}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}
