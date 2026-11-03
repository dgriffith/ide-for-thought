/**
 * Paths as the repo's tests compare them: `/`-separated, on every OS (#2180).
 * `path.join` / `path.relative` use the platform separator, so on Windows a
 * scanner's `src\main\x.ts` never matches a baseline that says `src/main/x.ts`.
 */
import path from 'node:path';

/** `p` with the platform separator replaced by `/`. */
export function posix(p: string): string {
  return path.sep === '/' ? p : p.split(path.sep).join('/');
}

/** `path.relative(from, to)`, `/`-separated. */
export function posixRelative(from: string, to: string): string {
  return posix(path.relative(from, to));
}
