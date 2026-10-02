/**
 * An approved AI move updates open tabs the way a user rename does (#2541).
 *
 * Proposal applies mark their paths handled, so the watcher reports a moved
 * note's old path as a delete — and nothing told the window about the move, so
 * its tab closed instead of following, and an open referrer kept its stale
 * link text. Now every approve broadcasts the move and the rewrites.
 *
 * Files the proposals through the e2e hook and approves them through
 * `api.proposals.approve` — the channel the Proposals panel uses.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot, seedProposal } from './helpers/launch';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('Moving Note.md', '# Moving Note\n\nThis note gets moved.\n');
  write('Referrer.md', '# Referrer\n\nSee [[Moving Note]].\n');
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '---', ''].join('\n'));
  write('trip/Kampa.md', '---\ntype: place\ncity: Prague\n---\n# Kampa\n');
}

async function approve(win: Page, uri: string): Promise<void> {
  const res = await win.evaluate((u) => (window as unknown as { api: { proposals: { approve(u: string): Promise<{ ok: boolean }> } } }).api.proposals.approve(u), uri);
  expect(res.ok).toBe(true);
}

/** Every open tab's label, across groups. */
const tabTitles = (win: Page) => win.locator('.tab').allTextContents().then((ts) => ts.map((t) => t.replace(/\s+/g, ' ').trim()));

test('approving an AI note move or folder move moves the open tabs with it (#2541)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approved-move-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approved-move-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await test.step('open the note to be moved, and a note that links to it', async () => {
      await win.locator('[data-relative-path="Referrer.md"]').first().click();
      await win.locator('[data-relative-path="Moving Note.md"]').first().click();
      await expect(win.locator('.tab.active')).toContainText('Moving Note');
    });

    await test.step('approve a move of it into a folder: the tab follows, the referrer reloads', async () => {
      const uri = await seedProposal(app, {
        operationType: 'note_refactor',
        payloads: [{ kind: 'note-refactor', fromPath: 'Moving Note.md', toPath: 'archive/Moving Note.md' }],
        note: 'e2e move', proposedBy: 'e2e',
      });
      await approve(win, uri!);
      await expect.poll(() => fs.existsSync(path.join(projectDir, 'archive/Moving Note.md'))).toBe(true);
      // Still open — the tab followed rather than closing (give the watcher's
      // delete time to arrive and fail to close it).
      await win.waitForTimeout(1500);
      expect((await tabTitles(win)).filter((t) => t.includes('Moving Note'))).toHaveLength(1);
      await expect(win.locator('.tab.active')).toContainText('Moving Note');
      await expect(win.locator('.cm-content')).toContainText('This note gets moved.');
      // The referrer's open tab shows the rewritten link, not its stale text.
      await win.locator('.tab', { hasText: 'Referrer' }).first().click();
      await expect(win.locator('.cm-content')).toContainText('[[archive/Moving Note]]', { timeout: 10_000 });
    });

    await test.step('approve a folder move: a view scoped to it follows', async () => {
      await win.locator('[data-relative-path="trip"]').first().click({ button: 'right' });
      const trigger = win.getByRole('button', { name: 'View Objects' });
      await trigger.focus();
      await win.getByRole('menu', { name: 'View objects in trip' }).getByRole('menuitem', { name: /Place/ }).click();
      await expect(win.locator('.tab.active')).toContainText('Place · trip', { timeout: 10_000 });

      const uri = await seedProposal(app, {
        operationType: 'note_refactor',
        payloads: [{ kind: 'folder-refactor', fromPath: 'trip', toPath: 'travel' }],
        note: 'e2e folder move', proposedBy: 'e2e',
      });
      await approve(win, uri!);
      await expect(win.locator('.tab', { hasText: 'Place · travel' })).toHaveCount(1, { timeout: 10_000 });
      await expect(win.locator('.tv-table tbody tr, .tv-list-title').first()).toContainText('Kampa', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
