/**
 * Type-aware bulk property editing (#2431): select three Task notes in the
 * table view (⌘-click each), open "Edit properties", set a date and
 * tick a checkbox — all three notes get correctly typed YAML (`due: 2026-12-01`,
 * `done: true`, neither quoted), and the keys nobody touched keep their exact
 * bytes. A fourth Task, left unselected, is not written at all.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const TITLES = ['Alpha task', 'Beta task', 'Gamma task', 'Delta task'] as const;

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/task.md', [
    '---', 'label: Task', 'id: task', 'icon: ✅', 'properties:',
    '  - name: due', '    type: date', '    label: Due',
    '  - name: done', '    type: boolean', '    label: Done',
    '---', '',
  ].join('\n'));
  for (const [i, title] of TITLES.entries()) {
    write(`tasks/${title}.md`, `---\ntype: task\npriority:   high   # untouched\ndone: "false"\ndue: 2025-0${i + 1}-01\n---\n# ${title}\n`);
  }
}

test('select N typed notes in a table, edit a date and a checkbox: all N get typed YAML (#2431)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-bulk-props-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-bulk-props-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const file = (title: string) => path.join(projectDir, 'tasks', `${title}.md`);
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await test.step('open the Task view as a table', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Task view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Table' }).click();
      await expect(win.locator('.tv-table tbody tr')).toHaveCount(4, { timeout: 15_000 });
    });

    await test.step('select three rows with ⌘-click (which does not open them)', async () => {
      const row = (title: string) => win.locator('.tv-table tbody tr', { hasText: title });
      for (const t of ['Alpha task', 'Beta task', 'Gamma task']) await row(t).click({ modifiers: ['ControlOrMeta'] });
      await expect(win.locator('.tv-table tbody tr.selected')).toHaveCount(3);
    });

    await test.step('edit a date and a checkbox for all three', async () => {
      await win.getByRole('button', { name: 'Edit properties (3)' }).click();
      const dialog = win.getByRole('dialog', { name: 'Edit properties of 3 notes' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Due', { exact: true }).fill('2026-12-01');
      await dialog.getByRole('checkbox', { name: 'Done' }).check();
      await dialog.getByRole('button', { name: 'Apply to 3 notes' }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('all three are written with typed YAML; nothing else changed', async () => {
      for (const title of ['Alpha task', 'Beta task', 'Gamma task']) {
        await expect.poll(() => fs.readFileSync(file(title), 'utf-8'), { timeout: 10_000 })
          .toBe(`---\ntype: task\npriority:   high   # untouched\ndone: true\ndue: 2026-12-01\n---\n# ${title}\n`);
      }
      expect(fs.readFileSync(file('Delta task'), 'utf-8'))
        .toBe('---\ntype: task\npriority:   high   # untouched\ndone: "false"\ndue: 2025-04-01\n---\n# Delta task\n');
    });

    await test.step('the table re-projects the new values', async () => {
      await expect(win.locator('.tv-table tbody tr', { hasText: 'Beta task' })).toContainText('2026-12-01', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
