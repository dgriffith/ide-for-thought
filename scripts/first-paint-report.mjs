#!/usr/bin/env node
/**
 * Packaged-app time-to-first-paint, into the job summary (#2384).
 *
 * Reads the samples the packaged smoke boot recorded
 * (`tests/e2e/helpers/first-paint.ts` → `test-results/first-paint.jsonl`),
 * prints a table, appends it to $GITHUB_STEP_SUMMARY when set, and raises a
 * `::notice` with the number (a `::warning` when there is none). Always exits
 * 0: this is a trend, not a gate — see scripts/lib/first-paint-report.mjs.
 *
 * Usage:
 *   node scripts/first-paint-report.mjs [first-paint.jsonl] [--label <text>]
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { formatFirstPaintReport, parseFirstPaintRows } from './lib/first-paint-report.mjs';

const argv = process.argv.slice(2);
let file = 'test-results/first-paint.jsonl';
let label = '';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--label') label = argv[++i] ?? '';
  else file = argv[i];
}

let text = '';
try {
  text = readFileSync(file, 'utf-8');
} catch {
  // No file: the packaged spec skipped or never ran. The report says so.
}

const { markdown, annotations } = formatFirstPaintReport(parseFirstPaintRows(text), { label });
console.log(markdown);
for (const a of annotations) console.log(a);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  } catch (err) {
    console.log(`first-paint-report: could not write the job summary (${err instanceof Error ? err.message : err})`);
  }
}
