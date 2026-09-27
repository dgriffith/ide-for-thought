/**
 * Proposal review driven through the UI (#2355).
 *
 * `happy-paths.spec.ts`'s approve flow seeds a proposal and then calls
 * `window.api.proposals.approve` directly — it proves the IPC → approval
 * engine → graph pipeline, but nothing ever clicked the button a user clicks.
 * A regression in `ProposalsPanel.svelte` (the button wired to the wrong
 * handler, a disabled state that never clears, a store that never refreshes)
 * would leave every other e2e green. These two tests close that gap:
 *
 *   - Approve: open the Proposals panel, expand the seeded proposal, click
 *     Approve, then assert the payload landed in the graph AND the proposal is
 *     `approved` — in the graph and in the panel's status filters.
 *   - Reject: the same, clicking Reject, asserting the payload did NOT land and
 *     the proposal is `rejected` / no longer pending.
 *
 * The proposal is SEEDED through the `MINERVA_E2E` main-process hook
 * (`src/main/e2e-hooks.ts`), because a live LLM conversation isn't
 * CI-deterministic. That's the only non-UI step that changes state; the
 * decision itself is a click. There is deliberately no `window.api.proposals.*`
 * call in this file — outcome checks read the graph through
 * `window.api.graph.query` (a read) and the panel's own rendering.
 *
 * Boots the in-tree `.vite/build` app, so it needs `pnpm build:e2e` first
 * (`pnpm test:e2e` does that).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchMinerva, projectRoot } from './helpers/launch';

// `window.api` is used inside `win.evaluate` — the renderer's global typing
// isn't in this spec's scope, so calls are validated at runtime, not by tsc.

/** Mirrors `E2E_CLAIM_LABEL` in src/main/e2e-hooks.ts — the triple the seeded
 *  proposal adds when (and only when) it is approved. */
const CLAIM_LABEL = 'E2E Approved Claim';
/** The seeded proposal's `note`, which the panel renders on its card. */
const PROPOSAL_NOTE = 'e2e seeded proposal';

const CLAIM_QUERY =
  `SELECT ?c WHERE { ?c <https://minerva.dev/ontology/thought#label> "${CLAIM_LABEL}" }`;

function statusQuery(uri: string, status: 'pending' | 'approved' | 'rejected'): string {
  return `SELECT ?p WHERE { <${uri}> thought:proposalStatus thought:${status} . BIND(<${uri}> AS ?p) }`;
}

async function launchWithProject() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-review-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-review-project-'));
  // Copy the fixture so the run can't dirty the tracked one.
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  return { app, userDataDir, projectDir };
}

async function graphRowCount(win: Page, sparql: string): Promise<number> {
  const res = await win.evaluate((q) => window.api.graph.query(q), sparql);
  if (res.error) throw new Error(`SPARQL failed: ${res.error}\n${sparql}`);
  return res.results.length;
}

/**
 * Boot, wait for the workspace, seed ONE pending proposal, and open the
 * Proposals panel with that proposal's review detail expanded. Returns the
 * proposal URI and a locator for its card.
 */
async function openSeededProposal(app: ElectronApplication, win: Page) {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

  // Seed through the main-process hook (stands in for the LLM conversation).
  const uri = await app.evaluate(async () => {
    const g = globalThis as typeof globalThis & { __minervaE2E?: { seedProposal(): Promise<string | null> } };
    if (!g.__minervaE2E) throw new Error('e2e hook missing — MINERVA_E2E not set?');
    return g.__minervaE2E.seedProposal();
  });
  expect(uri, 'seedProposal returned no uri').toBeTruthy();

  // Precondition — the gate holds: pending, and its payload not yet applied.
  expect(await graphRowCount(win, statusQuery(uri!, 'pending')), 'seeded proposal should be pending').toBe(1);
  expect(await graphRowCount(win, CLAIM_QUERY), 'claim must be absent before review').toBe(0);

  // The Proposals panel lives in the left sidebar (#1526) behind its panel tab.
  await win.getByTitle('Proposals', { exact: true }).click();

  // Narrow to the review queue, so the card we act on is provably pending.
  const panel = win.locator('.proposals-panel');
  await panel.getByRole('tab', { name: 'Pending', exact: true }).click();
  const card = panel.getByRole('button', { name: new RegExp(PROPOSAL_NOTE) });
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  await expect(card).toContainText('pending');

  // Expand the review detail (payload list + Approve / Reject).
  await card.click();
  await expect(panel.locator('.proposal-detail')).toBeVisible();

  return { uri: uri!, card, panel };
}

async function withApp(body: (app: ElectronApplication, win: Page) => Promise<void>): Promise<void> {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await body(app, win);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

test('proposal review: clicking Approve applies the payload and marks the proposal approved', async () => {
  await withApp(async (app, win) => {
    const { uri, card, panel } = await openSeededProposal(app, win);

    await panel.getByRole('button', { name: 'Approve (y)', exact: true }).click();

    // The panel reports what landed — this banner renders only after
    // `review.approveProposal` resolved `true`.
    await expect(panel.getByRole('status')).toContainText('Approved — landed');

    // Graph effect: the payload's claim triple is now present…
    await expect.poll(() => graphRowCount(win, CLAIM_QUERY), {
      message: 'claim should be present after approving through the UI',
    }).toBeGreaterThan(0);
    // …and the proposal itself is recorded as approved (no longer pending).
    await expect.poll(() => graphRowCount(win, statusQuery(uri, 'approved'))).toBe(1);
    expect(await graphRowCount(win, statusQuery(uri, 'pending'))).toBe(0);

    // UI effect: it has left the Pending queue…
    await expect(card).toHaveCount(0);
    // …and shows up under Approved with an approved status pill.
    await panel.getByRole('tab', { name: 'Approved', exact: true }).click();
    await expect(card).toHaveCount(1);
    await expect(card.locator('.proposal-status')).toHaveText('approved');
  });
});

test('proposal review: clicking Reject leaves the graph untouched and marks the proposal rejected', async () => {
  await withApp(async (app, win) => {
    const { uri, card, panel } = await openSeededProposal(app, win);

    await panel.getByRole('button', { name: 'Reject (n)', exact: true }).click();

    // Status first: once the graph says rejected, the reject call has fully
    // resolved, so the "claim absent" check below is not racing the click.
    await expect.poll(() => graphRowCount(win, statusQuery(uri, 'rejected')), {
      message: 'proposal should be rejected after clicking Reject',
    }).toBe(1);
    expect(await graphRowCount(win, statusQuery(uri, 'pending'))).toBe(0);

    // No graph effect: the payload's claim never landed.
    expect(await graphRowCount(win, CLAIM_QUERY), 'rejected payload must not be applied').toBe(0);

    // UI effect: gone from the Pending queue, present under Rejected.
    await expect(card).toHaveCount(0);
    await panel.getByRole('tab', { name: 'Rejected', exact: true }).click();
    await expect(card).toHaveCount(1);
    await expect(card.locator('.proposal-status')).toHaveText('rejected');
  });
});
