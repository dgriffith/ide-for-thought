/**
 * A plugin the assistant drafted, end to end (#2890): filed as a
 * `plugin_install` proposal (seeded through the main-process hook, standing
 * in for the conversation), nothing is installed until it's approved; the
 * review shows what it can do and every file; approving it in the Proposals
 * panel installs it, recorded as a draft.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, isolatedHome, launchMinerva, projectRoot, seedProposal } from './helpers/launch';

const SKILL = '---\nid: weekly-lab.weekly\nname: Weekly Review\ndescription: Review the week\nmenu: Analysis\noutputMode: openConversation\n---\nHelp me review my week.\n';
const MANIFEST = JSON.stringify({ id: 'weekly-lab', name: 'Weekly Lab', version: '0.1.0', minerva: '>=3.0.0', description: 'A weekly review.', contributes: { skills: ['skills/w.md'] } });

test('a drafted plugin is a proposal: reviewed, then installed only when approved (#2890)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-proposal-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-proposal-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]));
  const installed = path.join(isolatedHome(userDataDir), '.minerva', 'plugins', 'weekly-lab');
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    // The thoughtbase open, not just the welcome screen gone.
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 15_000 });
    const panel = win.locator('.proposals-panel');
    const card = panel.getByRole('button', { name: /Install the Weekly Lab plugin/ });

    await test.step('filed pending, and nothing is installed', async () => {
      const uri = await seedProposal(app, {
        operationType: 'plugin_install',
        payloads: [{ kind: 'plugin-install', id: 'weekly-lab', name: 'Weekly Lab', files: [{ path: 'plugin.json', content: MANIFEST }, { path: 'skills/w.md', content: SKILL }] }],
        note: 'Install the Weekly Lab plugin: A weekly review.',
        proposedBy: 'llm:conversation:e2e',
      });
      expect(uri).toBeTruthy();
      expect(fs.existsSync(installed)).toBe(false);
    });

    await test.step('the review shows what it can do and every file', async () => {
      await win.getByTitle('Proposals', { exact: true }).click();
      await panel.getByRole('tab', { name: 'Pending', exact: true }).click();
      await expect(card).toHaveCount(1, { timeout: 10_000 });
      await expect(card).toContainText('plugin install');
      await card.click();
      await panel.locator('.payload-row', { hasText: 'install Weekly Lab (weekly-lab), 2 files' }).click();
      const preview = panel.locator('.payload-preview');
      await expect(preview).toContainText('Weekly Lab 0.1.0: A weekly review.');
      await expect(preview).toContainText('It runs no code.');
      await expect(preview).toContainText('── skills/w.md ──');
      await expect(preview).toContainText('Help me review my week.');
    });

    await test.step('approving installs it, recorded as a draft', async () => {
      await panel.getByRole('button', { name: 'Approve (y)', exact: true }).click();
      await expect.poll(() => fs.existsSync(path.join(installed, 'plugin.json')), { timeout: 10_000 }).toBe(true);
      expect(fs.readFileSync(path.join(installed, 'skills', 'w.md'), 'utf8')).toBe(SKILL);
      const records = JSON.parse(fs.readFileSync(path.join(isolatedHome(userDataDir), '.minerva', 'plugins.json'), 'utf8'));
      expect(records.plugins['weekly-lab']).toMatchObject({ enabled: true, source: { kind: 'draft' } });
      await expect(card).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
