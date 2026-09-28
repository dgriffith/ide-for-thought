#!/usr/bin/env node
/**
 * Assert the live ruleset protecting main matches `.github/rulesets/main.json`
 * (#2353).
 *
 * The required checks, "require up to date" and the bypass policy are
 * repository settings, and a settings page can be edited with nothing in the
 * repo to show it. This reads the live ruleset back and diffs it against the
 * committed file.
 *
 *   pnpm check:ruleset
 *
 * Needs an authenticated `gh` (read access to the repo's rulesets). Finds the
 * ruleset by `name`, so the numeric id doesn't have to be committed.
 *
 * Exit codes: 0 in step, 1 drift (or the ruleset is missing), 2 couldn't ask.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRulesets } from './lib/branch-ruleset.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, '.github', 'rulesets', 'main.json');

function gh(args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { cwd: ROOT, encoding: 'utf-8' }));
}

function main() {
  const expected = JSON.parse(readFileSync(FILE, 'utf-8'));

  let summaries;
  try {
    // `{owner}/{repo}` is filled in by gh from the checkout's remote.
    summaries = gh(['repos/{owner}/{repo}/rulesets']);
  } catch (err) {
    console.error(`could not list rulesets via gh api: ${err.message}`);
    process.exit(2);
  }

  const match = summaries.filter((r) => r.name === expected.name);
  if (match.length !== 1) {
    console.error(
      `expected exactly one ruleset named "${expected.name}", found ${match.length}. ` +
        `Apply the committed one with:\n\n` +
        `  gh api --method POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json`,
    );
    process.exit(1);
  }

  // The list endpoint omits `rules`; the detail endpoint has everything.
  const live = gh([`repos/{owner}/{repo}/rulesets/${match[0].id}`]);
  const result = compareRulesets(expected, live);
  if (!result.ok) {
    console.error(result.message.replace('<id>', String(live.id)));
    process.exit(1);
  }

  console.log(`✓ ruleset "${live.name}" (id ${live.id}) matches .github/rulesets/main.json`);
}

main();
