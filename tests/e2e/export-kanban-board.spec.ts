/**
 * A Kanban board exports as the preview shows it, read-only (#2604, epic
 * #2600). Seeds a board embed that uses everything that shapes one — folder
 * scope, a filter, a column order, an empty column, a No value column and a
 * long card title — opens it in the preview, then exports it through the real
 * pipeline three ways:
 *
 * - **note HTML** (`inline-title`): the same columns in the same order with
 *   the same cards; the columns WRAP within the 760px block (more than one
 *   row, nothing overflowing sideways); nothing interactive; each card plain
 *   text; card text readable on the light export theme;
 * - **static site**: the published page carries the board, and every card is
 *   a link to a page the site wrote;
 * - **note PDF**: it prints (the PDF is kept in `test-results/` for review).
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const TASKS: Array<[string, string | null, string, string]> = [
  // title, status, area, folder
  ['Fix the gate', 'todo', 'home', 'board'],
  ['Write the quarterly report for the board of trustees, with appendices', 'doing', 'work', 'board'],
  ['File expenses', 'done', 'work', 'board'],
  ['Book dentist', 'todo', 'home', 'board'],
  ['Someday sort the attic', null, 'home', 'board'],
  ['Plant the bulbs', 'todo', 'garden', 'board'], // filtered out by area
  ['Elsewhere task', 'todo', 'home', 'other'], // outside the folder
];
const SPEC = { typeId: 'task', layout: 'kanban', groupBy: 'status', folder: 'board', filters: [{ property: 'area', values: ['home', 'work'] }], columnOrder: ['done'], columns: ['area'] };

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/task.md', [
    '---', 'label: Task', 'id: task', 'icon: ✅', 'properties:',
    '  - name: status', '    type: enum', '    options: [todo, doing, review, done, dropped]',
    '  - name: area', '    type: text', '    label: Area', '---', '',
  ].join('\n'));
  for (const [title, status, area, folder] of TASKS) {
    write(`${folder}/${title}.md`, `---\ntype: task\n${status ? `status: ${status}\n` : ''}area: ${area}\n---\n# ${title}\n`);
  }
  write('Board.md', ['# Board', '', '```object-view', JSON.stringify(SPEC), '```', ''].join('\n'));
}

type Column = { label: string; count: string; cards: string[] };
/** Each column's label, count and card titles, in order, under a root (or its shadow root). */
async function readBoard(scope: Page, rootSelector: string): Promise<Column[]> {
  return scope.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const tree = (root as HTMLElement).shadowRoot ?? root;
    return Array.from(tree.querySelectorAll('.kb-column')).map((c) => ({
      label: c.querySelector('.kb-col-label')!.textContent.trim(),
      count: c.querySelector('.kb-col-count')!.textContent.trim(),
      cards: Array.from(c.querySelectorAll('.kb-card-name')).map((n) => n.textContent.trim()),
    }));
  }, rootSelector);
}

async function runExport(win: Page, args: Record<string, unknown>): Promise<string[]> {
  const res = await win.evaluate(async (a) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport(a), args);
  expect(res).not.toBeNull();
  return res!.writtenPaths;
}

