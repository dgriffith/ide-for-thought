/**
 * End-to-end coverage for #907 (the `:::argument` embed) — proves the whole
 * pipeline holds together in the real app: a note authored the way
 * `find-supporting-arguments.md` already authors one today (a plain note
 * with a `supports: <claim-uri>` frontmatter value) is picked up by the
 * embed's SPARQL traversal and rendered as a real, clickable outline.
 *
 * Boots the in-tree `.vite/build` app, same as the other e2e specs — needs
 * `pnpm build:e2e` first (`pnpm test:e2e` does that).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchMinerva, projectRoot } from './helpers/launch';

async function launchWithProject() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-argmap-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-argmap-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  return { app, userDataDir, projectDir };
}

async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
}

test('argument map: renders a real supports edge as a clickable outline (#907)', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    // The claim — a note is a thought:Claim via an embedded turtle block,
    // same shape `register-conversation-drafts.ts`'s buildClaimNoteContent
    // produces for propose_claims.
    await win.evaluate(async () => {
      await window.api.notebase.writeFile(
        'notes/The Claim.md',
        '---\ntitle: The Claim\n---\n\n# The Claim\n\nSome assertion.\n\n```turtle\nthis: a thought:Claim .\n```\n',
      );
    });

    // Resolve the claim's real graph URI — don't guess the minting scheme.
    const claimUri = await win.evaluate(async () => {
      const res = await window.api.graph.query(
        'SELECT ?claim WHERE { ?claim minerva:relativePath "notes/The Claim.md" }',
      );
      return (res.results as Array<{ claim?: string }>)[0]?.claim ?? null;
    });
    expect(claimUri).toBeTruthy();

    // The grounds — authored exactly the way find-supporting-arguments.md
    // authors one today: a plain note whose frontmatter URI value
    // materializes a thought:supports triple, no dedicated component tool.
    await win.evaluate(async (uri) => {
      await window.api.notebase.writeFile(
        'notes/Cited Evidence.md',
        `---\ntitle: Cited Evidence\nsupports: ${uri}\n---\n\n# Cited Evidence\n\nThe supporting case.\n`,
      );
    }, claimUri);

    // The host note embedding the argument map.
    await win.evaluate(async () => {
      await window.api.notebase.writeFile(
        'notes/Host.md',
        '---\ntitle: Host\n---\n\n# Host\n\n:::argument\n[[The Claim]]\n:::\n',
      );
    });

    await expect(win.locator('[data-relative-path="notes/Host.md"]').first()).toBeVisible({ timeout: 10_000 });
    await win.locator('[data-relative-path="notes/Host.md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });

    await win.getByRole('button', { name: 'Preview', exact: true }).click();

    const outline = win.locator('.argument-map');
    await expect(outline).toBeVisible({ timeout: 10_000 });
    await expect(outline.getByText('The Claim')).toBeVisible();
    await expect(outline.getByRole('heading', { name: 'Support' })).toBeVisible({ timeout: 10_000 });
    await expect(outline.getByRole('button', { name: 'Cited Evidence' })).toBeVisible();

    // Clicking the grounds node navigates to it — the embed isn't just a
    // static rendering, the tree click wiring is real. The group's view mode
    // (Preview, set above) carries over to the newly-opened tab, so check
    // whatever's rendering rather than assuming an editor mounted.
    await outline.getByRole('button', { name: 'Cited Evidence' }).click();
    await expect(win.getByText('The supporting case')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
