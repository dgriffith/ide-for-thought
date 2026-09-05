/**
 * The CLI's "electron-free read core" guarantee, enforced (#1839, epic #1145).
 *
 * `src/cli` is the one layer that runs OUTSIDE Electron. That property used to
 * be held entirely by a build-time alias (`vite.cli.config.mts` maps `electron`
 * to the all-undefined `src/cli/electron-stub.ts`) plus the happy accident of
 * which functions the CLI's commands happen to reach at runtime — nothing at
 * lint or test time noticed when new `src/main` code on the CLI's import graph
 * started calling an Electron API. The eslint block for `src/cli/**` covers the
 * layer's own imports; this file covers the transitive graph, in two ways:
 *
 *  1. **The runtime proof.** Build the real bundle and run it under plain
 *     `node` (not Electron, no ELECTRON_RUN_AS_NODE), against a real temp
 *     thoughtbase, asserting the exit-code + JSON contract. This is the
 *     `.vite/build/cli.js` shipping artifact, not a vitest-transformed import,
 *     so a bundle that can't boot headless fails here rather than in someone's
 *     terminal. The build is a rolldown SSR pass over ~2900 modules and takes
 *     about a second, which is why it's affordable to do inline.
 *
 *  2. **The static ratchet.** Walk the import graph from the CLI entry and pin
 *     the set of modules that import `electron` at all. Every one of them is
 *     latent-only — the Electron reference sits inside a function no CLI
 *     command calls — and the list below says so per module. That's a claim a
 *     reviewer has to re-make deliberately: adding an eighth electron importer
 *     to the CLI's graph fails this test and forces the question "is this one
 *     reached?" The runtime proof above can't ask it, because it can only
 *     observe the paths the tested commands happen to take.
 *
 * The durable fix for the list is the follow-up named in #1839: route every
 * `app.getPath('userData')` through a single `main/config/user-data-path.ts`
 * the CLI can stub, instead of the independent reach-throughs pinned below.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { cruise, type IModule } from 'dependency-cruiser';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'cli', 'main.ts');
const CLI_BUNDLE = path.join(REPO_ROOT, '.vite', 'build', 'cli.js');

/**
 * Modules on the CLI's import graph that import `electron`.
 *
 * Importing it is harmless on its own: every entry below reads `app` / `dialog`
 * / `safeStorage` from inside a function body, never at module scope, and the
 * CLI build swaps the module for a stub whose exports are all `undefined`. What
 * would NOT be harmless is a CLI command reaching one of those function bodies
 * — `app.getPath(…)` on an undefined `app` throws. None do today, for the
 * reasons noted per entry.
 */
const ELECTRON_IMPORTERS_ON_CLI_GRAPH = [
  // `app.getPath('userData')` for the on-disk embedding cache, behind
  // `app?.isPackaged` — already undefined-safe, and the CLI passes its own
  // `resourcesBase` anyway (run.ts derives it from __dirname).
  'src/main/embeddings/shared-embedder.ts',
  // `app.getPath` for the packaged help corpus, also behind `app?.isPackaged`.
  // Help docs are an in-app search surface; no CLI command exposes them.
  'src/main/help-docs/corpus-store.ts',
  // `app.getPath('userData')` for history-settings.json. Reachable because
  // notebase/fs's write path calls history's capture hooks — but no CLI command
  // writes a note through it: `propose-note` files a pending proposal and
  // approval (the thing that actually writes) is app-only. Flagged as the
  // newest reach-through in #1839; allowlisted rather than patched because the
  // call is ALREADY lazy — it sits inside `settingsPath()`, which only runs
  // when `getHistorySettings()` is called — so there is nothing local left to
  // make lazier. The remaining exposure is shared with the six entries around
  // it, and its fix is the shared user-data-path module, not a bespoke
  // undefined-check here.
  'src/main/history/settings.ts',
  // `app.getPath('userData')` for the model/provider settings file. The CLI
  // runs no LLM calls; `propose-note` takes its content from stdin.
  'src/main/llm/settings.ts',
  // `dialog` for the native project picker. The CLI resolves its root from
  // `--project` / cwd and never opens a picker.
  'src/main/notebase/fs.ts',
  // `app.getPath('userData')` for the recent-projects list — a window-reopening
  // convenience with no CLI equivalent.
  'src/main/recent-projects.ts',
  // `safeStorage` for encrypted secrets (clipper token, API keys). Nothing the
  // read core touches.
  'src/main/secret-storage.ts',
].sort();

