/**
 * The `minerva` CLI works from the PACKAGED app, run the way the shim runs it
 * (#2410).
 *
 * The installed shim (`src/main/cli-install.ts`) is
 *
 *     exec '<app>/Contents/MacOS/Minerva' --minerva-cli -- "$@"
 *
 * (CLI mode, #2565 — it used to run the binary as plain Node with
 * ELECTRON_RUN_AS_NODE, which is what kept the RunAsNode fuse on.)
 *
 * `minerva semantic` shipped broken that way — `ENOENT … resources/models/
 * all-MiniLM-L6-v2/tokenizer.json` — because the CLI resolved the model at
 * `<cli.js>/../../resources`, which is `Resources/app.asar/resources` once
 * packaged, while `extraResource` puts it at `Resources/resources`. Every
 * other check passed: `tests/cli/electron-free.test.ts` runs the bundle from
 * the checkout (where `../../resources` IS the repo's), and the embeddings e2e
 * spec runs the model inside the app, not through the CLI. Only this shape —
 * packaged binary, RunAsNode, cli.js inside the archive, cwd somewhere
 * unrelated — reproduces it, so this spec is exactly that shape.
 *
 * No Electron driver here: the CLI is a plain child process with a JSON
 * contract, so `spawnSync` is the honest harness.
 *
 * ── Not vacuous ─────────────────────────────────────────────────────────────
 * The thoughtbase is fresh, so `semantic` finds no embedded chunks — but
 * `vectors.searchRelated` embeds the QUERY before it looks at the table
 * (see `embeddings.spec.ts`), so a missing model or a broken WASM still fails
 * the call with a non-zero exit. That is precisely how #2410 presented.
 */

import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeTempDir, minervaEnv, projectRoot } from './helpers/launch';

/** The packaged `.app`, or null if it hasn't been built. */
function packagedApp(): string | null {
  if (process.platform !== 'darwin') return null; // only darwin .app layout handled
  const p = path.join(projectRoot, 'out', `Minerva-${process.platform}-${process.arch}`, 'Minerva.app');
  return fs.existsSync(path.join(p, 'Contents', 'MacOS', 'Minerva')) ? p : null;
}

let app: string | null;
let project: string;
let elsewhere: string;
let home: string;

test.beforeAll(() => {
  app = packagedApp();
  project = makeTempDir('minerva-e2e-cli-tb-');
  // The CLI runs from any directory; the pre-#2410 dev fallback was cwd-relative.
  elsewhere = makeTempDir('minerva-e2e-cli-cwd-');
  // Not the developer's HOME: the CLI would read their ~/.minerva/ (#2466).
  home = makeTempDir('minerva-e2e-cli-home-');
  fs.writeFileSync(
    path.join(project, 'apples.md'),
    '---\ntitle: Apples\ntags: [fruit]\n---\n# Apples\n\nApples grow on trees in orchards.\n',
  );
});

test.afterAll(() => {
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

/** Run the packaged CLI exactly as the installed shim does: CLI mode (#2565). */
function minerva(args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync(binary(), ['--minerva-cli', '--', ...args], {
    cwd: elsewhere,
    env: minervaEnv(home),
    encoding: 'utf-8',
    input,
    timeout: 45_000,
  });
}

function binary(): string {
  return path.join(app as string, 'Contents', 'MacOS', 'Minerva');
}

function cliJs(): string {
  return path.join(app as string, 'Contents', 'Resources', 'app.asar', '.vite', 'build', 'cli.js');
}

/**
 * Run something that may start the whole GUI app, for at most `ms`, then kill
 * its entire process group. spawnSync can't do this. Its timeout kills only
 * the main process, then waits for stdout/stderr to close, and Electron's
 * helper processes hold those pipes open, so the call never returns. That
 * hung the e2e job until its 20-minute timeout. Resolves on `exit`, not on
 * `close`, for the same reason.
 */
function runBounded(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }, ms: number):
  Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const killGroup = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(killGroup, ms);
    child.on('exit', (status, signal) => {
      clearTimeout(timer);
      killGroup(); // helpers outlive the main process otherwise
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function describeRun(r: { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }): string {
  return `exit=${r.status} signal=${r.signal}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
}

test('packaged CLI: semantic loads the bundled embedding model (#2410)', async () => {
  test.skip(app === null, 'packaged app not built — run `pnpm build:e2e` first');
  const r = minerva(['semantic', 'fruit orchards', '--project', project]);
  expect(r.stderr, describeRun(r)).not.toContain('ENOENT');
  expect(r.status, describeRun(r)).toBe(0);
  const out = JSON.parse(r.stdout) as { query: string; hits: unknown[] };
  expect(out.query).toBe('fruit orchards');
  expect(Array.isArray(out.hits)).toBe(true);
});

test('packaged CLI: query and sql still work', async () => {
  test.skip(app === null, 'packaged app not built — run `pnpm build:e2e` first');

  const q = minerva(['query', 'SELECT ?t WHERE { ?n dc:title ?t }', '--project', project]);
  expect(q.status, describeRun(q)).toBe(0);
  expect(q.stdout).toContain('Apples');

  const s = minerva(['sql', 'SELECT 1 + 1 AS two', '--project', project]);
  expect(s.status, describeRun(s)).toBe(0);
  expect(s.stdout).toContain('"two"');
});

test('packaged CLI: mcp answers tools/list and a semantic_search call', async () => {
  test.skip(app === null, 'packaged app not built — run `pnpm build:e2e` first');
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'e2e' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'semantic_search', arguments: { text: 'fruit' } } },
  ];
  const r = minerva(['mcp', '--project', project], lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  expect(r.status, describeRun(r)).toBe(0);

  const byId = new Map<number, { result?: { tools?: unknown[]; isError?: boolean; content?: { text: string }[] } }>();
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const msg = JSON.parse(line) as { id: number };
    byId.set(msg.id, msg);
  }
  expect(byId.get(2)?.result?.tools?.length, describeRun(r)).toBeGreaterThan(0);
  const call = byId.get(3)?.result;
  expect(call?.isError, `semantic_search failed over MCP: ${call?.content?.[0]?.text}`).not.toBe(true);
});

test('packaged CLI: a shim installed before #2565 (ELECTRON_RUN_AS_NODE) still works', async () => {
  test.skip(app === null, 'packaged app not built — run `pnpm build:e2e` first');
  const r = spawnSync(binary(), [cliJs(), 'sql', 'SELECT 1 + 1 AS two', '--project', project], {
    cwd: elsewhere, env: minervaEnv(home, { ELECTRON_RUN_AS_NODE: '1' }), encoding: 'utf-8', timeout: 45_000,
  });
  expect(r.status, describeRun(r)).toBe(0);
  expect(r.stdout).toContain('"two"');
});

test('packaged binary: ELECTRON_RUN_AS_NODE no longer runs arbitrary JS (RunAsNode off, #2565)', async () => {
  test.skip(app === null, 'packaged app not built — run `pnpm build:e2e` first');
  const canary = path.join(elsewhere, 'runasnode-canary');
  // Under RunAsNode this ran as plain Node, as "Minerva", and wrote the file.
  const r = await runBounded(
    binary(),
    ['-e', `require('fs').writeFileSync(${JSON.stringify(canary)}, 'ran')`],
    { cwd: elsewhere, env: minervaEnv(home, { ELECTRON_RUN_AS_NODE: '1' }) },
    8_000,
  );
  // With the fuse off the binary starts as the app (and is killed by the
  // timeout, or exits) — the code is never evaluated.
  expect(fs.existsSync(canary), describeRun(r)).toBe(false);
});
