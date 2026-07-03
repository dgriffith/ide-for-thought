#!/usr/bin/env node
/**
 * Create the git tag that matches package.json's `version` — the one manual
 * release step that's easy to fat-finger. The tag (`vX.Y.Z`) must equal the
 * packaged `version`, because release.yml keys the build off the tag while
 * update.electronjs.org compares the running app's `version` to the release.
 * A mismatch means the updater never offers the "new" build.
 *
 * This only creates the tag locally and prints the push command — pushing is
 * the outward-facing step, left to a human. See docs/releasing.md.
 *
 *   node scripts/tag-release.mjs        # tag the current package.json version
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execSync(`git ${args}`, { cwd: root }).toString().trim();

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  fail(`package.json version "${version}" isn't semver — bump it first.`);
}

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

git(`tag -a ${tag} -m "Release ${tag}"`);
console.log(`✓ Created tag ${tag} at ${git('rev-parse --short HEAD')}`);
console.log(`\nNext: push it to trigger the signed build + draft release:\n`);
console.log(`  git push origin ${tag}\n`);
