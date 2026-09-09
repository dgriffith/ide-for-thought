// Shared `predev`/`prebuild`/`prebuild:e2e` prep chain (#2103).
//
// npm/pnpm lifecycle scripts can't cleanly invoke another named `package.json`
// script from inside a hook, so the three-step chain used to be copy-pasted
// verbatim into `predev`, `prebuild`, and `prebuild:e2e` in package.json. This
// wrapper is the one place that sequence lives; each hook just runs
// `node scripts/prep.mjs`.
//
// Steps run in order, matching the original `&&` chain's fail-fast semantics:
// a non-zero exit aborts immediately and later steps never run.
//
//   1. node scripts/build-docs.mjs            — regenerate website/docs/*.html
//   2. node scripts/fetch-embedding-model.mjs  — stage the local embedding model
//   3. vite-node scripts/build-help-corpus.mjs — embed the docs help corpus
//      (needs vite-node, not plain node — see the comment atop that file)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** Resolve a local bin, platform-aware (`.cmd` shim on Windows). */
const bin = (name) => join('node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

const STEPS = [
  ['node', ['scripts/build-docs.mjs']],
  ['node', ['scripts/fetch-embedding-model.mjs']],
  [bin('vite-node'), ['scripts/build-help-corpus.mjs']],
];

for (const [cmd, args] of STEPS) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`prep: failed to start ${cmd} ${args.join(' ')}: ${result.error.message}`);
    process.exit(1);
  }
  const code = result.status ?? 1;
  if (code !== 0) {
    console.error(`prep: ${cmd} ${args.join(' ')} exited ${code} — aborting remaining steps`);
    process.exit(code);
  }
}
