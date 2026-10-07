/**
 * Captures the user docs' screenshots from the real app (3.0 docs review):
 * a seeded thoughtbase of places in Prague and Budapest, driven the way a
 * user would, each shot cropped to its panel or dialog at the display's
 * native scale, dark theme — matching the existing images. Writes into
 * `website/docs/img/`; review the diff before committing.
 *
 *   pnpm build:e2e && pnpm docs:screenshots
 *
 * The map uses real tiles, so it needs a network connection.
 */
import { test, expect, type Page } from '../e2e/helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, isolatedHome, launchMinerva, projectRoot } from '../e2e/helpers/launch';

const IMG = path.join(projectRoot, 'website', 'docs', 'img');

const SIGHTS: Array<[string, string, string, string, string]> = [
  ['prague', 'Prague Castle', 'Prague', '50.0909,14.4005', 'castle'],
  ['prague', 'Charles Bridge', 'Prague', '50.0865,14.4114', 'bridge'],
  ['prague', 'Old Town Square', 'Prague', '50.0875,14.4213', 'square'],
  ['prague/mala strana', 'Kampa Museum', 'Prague', '50.0835,14.4089', 'museum'],
  ['budapest', 'Hungarian Parliament', 'Budapest', '47.5071,19.0456', 'landmark'],
  ['budapest', "Fisherman's Bastion", 'Budapest', '47.5022,19.0348', 'viewpoint'],
  ['budapest', 'Széchenyi Baths', 'Budapest', '47.5186,19.0818', 'baths'],
];
const RESTAURANTS: Array<[string, string, string, string, string]> = [
  ['prague', 'Lokál Dlouhá', 'Prague', '50.0911,14.4250', 'Czech'],
  ['prague', 'Café Louvre', 'Prague', '50.0816,14.4195', 'Café'],
  ['budapest', 'Gerbeaud', 'Budapest', '47.4969,19.0505', 'Café'],
];

/** Projects for the board shot: title, status (null = No value), started. */
const PROJECTS: Array<[string, string | null, string]> = [
  ['Book the night train', 'active', '2026-04-02'],
  ['Budapest hotel', 'active', '2026-04-05'],
  ['Photo book of the trip', 'paused', '2026-03-20'],
  ['Rail passes', 'done', '2026-03-01'],
  ['Travel insurance', 'done', '2026-03-03'],
  ['Learn some Czech', 'abandoned', '2026-02-14'],
  ['A day at the thermal baths', null, '2026-04-10'],
];

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', [
    '---', 'label: Place', 'icon: 📍', 'color: "#94e2d5"', 'card: [city, kind]', 'properties:',
    '  - name: location', '    type: geo', '    label: Location',
    '  - name: city', '    type: text', '    label: City',
    '  - name: kind', '    type: text', '    label: Kind',
    '  - name: visited', '    type: date', '    label: Visited',
    '---', '', '## About', '', '{{cursor}}', '', '## Notes', '',
  ].join('\n'));
  write('.minerva/types/restaurant.md', [
    '---', 'label: Restaurant', 'icon: 🍽️', 'color: "#fab387"', 'parent: place', 'properties:',
    '  - name: cuisine', '    type: text', '    label: Cuisine', '---', '',
  ].join('\n'));
  for (const [folder, title, city, loc, kind] of SIGHTS) {
    write(`trip/${folder}/${title}.md`, `---\ntype: place\nlocation: "${loc}"\ncity: ${city}\nkind: ${kind}\n---\n# ${title}\n\nNotes for the ${city} leg of the trip.\n`);
  }
  for (const [folder, title, city, loc, cuisine] of RESTAURANTS) {
    write(`trip/${folder}/${title}.md`, `---\ntype: restaurant\nlocation: "${loc}"\ncity: ${city}\nkind: restaurant\ncuisine: ${cuisine}\n---\n# ${title}\n`);
  }
  write('trip/Itinerary.md', '# Itinerary\n\nFour days in Prague, then the train to Budapest.\n\n- [[Prague Castle]]\n- [[Széchenyi Baths]]\n');
  write('trip/Packing list.md', '# Packing list\n\n- [ ] Rail pass\n- [ ] Swimsuit for the baths\n');
  write('reading/Kafka in Prague.md', '# Kafka in Prague\n\nA walking guide to the places in the letters.\n');
  write('journal/Arrival.md', '# Arrival\n\nLanded late; the castle was lit up over the river.\n');
}

/** Screenshot one element to website/docs/img/<name>. */
async function shot(page: Page, selector: string, name: string): Promise<void> {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  await el.screenshot({ path: path.join(IMG, name), animations: 'disabled' });
}

