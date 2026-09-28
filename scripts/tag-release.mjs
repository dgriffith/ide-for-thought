#!/usr/bin/env node
/**
 * Create the git tag that matches package.json's `version` — the one manual
 * release step that's easy to fat-finger. The tag (`vX.Y.Z`) must equal the
 * packaged `version`, because release.yml keys the build off the tag while
 * update.electronjs.org compares the running app's `version` to the release.
 * A mismatch means the updater never offers the "new" build.
 *
 * It also refuses a HEAD that main CI hasn't passed (#2371): HEAD must be on
 * origin/main (after a fetch), and its main `ci.yml` run must have concluded
 * `success`. A run still in progress is refused with its URL rather than
 * waited on — come back when it's green. There is no bypass flag: rerun a
 * flaky red run to green, fix a real one.
 *
 * This only creates the tag locally and prints the push command — pushing is
 * the outward-facing step, left to a human. See docs/releasing.md.
 *
 *   node scripts/tag-release.mjs        # tag the current package.json version
 */

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Shared with scripts/check-release-tag.mjs, which release.yml runs on the
// pushed ref (#2245) — one definition of the rule, asserted in both places.
import { checkReleaseTag, tagForVersion } from './lib/release-version.mjs';
// Shared with scripts/check-release-ci.mjs, the same way (#2371).
import { ciVerdict, fetchCiRuns } from './lib/release-ci-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execSync(`git ${args}`, { cwd: root }).toString().trim();

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = tagForVersion(version);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const tagCheck = checkReleaseTag(tag, version);
if (!tagCheck.ok) fail(tagCheck.error);

const branch = git('rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
  fail(`on branch "${branch}", not main. Release tags come off merged main.`);
}

if (git('status --porcelain')) {
  fail('working tree is dirty. Commit or stash before tagging a release.');
}

const existing = git('tag --list').split('\n');
if (existing.includes(tag)) {
  fail(`tag ${tag} already exists. Bump the version in package.json first.`);
}

// Main CI must have passed for exactly the commit about to be tagged (#2371).
// A SHA that isn't on origin/main can never have a main CI run, so say that
// plainly rather than reporting "no run found".
const head = git('rev-parse HEAD');
try {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root, stdio: 'ignore' });
} catch {
  fail('could not fetch origin/main, so HEAD cannot be checked against it. Fix the remote and retry.');
}
try {
  execFileSync('git', ['merge-base', '--is-ancestor', head, 'origin/main'], { cwd: root, stdio: 'ignore' });
} catch {
  fail(
    `HEAD ${head.slice(0, 10)} is not on origin/main. Release tags come off merged main — ` +
    `a commit that never landed there can never have a main CI run. Merge it via a PR, ` +
    `pull, and tag the merged commit.`,
  );
}

let verdict;
try {
  verdict = ciVerdict(
    fetchCiRuns(head, { exec: (cmd, args, opts) => execFileSync(cmd, args, { ...opts, cwd: root }) }),
    head,
  );
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
// A running CI is refused, not waited on: the release runner polls, but a
// laptop blocking for 12 minutes is worse than "come back when it's green".
if (!verdict.ok) fail(verdict.message);
console.log(`✓ ${verdict.message}`);

git(`tag -a ${tag} -m "Release ${tag}"`);
console.log(`✓ Created tag ${tag} at ${git('rev-parse --short HEAD')}`);
console.log(`\nNext: push it to trigger the signed build + draft release:\n`);
console.log(`  git push origin ${tag}\n`);
