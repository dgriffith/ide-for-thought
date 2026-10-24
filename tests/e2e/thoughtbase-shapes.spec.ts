/**
 * A thoughtbase's own SHACL shapes, end to end (#2874): `.minerva/shapes/`
 * travels with the thoughtbase, its shape finds what it says in the packaged
 * app, the finding shows in the Inspections panel in the shape's words, and
 * Settings → Inspections lists the check under the thoughtbase — with the
 * file it refused, and why.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const SHAPES = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix types: <https://minerva.dev/ontology/types#> .
@prefix ex: <https://example.org/my-thoughtbase#> .
ex:BooksNeedAnAuthor a sh:NodeShape ; sh:targetClass types:Book ;
  sh:name "Books without an author" ; sh:description "Every book should say who wrote it." ;
  sh:severity sh:Warning ; sh:message "\\"{$this}\\" has no author" ;
  sh:property [ sh:path <http://purl.org/dc/terms/creator> ; sh:minCount 1 ] .
`;

test("a thoughtbase's own shape finds what it says, and Settings lists it (#2874)", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tb-shapes-userdata-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tb-shapes-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Walden.md'), '---\ntitle: Walden\ntype: book\n---\n# Walden\n');
  fs.writeFileSync(path.join(dir, 'Meditations.md'), '---\ntitle: Meditations\ntype: book\nauthor: Marcus Aurelius\n---\n# Meditations\n');
  fs.mkdirSync(path.join(dir, '.minerva', 'shapes'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.minerva', 'shapes', 'books.ttl'), SHAPES);
  fs.writeFileSync(path.join(dir, '.minerva', 'shapes', 'writer.ttl'), '@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <https://example.org/x#> .\nex:W a sh:NodeShape ; sh:targetNode ex:a ; sh:sparql [ sh:select "INSERT DATA { <a:b> <a:c> 1 }" ] .\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: dir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const panel = win.locator('.inspections-panel');
    const finding = panel.locator('.inspection-item', { hasText: '"Walden" has no author' });

    await test.step("the book with no author is a finding, in the shape's words", async () => {
      await win.locator('[data-relative-path="Walden.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.toggleRightSidebar'); });
      await win.locator('.right-sidebar .group-tab', { hasText: 'Activity' }).click();
      await win.locator('.right-sidebar .sub-tab', { hasText: 'Inspections' }).click();
      await expect.poll(async () => {
        if (await finding.count() > 0) return true;
        await panel.locator('.refresh-btn').click();
        return false;
      }, { timeout: 20_000, intervals: [1000] }).toBe(true);
    });

    await test.step('Settings lists it under the thoughtbase, with the file it refused', async () => {
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Inspections$/ }) }).click();
      await expect(settings.getByRole('checkbox', { name: 'Books without an author' })).toBeChecked({ timeout: 10_000 });
      await expect(settings.getByText('From this thoughtbase')).toBeVisible();
      await expect(settings.getByText(/writer\.ttl.*a sh:select must be a SELECT query/)).toBeVisible();
    });
  } finally {
    await closeMinerva(app);
  }
});
