#!/usr/bin/env node
/**
 * Assert main CI passed for the commit being released (#2371).
 *
 * release.yml rebuilds, lints and audits whatever a tag points at, but it
 * never asked whether main's CI — the full test suite and the e2e job, which
 * the release build does not re-run — passed for that commit. A tag could be
 * cut on a SHA whose main run was cancelled or red, and every release
 * checkpoint would still go green.
 *
 *   node scripts/check-release-ci.mjs <sha|ref>            # verdict now
 *   node scripts/check-release-ci.mjs --wait <sha|ref>     # poll a running CI (≤30 min)
 *
 * `--wait` is what release.yml uses: a tag pushed right after a merge races
 * main CI (~12 min), so an in-progress run is polled until it completes. A
 * missing run, or one that finished non-green, fails immediately. The rule
 * itself lives in `lib/release-ci-gate.mjs`, shared with `tag-release.mjs`.
 *
 * The SHA arrives as an argv (release.yml passes `"$GITHUB_SHA"` from the
 * environment), never interpolated into a shell, and reaches `git`/`gh` via
 * execFile.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FULL_SHA_RE, ciVerdict, fetchCiRuns, waitForVerdict } from './lib/release-ci-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Peel whatever we were given to a commit SHA — a short SHA, `HEAD`, or an
 * annotated tag object all resolve. Falls back to the argument when it is
 * already a full SHA and git can't see it (e.g. outside a checkout).
 */
function resolveCommit(ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return FULL_SHA_RE.test(ref) ? ref : null;
  }
}

function fail(msg) {
  // `::error::` renders on the job summary, not just in the log.
  console.error(`::error::${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const wait = args.includes('--wait');
  const ref = args.find((a) => !a.startsWith('--'));
  if (!ref) {
    console.error('usage: node scripts/check-release-ci.mjs [--wait] <sha|ref>');
    process.exit(2);
  }

  const sha = resolveCommit(ref);
  if (!sha || !FULL_SHA_RE.test(sha)) fail(`cannot resolve ${JSON.stringify(ref)} to a commit SHA.`);

  let verdict;
  try {
    verdict = wait
      ? await waitForVerdict(sha, {
          fetchRuns: (s) => fetchCiRuns(s),
          onPending: (v) => console.log(`… ${v.message}`),
        })
      : ciVerdict(fetchCiRuns(sha), sha);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  if (!verdict.ok) fail(verdict.message);
  console.log(`✓ ${verdict.message}`);
}

main();
