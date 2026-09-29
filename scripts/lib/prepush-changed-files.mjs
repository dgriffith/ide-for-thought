/**
 * Which files does this push change? — the file-selection half of the
 * pre-push hook's opt-in related-tests run (#2380).
 *
 * Git feeds a pre-push hook one line per ref being pushed:
 *
 *   <local ref> <local sha> <remote ref> <remote sha>
 *
 * and this module turns those lines into the set of files `vitest related`
 * should start from. It lives here rather than inline in `.githooks/pre-push`
 * because every rule below has an edge case, and edge cases in a POSIX sh
 * pipeline are untestable in practice. The pure parts take their git facts
 * injected (`GitFacts`) so `tests/scripts/prepush-changed-files.test.ts` can
 * drive new-branch / update / delete / multi-ref pushes without a live repo;
 * `realGit()` is the thin adapter the hook actually uses.
 *
 * The diff-range rules, one per push shape:
 *
 *   - **Deletion** (local sha all zeros): nothing is being pushed, so no files.
 *   - **Update** (both shas real, remote sha known locally): `remote..local`,
 *     a tree-to-tree diff. On a force-push after a rebase that includes
 *     whatever the rebase pulled in from main — a superset, which is the safe
 *     direction for a test gate.
 *   - **New branch** (remote sha all zeros) — or an update whose remote sha we
 *     don't have locally (someone else pushed, you never fetched): diff from
 *     the merge-base with the remote's default branch. The default branch is
 *     resolved as `<remote>/HEAD`, then `<remote>/main`, then
 *     `<remote>/master`. If none resolves, fall back to "every file touched by
 *     a commit that no remote-tracking ref has" (git's own sample pre-push
 *     hook uses the same `--not --remotes` idea).
 *
 * The union across refs is then filtered to files that still exist and that
 * vitest's module graph can relate (`isRelatable`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ZERO_SHA_RE = /^0+$/;

/**
 * Source extensions vitest can place in its module graph wherever they live.
 * A `.mjs` under `scripts/lib/` is imported by `tests/scripts/`, so `scripts/`
 * counts as much as `src/` does.
 */
const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte']);

/**
 * Non-code files that `src/` imports (`?raw` ontologies, `import.meta.glob`
 * skill bodies, JSON) — relatable only under `src/`, where something imports
 * them. The same extensions elsewhere (docs, workflows) are never imported by
 * a test, so passing them would only lengthen the argv.
 */
const SRC_DATA_EXTENSIONS = new Set(['.json', '.ttl', '.md', '.rq', '.sql', '.css']);

/** Trees nothing imports from, even when a path in them has a code extension. */
const EXCLUDED_PREFIXES = ['node_modules/', '.vite/', 'out/', 'dist/', 'coverage/'];

/**
 * @typedef {{ localRef: string, localSha: string, remoteRef: string, remoteSha: string }} PushUpdate
 *
 * @typedef {object} GitFacts
 * @property {(sha: string) => boolean} hasCommit       Is this commit in the local object store?
 * @property {() => string | null} defaultBranch        e.g. `origin/main`, or null if unresolvable.
 * @property {(a: string, b: string) => string | null} mergeBase
 * @property {(base: string, head: string) => string[]} diffNames  Paths changed base..head.
 * @property {(head: string) => string[]} unpushedNames Paths touched by commits in head that no remote ref has.
 */

export function isZeroSha(sha) {
  return ZERO_SHA_RE.test(sha);
}

/**
 * Parse git's pre-push stdin. Malformed lines are dropped rather than thrown
 * on: a hook that crashes on input it doesn't understand blocks the push, and
 * git's format has been stable for a decade — a line that doesn't fit is noise.
 *
 * Splits on whitespace, which is safe because ref names cannot contain spaces
 * (`git check-ref-format`) and shas are hex.
 *
 * @param {string} text
 * @returns {PushUpdate[]}
 */
export function parsePrePushInput(text) {
  const updates = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    if (!/^[0-9a-f]+$/i.test(localSha) || !/^[0-9a-f]+$/i.test(remoteSha)) continue;
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}

