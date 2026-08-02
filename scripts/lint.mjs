// Parallel lint gate (#1645). Runs the three independent checks — tsc,
// svelte-check, eslint — concurrently instead of sequentially, so `pnpm lint`
// (and the pre-push hook) finishes closer to the slowest single check than the
// sum of all three (measured ~48s → ~39s, bounded by the slowest TS check).
//
// Each check ticks off with a ✓/✗ line the moment it finishes (live progress),
// and its buffered output is printed as a labelled block at the end — only when
// it has something to say — so parallel runs never interleave into noise. The
// process exits non-zero if ANY check fails.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** Resolve a local bin, platform-aware (`.cmd` shim on Windows). */
const bin = (name) => join('node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

const CHECKS = [
  { name: 'tsc', args: [bin('tsc'), '--noEmit'] },
  { name: 'svelte-check', args: [bin('svelte-check'), '--threshold', 'error'] },
  { name: 'eslint', args: [bin('eslint'), '.'] },
];

function run({ name, args }) {
  return new Promise((resolve) => {
    const [cmd, ...rest] = args;
    const child = spawn(cmd, rest, { shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      const c = code ?? 1;
      // Tick off live so a ~39s run shows progress instead of a silent wait.
      process.stdout.write(c === 0 ? `  ✓ ${name}\n` : `  ✗ ${name} (exit ${c})\n`);
      resolve({ name, code: c, out });
    });
    child.on('error', (err) => {
      process.stdout.write(`  ✗ ${name} (failed to start)\n`);
      resolve({ name, code: 1, out: `${name} failed to start: ${err.message}\n` });
    });
  });
}

process.stdout.write('▶ lint — tsc · svelte-check · eslint (parallel)\n');
const results = await Promise.all(CHECKS.map(run));

// Detail blocks at the end — passing checks first, failures last (closest to the
// prompt) — and only for checks that actually produced output.
const ordered = [...results.filter((r) => r.code === 0), ...results.filter((r) => r.code !== 0)];
for (const r of ordered) {
  const trimmed = r.out.trim();
  if (!trimmed) continue;
  process.stdout.write(`\n──── ${r.code === 0 ? r.name : `${r.name} (exit ${r.code})`} ────\n${trimmed}\n`);
}

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
