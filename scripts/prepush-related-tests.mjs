#!/usr/bin/env node
/**
 * Run the tests related to what's being pushed (#2380). Called by
 * `.githooks/pre-push` when `PREPUSH_TESTS=1`; not meant to be run by hand,
 * though it works if you pipe it the same stdin git gives the hook:
 *
 *   echo "refs/heads/x $(git rev-parse HEAD) refs/heads/x 0000000000000000000000000000000000000000" \
 *     | node scripts/prepush-related-tests.mjs origin
 *
 * File selection is `scripts/lib/prepush-changed-files.mjs` (tested); this
 * file only runs vitest and reports. vitest is spawned with an argv ARRAY —
 * never through a shell — so a path with spaces, quotes or `$` in it reaches
 * vitest as exactly one argument.
 *
 * Exit status: 0 when the related tests pass or there is nothing to run,
 * vitest's own status otherwise.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectChangedFilesInRepo } from './lib/prepush-changed-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Past this many files, say so before running — the related set is then
 * likely most of the suite (~9 min in full), and the developer should know
 * why the push is slow. It still runs: the developer opted into a test gate,
 * and quietly running fewer tests than they asked for would be the wrong
 * surprise. `vitest related` on a huge set is still never MORE than
 * `pnpm test`, because it's a subset of the same suite.
 */
const LARGE_CHANGESET = 150;

/**
 * Past this many argv bytes, run the full suite instead of `related`. Not a
 * judgement call like the one above — macOS caps argv+env at 1 MiB (ARG_MAX),
 * and a spawn that dies with E2BIG is a gate that fails for a reason unrelated
 * to the code. 256 KiB is ~3,000 typical paths; the full suite is a superset of
 * any related set, so the fallback can only test more, never less.
 */
const MAX_ARGV_BYTES = 256 * 1024;

const remote = process.argv[2] || 'origin';
const stdin = readFileSync(0, 'utf8');
const started = Date.now();

const { files, changed, refs } = selectChangedFilesInRepo(stdin, remote, ROOT);

if (files.length === 0) {
  console.log(
    `→ pre-push: no test-relevant files in this push (${changed} changed across ${refs} ref${refs === 1 ? '' : 's'}) — skipping related tests.`,
  );
  process.exit(0);
}

// `pnpm test` runs this as `pretest`; `pnpm exec vitest` bypasses that hook,
// and embedding tests fail without the weights. A no-op on a warm tree.
const fetched = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fetch-embedding-model.mjs')], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
});
if (fetched.status !== 0) {
  console.error('✗ pre-push: could not fetch the embedding model the tests need (see above).');
  process.exit(fetched.status ?? 1);
}

const argvBytes = files.reduce((n, f) => n + Buffer.byteLength(f) + 1, 0);
let args;
if (argvBytes > MAX_ARGV_BYTES) {
  console.log(
    `→ pre-push: ${files.length} changed files is too many to pass on a command line — running the full suite instead…`,
  );
  args = ['exec', 'vitest', 'run'];
} else {
  if (files.length > LARGE_CHANGESET) {
    console.log(
      `→ pre-push: ${files.length} changed files — the related set may be most of the suite (full \`pnpm test\` is ~9 min).`,
    );
  }
  console.log(`→ pre-push: vitest related --run on ${files.length} changed file${files.length === 1 ? '' : 's'}…`);
  args = ['exec', 'vitest', 'related', '--run', '--passWithNoTests', ...files];
}

// Async + its own process group, so a SIGINT/SIGTERM from the hook (Ctrl-C
// during the push) takes down pnpm AND the vitest workers under it rather than
// orphaning them — a backgrounded job in a non-interactive sh ignores SIGINT,
// so the hook forwards it as SIGTERM to this process.
//
// GIT_* is dropped from vitest's environment: git may export GIT_DIR /
// GIT_INDEX_FILE to a hook, and a test that builds a throwaway repo would then
// run its git commands against THIS one. Inside the hook, the suite should see
// the same environment `pnpm test` does.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const child = spawn('pnpm', args, { cwd: ROOT, stdio: 'inherit', detached: true, env });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    process.exit(130);
  });
}
child.on('error', (err) => {
  console.error(`✗ pre-push: could not start vitest: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  const status = code ?? (signal ? 1 : 0);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${status === 0 ? '✓' : '✗'} pre-push: related tests ${status === 0 ? 'passed' : 'FAILED'} in ${secs}s`);
  process.exit(status);
});
