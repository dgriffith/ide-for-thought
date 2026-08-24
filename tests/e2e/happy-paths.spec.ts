/**
 * Two core happy-path e2e flows (#998), each assembled end-to-end through the
 * real Electron app + preload/IPC bridge + main-process pipeline:
 *
 *   1. write a note → it reindexes → a SPARQL query returns it.
 *   2. a pending proposal → approve it → the graph reflects the applied mutation.
 *
 * Driven through `window.api` (the exact bridge the UI calls) rather than
 * simulating CodeMirror keystrokes / panel clicks — those are brittle and just
 * re-test what the component suite already covers, whereas these assert the full
 * IPC → main → graph pipeline holds together. Flow 2's proposal is seeded via
 * the `MINERVA_E2E` main-process hook (see `src/main/e2e-hooks.ts`) because a
 * live LLM conversation isn't CI-deterministic; the approve→graph half — the
 * safety-critical part — runs for real.
 *
 * Boots the in-tree `.vite/build` app (like smoke.spec.ts), so it needs
 * `pnpm build:e2e` first (the `pnpm test:e2e` script does that).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchMinerva, projectRoot } from './helpers/launch';


// These flows call `window.api` (the preload bridge) inside `win.evaluate` —
// the renderer's global typing isn't in this spec's scope, so `window` reads as
// `any` here and the `.api.*` calls are validated at runtime, not by tsc.

async function launchWithProject() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-happy-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-happy-project-'));
  // Copy the fixture so the run can't dirty the tracked one.
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({
    userDataDir,
    env: { MINERVA_E2E: '1' },
  });
  return { app, userDataDir, projectDir };
}

/** Wait until the workspace has replaced the welcome screen (project open). */
async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
}

test('flow: write a note → reindex → SPARQL query returns it', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    const marker = 'E2E Flow Marker Note';
    const rel = 'notes/e2e-flow.md';

    // Save through the real notebase IPC. writeAndReindex indexes the note
    // synchronously, so the graph reflects it the moment this resolves.
    await win.evaluate(async ([relPath, title]) => {
      await window.api.notebase.writeFile(relPath, `---\ntitle: ${title}\n---\n\nbody\n`);
    }, [rel, marker] as const);

    // The marquee assertion: a SPARQL query returns the freshly-saved note.
    const res = await win.evaluate((title) =>
      window.api.graph.query(
        `SELECT ?title WHERE { ?note rdf:type minerva:Note ; dc:title ?title . FILTER(CONTAINS(STR(?title), "${title}")) }`,
      ), marker);

    expect(res.error, res.error).toBeFalsy();
    const titles = (res.results as Array<{ title?: string }>).map((r) => r.title);
    expect(titles).toContain(marker);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('flow: pending proposal → approve → graph reflects the mutation', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    const claimQuery =
      `SELECT ?c WHERE { ?c <https://minerva.dev/ontology/thought#label> "E2E Approved Claim" }`;

    // Seed a pending proposal via the main-process e2e hook (stands in for the
    // LLM conversation). requires_approval ⇒ its payload is NOT applied yet.
    const uri = await app.evaluate(async () => {
      const g = globalThis as typeof globalThis & { __minervaE2E?: { seedProposal(): Promise<string | null> } };
      if (!g.__minervaE2E) throw new Error('e2e hook missing — MINERVA_E2E not set?');
      return g.__minervaE2E.seedProposal();
    });
    expect(uri, 'seedProposal returned no uri').toBeTruthy();

    // Before approval the claim triple must be absent (the gate holds).
    const before = await win.evaluate((q) => window.api.graph.query(q), claimQuery);
    expect(before.results.length, 'claim should be absent before approval').toBe(0);

    // Approve through the normal proposals IPC — exactly what the Proposals
    // panel's approve button calls.
    const ok = await win.evaluate((u) => window.api.proposals.approve(u), uri as string);
    expect(ok, 'approve returned false').toBe(true);

    // After approval the applied mutation is reflected in the graph.
    const after = await win.evaluate((q) => window.api.graph.query(q), claimQuery);
    expect(after.results.length, 'claim should be present after approval').toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
