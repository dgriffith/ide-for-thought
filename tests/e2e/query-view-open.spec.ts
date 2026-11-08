/**
 * Opening a query as a view (#2948, epic #2936), in the real app: the
 * command "Open Saved Query as View…" picks a saved query and opens it as a
 * `queryFile` view tab — its notes, its header naming the file, which opens
 * the query in the Query panel — and from there the panel's "Open as view"
 * opens the same query inline, with the same rows.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const QUERY = 'SELECT ?note ?due WHERE { ?note minerva:meta-due ?due }';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('tasks/Mow.md', '---\ndue: 2026-11-01\n---\n# Mow the lawn\n');
  write('tasks/Paint.md', '---\ndue: 2026-10-07\n---\n# Paint the shed\n');
  write('.minerva/queries/overdue.rq', `# @name Overdue\n\n${QUERY}\n`);
}

const titles = (win: import('./helpers/test').Page) => win.evaluate(() =>
  Array.from(document.querySelectorAll('.type-view .tv-table tbody tr td:first-child .tv-cell-title-inner > span:last-child')).map((e) => e.textContent.trim()).sort());

test('a saved query opens as a view, its header opens the query, and the panel opens it as a view too (#2948)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-query-open-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-query-open-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const command = (id: string) => app.evaluate(({ BrowserWindow }, cmd) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', cmd); }, id);
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await test.step('Open Saved Query as View… → pick it → a view tab of its notes', async () => {
      // A command sent the moment the window appears can land before the renderer listens for it.
      await expect(win.locator('[data-relative-path="tasks"]').first()).toBeVisible({ timeout: 15_000 });
      await command('query.openSavedAsView');
      await win.getByPlaceholder('Open a saved query as a view…').fill('overdue');
      await win.keyboard.press('Enter');
      await expect(win.locator('.type-view .tv-title')).toHaveText('overdue', { timeout: 15_000 });
      await expect(win.locator('.type-view .tv-table tbody tr')).toHaveCount(2, { timeout: 15_000 });
      expect(await titles(win)).toEqual(['Mow the lawn', 'Paint the shed']);
    });

    await test.step('the header names the file; clicking it opens the query in the Query panel', async () => {
      await win.locator('.type-view .tv-source').getByRole('button', { name: 'overdue.rq' }).click();
      await expect(win.locator('.query-panel .cm-content')).toContainText('minerva:meta-due', { timeout: 10_000 });
    });

    await test.step('the panel runs it, and Open as view opens the same rows as an inline query view', async () => {
      await win.keyboard.press('ControlOrMeta+Enter');
      await expect(win.getByRole('button', { name: 'Open as view' })).toBeVisible({ timeout: 15_000 });
      await win.getByRole('button', { name: 'Open as view' }).click();
      await expect(win.locator('.type-view .tv-source').getByRole('button', { name: 'Inline query' })).toBeVisible({ timeout: 15_000 });
      await expect(win.locator('.type-view .tv-table tbody tr')).toHaveCount(2, { timeout: 15_000 });
      expect(await titles(win)).toEqual(['Mow the lawn', 'Paint the shed']);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
