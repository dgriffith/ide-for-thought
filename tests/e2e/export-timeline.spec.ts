/**
 * A Timeline exports as one static picture of its range (#2609, epic #2606).
 * Seeds a timeline embed with everything that shapes an export — a range
 * (`from`/`to`) with an event outside it, a point, a span, partial dates
 * (hatched), a Meeting (an Event subtype, #2612), a long title, a backwards
 * `end` and an undated event — opens it in the preview, then exports it
 * through the real pipeline:
 *
 * - **the preview embed** stays read-only (List only; no zoom, pan or Fit);
 * - **note HTML** (`inline-title`): the SVG drawing at 760px with every event
 *   in range, nothing interactive, each event plain text; the hatch and dashed
 *   outline really paint (a class rule can't override the pattern fill); the
 *   legend, the outside-range note, the dated list and the Undated list after
 *   it; bars, points, labels and the axis hold contrast on the light theme;
 * - **static site**: the published page carries the drawing, and every event,
 *   in the SVG and in the list, links to a page the site wrote;
 * - **note PDF** prints; and the published page's timeline, printed, carries
 *   a `/URI` link annotation per event in the drawing and per row in the
 *   list. The PDFs, the HTML and screenshots are kept in `test-results/`.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const LONG = 'The lunar module ascent stage rendezvous and docking with Columbia';
const NOTES: Record<string, string> = {
  'events/Moon landing.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n',
  'events/Apollo 11.md': '---\ntype: event\ndate: 1969-07-16\nend: 1969-07-24\n---\n# Apollo 11\n',
  'events/Woodstock.md': '---\ntype: event\ndate: 1969-08\n---\n# Woodstock\n',
  'events/Summer of protest.md': '---\ntype: event\ndate: 1969-06\nend: 1969-09-15\n---\n# Summer of protest\n',
  [`events/${LONG}.md`]: `---\ntype: event\ndate: 1969-07-21\n---\n# ${LONG}\n`,
  'events/Typo.md': '---\ntype: event\ndate: 1969-07-28\nend: 1969-07-01\n---\n# Typo\n',
  'events/Someday.md': '---\ntype: event\n---\n# Someday\n',
  'events/Thirty Years War.md': '---\ntype: event\ndate: 1618\nend: 1648\n---\n# Thirty Years War\n',
  'meetings/Splashdown debrief.md': '---\ntype: meeting\ndate: 1969-07-25\n---\n# Splashdown debrief\n',
};
const IN_RANGE = ['Summer of protest', 'Apollo 11', 'Moon landing', LONG, 'Splashdown debrief', 'Typo', 'Woodstock'];
const SPEC = { typeId: 'event', layout: 'timeline', from: '1969-06', to: '1969-09' };

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  for (const [rel, body] of Object.entries(NOTES)) write(rel, body);
  write('Nineteen sixty-nine.md', ['# Nineteen sixty-nine', '', '```object-view', JSON.stringify(SPEC), '```', ''].join('\n'));
}

async function runExport(win: Page, args: Record<string, unknown>): Promise<string[]> {
  const res = await win.evaluate(async (a) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport(a), args);
  expect(res).not.toBeNull();
  return res!.writtenPaths;
}

test('a Timeline exports as a static, linked picture of its range, with its lists (#2609)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-timeline-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-timeline-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-timeline-out-'));
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-timeline-site-'));
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-timeline-pdf-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const note = win.locator('[data-relative-path="Nineteen sixty-nine.md"]').first();
    await expect(note).toBeVisible({ timeout: 10_000 });

    await test.step('open the note: the preview embed is a read-only timeline', async () => {
      await note.click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      const embed = win.locator('.preview .object-view-block');
      await expect(embed.locator('[data-timeline-event]').first()).toBeVisible({ timeout: 15_000 });
      await expect(embed.locator('.tl-toolbar button')).toHaveText(['List']);
      await expect(embed.locator('.tl-export, .tl-pannable, .tl-export-events')).toHaveCount(0);
      await win.locator('.preview').screenshot({ path: 'test-results/export-timeline-preview.png' });
    });

    const html = await test.step('export note HTML through the real pipeline', async () => {
      const written = await runExport(win, { exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Nineteen sixty-nine.md' }, outputDir: outDir, linkPolicy: 'inline-title' });
      const file = written.find((p) => p.endsWith('.html'))!;
      fs.copyFileSync(file, 'test-results/export-timeline-note.html');
      return fs.readFileSync(file, 'utf-8');
    });
    expect(html).toMatch(/class="tl[^"]*\btl-export\b/);
    expect(html, 'no raw spec').not.toContain('&quot;typeId&quot;');
    expect(html).not.toContain('```');
    expect(html).not.toContain('couldn&#39;t be rendered for export');

    await test.step('the export: the drawing at 760px, static, approximate dates visible, its lists, readable on light', async () => {
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
        const plot = q<SVGSVGElement>('.tl-plot')!;
        const events = Array.from(plot.querySelectorAll('[data-timeline-event]'));
        const block = plot.closest('.minerva-live-block')!;
        const approx = plot.querySelector('.tl-bar-approx')!;
        const solid = plot.querySelector('.tl-bar:not(.tl-bar-approx)');
        const point = plot.querySelector('.tl-point:not(.tl-approx-point)')!;
        const bg = rgb(css(q('.tl-viewport')!).backgroundColor);
        const inside = plot.querySelector('.tl-label-inside');
        return {
          plotWidth: plot.getBoundingClientRect().width,
          overflowX: q<HTMLElement>('.tl')!.scrollWidth - q<HTMLElement>('.tl')!.clientWidth,
          namespaces: [...new Set(events.map((e) => `${e.tagName}:${e.namespaceURI}`))],
          drawn: events.map((e) => e.getAttribute('aria-label')!.split(',')[0]),
          hrefs: tree.querySelectorAll('.minerva-live-block a[href]').length,
          interactive: block.querySelectorAll('button, input, select, [tabindex], [role="link"], [role="tooltip"], .tl-toolbar, .tl-ring').length,
          approxFill: css(approx).fill,
          approxDash: css(approx).strokeDasharray,
          legend: q('.tl-legend')?.textContent?.trim() ?? null,
          outside: q('.tl-outside')?.textContent?.trim() ?? null,
          listed: Array.from(tree.querySelectorAll('.tl-export-row')).map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
          undated: Array.from(tree.querySelectorAll('.tl-undated .tl-list-title')).map((n) => n.textContent.trim()),
          colors: {
            bg,
            bar: solid ? rgb(css(solid).fill) : null,
            point: rgb(css(point).fill),
            label: rgb(css(plot.querySelector('.tl-label:not(.tl-label-inside)')!).fill),
            inside: inside ? rgb(css(inside).fill) : null,
            tick: rgb(css(q('.tl-tick-label')!).fill),
            axis: rgb(css(q('.tl-axis-line')!).stroke),
          },
        };
      });
      expect(r.plotWidth).toBeLessThanOrEqual(760);
      expect(r.overflowX, 'nothing scrolls sideways').toBeLessThanOrEqual(0);
      expect(r.namespaces, 'each event is a link inside the SVG').toEqual(['a:http://www.w3.org/2000/svg']);
      expect([...r.drawn].sort()).toEqual([...IN_RANGE].sort());
      expect(r.hrefs, 'inline-title: events are plain text').toBe(0);
      expect(r.interactive, 'no controls or focus stops survive').toBe(0);
      expect(r.approxFill, 'the hatch paints').toMatch(/^url\(/);
      expect(r.approxDash, 'with a dashed edge').not.toBe('none');
      expect(r.legend).toContain('approximate');
      expect(r.outside).toBe('1 more falls outside this range.');
      expect(r.listed.map((t) => IN_RANGE.find((n) => t.startsWith(n)))).toEqual(IN_RANGE);
      expect(r.listed.find((t) => t.startsWith('Woodstock'))).toContain('(approximate)');
      expect(r.listed.find((t) => t.startsWith('Typo'))).toContain('End date ignored');
      expect(r.listed.find((t) => t.startsWith(LONG)), 'the list keeps the full title').toBeTruthy();
      expect(r.undated).toEqual(['Someday']);
      const c = r.colors;
      expect(contrast(c.label, c.bg), `label ${c.label} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.tick, c.bg), `tick label ${c.tick} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.point, c.bg), `point ${c.point} on ${c.bg}`).toBeGreaterThanOrEqual(3);
      expect(contrast(c.axis, c.bg), `axis ${c.axis} on ${c.bg}`).toBeGreaterThanOrEqual(3);
      if (c.bar) expect(contrast(c.bar, c.bg), `bar ${c.bar} on ${c.bg}`).toBeGreaterThanOrEqual(3);
      if (c.inside && c.bar) expect(contrast(c.inside, c.bar), `label ${c.inside} in a bar ${c.bar}`).toBeGreaterThanOrEqual(4.5);
      await win.locator('#export-under-test').screenshot({ path: 'test-results/export-timeline-export.png' });
      await win.evaluate(() => document.querySelector('#export-under-test')?.remove());
    });

    await test.step('static site: the published page has the drawing, every event linked to a page it wrote', async () => {
      await runExport(win, { exporterId: 'static-site', input: { kind: 'project' }, outputDir: siteDir });
      const page = fs.readFileSync(path.join(siteDir, 'Nineteen sixty-nine.html'), 'utf-8');
      fs.copyFileSync(path.join(siteDir, 'Nineteen sixty-nine.html'), 'test-results/export-timeline-site.html');
      expect(page).toMatch(/class="tl[^"]*\btl-export\b/);
      const hrefsOf = (cls: string) => [...page.matchAll(new RegExp(`<a [^>]*class="${cls}[^>]*>`, 'g'))].map((m) => decodeURIComponent(/href="([^"]+)"/.exec(m[0])?.[1] ?? ''));
      for (const cls of ['tl-event', 'tl-list-title']) {
        const hrefs = hrefsOf(cls);
        expect(hrefs, cls).toHaveLength(IN_RANGE.length);
        expect(hrefs).not.toContain('');
        for (const href of hrefs) expect(fs.existsSync(path.join(siteDir, href)), href).toBe(true);
      }
      expect(page).not.toContain('data-note-link');
    });

    await test.step('note PDF: the timeline prints', async () => {
      const written = await runExport(win, { exporterId: 'note-pdf', input: { kind: 'single-note', relativePath: 'Nineteen sixty-nine.md' }, outputDir: pdfDir, linkPolicy: 'inline-title' });
      const pdf = written.find((p) => p.endsWith('.pdf'));
      expect(pdf, written.join(', ')).toBeDefined();
      expect(fs.statSync(pdf!).size).toBeGreaterThan(5_000);
      fs.copyFileSync(pdf!, 'test-results/export-timeline-note.pdf');
    });

    await test.step('the published page prints with each event a real link annotation, in the drawing and in the list', async () => {
      // Print just the timeline block of the site's page, so every link in the PDF is the timeline's.
      const b64 = await app.evaluate(async ({ BrowserWindow }, file) => {
        const w = new BrowserWindow({ show: false });
        try {
          await w.loadFile(file);
          await w.webContents.executeJavaScript(`document.body.replaceChildren(document.querySelector('.minerva-live-block'))`);
          return (await w.webContents.printToPDF({})).toString('base64');
        } finally {
          w.destroy();
        }
      }, path.join(siteDir, 'Nineteen sixty-nine.html'));
      const pdf = Buffer.from(b64, 'base64');
      fs.writeFileSync('test-results/export-timeline-site-block.pdf', pdf);
      const uris = [...pdf.toString('latin1').matchAll(/\/URI\s*\(([^)]*)\)/g)].map((m) => decodeURIComponent(m[1]!));
      for (const title of IN_RANGE) {
        const page = `/${path.basename(Object.keys(NOTES).find((rel) => rel.endsWith(`/${title}.md`))!, '.md')}.html`;
        expect(uris.filter((u) => u.endsWith(page)), `${title}: ${uris.join(' ')}`).toHaveLength(2);
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