/**
 * Decide how to diff one pushed ref.
 *
 * @param {PushUpdate} update
 * @param {GitFacts} git
 * @returns {{ kind: 'delete' }
 *   | { kind: 'range', base: string, head: string, why: 'update' | 'new-branch' | 'unknown-remote-sha' }
 *   | { kind: 'unpushed', head: string, why: string }}
 */
export function planRange(update, git) {
  const { localSha, remoteSha } = update;
  if (isZeroSha(localSha)) return { kind: 'delete' };

  if (!isZeroSha(remoteSha) && git.hasCommit(remoteSha)) {
    return { kind: 'range', base: remoteSha, head: localSha, why: 'update' };
  }

  const why = isZeroSha(remoteSha) ? 'new-branch' : 'unknown-remote-sha';
  const defaultBranch = git.defaultBranch();
  const base = defaultBranch ? git.mergeBase(defaultBranch, localSha) : null;
  if (base) return { kind: 'range', base, head: localSha, why };
  return { kind: 'unpushed', head: localSha, why };
}

/**
 * Could `vitest related` do anything with this repo-relative path?
 *
 * @param {string} file POSIX-style, repo-relative (what `git diff --name-only` prints).
 */
export function isRelatable(file) {
  if (EXCLUDED_PREFIXES.some((p) => file.startsWith(p))) return false;
  const ext = path.posix.extname(file).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  return file.startsWith('src/') && SRC_DATA_EXTENSIONS.has(ext);
}

/**
 * The whole selection: stdin text in, sorted unique relatable paths out.
 *
 * @param {string} stdinText
 * @param {GitFacts} git
 * @param {(file: string) => boolean} exists  Existence check (a file deleted by
 *   the push can't be handed to vitest; whatever imported it shows up anyway).
 * @returns {{ files: string[], changed: number, refs: number, plans: ReturnType<typeof planRange>[] }}
 */
export function selectChangedFiles(stdinText, git, exists) {
  const updates = parsePrePushInput(stdinText);
  const plans = updates.map((u) => planRange(u, git));
  const changed = new Set();
  for (const plan of plans) {
    const names =
      plan.kind === 'range' ? git.diffNames(plan.base, plan.head)
        : plan.kind === 'unpushed' ? git.unpushedNames(plan.head)
          : [];
    for (const n of names) changed.add(n);
  }
  const files = [...changed].filter((f) => isRelatable(f) && exists(f)).sort();
  return { files, changed: changed.size, refs: updates.length, plans };
}

/** Split `git … -z` output. NUL-separated so a path with spaces or newlines survives. */
function splitZ(out) {
  return out.split('\0').filter(Boolean);
}

/**
 * The real `GitFacts`, shelling out with argv arrays (no shell, so no quoting).
 *
 * @param {string} remote  The remote name git passed the hook as `$1` (e.g. `origin`).
 * @param {string} cwd
 * @returns {GitFacts}
 */
export function realGit(remote, cwd) {
  const git = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const tryGit = (args) => {
    try {
      return git(args).trim();
    } catch {
      return null;
    }
  };
  return {
    hasCommit: (sha) => tryGit(['cat-file', '-e', `${sha}^{commit}`]) !== null,
    defaultBranch: () => {
      const head = tryGit(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
      if (head) return head;
      for (const b of ['main', 'master']) {
        if (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${b}`])) return `${remote}/${b}`;
      }
      return null;
    },
    mergeBase: (a, b) => tryGit(['merge-base', a, b]) || null,
    diffNames: (base, head) => splitZ(git(['diff', '--name-only', '-z', '--no-renames', base, head])),
    unpushedNames: (head) =>
      splitZ(git(['log', '--name-only', '-z', '--format=', '--no-renames', head, '--not', '--remotes'])),
  };
}

/** `realGit` + the filesystem, rooted at `cwd`. */
export function selectChangedFilesInRepo(stdinText, remote, cwd) {
  return selectChangedFiles(stdinText, realGit(remote, cwd), (f) => existsSync(path.join(cwd, f)));
}
