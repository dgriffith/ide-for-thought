/**
 * *Link attendees* (#2612): a Meeting note written before Meeting became an
 * Event subtype holds its attendees as plain names. They show as text in the
 * Properties panel; *Link attendees* asks once — naming who gets linked and
 * who stays text — and rewrites just this note's `attendees`, turning the
 * names that match a Person (by filename or alias) into links. The note is
 * CRLF on disk and stays CRLF.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const crlf = (lines: string[]) => lines.join('\r\n');

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('people/Ada Lovelace.md', '---\ntype: person\n---\n# Ada Lovelace\n');
  write('people/grace.md', '---\ntitle: Grace\ntype: person\naliases: [Grace Hopper]\n---\n# Grace\n');
  write('Weekly sync.md', crlf([
    '---', 'type: meeting', 'date: 2026-10-01', 'attendees: Ada Lovelace, Grace Hopper, Zed Unknown', '---', '', '## Agenda', '',
  ]));
}

test('Link attendees links the names that match a Person, after one confirm (#2612)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-attendees-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-attendees-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const note = path.join(projectDir, 'Weekly sync.md');
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const panel = win.locator('.properties-panel');

    await test.step('open the meeting and its Properties panel', async () => {
      await win.locator('[data-relative-path="Weekly sync.md"]').first().click();
      await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
      await win.getByTitle('Toggle Right Sidebar (Cmd+Shift+B)').first().click();
      await win.locator('.right-sidebar .group-tab[title="Note"]').click();
      await win.locator('.right-sidebar .sub-tab[title="Properties"]').click();
      await expect(panel.locator('.type-head')).toContainText('Meeting', { timeout: 15_000 });
    });

    await test.step('the plain names show as text, with the action offered', async () => {
      await expect.poll(() => panel.locator('.declared input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), { timeout: 10_000 })
        .toContain('Ada Lovelace, Grace Hopper, Zed Unknown');
      await expect(panel.locator('.wiki-chip')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Link attendees' })).toBeVisible({ timeout: 10_000 });
    });

    await test.step('one confirm names what changes', async () => {
      await panel.getByRole('button', { name: 'Link attendees' }).click();
      const dialog = win.getByRole('dialog');
      await expect(dialog).toContainText('Link Ada Lovelace and Grace Hopper to their Person notes? Zed Unknown stays as text.');
      await dialog.getByRole('button', { name: /^Link/ }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('the note is rewritten on disk — links for the matches, CRLF kept', async () => {
      await expect.poll(() => fs.readFileSync(note, 'utf-8'), { timeout: 10_000 }).toBe(crlf([
        '---', 'type: meeting', 'date: 2026-10-01', 'attendees:',
        '  - "[[Ada Lovelace]]"', '  - "[[Grace Hopper]]"', '  - Zed Unknown',
        '---', '', '## Agenda', '',
      ]));
    });

    await test.step('the panel now shows the links, and no longer offers the action', async () => {
      await expect(panel.getByText('[[Ada Lovelace]]', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(panel.getByText('Zed Unknown', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Link attendees' })).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
