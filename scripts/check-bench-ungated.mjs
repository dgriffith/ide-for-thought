#!/usr/bin/env node
/**
 * Fail when an ungated bench has lost its owner (#2358).
 *
 * Run by `bench.yml` with `GH_TOKEN` set. For every `gate: false` entry in the
 * baseline, asks GitHub whether its linked `issue` is still OPEN. A CLOSED link
 * means the work that was supposed to arm the gate is done (or abandoned) and
 * nobody owns the ungated bench any more — the exact state #2211's six entries
 * sat in for a week after their fixes landed. Exiting non-zero here reaches the
 * workflow's existing failure-notify step, so it surfaces the same way a
 * regression does.
 *
 * The structural half (every ungated entry HAS an `issue` + `reason`) is
 * checked offline by `tests/architecture/bench-ungated-entries-tracked.test.ts`;
 * this script repeats it so the workflow can't pass on a malformed file either.
 *
 *   node scripts/check-bench-ungated.mjs [--baseline tests/main/bench-baseline.json]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findClosedLinks, findUntrackedUngated, ungatedEntries } from './lib/bench-ungated.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--baseline');
const baselinePath = i >= 0 ? argv[i + 1] : 'tests/main/bench-baseline.json';
const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));

const ungated = ungatedEntries(baseline);
console.log(`\nUngated bench entries: ${ungated.length} (${baselinePath})`);

const untracked = findUntrackedUngated(baseline);
const closed = findClosedLinks(baseline, (n) =>
  execFileSync('gh', ['issue', 'view', String(n), '--json', 'state', '--jq', '.state'], {
    encoding: 'utf-8',
  }).trim(),
);

for (const b of ungated) console.log(`  - ${b.name} → ${b.issue != null ? `#${b.issue}` : '(no issue linked)'}`);

if (untracked.length || closed.length) {
  console.error('\n✗ Ungated-bench ownership check FAILED:');
  for (const u of untracked) console.error(`  - ${u.name}: ${u.problem}`);
  for (const c of closed) {
    console.error(
      `  - ${c.name}: linked issue #${c.issue} is ${c.state}. Nobody owns this ungated bench any more — ` +
        'arm it (drop `gate: false`, re-bless on CI) or link the issue that now owns it.',
    );
  }
  process.exit(1);
}
console.log('✓ Every ungated bench links an open issue.');