/** Screenshot the box spanning several elements (a menu that overflows its
 *  panel, or a panel cut off below its content), plus `pad` px. */
async function shotUnion(page: Page, selectors: string[], name: string, opts: { pad?: number; bottomOf?: string } = {}): Promise<void> {
  const boxes = await Promise.all(selectors.map(async (s) => (await page.locator(s).first().boundingBox())!));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  let bottom = Math.max(...boxes.map((b) => b.y + b.height));
  if (opts.bottomOf) {
    const b = (await page.locator(opts.bottomOf).first().boundingBox())!;
    bottom = b.y + b.height + (opts.pad ?? 0);
  }
  await page.screenshot({ path: path.join(IMG, name), animations: 'disabled', clip: { x, y, width: right - x + (opts.bottomOf ? 0 : opts.pad ?? 0), height: bottom - y } });
}

test('capture the docs screenshots', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-docs-shots-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-docs-shots-'));
  // A tidy thoughtbase of its own, named like a real one.
  const root = path.join(projectDir, 'Central Europe trip');
  fs.mkdirSync(root);
  seed(root);
  // A connected MCP server for the settings shot: Minerva's own CLI serving
  // this same thoughtbase, under the launch's isolated HOME (never the real ~).
  const home = isolatedHome(userDataDir);
  fs.mkdirSync(path.join(home, '.minerva'), { recursive: true });
  fs.writeFileSync(path.join(home, '.minerva', 'mcp-servers.json'), JSON.stringify({ servers: [{
    id: 'trip-notes', name: 'Trip notes (Minerva)', enabled: true,
    descriptor: { kind: 'stdio', command: process.execPath, args: [path.join(projectRoot, '.vite', 'build', 'cli.js'), 'mcp', '--project', root] },
  }] }, null, 2));
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 40, y: 40, width: 1440, height: 900, rootPath: root }]));

  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const send = (ch: string) => app.evaluate(({ BrowserWindow }, c) => { BrowserWindow.getAllWindows()[0]!.webContents.send(c); }, ch);
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const row = (rel: string) => win.locator(`[data-relative-path="${rel}"]`).first();
    await expect(row('trip')).toBeVisible({ timeout: 20_000 }); // the thoughtbase has opened
    // The dark theme, like the docs' other screenshots: seed it and reload so
    // the app boots straight into it (as the a11y spec does).
    await win.evaluate(() => localStorage.setItem('themeMode', 'dark'));
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await expect(row('trip')).toBeVisible({ timeout: 20_000 });

    // Some history to look back over: edits to several notes, then a delete.
    await test.step('make some history', async () => {
      const api = (fn: string, ...args: string[]) => win.evaluate(([f, a]) => {
        const [ns, m] = (f).split('.');
        return ((window as unknown as Record<string, Record<string, Record<string, (...x: string[]) => Promise<unknown>>>>).api[ns!]![m!]!)(...(a));
      }, [fn, args] as const);
      const add = async (rel: string, line: string) => {
        const before = await api('notebase.readFile', rel) as string;
        await api('notebase.writeFile', rel, `${before}\n${line}\n`);
        await win.waitForTimeout(1200);
      };
      await add('trip/Itinerary.md', '- [[Gerbeaud]] for coffee on the last morning');
      await add('trip/prague/Charles Bridge.md', 'Go before 8am — it fills up fast.');
      await add('trip/Packing list.md', '- [ ] Walking shoes');
      await add('trip/budapest/Széchenyi Baths.md', 'Bring a towel; rentals are pricey.');
      await api('notebase.deleteFile', 'trip/Packing list.md');
      await win.waitForTimeout(800);
    });

    await test.step('Notes tree: a folder menu with View Objects open', async () => {
      await row('trip').click();
      await row('trip/prague').click();
      await row('trip').click({ button: 'right' });
      await win.getByRole('button', { name: 'View Objects' }).focus();
      await expect(win.getByRole('menu', { name: 'View objects in trip' })).toBeVisible();
      await win.waitForTimeout(300);
      // The submenu opens past the sidebar's edge — take the box around both.
      await shotUnion(win, ['.sidebar', '[role="menu"][aria-label="View objects in trip"]'], 'left-sidebar-notes-tree.png', { pad: 12 });
      await win.keyboard.press('Escape');
      await win.mouse.click(5, 5);
    });

    await test.step('Objects: a folder-scoped, filtered table', async () => {
      await row('trip').click({ button: 'right' });
      await win.getByRole('button', { name: 'View Objects' }).focus();
      await win.getByRole('menu', { name: 'View objects in trip' }).getByRole('menuitem', { name: /^Place/ }).click();
      await expect(win.locator('.tv-table tbody tr')).toHaveCount(SIGHTS.length + RESTAURANTS.length, { timeout: 10_000 });
      await win.getByRole('button', { name: 'Filter ▾' }).click();
      const dialog = win.getByRole('dialog', { name: 'Filter by property' });
      await dialog.getByRole('button', { name: 'City' }).click();
      await dialog.getByRole('checkbox', { name: /Prague/ }).check();
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
      // Down to the last row, not the empty space under it.
      await shotUnion(win, ['.type-view'], 'left-sidebar-objects-table.png', { bottomOf: '.tv-table', pad: 24 });
    });

    await test.step('Objects: the map', async () => {
      // Still filtered to Prague: one city, so the pins (and the two types'
      // colours) are told apart rather than stacked at country scale.
      await win.getByRole('tab', { name: 'Map' }).click();
      const prague = [...SIGHTS, ...RESTAURANTS].filter((p) => p[2] === 'Prague').length;
      await expect(win.locator('.type-view-map .maplibregl-marker')).toHaveCount(prague, { timeout: 15_000 });
      await win.waitForTimeout(4000); // tiles
      await shot(win, '.type-view', 'left-sidebar-objects-map.png');
    });

    await test.step('Properties: a typed note', async () => {
      await row('trip/prague').click();
      await row('trip/prague/Charles Bridge.md').click();
      const props = win.locator('.right-sidebar');
      if (!(await props.isVisible())) await send('menu:toggleRightSidebar');
      await win.locator('.right-sidebar').getByRole('button', { name: /Properties/ }).first().click();
      await win.waitForTimeout(600);
      await shot(win, '.right-sidebar', 'right-sidebar-properties.png');
    });

    await test.step('Local history across a folder', async () => {
      await row('trip').click({ button: 'right' });
      await win.getByRole('button', { name: 'View Local History…', exact: true }).click();
      const dialog = win.locator('[role="dialog"]:has(#multi-file-history-title)');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByText('Loading…')).toHaveCount(0, { timeout: 10_000 });
      // Pick a moment a few edits back, so the preview has something to say.
      const rows = dialog.locator('li, [role="option"], .timeline-row').filter({ hasText: /modified|added|deleted/ });
      const n = await rows.count();
      if (n > 2) await rows.nth(2).click();
      await win.waitForTimeout(500);
      await shot(win, '[role="dialog"]:has(#multi-file-history-title)', 'right-sidebar-history-multi-file.png');
      await win.keyboard.press('Escape');
    });

    await test.step('Settings: Versioning, the type editor, MCP Servers', async () => {
      await send('menu:openSettings');
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: /^Versioning/ }).click();
      await win.waitForTimeout(400);
      await shot(win, '[role="dialog"][aria-label="Settings"]', 'settings-versioning.png');

      await settings.getByRole('button', { name: /^MCP Servers/ }).click();
      await expect(settings.getByText('Trip notes (Minerva)')).toBeVisible();
      await win.waitForTimeout(5000); // let it connect and list its tools
      await shot(win, '[role="dialog"][aria-label="Settings"]', 'settings-mcp-servers.png');

      await settings.getByRole('button', { name: /^Object Types/ }).click();
      await settings.locator('.type-row', { hasText: 'Place' }).first().getByRole('button', { name: 'Edit' }).click();
      const editor = win.getByRole('dialog', { name: 'Edit object type' });
      await expect(editor).toBeVisible();
      await win.waitForTimeout(500);
      await shot(win, '[role="dialog"][aria-label="Edit object type"]', 'settings-object-types-editor.png');
      await win.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      await win.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);
    });

    await test.step('Objects: a Project board', async () => {
      // Written last, in a folder of their own, so none of the shots above
      // (the trip folder's menu, its table, its history) gains a Project.
      for (const [title, status, started] of PROJECTS) {
        const rel = path.join(root, 'projects', `${title}.md`);
        fs.mkdirSync(path.dirname(rel), { recursive: true });
        fs.writeFileSync(rel, `---\ntype: project\n${status ? `status: ${status}\n` : ''}started: ${started}\n---\n# ${title}\n`);
      }
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Project view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Kanban' }).click();
      await expect(win.locator('.kb-board [data-kanban-card]')).toHaveCount(PROJECTS.length, { timeout: 15_000 });
      // Hide the sidebar so all five columns fit, and stop below the
      // tallest column (the first, with two cards) rather than the board's
      // full height.
      await send('menu:toggleSidebar');
      await win.waitForTimeout(400);
      await shotUnion(win, ['.type-view'], 'left-sidebar-objects-kanban.png', { bottomOf: '.kb-column', pad: 24 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