/** Import specifiers in a TS source: `from '…'`, bare `import '…'`, `import('…')`. */
/**
 * Every in-repo module transitively reachable from `entry`.
 *
 * Resolved by `dependency-cruiser` (#1850), not by a regex over import lines.
 * The hand-rolled walker this replaces understood relative `.ts` and
 * `/index.ts` specifiers and nothing else — accurate for this repo today, but
 * by luck rather than construction, and it saw three fewer modules than the
 * real resolver does. A graph walker that silently misses edges is the worst
 * shape for a ratchet: it reads as a guarantee while quietly narrowing what it
 * guards.
 */
async function reachableModules(entry: string): Promise<Set<string>> {
  const result = await cruise([path.relative(REPO_ROOT, entry)], {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.d\\.ts$' },
    // Type-only imports count: `import type { X } from './y'` is erased at
    // runtime, but if `y` imports electron then `y` is on the graph.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.mts', '.js', '.mjs'] },
  });
  const modules = (result.output as { modules: IModule[] }).modules ?? [];
  return new Set(
    modules
      .filter((module) => module.source.startsWith('src/'))
      .map((module) => path.join(REPO_ROOT, module.source)),
  );
}

/** Modules on `graph` that import `electron` at all. */
async function electronImporters(entry: string): Promise<string[]> {
  const result = await cruise([path.relative(REPO_ROOT, entry)], {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.d\\.ts$' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.mts', '.js', '.mjs'] },
  });
  const modules = (result.output as { modules: IModule[] }).modules ?? [];
  return modules
    .filter((module) => module.source.startsWith('src/'))
    .filter((module) => (module.dependencies ?? []).some(
      (dependency) => dependency.module === 'electron' || dependency.resolved === 'electron',
    ))
    .map((module) => module.source)
    .sort();
}

describe('CLI import graph — electron reach-through ratchet (#1839)', () => {
  it('reaches the read core it is supposed to reuse', async () => {
    const graph = await reachableModules(CLI_ENTRY);
    // Sanity check on the resolver: if it silently traversed nothing, the
    // assertions below would pass vacuously.
    expect(graph.size).toBeGreaterThan(100);
    expect(graph).toContain(path.join(REPO_ROOT, 'src', 'main', 'notebase', 'fs.ts'));
  }, 60_000);

  it('pins the set of modules that import electron', async () => {
    const found = await electronImporters(CLI_ENTRY);
    // A diff here means the CLI's graph gained (or dropped) an electron
    // importer. Adding one is allowed — but only after checking that no CLI
    // command can reach the Electron call, and saying so in the list above.
    expect(found).toEqual(ELECTRON_IMPORTERS_ON_CLI_GRAPH);
  }, 60_000);

  it('has no electron import in src/cli itself', async () => {
    // Belt to the eslint block's braces: the layer's own code is stub-free too,
    // so `electron-stub.ts` stays the single place that shape is described.
    const importers = await electronImporters(CLI_ENTRY);
    expect(importers.filter((source) => source.startsWith('src/cli/'))).toEqual([]);
    // …and the layer is actually on the graph, so that isn't vacuous.
    const graph = await reachableModules(CLI_ENTRY);
    expect([...graph].some((file) => file.startsWith(path.join(REPO_ROOT, 'src', 'cli')))).toBe(true);
  }, 60_000);
});

