import path from 'node:path';

import { isIgnoredEntry } from '../../shared/ignored-dirs';

/**
 * The notes watcher's ignore matcher (#2224).
 *
 * ## Why this isn't a list of glob strings any more
 *
 * `startWatching` used to hand chokidar three `ignored` entries:
 *
 * ```ts
 * ignored: [ /(^|[/\\])\./, '**\/node_modules/**', '**\/.minerva/**' ]
 * ```
 *
 * chokidar 5 dropped glob support outright. Its `createPattern` compiles a
 * **string** matcher to `(string) => matcher === string` — exact equality
 * against the normalized absolute path, after `normalizeIgnored` joins a
 * relative pattern onto `cwd`. A path is never literally
 * `<cwd>/**\/node_modules/**`, so both string entries matched nothing, ever.
 *
 * Measured against chokidar 5.0.0 rather than inferred: watching a tree
 * holding `note.md`, `node_modules/left-pad/readme.md`,
 * `sub/node_modules/deep/a.md`, `.minerva/graph.ttl` and `.git/config` with
 * the three-entry list above produced `add` events for
 * `node_modules/left-pad/readme.md` and `sub/node_modules/deep/a.md`; running
 * the same tree with the dot-regex *alone* produced a byte-identical result
 * set, which is the direct evidence that neither string entry contributed
 * anything. `.minerva` was incidentally still covered (the dot-regex catches
 * it), so that entry was merely redundant — but `node_modules` isn't
 * dot-prefixed, so a thoughtbase that also holds code was recursively watched,
 * tens of thousands of fsevents subscriptions deep, while
 * `shared/ignored-dirs.ts` excluded it from every *listing* walk. That is the
 * reliability bug: exhausting file handles, not merely wasting them.
 *
 * ## Why the dot-regex had to go too
 *
 * The surviving entry wasn't innocent either. chokidar tests matchers against
 * the normalized **absolute** path, so `/(^|[/\\])\./` fires on any
 * dot-segment *ancestor* of the thoughtbase — a thoughtbase at
 * `~/Dropbox/.private/notes` had every event silently suppressed: no tree
 * refresh, no reindex, no visible error. Probed directly while fixing this
 * (root under a `.private/` ancestor, current ignore list → zero `add` events;
 * same tree with no ignore list → both files seen), so it's a real failure
 * mode and not a reading of the source.
 *
 * Matching on the path **relative to the thoughtbase root** fixes both halves
 * at once, and lets the policy come from `isIgnoredEntry` — the same predicate
 * every listing walk uses — instead of a second, drifting copy expressed in a
 * pattern language the watcher doesn't actually speak.
 */
export function createWatchIgnoreMatcher(rootPath: string): (absPath: string) => boolean {
  const root = toUnix(rootPath);

  return (absPath: string): boolean => {
    const candidate = toUnix(absPath);

    // chokidar asks about the watch root itself before descending. Ignoring
    // it would abort the whole scan and watch nothing at all.
    if (candidate === root) return false;

    // Defensive only: every path chokidar hands the predicate is presented
    // under the watched root, symlinked subtrees included — verified against
    // 5.0.0 by watching a root containing `linked -> /elsewhere`, which was
    // probed (and emitted) as `<root>/linked/...`, never as its real path. If
    // some future backend does surface an outside path, watch it rather than
    // drop it: a silently-suppressed event is the failure mode this whole
    // module exists to remove.
    if (!candidate.startsWith(`${root}/`)) return false;

    // Segment-wise, and only over the part of the path *inside* the
    // thoughtbase — an ancestor named `.private` or `node_modules` is the
    // user's business, not ours.
    return candidate
      .slice(root.length + 1)
      .split('/')
      .some(isIgnoredEntry);
  };
}

/**
 * chokidar normalizes every path it tests to POSIX separators with no
 * trailing slash before consulting a matcher, so the root must be put in the
 * same shape or the prefix comparison above can never line up on Windows.
 */
function toUnix(p: string): string {
  const normalized = path.normalize(p).replace(/\\/g, '/');
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}
