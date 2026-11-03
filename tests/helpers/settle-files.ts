/**
 * Backdate every file under `root` (#2178), as if it was written a while ago.
 *
 * Caches that trust a file's stat stamp don't trust one written in the last
 * couple of seconds (`shared/file-stamp.ts`, `STAMP_SETTLE_MS`): a same-size
 * rewrite inside one coarse timestamp tick wouldn't move it. A test that
 * writes a corpus and immediately asserts a warm cache is asserting the steady
 * state of files that haven't changed lately, so it says so with this.
 */
import fs from 'node:fs';
import path from 'node:path';

export function settleFiles(root: string, ageMs = 60_000): void {
  const when = new Date(Date.now() - ageMs);
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) fs.utimesSync(abs, when, when);
    }
  };
  walk(root);
}