describe('built CLI runs under plain Node (#1839)', () => {
  let root: string;

  beforeAll(() => {
    // vite.cli.config.mts sets `emptyOutDir: false`, so a stale `assets/`
    // chunk from a build made before `codeSplitting: false` was added (#1437)
    // would sit there forever and mask the very regression the test below
    // checks for. Start from a clean output dir so that check means something.
    fs.rmSync(path.join(REPO_ROOT, '.vite', 'build'), { recursive: true, force: true });
    // The shipping artifact, built the way `pnpm cli:build` builds it. Vite's
    // JS entry is resolved rather than reached for at `node_modules/.bin` so
    // this works from a git worktree too, where deps resolve upward to the
    // parent checkout's tree.
    const vitePkg = createRequire(import.meta.url).resolve('vite/package.json');
    const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js');
    execFileSync(process.execPath, [viteBin, 'build', '--config', 'vite.cli.config.mts'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-headless-'));
    fs.mkdirSync(path.join(root, 'notes'));
    fs.writeFileSync(
      path.join(root, 'notes', 'photosynthesis.md'),
      '---\ntitle: Photosynthesis\ntags: [biology, energy]\n---\n\n' +
        'Photosynthesis converts light into chemical energy. See [[chlorophyll]].\n',
      'utf-8',
    );
  }, 180_000);

  afterAll(async () => {
    if (root) await fsp.rm(root, { recursive: true, force: true });
  });

  /** Spawn the bundle with THIS process's node binary — vitest runs under plain
   *  Node, so there is no Electron anywhere in the child's environment. */
  function runBundle(args: string[], stdin = ''): { code: number | null; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, [CLI_BUNDLE, ...args, '--project', root], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      input: stdin,
      timeout: 120_000,
    });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('builds a single self-contained cli.js — no split chunks (#1437, #2045)', () => {
    // `codeSplitting: false` in vite.cli.config.mts exists because Rolldown
    // otherwise gives a dynamically-imported dependency (the AWS SDK pulled in
    // for S3 publish was the one that shipped broken) its own chunk under
    // `.vite/build/assets/` — and `copyCliBundle` in forge.config.ts stages
    // ONLY `cli.js` into the packaged app, so a split build produces an
    // installed CLI that crashes on its first dynamic import (#1437), with
    // nothing catching it until someone runs the packaged shim end-to-end.
    // Assert the actual build output rather than re-reading the config flag,
    // since a flag nobody checks the effect of is exactly how #1437 shipped.
    const entries = fs.readdirSync(path.join(REPO_ROOT, '.vite', 'build')).sort();
    expect(entries).toEqual(['cli.js']);
  });

  it('emits no require("electron") into the bundle', () => {
    // The packaged app ships no npm `electron` package, so a surviving require
    // would fail to resolve there (#1437) — and in a dev checkout it would
    // resolve to the binary-path string, quietly reinstating the undefined
    // exports the alias exists to make explicit.
    const bundle = fs.readFileSync(CLI_BUNDLE, 'utf-8');
    expect(bundle).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
  });

  it('answers a SPARQL query with grounded node IRIs and exits 0', () => {
    const r = runBundle(['query', 'PREFIX dc: <http://purl.org/dc/terms/> SELECT ?s ?t WHERE { ?s dc:title ?t }']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { columns: string[]; results: Record<string, string>[] };
    expect(parsed.columns).toContain('s');
    expect(parsed.results.map((row) => row.t)).toContain('Photosynthesis');
    expect(parsed.results.some((row) => (row.s ?? '').includes('/note/notes/photosynthesis'))).toBe(true);
  }, 120_000);

  it('reads a note and exits 0', () => {
    const r = runBundle(['read', 'notes/photosynthesis.md']);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ path: 'notes/photosynthesis.md' });
  }, 120_000);

  it('files a proposal — the only write path — and exits 0', () => {
    // The CLI's write surface, headless. Empty stderr matters as much as the
    // exit code: history's capture hooks and the graph indexer swallow their own
    // errors and only console.error, so a silent Electron failure on this path
    // would show up here as noise on stderr rather than a non-zero exit.
    const r = runBundle(['propose-note', 'notes/chlorophyll.md'], '# Chlorophyll\n\nThe green pigment.\n');
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'pending', relativePath: 'notes/chlorophyll.md' });
    // Still a proposal, not a note: the CLI never writes into the thoughtbase.
    expect(fs.existsSync(path.join(root, 'notes', 'chlorophyll.md'))).toBe(false);
  }, 120_000);

  it('reports a usage error with exit code 2, not a crash', () => {
    const r = runBundle(['query']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('SPARQL string is required');
  }, 120_000);
});
