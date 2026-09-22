#!/usr/bin/env node
/**
 * Ratcheted advisory gate for the full dependency tree (#2249).
 *
 * `audit:prod` (the shipped surface) has been blocking since #1455.
 * `audit:all` was left `continue-on-error: true` with a comment naming the
 * next move — "once the full tree is clean, remove `continue-on-error`" — and
 * no way to learn when that became possible, because the step is green either
 * way. A plan with no feedback loop.
 *
 * The tree is not clean and, as of 2026-09-22, cannot be made clean:
 *
 *   extract-zip ×2   GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3
 *                    `patched: null` — no fixed version exists. 28 paths, all
 *                    under @electron/packager.
 *   image-size ×2    GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq
 *                    Patched at >=2.0.3, but the installed 0.7.5 is reached
 *                    through `appdmg@0.6.6`, which declares `^0.7.4` and calls
 *                    `require('image-size')(path, callback)`. image-size 2.x is
 *                    ESM-first and exports `{ imageSize }` taking a Buffer with
 *                    no callback form — verified by forcing the override and
 *                    reproducing appdmg's call: `sizeOf is not a function`. So
 *                    the "fix" breaks `pnpm build`'s DMG step, the same shape
 *                    as the `plist>@xmldom/xmldom` entry in pnpm-workspace.yaml.
 *                    Unlike that one there is no safe floor: 1.x is vulnerable
 *                    too, so no in-range version is patched.
 *
 * So "clean" isn't reachable today, but "no worse than today" is — the pattern
 * used by `tests/architecture/pattern-ratchets.test.ts`, `file-size-budgets`,
 * and the `vitest.config.mts` coverage floors.
 *
 * **Tracks advisory IDENTITIES, not a count.** A count alone passes when one
 * advisory is fixed and a different one appears the same week, which is
 * exactly the drift this is meant to catch. Fixing one without the other being
 * noticed is the failure mode; the set makes both visible.
 *
 *   node scripts/check-audit.mjs            # gate against the baseline
 *   node scripts/check-audit.mjs --update   # re-bless after a real change
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(ROOT, 'build', 'audit-baseline.json');

/** Severities this gate cares about. Moderate and below are reported by
 *  `pnpm audit` but have never been part of the blocking contract (#1455). */
const GATED = new Set(['high', 'critical']);

/**
 * Advisories keyed by a stable identity.
 *
 * `github_advisory_id` (GHSA-…) rather than the numeric `id`, which is
 * registry-local and can churn. Module name is carried alongside so the
 * baseline reads as something a human can audit.
 */
export function advisoryKeys(auditJson) {
  const advisories = Object.values(auditJson?.advisories ?? {});
  return advisories
    .filter((a) => GATED.has(a.severity))
    .map((a) => ({
      id: a.github_advisory_id ?? String(a.id),
      module: a.module_name,
      severity: a.severity,
      title: (a.title ?? '').slice(0, 100),
      // `null` means no fixed version exists anywhere — worth surfacing,
      // because it's the difference between "nobody has bumped it" and
      // "there is nothing to bump to".
      patched: a.patched_versions ?? null,
    }))
    .sort((x, y) => x.id.localeCompare(y.id));
}

/** Compare the current advisory set against the blessed one. */
export function compare(current, baseline) {
  const baseIds = new Set(baseline.map((b) => b.id));
  const currIds = new Set(current.map((c) => c.id));
  return {
    added: current.filter((c) => !baseIds.has(c.id)),
    removed: baseline.filter((b) => !currIds.has(b.id)),
  };
}

function runAudit() {
  // `pnpm audit` exits non-zero when it finds anything at the given level, so
  // a throw here is the normal case and the payload is still on stdout.
  try {
    return execFileSync('pnpm', ['audit', '--audit-level=high', '--json'], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const out = err.stdout;
    if (typeof out === 'string' && out.trim().startsWith('{')) return out;
    throw err;
  }
}

function main() {
  const update = process.argv.includes('--update');
  const current = advisoryKeys(JSON.parse(runAudit()));

  if (update) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify(
        {
          _comment:
            'High/critical advisories in the FULL dependency tree, accepted as of the ' +
            'date below (#2249). The shipped surface (`pnpm audit --prod`) is blocking ' +
            'and separately clean — everything here is build/dev tooling that never ' +
            'reaches a user. This gate fails when the set GROWS, and when it SHRINKS ' +
            '(re-bless so the win is held). Tracks advisory ids, not a count: a count ' +
            'passes when one advisory is fixed and another appears. ' +
            'Re-bless with `node scripts/check-audit.mjs --update`.',
          blessed: new Date().toISOString().slice(0, 10),
          advisories: current,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Blessed ${current.length} advisories to ${path.relative(ROOT, BASELINE_FILE)}`);
    return;
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`::error::${path.relative(ROOT, BASELINE_FILE)} is missing — run with --update.`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')).advisories ?? [];
  const { added, removed } = compare(current, baseline);

  console.log(`Gated advisories (high+critical): ${current.length}, baseline ${baseline.length}`);

  if (added.length > 0) {
    for (const a of added) {
      console.error(`::error::NEW ${a.severity} advisory ${a.id} in ${a.module}: ${a.title}`);
      console.error(
        a.patched
          ? `  Fixed in ${a.patched} — add a pnpm-workspace.yaml override, and verify with a real ` +
            `build rather than with \`pnpm audit\` going quiet (see the xmldom and tar entries).`
          : `  No patched version exists. If it is genuinely unfixable and unreachable at runtime, ` +
            `re-bless with \`node scripts/check-audit.mjs --update\` and say why in the PR.`,
      );
    }
    process.exit(1);
  }

  if (removed.length > 0) {
    for (const a of removed) {
      console.error(`::error::${a.id} (${a.module}) is FIXED — nice.`);
    }
    console.error(
      '\nRe-bless with `node scripts/check-audit.mjs --update` so the improvement is held ' +
      'and cannot quietly become room for a new advisory.',
    );
    process.exit(1);
  }

  console.log('✓ No new high/critical advisories.');
}

// Only run when invoked directly, so the pure helpers stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
