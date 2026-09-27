/**
 * The `minerva` CLI works from the PACKAGED app, run the way the shim runs it
 * (#2410).
 *
 * The installed shim (`src/main/cli-install.ts`) is
 *
 *     exec env ELECTRON_RUN_AS_NODE=1 '<app>/Contents/MacOS/Minerva' \
 *       '<app>/Contents/Resources/app.asar/.vite/build/cli.js' "$@"
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
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeTempDir, projectRoot, scrubbedEnv } from './helpers/launch';

/** The packaged `.app`, or null if it hasn't been built. */
function packagedApp(): string | null {
  if (process.platform !== 'darwin') return null; // only darwin .app layout handled
  const p = path.join(projectRoot, 'out', `Minerva-${process.platform}-${process.arch}`, 'Minerva.app');
  return fs.existsSync(path.join(p, 'Contents', 'MacOS', 'Minerva')) ? p : null;
}

let app: string | null;
let project: string;
let elsewhere: string;

test.beforeAll(() => {
  app = packagedApp();
  project = makeTempDir('minerva-e2e-cli-tb-');
  // The CLI runs from any directory; the pre-#2410 dev fallback was cwd-relative.
  elsewhere = makeTempDir('minerva-e2e-cli-cwd-');
  fs.writeFileSync(
    path.join(project, 'apples.md'),
    '---\ntitle: Apples\ntags: [fruit]\n---\n# Apples\n\nApples grow on trees in orchards.\n',
  );
});

test.afterAll(() => {
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

/** Run the packaged CLI exactly as the installed shim does. */
function minerva(args: string[], input?: string): SpawnSyncReturns<string> {
  const a = app as string;
  return spawnSync(
    path.join(a, 'Contents', 'MacOS', 'Minerva'),
    [path.join(a, 'Contents', 'Resources', 'app.asar', '.vite', 'build', 'cli.js'), ...args],
    {
      cwd: elsewhere,
      env: { ...scrubbedEnv(), ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf-8',
      input,
      timeout: 45_000,
    },
  );
}

function describeRun(r: SpawnSyncReturns<string>): string {
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
