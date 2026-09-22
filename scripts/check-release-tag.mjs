#!/usr/bin/env node
/**
 * Assert the pushed tag matches `package.json`'s version (#2245).
 *
 * `release.yml` triggers on `push: tags: ['v*']` and nothing downstream checks
 * that the tag is the version being packaged. The check existed only in
 * `tag-release.mjs`, which is a local convenience — `git tag -a v2.0.3 &&
 * git push origin v2.0.3` never runs it.
 *
 * Every other invariant in that workflow is asserted server-side: the DMG is
 * present, the signature verifies, Gatekeeper accepts it, the notarization
 * ticket staples, the DMG and ZIP are both there (#1639). This one was
 * asserted on a laptop.
 *
 *   node scripts/check-release-tag.mjs v2.0.3
 *
 * The tag comes in as an argument rather than being read from the environment
 * inside a shell interpolation, so a tag name can't reach a shell at all.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReleaseTag } from './lib/release-version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error('usage: node scripts/check-release-tag.mjs <tag>');
    process.exit(2);
  }

  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const result = checkReleaseTag(tag, version);

  if (!result.ok) {
    // `::error::` renders on the job summary, not just in the log — this is
    // the one failure someone needs to see without opening the run.
    console.error(`::error::${result.error}`);
    process.exit(1);
  }

  console.log(`✓ tag ${tag} matches package.json version ${version}`);
}

main();
