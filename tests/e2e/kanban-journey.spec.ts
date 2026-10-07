/**
 * The Kanban journey (#2605, epic #2600), end to end in one flow: open
 * Projects as a board, move one card with the pointer and another with the
 * keyboard alone (checking the file after each), save the board as a note
 * (checking its `object-view` fence), and export that note through the real
 * `publish.runExport`.
 *
 * The pieces each have their own spec — `kanban-board`, `kanban-move-card`,
 * `kanban-column-order` — and this one checks they add up: a board arranged
 * and used in its tab is the board that lands in a note and an export.
 *
 * The thoughtbase overrides the stock Project type with a second enum,
 * `priority`. With one enum the board's grouping is implied and Save as note
 * writes no `groupBy` (#2601); with two the Group by picker appears and the
 * choice is saved, which is what this checks.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { dragCardToColumn, openProjectBoard, projectNote, seedProjects, type SeedProject } from './helpers/kanban';

const PROJECTS: SeedProject[] = [
  ['Garden Shed', 'active'],
  ['Novel Draft', 'active'],
  ['Tax Return', 'done'],
  ['Pottery Class', 'paused'],
  ['Someday Boat', null],
];

/** The stock Project type (`src/main/types/stock/project.md`) plus a `priority` enum. */
const PROJECT_TYPE = [
  '---', 'label: Project', 'id: project', 'icon: 🚀', 'properties:',
  '  - name: status', '    type: enum', '    options: [active, paused, done, abandoned]',
  '  - name: priority', '    type: enum', '    options: [low, medium, high]',
  '  - name: started', '    type: date',
  '  - name: owner', '    type: link-to-type', '    targetType: person',
  '---', '',
].join('\n');

test('the Kanban journey: a Project board, a card moved by pointer and by keyboard, saved as a note, exported (#2605)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-journey-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-journey-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-journey-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.minerva', 'types'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.minerva', 'types', 'project.md'), PROJECT_TYPE);
  const fileOf = seedProjects(projectDir, PROJECTS);
  const statusOf = (title: string) => /^status: (.*)$/m.exec(fs.readFileSync(fileOf(title), 'utf8'))?.[1];
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    const kb = await test.step('open Projects as a board: columns by status', async () => {
      const b = await openProjectBoard(win, PROJECTS.length);
      await expect(b.board.locator('.kb-col-label')).toHaveText(['active', 'paused', 'done', 'abandoned', 'No value']);
      await expect(b.board.locator('.kb-col-count')).toHaveText(['2', '1', '1', '0', '1']);
      await recordAnnouncements(win);
      return b;
    });
    const { board, cardFor, inColumn } = kb;

    await test.step('pointer: drag Garden Shed from active onto done, and the file says so', async () => {
      await dragCardToColumn(win, kb, 'Garden Shed', 'done', async () => {
        await expect(board.locator('section.kb-column[data-drop-target]')).toHaveAttribute('data-column-value', 'done');
      });
      await expect.poll(() => statusOf('Garden Shed'), { timeout: 10_000 }).toBe('done');
      // One field changed, nothing else.
      expect(fs.readFileSync(fileOf('Garden Shed'), 'utf8')).toBe(projectNote('Garden Shed', 'done'));
      await expect(inColumn('done', 'Garden Shed')).toHaveCount(1, { timeout: 10_000 });
      await expectAnnounced(win, 'Moved Garden Shed to done.');
    });

    await test.step('keyboard only: Novel Draft from active to paused, and the file says so', async () => {
      // The board is one tab stop after the layout switcher; it is still on
      // the card just dragged (focus follows the note, not the position).
      await win.getByRole('tab', { name: 'Kanban' }).focus();
      await win.keyboard.press('Tab');
      await expect(inColumn('done', 'Garden Shed')).toBeFocused();
      await win.keyboard.press('ArrowLeft');
      await expect(cardFor('Pottery Class')).toBeFocused();
      await win.keyboard.press('ArrowLeft');
      await expect(cardFor('Novel Draft')).toBeFocused();
      await win.keyboard.press('Shift+F10');
      await expect(win.getByRole('menuitem', { name: 'Move to' })).toBeFocused();
      await win.keyboard.press('ArrowRight');
      // active is where it already is (disabled), so focus starts at paused.
      await expect(win.getByRole('menu', { name: 'Move to' }).getByRole('menuitem', { name: 'paused' })).toBeFocused();
      await win.keyboard.press('Enter');

      await expect.poll(() => statusOf('Novel Draft'), { timeout: 10_000 }).toBe('paused');
      expect(fs.readFileSync(fileOf('Novel Draft'), 'utf8')).toBe(projectNote('Novel Draft', 'paused'));
      await expect(inColumn('paused', 'Novel Draft')).toBeFocused({ timeout: 10_000 });
      await expectAnnounced(win, 'Moved Novel Draft to paused.');
      await expect(board.locator('.kb-col-count')).toHaveText(['0', '2', '2', '0', '1']);
    });

    await test.step('Group by: priority, then back to status', async () => {
      const groupBy = win.getByRole('combobox', { name: 'Group by' });
      await groupBy.selectOption('priority');
      // No project has a priority yet: one No value column holds them all.
      await expect(board.locator('.kb-col-label')).toHaveText(['low', 'medium', 'high', 'No value']);
      await expect(inColumn('', 'Garden Shed')).toHaveCount(1);
      await groupBy.selectOption('status');
      await expect(board.locator('.kb-col-label')).toHaveText(['active', 'paused', 'done', 'abandoned', 'No value']);
      await expect(inColumn('paused', 'Novel Draft')).toHaveCount(1);
    });

    const savedRel = 'Project board.md';
    await test.step('Save as note: the fence carries layout kanban and groupBy', async () => {
      await win.getByRole('button', { name: 'Save as note' }).click();
      await win.locator('input[aria-labelledby="prompt-dialog-title"]').press('Enter'); // accept the suggested name
      const saved = path.join(projectDir, savedRel);
      await expect.poll(() => fs.existsSync(saved), { timeout: 10_000 }).toBe(true);
      const body = fs.readFileSync(saved, 'utf-8');
      const spec = JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(body)![1]!) as Record<string, unknown>;
      expect(spec).toMatchObject({ typeId: 'project', layout: 'kanban', groupBy: 'status' });
    });

    // Nothing below touches a preview: the export renders the board itself,
    // so there is no 120ms preview re-render (#2680) to wait out.
    const html = await test.step('export the saved note through the real pipeline', async () => {
      const res = await win.evaluate(async ([dir, rel]) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: rel }, outputDir: dir, linkPolicy: 'inline-title',
      }), [outDir, savedRel] as const);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    // Every card is on the exported page, and the fence isn't left as source.
    // #2604 (read-only boards in exports: columns wrap, cards link) tightens
    // these into checks on the board's layout.
    for (const [title] of PROJECTS) expect(html).toContain(title);
    expect(html, 'no raw spec in the export').not.toContain('&quot;typeId&quot;');
    expect(html, 'no raw spec in the export').not.toContain('"typeId"');
    expect(html, 'no object-view code block in the export').not.toMatch(/<code[^>]*object-view/);
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
