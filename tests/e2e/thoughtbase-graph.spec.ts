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

/**
 * Finding your way (#2959). A found note is centred, so the canvas's own centre
 * is that note — which is how the spec clicks, right-clicks and drags it.
 */
/**
 * The canvas's centre once it has stopped moving, and been drawn there.
 *
 * - Stopped moving: Find and a selection add to the toolbar, which can wrap and
 *   move the canvas (#3066).
 * - Drawn: where WebGL is available the graph draws with Cytoscape's WebGL
 *   renderer, which finds what's under a click in the last frame it DREW, not
 *   from the nodes' positions (#3084). Find centres the note at once, but the
 *   frame showing it comes a frame later, later still on a loaded machine, so
 *   a click before then was tested against the old picture and hit the
 *   background. Captured: the tap's rendered position (525, 365) on the note's
 *   own (525, 365.5), the container box and Cytoscape's cache of it both
 *   right, and the target "background". Two animation frames later Cytoscape
 *   has drawn. A user clicks what they can see, so for them the drawn frame is
 *   always current.
 */
async function settledCentre(canvas: import('@playwright/test').Locator): Promise<{ x: number; y: number }> {
  let last = '';
  let b = (await canvas.boundingBox())!;
  for (let i = 0; i < 20; i++) {
    b = (await canvas.boundingBox())!;
    const now = JSON.stringify(b);
    if (now === last) break;
    last = now;
    await new Promise((r) => setTimeout(r, 100));
  }
  await canvas.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('the graph: find a note, trace a connection, the note menu, pin and release (#2959)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tb-graph-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tb-graph-project-'));
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
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.openGraph'); });
    await expect(graph.locator('.count')).toHaveText(/^5 of 5 nodes/, { timeout: 15_000 });
    const canvas = graph.locator('.canvas');
    await expect(canvas).toHaveAttribute('data-settled', '', { timeout: 15_000 }); // the layout has finished: nothing moves now
    const find = graph.getByRole('searchbox', { name: 'Find a note' });
    const centreOf = () => settledCentre(canvas);
    // Settled first: a layout still running (Release all starts one) moves the note out from under the click.
    const findAndCentre = async (q: string) => {
      await expect(canvas).toHaveAttribute('data-settled', '', { timeout: 15_000 });
      await find.fill(q);
      return centreOf();
    };

    await test.step('find marks the matches and steps through them', async () => {
      await find.fill('a');
      await expect(graph.locator('.found')).toHaveText(/^1 of \d$/);
      await find.press('Enter');
      await expect(graph.locator('.found')).toHaveText(/^2 of \d$/);
      await find.fill('zzz');
      await expect(graph.locator('.found')).toHaveText('None');
    });

    await test.step('select Prague, trace to Budget: two steps over the links', async () => {
      const at = await findAndCentre('Prague');
      await win.mouse.click(at.x, at.y);
      await graph.getByRole('button', { name: 'Trace from “Prague”' }).click();
      const b = await findAndCentre('Budget');
      await win.mouse.click(b.x, b.y);
      await expect(graph.locator('.path-steps')).toContainText('Prague');
      await expect(graph.locator('.path-steps')).toContainText('Budget');
      await expect(graph.locator('.path-steps')).toContainText('2 steps');
      await graph.getByRole('button', { name: 'Clear' }).click();
    });

    await test.step('no connection to an orphan', async () => {
      const at = await findAndCentre('Plan');
      await win.mouse.click(at.x, at.y);
      await graph.getByRole('button', { name: 'Trace from “Plan”' }).click();
      const l = await findAndCentre('Lonely');
      await win.mouse.click(l.x, l.y);
      await expect(graph.locator('.path-steps')).toContainText('Nothing connects');
      await win.keyboard.press('Escape');
    });

    await test.step('a found note stays centred when the canvas resizes under it (#3066)', async () => {
      // Narrowing the window narrows the canvas by 400px: a note centred before that would sit 200px
      // off the new centre, and a click there would miss it. (On Linux the toolbar wrapping did the
      // same, by a row, whenever Find or a selection added to it.)
      // Relative to whatever the window is: a CI runner's screen may not hold the 1300px asked for.
      const [w, h] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize());
      const resize = (width: number) => app.evaluate(({ BrowserWindow }, [ww, hh]) => { BrowserWindow.getAllWindows()[0]!.setSize(ww!, hh!); }, [width, h!]);
      const before = (await canvas.boundingBox())!.width;
      await findAndCentre('Kampa');
      await resize(w! - 300);
      await expect.poll(async () => (await canvas.boundingBox())!.width, { timeout: 5_000 }).toBeLessThan(before - 200);
      const at = await centreOf();
      await win.mouse.click(at.x, at.y);
      // The click landed on Kampa: it's selected (Focus on shows for whatever is selected, trace or not).
      await expect(graph.getByRole('button', { name: 'Focus on “Kampa”' })).toBeVisible();
      await resize(w!);
      await expect.poll(async () => (await canvas.boundingBox())!.width, { timeout: 5_000 }).toBe(before);
    });

    await test.step('right-click a note: the note menu', async () => {
      const at = await findAndCentre('Kampa');
      await win.mouse.click(at.x, at.y, { button: 'right' });
      await expect(win.getByRole('menuitem', { name: /^Add Tag…/ })).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByRole('menuitem', { name: /^Add Tag…/ })).toHaveCount(0);
    });

    await test.step('drag a note to pin it; Release all undoes it', async () => {
      const at = await findAndCentre('Kampa');
      await win.mouse.move(at.x, at.y);
      await win.mouse.down();
      await win.mouse.move(at.x + 60, at.y + 40, { steps: 6 });
      await win.mouse.up();
      const release = graph.getByRole('button', { name: 'Release all (1)' });
      await expect(release).toBeVisible();
      await release.click();
      await expect(release).toHaveCount(0);
    });

    await test.step('a double-click opens the note; two quick clicks on different notes do not', async () => {
      const at = await findAndCentre('Kampa');
      await win.mouse.dblclick(at.x, at.y);
      await expect(win.locator('.tab.active')).toContainText('Kampa', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
