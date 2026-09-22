/**
 * Ratcheted size budgets for the release artifacts (#2243).
 *
 * The packaged app drifted to 696 MB — a 239 MB DMG and a 242 MB ZIP —
 * unobserved. It is the one large surface in this codebase with no committed
 * number: `tests/architecture/file-size-budgets.test.ts` watches every source
 * file over 600 lines, `pattern-ratchets` watches known-bad idioms,
 * `vitest.config.mts` watches coverage. Nothing watched the thing users
 * actually download.
 *
 * The ZIP matters most: it is the Squirrel.Mac auto-update payload, and
 * Squirrel has no delta mechanism, so **every installed user downloads all of
 * it for every point release**. A megabyte added here is a megabyte sent to
 * everyone, forever.
 *
 * Same shape as the file-size budgets, deliberately: it fails when an artifact
 * GROWS past its budget, and also when one shrinks well past it — so a win
 * gets recorded instead of quietly becoming headroom for the next regression.
 *
 * Runs in the release job, where a human is watching the release they just
 * cut. That placement is the point of #2242: a check that runs out-of-band has
 * to ship a notification path, and the cheapest notification path is running
 * somewhere a person is already looking.
 *
 * Usage:  node scripts/check-artifact-size.mjs <dir>   [--update]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(ROOT, 'build', 'artifact-size-budget.json');

const MB = 1024 * 1024;

/**
 * How far below budget an artifact may sit before the check asks for the
 * number to be lowered. Wider than the file-size budgets' zero-tolerance
 * shrink check because these numbers are compression output: the same input
 * varies by a little between runs and across runners, and a build that failed
 * for being 0.4 MB smaller would be re-blessed on reflex, which is how a
 * ratchet stops being read.
 */
const SHRINK_SLACK_MB = 12;

/**
 * Headroom baked into a blessed budget, over the size actually measured.
 *
 * These numbers are compression output. The same input produces a slightly
 * different DMG on a different runner, a different macOS version, or a
 * different `hdiutil`, so a budget set to the exact measured byte count would
 * fail the release on a rounding difference — and a gate that fails for no
 * reason is one people learn to re-bless without reading. 2% of a 230 MB
 * artifact is ~4.6 MB, comfortably more than that variance and far less than
 * any regression worth catching.
 */
const BLESS_HEADROOM = 1.02;

export function formatMb(bytes) {
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** Artifacts to measure, by extension, with the role each one plays. */
const KINDS = [
  { ext: '.zip', key: 'zip', role: 'Squirrel.Mac auto-update payload — every user downloads this for every release' },
  { ext: '.dmg', key: 'dmg', role: 'human-downloadable installer' },
];

/** Find one artifact per kind under `dir`, recursively. */
export function findArtifacts(dir, { readdirSync = fs.readdirSync, statSync = fs.statSync } = {}) {
  const found = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const kind = KINDS.find((k) => entry.name.toLowerCase().endsWith(k.ext));
      // First match wins: a release builds exactly one of each, and a second
      // would mean two versions in the directory — worth failing on rather
      // than silently measuring whichever `readdir` returned first.
      if (kind && !found[kind.key]) {
        found[kind.key] = { file: full, bytes: statSync(full).size };
      }
    }
  };
  walk(dir);
  return found;
}

/**
 * Compare measured sizes against budgets.
 *
 * Returns `{ grown, shrunk, missing }` rather than throwing, so the same logic
 * is testable without a 240 MB file on disk.
 */
export function compare(found, budgets) {
  const grown = [];
  const shrunk = [];
  const missing = [];

  for (const kind of KINDS) {
    const actual = found[kind.key];
    const budget = budgets[kind.key];
    if (!actual) {
      missing.push(kind);
      continue;
    }
    if (typeof budget !== 'number') continue; // not yet budgeted — `--update` sets it
    if (actual.bytes > budget) {
      grown.push({ kind, actual: actual.bytes, budget, delta: actual.bytes - budget });
    } else if (budget - actual.bytes > SHRINK_SLACK_MB * MB) {
      shrunk.push({ kind, actual: actual.bytes, budget, delta: budget - actual.bytes });
    }
  }
  return { grown, shrunk, missing };
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node scripts/check-artifact-size.mjs <dir> [--update]');
    process.exit(2);
  }

  const budgets = fs.existsSync(BUDGET_FILE)
    ? JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf-8'))
    : {};
  const found = findArtifacts(dir);

  for (const kind of KINDS) {
    const a = found[kind.key];
    const b = budgets[kind.key];
    const budgetStr = typeof b === 'number' ? formatMb(b) : '(none)';
    console.log(
      `  ${kind.ext.padEnd(5)} ${a ? formatMb(a.bytes).padStart(9) : '   missing'}` +
      `  budget ${budgetStr.padStart(9)}`,
    );
  }

  if (update) {
    const next = { ...budgets };
    for (const kind of KINDS) {
      if (found[kind.key]) next[kind.key] = Math.ceil(found[kind.key].bytes * BLESS_HEADROOM);
    }
    next._comment =
      'Release-artifact size budgets in BYTES (#2243), each ~2% above the size last ' +
      'measured — compression output varies a little between runners, and a gate that ' +
      'fails on that noise is one people re-bless without reading. The .zip is the Squirrel.Mac ' +
      'auto-update payload — Squirrel has no delta mechanism, so every installed user ' +
      'downloads all of it for every point release. The check fails when an artifact ' +
      `grows past its budget, and when one falls more than ${SHRINK_SLACK_MB} MB below ` +
      'it (lower the number so the win is held). Re-bless with ' +
      '`node scripts/check-artifact-size.mjs out/make --update`.';
    fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
    fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nBudgets written to ${path.relative(ROOT, BUDGET_FILE)}`);
    return;
  }

  const { grown, shrunk, missing } = compare(found, budgets);

  if (missing.length > 0) {
    for (const kind of missing) {
      console.error(`::error::No ${kind.ext} found under ${dir} — the ${kind.role} is missing.`);
    }
    process.exit(1);
  }

  if (grown.length > 0) {
    for (const g of grown) {
      console.error(
        `::error::${g.kind.ext} grew to ${formatMb(g.actual)}, over its ` +
        `${formatMb(g.budget)} budget by ${formatMb(g.delta)}. ` +
        `This is the ${g.kind.role}.`,
      );
    }
    console.error(
      '\nTwo ways forward, and choosing is the point of this check: prune what got ' +
      'added (see scripts/lib/package-prune.mjs — the packaged app carried 30 MB of ' +
      'source maps and type declarations before #2243), or raise the number in ' +
      'build/artifact-size-budget.json in this same PR and say why.',
    );
    process.exit(1);
  }

  if (shrunk.length > 0) {
    for (const s of shrunk) {
      console.error(
        `::error::${s.kind.ext} is ${formatMb(s.delta)} under its budget ` +
        `(${formatMb(s.actual)} vs ${formatMb(s.budget)}) — nice. Lower the number in ` +
        'build/artifact-size-budget.json so the reclaimed space does not quietly ' +
        'become headroom for the next addition.',
      );
    }
    process.exit(1);
  }

  console.log('\n✓ Release artifacts are within budget.');
}

// Only run when invoked directly, so the pure helpers above stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
