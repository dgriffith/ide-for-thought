/**
 * The whole thoughtbase as a graph (#2958): opened from the View menu's
 * command, it draws every note; a folder filter narrows it; "Show in Graph"
 * on a note centres it there at depth 1; the List shows the same notes as
 * text; and the tab keeps its filters and focus while another tab is shown.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

test('the graph of the thoughtbase: open, filter, focus on a note, list, kept with its tab (#2958)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tb-graph-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tb-graph-project-'));
  // A small thoughtbase of its own, so the counts are known.
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), content);
  };
  write('trip/Prague.md', '# Prague\n\nSee [[Kampa]] and [[Plan]].\n');
  write('trip/Kampa.md', '# Kampa\n');
  write('Plan.md', '# Plan\n\nThe [[Budget]].\n');
  write('Budget.md', '# Budget\n');
  write('Lonely.md', '# Lonely\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="trip"]').first()).toBeVisible({ timeout: 10_000 });
    const graph = win.locator('.tb-graph');
    const count = graph.locator('.count');

    await test.step('Open Graph draws every note', async () => {
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.openGraph'); });
      await expect(win.locator('.tab.active')).toContainText('Graph', { timeout: 10_000 });
      await expect(count).toHaveText(/^5 of 5 nodes, 3 connections$/, { timeout: 15_000 });
      await expect(graph.locator('.canvas canvas').first()).toBeVisible();
      await win.waitForTimeout(1500); // let the layout settle, for the picture only
      await graph.screenshot({ path: 'test-results/thoughtbase-graph.png' });
    });

    await test.step('a folder narrows it; hiding orphans drops Lonely', async () => {
      await graph.getByLabel('Folder').selectOption('trip');
      await expect(count).toHaveText(/^2 of 5 nodes, 1 connections$/);
      await graph.getByLabel('Folder').selectOption('');
      await graph.getByLabel('Hide orphans').check();
      await expect(count).toHaveText(/^4 of 5 nodes, 3 connections$/);
    });

    await test.step('the List shows the same notes as text, each with its connections', async () => {
      await graph.getByRole('button', { name: 'List' }).click();
      const list = graph.getByRole('list', { name: 'Notes in the graph' });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      const plan = list.getByRole('listitem').filter({ has: win.getByRole('button', { name: 'Plan', exact: true }) });
      await expect(plan).toContainText('References ← Prague');
      await expect(plan).toContainText('References → Budget');
      await graph.getByRole('button', { name: 'List' }).click();
    });

    await test.step('Show in Graph on a note centres the graph on it, one step out', async () => {
      await win.locator('[data-relative-path="Plan.md"]').first().click({ button: 'right' });
      await win.getByRole('button', { name: 'Show in Graph' }).click();
      await expect(graph.locator('.focus')).toContainText('Around Plan');
      await expect(count).toHaveText(/^3 of 5 nodes, 2 connections$/); // Plan, Prague, Budget
    });

    await test.step('the tab keeps its filters and focus while another tab is shown', async () => {
      await win.locator('[data-relative-path="Budget.md"]').first().click();
      await expect(graph).toHaveCount(0);
      await win.locator('.tab', { hasText: 'Graph' }).first().click();
      await expect(graph.locator('.focus')).toContainText('Around Plan');
      await expect(graph.getByLabel('Hide orphans')).toBeChecked();
      await expect(count).toHaveText(/^3 of 5 nodes, 2 connections$/, { timeout: 15_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
