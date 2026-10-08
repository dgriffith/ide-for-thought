/**
 * A Calendar exports as a static month grid (#2704, epic #2699). Seeds a
 * calendar embed with everything that shapes an export — a busy day (ten
 * events), a long title, a multi-day bar across a row break, an end coarser
 * than its start (hatched), a Meeting (an Event subtype, #2612), a month-only
 * and a year-only start (the bands), an event outside the month and an
 * undated one — opens it in the preview, then exports it through the real
 * pipeline:
 *
 * - **the preview embed** is a read-only grid that still pages months;
 * - **note HTML** (`inline-title`): the spec's month at 760px, nothing
 *   interactive, every event listed in its day's cell (no "+N more"), each
 *   plain text; the long title printed whole; rows that don't split across a
 *   page; the hatch and its legend; the bands and the Undated tray after the
 *   grid; chip text holding contrast on the light theme;
 * - **static site**: every event, band entry and Undated row links to a page
 *   the site wrote;
 * - **note PDF** prints; and the published page's calendar, printed, carries
 *   a `/URI` link annotation per event. The PDFs, the HTML and screenshots are
 *   kept in `test-results/`.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const LONG = 'The lunar module ascent stage rendezvous and docking with Columbia';
const BUSY = Array.from({ length: 10 }, (_, i) => `Briefing ${i + 1}`);
const NOTES: Record<string, string> = {
  'events/Moon landing.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n',
  'events/Apollo 11.md': '---\ntype: event\ndate: 1969-07-16\nend: 1969-07-24\n---\n# Apollo 11\n',
  'events/Summer school.md': '---\ntype: event\ndate: 1969-07-28\nend: 1969-08\n---\n# Summer school\n',
  [`events/${LONG}.md`]: `---\ntype: event\ndate: 1969-07-21\n---\n# ${LONG}\n`,
  'events/Heatwave.md': '---\ntype: event\ndate: 1969-07\n---\n# Heatwave\n',
  'events/Year of the Moon.md': '---\ntype: event\ndate: 1969\n---\n# Year of the Moon\n',
  'events/Woodstock.md': '---\ntype: event\ndate: 1969-08-15\n---\n# Woodstock\n',
  'events/Someday.md': '---\ntype: event\n---\n# Someday\n',
  'meetings/Splashdown debrief.md': '---\ntype: meeting\ndate: 1969-07-25\n---\n# Splashdown debrief\n',
  ...Object.fromEntries(BUSY.map((t, i) => [`events/${t}.md`, `---\ntype: event\ndate: 1969-07-14T${String(8 + i).padStart(2, '0')}:00\n---\n# ${t}\n`])),
};
const IN_GRID = ['Moon landing', 'Apollo 11', 'Summer school', LONG, 'Splashdown debrief', ...BUSY];
const SPEC = { typeId: 'event', layout: 'calendar', month: '1969-07' };

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  for (const [rel, body] of Object.entries(NOTES)) write(rel, body);
  write('Summer of sixty-nine.md', ['# Summer of sixty-nine', '', '```object-view', JSON.stringify(SPEC), '```', ''].join('\n'));
}

async function runExport(win: Page, args: Record<string, unknown>): Promise<string[]> {
  const res = await win.evaluate(async (a) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport(a), args);
  expect(res).not.toBeNull();
  return res!.writtenPaths;
}

const pageOf = (title: string) => `/${title}.html`;

test('a Calendar exports as a static, linked month grid, every event in its cell (#2704)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-calendar-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-calendar-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-calendar-out-'));
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-calendar-site-'));
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-calendar-pdf-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const note = win.locator('[data-relative-path="Summer of sixty-nine.md"]').first();
    await expect(note).toBeVisible({ timeout: 10_000 });

    await test.step('open the note: the preview embed is a read-only grid that pages months', async () => {
      await note.click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      const embed = win.locator('.preview .object-view-block');
      await expect(embed.locator('[data-calendar-event]').first()).toBeVisible({ timeout: 15_000 });
      await expect(embed.locator('[role="grid"]')).toHaveCount(1);
      await expect(embed.locator('.cal-export, .calx')).toHaveCount(0);
      await expect(embed.locator('.cal-title')).toHaveText('July 1969');
      await win.locator('.preview').screenshot({ path: 'test-results/export-calendar-preview.png' });
      await embed.getByRole('button', { name: 'Next month' }).click();
      await expect(embed.locator('.cal-title')).toHaveText('August 1969');
      await embed.getByRole('button', { name: 'Previous month' }).click();
      await expect(embed.locator('.cal-title')).toHaveText('July 1969');
      // Paging changed what was shown, not the note.
      expect(fs.readFileSync(path.join(projectDir, 'Summer of sixty-nine.md'), 'utf-8')).toContain(JSON.stringify(SPEC));
    });

    const html = await test.step('export note HTML through the real pipeline', async () => {
      const written = await runExport(win, { exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Summer of sixty-nine.md' }, outputDir: outDir, linkPolicy: 'inline-title' });
      const file = written.find((p) => p.endsWith('.html'))!;
      fs.copyFileSync(file, 'test-results/export-calendar-note.html');
      return fs.readFileSync(file, 'utf-8');
    });
    expect(html).toMatch(/class="cal[^"]*\bcal-export\b/);
    expect(html, 'no raw spec').not.toContain('&quot;typeId&quot;');
    expect(html).not.toContain('```');
    expect(html).not.toContain('couldn&#39;t be rendered for export');

    await test.step('the export: the month at 760px, static, every event in its cell, bands and tray after it, readable on light', async () => {
      await win.evaluate((doc) => {
        const host = document.createElement('div');
        host.id = 'export-under-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
        const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
        host.attachShadow({ mode: 'open' }).innerHTML = `${styles}<div style="width:760px">${body}</div>`;
        document.body.appendChild(host);
      }, html);
      const r = await win.evaluate(() => {
        const tree = document.querySelector('#export-under-test')!.shadowRoot!;
        const q = <T extends Element>(s: string) => tree.querySelector<T>(s);
        const css = (el: Element) => getComputedStyle(el);
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
        const rgb = (c: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
        const table = q<HTMLElement>('[role="table"]')!;
        const block = table.closest('.minerva-live-block')!;
        const cellOf = (title: string) => Array.from(table.querySelectorAll<HTMLElement>('[role="cell"]')).find((c) => Array.from(c.querySelectorAll('.calx-title')).some((t) => t.textContent === title));
        const busy = cellOf('Briefing 1')!;
        const longEl = Array.from(table.querySelectorAll<HTMLElement>('.calx-ev')).find((e) => e.textContent.includes('lunar module'))!;
        const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const chip = table.querySelector<HTMLElement>('.calx-ev:not(.calx-approx)')!;
        const chipTitle = chip.querySelector('.calx-title')!;
        const weeks = Array.from(table.querySelectorAll<HTMLElement>('.calx-week'));
        return {
          width: table.getBoundingClientRect().width,
          overflowX: q<HTMLElement>('.cal')!.scrollWidth - q<HTMLElement>('.cal')!.clientWidth,
          title: q('.cal-title')!.textContent,
          inGrid: Array.from(new Set(Array.from(table.querySelectorAll('[data-calendar-event] .calx-title')).map((t) => t.textContent))),
          busyCount: busy.querySelectorAll('[data-calendar-event]').length,
          busyInside: (() => { const c = busy.getBoundingClientRect(); return Array.from(busy.querySelectorAll('.calx-ev')).every((e) => { const b = e.getBoundingClientRect(); return b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5; }); })(),
          more: tree.querySelectorAll('.cal-more').length,
          longWhole: longEl.querySelector('.calx-title')!.scrollWidth <= longEl.querySelector('.calx-title')!.clientWidth + 1 && longEl.getBoundingClientRect().height > 20,
          hrefs: tree.querySelectorAll('.minerva-live-block a[href]').length,
          interactive: block.querySelectorAll('button, input, select, [tabindex], [role="grid"], [role="gridcell"], [aria-current], [role="tooltip"], [role="dialog"], .cal-nav').length,
          breakInside: weeks.map((w) => css(w).breakInside),
          hatch: table.querySelector('.calx-hatch') ? css(table.querySelector('.calx-hatch')!).backgroundImage : null,
          legend: q('.calx-legend')?.textContent?.trim() ?? null,
          order: (() => { const yb = q('[data-band="year"]')!; const mb = q('[data-band="month"]')!; const u = q('.cal-undated')!; return after(table, yb) && after(yb, mb) && after(mb, u) && table.getBoundingClientRect().bottom <= yb.getBoundingClientRect().top; })(),
          bands: Array.from(tree.querySelectorAll('.cal-chip-title')).map((t) => t.textContent),
          undated: Array.from(tree.querySelectorAll('.cal-undated-title')).map((t) => t.textContent),
          // A border written as a shorthand holding var() comes back from the CSSOM empty, so check the bar's really paints.
          bar: (() => { const b = table.querySelector<HTMLElement>('.calx-bar:not(.calx-approx)')!; return { width: css(b).borderLeftWidth, style: css(b).borderLeftStyle, right: css(b).borderRightWidth }; })(),
          colors: { accent: rgb(css(table.querySelector('.calx-bar')!).borderLeftColor), text: rgb(css(chipTitle).color), chip: rgb(css(chip).backgroundColor), num: rgb(css(q('.calx-num')!).color), page: rgb(css(table).backgroundColor) },
        };
      });
      expect(r.width).toBeLessThanOrEqual(760);
      expect(r.overflowX, 'nothing scrolls sideways').toBeLessThanOrEqual(0);
      expect(r.title).toBe('July 1969');
      expect([...r.inGrid].sort()).toEqual([...IN_GRID].sort());
      expect(r.busyCount, 'a busy day lists every event').toBe(10);
      expect(r.busyInside, 'and they fit in its cell: the row grows').toBe(true);
      expect(r.more).toBe(0);
      expect(r.longWhole, 'a long title wraps, printed whole').toBe(true);
      expect(r.hrefs, 'inline-title: events are plain text').toBe(0);
      expect(r.interactive, 'no controls or focus stops survive').toBe(0);
      expect(new Set(r.breakInside), 'rows never split across a page').toEqual(new Set(['avoid']));
      expect(r.hatch, 'the hatch paints').toMatch(/repeating-linear-gradient/);
      expect(r.legend).toContain('approximate');
      expect(r.order, 'grid, then the year and month bands, then Undated').toBe(true);
      expect(r.bands).toEqual(['Year of the Moon', 'Heatwave']);
      expect(r.undated).toEqual(['Someday']);
      expect(r.bar, 'a bar has its accent edge').toEqual({ width: '3px', style: 'solid', right: '1px' });
      const c = r.colors;
      expect(contrast(c.accent, c.page), `bar edge ${c.accent} on ${c.page}`).toBeGreaterThanOrEqual(3);
      expect(contrast(c.text, c.chip), `chip text ${c.text} on ${c.chip}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.num, c.page), `day number ${c.num} on ${c.page}`).toBeGreaterThanOrEqual(4.5);
      await win.locator('#export-under-test').screenshot({ path: 'test-results/export-calendar-export.png' });
      await win.evaluate(() => document.querySelector('#export-under-test')?.remove());
    });

    await test.step('static site: every event, band entry and Undated row links to a page it wrote', async () => {
      await runExport(win, { exporterId: 'static-site', input: { kind: 'project' }, outputDir: siteDir });
      const page = fs.readFileSync(path.join(siteDir, 'Summer of sixty-nine.html'), 'utf-8');
      fs.copyFileSync(path.join(siteDir, 'Summer of sixty-nine.html'), 'test-results/export-calendar-site.html');
      expect(page).toMatch(/class="cal[^"]*\bcal-export\b/);
      const hrefsOf = (cls: string) => [...page.matchAll(new RegExp(`<a [^>]*class="${cls}\\b[^>]*>`, 'g'))].map((m) => decodeURIComponent(/href="([^"]+)"/.exec(m[0])?.[1] ?? ''));
      const events = [...hrefsOf('calx-ev'), ...hrefsOf('calx-bar')];
      // A bar cut at a row break is two links to the same page.
      expect(new Set(events).size).toBe(IN_GRID.length);
      expect(hrefsOf('cal-chip')).toHaveLength(2);
      expect(hrefsOf('cal-undated-row')).toHaveLength(1);
      for (const href of [...events, ...hrefsOf('cal-chip'), ...hrefsOf('cal-undated-row')]) {
        expect(href).not.toBe('');
        expect(fs.existsSync(path.join(siteDir, href)), href).toBe(true);
      }
      expect(page).not.toContain('data-note-link');
    });

    await test.step('note PDF: the calendar prints', async () => {
      const written = await runExport(win, { exporterId: 'note-pdf', input: { kind: 'single-note', relativePath: 'Summer of sixty-nine.md' }, outputDir: pdfDir, linkPolicy: 'inline-title' });
      const pdf = written.find((p) => p.endsWith('.pdf'));
      expect(pdf, written.join(', ')).toBeDefined();
      expect(fs.statSync(pdf!).size).toBeGreaterThan(5_000);
      fs.copyFileSync(pdf!, 'test-results/export-calendar-note.pdf');
    });

    await test.step('the published page prints with each event a real link annotation', async () => {
      const b64 = await app.evaluate(async ({ BrowserWindow }, file) => {
        const w = new BrowserWindow({ show: false });
        try {
          await w.loadFile(file);
          await w.webContents.executeJavaScript(`document.body.replaceChildren(document.querySelector('.minerva-live-block'))`);
          return (await w.webContents.printToPDF({ printBackground: true })).toString('base64');
        } finally {
          w.destroy();
        }
      }, path.join(siteDir, 'Summer of sixty-nine.html'));
      const pdf = Buffer.from(b64, 'base64');
      fs.writeFileSync('test-results/export-calendar-site-block.pdf', pdf);
      const uris = [...pdf.toString('latin1').matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => decodeURIComponent(m[1]!));
      for (const title of [...IN_GRID, 'Heatwave', 'Year of the Moon', 'Someday']) {
        expect(uris.some((u) => u.endsWith(pageOf(title))), `${title}: ${uris.join(' ')}`).toBe(true);
      }
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
