/**
 * Semantic search works in the PACKAGED app (#2293).
 *
 * Embeddings had no e2e coverage at all, and that gap was the blocker on
 * #2243's Phase 2 rather than anything about packaging. The local embedder
 * runs `onnxruntime-web` against a `.wasm` copied in by `forge.config.ts`'s
 * `afterPrune` hook, so the failure mode is exactly the one the DuckDB test
 * beside this exists to catch: fine in `pnpm dev`, fine in `pnpm test`, dead
 * in the shipped artifact, discovered by a user.
 *
 * `onnxruntime-web` ships four mutually-exclusive WASM builds and exactly one
 * runs. Pruning the other three takes 66 MB off the unpacked app and 16 MB off
 * the auto-update payload every user downloads for every release — but "which
 * one is live" is a runtime capability decision, not a static reference, so
 * the only honest verification is to run it. This test is that verification,
 * and it is what makes the prune safe to keep.
 *
 * ── Why this exercises the WASM rather than skirting it ─────────────────────
 * `EMBEDDINGS_SEARCH_TEXT` → `vectors.searchRelated`, which embeds the query
 * on its first statement (`vector-store.ts:220`) *before* it looks at the
 * corpus. So a non-empty query always reaches the model, even against an empty
 * vector table, and a broken WASM rejects the IPC call rather than quietly
 * returning no hits.
 *
 * The one thing this must not do is pass vacuously. `searchText` answers
 * `{ enabled: false }` without touching the embedder when the vector store
 * isn't open — which is exactly what a run against an unopened project would
 * see. So the test asserts `enabled === true` and fails loudly on `false`,
 * rather than treating an empty result as success.
 */

import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { launchMinerva, makeTempDir, seedSession, projectRoot } from './helpers/launch';

/** Path to the packaged app binary, or null if it hasn't been built. */
function packagedBinary(): string | null {
  if (process.platform !== 'darwin') return null; // only darwin .app layout handled
  const p = path.join(
    projectRoot,
    'out',
    `Minerva-${process.platform}-${process.arch}`,
    'Minerva.app',
    'Contents',
    'MacOS',
    'Minerva',
  );
  return fs.existsSync(p) ? p : null;
}

interface SearchOutcome {
  ok: boolean;
  enabled?: boolean;
  count?: number;
  error?: string;
}

test('packaged app runs the local embedder (ORT WASM shipped)', async () => {
  test.slow(); // model load + first inference is seconds, not milliseconds
  const appBinary = packagedBinary();
  test.skip(appBinary === null, 'packaged app not built — run `pnpm build:e2e` first');

  const userDataDir = makeTempDir('minerva-e2e-userdata-');
  const projectDir = makeTempDir('minerva-e2e-project-');
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedSession(userDataDir, projectDir);

  const mainOut: string[] = [];
  const app = await launchMinerva({ userDataDir, executablePath: appBinary as string });
  app.process().stderr?.on('data', (chunk: Buffer) => mainOut.push(chunk.toString()));
  app.process().stdout?.on('data', (chunk: Buffer) => mainOut.push(chunk.toString()));

  let outcome: SearchOutcome;
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    // The vector store is opened by `acquireProject`, so the project has to be
    // restored before a search can do anything but answer `enabled: false`.
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' }))
      .toHaveCount(0, { timeout: 25_000 });

    outcome = await win.evaluate(async () => {
      // Full stack on purpose: renderer → preload bridge → IPC → main →
      // embedder-service → worker thread → onnxruntime-web → the .wasm.
      // Anything short of this can't tell a shipped WASM from a missing one.
      const api = (window as unknown as {
        api: { embeddings: { searchText(q: string, o?: { limit?: number }): Promise<{ enabled: boolean; notes: unknown[] }> } };
      }).api;
      try {
        const result = await api.embeddings.searchText('structured reasoning about claims', { limit: 5 });
        return { ok: true, enabled: result.enabled, count: result.notes.length };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  const out = mainOut.join('');

  // A WASM that didn't ship, or the wrong one, surfaces here first and with the
  // most readable message — ORT reports a fetch/instantiate failure by path.
  expect(
    /no available backend|failed to (load|fetch|instantiate)|ort-wasm.*\.wasm|cannot find module 'onnxruntime/i.test(out),
    `the ONNX runtime failed to load in the packaged app:\n${out}`,
  ).toBe(false);

  expect(outcome.ok, `semantic search threw in the packaged app: ${outcome.error}\n${out}`).toBe(true);
  // The assertion that stops this passing vacuously: `enabled: false` is the
  // answer when the embedder was never reached, and it is indistinguishable
  // from "no results" if you only check that the call resolved.
  expect(
    outcome.enabled,
    'searchText returned enabled:false — the vector store was not open, so the embedder never ran and this test proved nothing',
  ).toBe(true);
});
