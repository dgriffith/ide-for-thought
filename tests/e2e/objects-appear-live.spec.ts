/**
 * New objects show up in an open view without an edit or a restart (#2742).
 *
 * The reported path: create an object type, then several objects of it — and
 * no view showed them until the app was restarted. Views re-project on the
 * graph revision, which only an editor save used to move; creating a note
 * isn't one, and an ```object-view embed keeps its mount across re-renders
 * (#2323), so it stayed on its first, empty answer. Main now broadcasts
 * `graph:changed` after any write.
 *
 * The type and the objects go through the same IPC the Type editor and New
 * Note use, with no editor save in between — and nothing in the note is
 * touched, so the preview never re-renders on its own.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

type Api = {
  types: { save(input: { label: string; properties: unknown[] }): Promise<{ id: string }> };
  notebase: { writeFile(rel: string, content: string): Promise<void> };
};

test('objects of a type created mid-session appear in an open view (#2742)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-objects-live-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-objects-live-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'Gadgets.md'), '# Gadgets\n\n```object-view\n{"typeId":"gadget","layout":"list"}\n```\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    const row = win.locator('[data-relative-path="Gadgets.md"]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.click();
    await win.getByRole('button', { name: 'Preview', exact: true }).click();
    const embed = win.locator('.preview .object-view-block').first();
    await expect(embed).toHaveAttribute('data-object-view-rendered', /.+/, { timeout: 10_000 });

    await test.step('create the type, then two objects of it — no editor save', async () => {
      const id = await win.evaluate(async () => (await (window as unknown as { api: Api }).api.types.save({ label: 'Gadget', properties: [] })).id);
      expect(id).toBe('gadget');
      await win.evaluate(async () => {
        const { api } = window as unknown as { api: Api };
        await api.notebase.writeFile('Sprocket.md', '---\ntype: gadget\n---\n# Sprocket\n');
        await api.notebase.writeFile('Flange.md', '---\ntype: gadget\n---\n# Flange\n');
      });
    });

    await test.step('the open view shows them', async () => {
      await expect(embed).toContainText('Sprocket', { timeout: 10_000 });
      await expect(embed).toContainText('Flange');
    });

    await test.step('a third, written outside the app, shows up too', async () => {
      fs.writeFileSync(path.join(projectDir, 'Grommet.md'), '---\ntype: gadget\n---\n# Grommet\n');
      await expect(embed).toContainText('Grommet', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