test('a Kanban board exports as the preview shows it: wrapped, read-only, linked (#2604)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-kanban-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-kanban-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-kanban-out-'));
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-kanban-site-'));
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-kanban-pdf-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="Board.md"]').first()).toBeVisible({ timeout: 10_000 });

    const preview = await test.step('open the note: the preview embed is a read-only board', async () => {
      await win.locator('[data-relative-path="Board.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .kb-card')).toHaveCount(5, { timeout: 15_000 });
      const embed = win.locator('.preview .object-view-block');
      await expect(embed.locator('.kb-col-menu-btn, [data-draggable], .tv-header, [aria-pressed]')).toHaveCount(0);
      await embed.locator('.kb-card').first().click({ button: 'right' });
      await expect(win.locator('.tv-menu')).toHaveCount(0); // no Move to
      await win.locator('.preview').screenshot({ path: 'test-results/export-kanban-preview.png' });
      return readBoard(win, '.preview .object-view-block');
    });
    // The board the spec describes: done first (columnOrder), the empty review
    // and dropped columns shown, No value last; the garden and out-of-folder tasks absent.
    expect(preview.map((c) => c.label)).toEqual(['done', 'todo', 'doing', 'review', 'dropped', 'No value']);
    expect(preview.map((c) => c.count)).toEqual(['1', '2', '1', '0', '0', '1']);
    expect(preview.flatMap((c) => c.cards)).not.toContain('Plant the bulbs');
    expect(preview.flatMap((c) => c.cards)).not.toContain('Elsewhere task');

    const html = await test.step('export note HTML through the real pipeline', async () => {
      const written = await runExport(win, { exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Board.md' }, outputDir: outDir, linkPolicy: 'inline-title' });
      const file = written.find((p) => p.endsWith('.html'))!;
      fs.copyFileSync(file, 'test-results/export-kanban-note.html');
      return fs.readFileSync(file, 'utf-8');
    });
    expect(html).toMatch(/class="kb-board[^"]*\bkb-export\b/);
    expect(html, 'no raw spec').not.toContain('&quot;typeId&quot;');
    expect(html).not.toContain('```');
    expect(html).not.toContain('couldn&#39;t be rendered for export');

    await test.step('the export shows the same board, wrapped within the page, read-only', async () => {
      await win.evaluate((doc) => {
        const host = document.createElement('div');
        host.id = 'export-under-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
        const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
        // The export's own page width, as the PDF prints it.
        host.attachShadow({ mode: 'open' }).innerHTML = `${styles}<div style="width:760px">${body}</div>`;
        document.body.appendChild(host);
      }, html);
      expect(await readBoard(win, '#export-under-test')).toEqual(preview);

      const layout = await win.evaluate(() => {
        const tree = document.querySelector('#export-under-test')!.shadowRoot!;
        const board = tree.querySelector<HTMLElement>('.kb-board')!;
        const cols = Array.from(tree.querySelectorAll<HTMLElement>('.kb-column'));
        const card = tree.querySelector<HTMLElement>('.kb-card')!;
        const name = tree.querySelector<HTMLElement>('.kb-card-name')!;
        const header = tree.querySelector<HTMLElement>('.kb-col-header')!;
        const label = tree.querySelector<HTMLElement>('.kb-col-label')!;
        const css = (el: Element) => getComputedStyle(el);
        // Computed colours come back as oklch()/color-mix(); a canvas pixel gives sRGB.
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
        const rgb = (c: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
        return {
          display: css(board).display,
          rows: new Set(cols.map((c) => Math.round(c.getBoundingClientRect().top))).size,
          perRow: cols.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.round(cols[0]!.getBoundingClientRect().top)).length,
          overflowX: board.scrollWidth - board.clientWidth,
          boardRight: board.getBoundingClientRect().right,
          hostRight: board.closest('.minerva-live-block')!.getBoundingClientRect().right,
          interactive: tree.querySelectorAll('.minerva-live-block button, .minerva-live-block input, .minerva-live-block select, .minerva-live-block [tabindex], .minerva-live-block [role="menu"]').length,
          hrefs: tree.querySelectorAll('.kb-card[href]').length,
          cardColors: [rgb(css(name).color), rgb(css(card).backgroundColor)],
          headerColors: [rgb(css(label).color), rgb(css(header).backgroundColor)],
          longTitleHeight: Array.from(tree.querySelectorAll<HTMLElement>('.kb-card-name')).find((n) => n.textContent.startsWith('Write the quarterly'))!.getBoundingClientRect().height,
          shortTitleHeight: name.getBoundingClientRect().height,
        };
      });
      expect(layout.display).toBe('grid');
      expect(layout.rows, 'the columns wrap onto further rows').toBeGreaterThan(1);
      expect(layout.perRow).toBe(3);
      expect(layout.overflowX, 'nothing scrolls sideways').toBeLessThanOrEqual(0);
      expect(layout.boardRight).toBeLessThanOrEqual(layout.hostRight + 0.5);
      expect(layout.interactive, 'no controls or focus stops survive').toBe(0);
      expect(layout.hrefs, 'inline-title: cards are plain text').toBe(0);
      expect(layout.longTitleHeight, 'a long title wraps, never truncates').toBeGreaterThan(layout.shortTitleHeight * 1.5);
      expect(contrast(layout.cardColors[0]!, layout.cardColors[1]!), `card text ${layout.cardColors.join(' on ')}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(layout.headerColors[0]!, layout.headerColors[1]!), `header text ${layout.headerColors.join(' on ')}`).toBeGreaterThanOrEqual(4.5);
      await win.locator('#export-under-test').screenshot({ path: 'test-results/export-kanban-export.png' });
      await win.evaluate(() => document.querySelector('#export-under-test')?.remove());
    });

    await test.step('static site: the published page has the board, every card linked to a page it wrote', async () => {
      await runExport(win, { exporterId: 'static-site', input: { kind: 'project' }, outputDir: siteDir });
      const page = fs.readFileSync(path.join(siteDir, 'Board.html'), 'utf-8');
      fs.copyFileSync(path.join(siteDir, 'Board.html'), 'test-results/export-kanban-site.html');
      expect(page).toMatch(/class="kb-board[^"]*\bkb-export\b/);
      const hrefs = [...page.matchAll(/<a [^>]*class="kb-card[^>]*>/g)].map((m) => decodeURIComponent(/href="([^"]+)"/.exec(m[0])?.[1] ?? ''));
      expect(hrefs).toHaveLength(5);
      expect(hrefs).not.toContain('');
      for (const href of hrefs) expect(fs.existsSync(path.join(siteDir, href)), href).toBe(true);
      expect(page).not.toContain('data-note-link');
    });

    await test.step('note PDF: the board prints', async () => {
      const written = await runExport(win, { exporterId: 'note-pdf', input: { kind: 'single-note', relativePath: 'Board.md' }, outputDir: pdfDir, linkPolicy: 'inline-title' });
      const pdf = written.find((p) => p.endsWith('.pdf'));
      expect(pdf, written.join(', ')).toBeDefined();
      expect(fs.statSync(pdf!).size).toBeGreaterThan(5_000);
      fs.copyFileSync(pdf!, 'test-results/export-kanban-note.pdf');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir, siteDir, pdfDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

/** WCAG contrast ratio of two `rgb()` colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const nums = (c.match(/[\d.]+/g) ?? []).map(Number);
    const [r, g, bl] = nums.slice(0, 3).map((n) => n / 255);
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(bl!);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
