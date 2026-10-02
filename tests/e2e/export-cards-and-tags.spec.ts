/**
 * Typed-note link cards and #tags export the way the preview shows them
 * (#2526, epic #2508): a block-level link to a typed note is the preview's
 * object card in the export too — same title, same card fields — while a link
 * to an untyped note stays an ordinary link, and a #tag is a chip.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'card: [city, kind]', 'properties:', '  - name: city', '    type: text', '    label: City', '  - name: kind', '    type: text', '    label: Kind', '---', ''].join('\n'));
  write('trip/places/Kampa Museum.md', '---\ntype: place\ncity: Prague\nkind: museum\n---\n# Kampa Museum\n');
  write('trip/Plain Note.md', '# Plain Note\n');
  write('trip/plan.md', '# Plan\n\n[[Kampa Museum]]\n\n[[Plain Note]]\n\nPacking for #trip/prague.\n');
}

/** Each object card's title and field values, in order. */
async function cards(win: Page, rootSelector: string) {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const scope = (root as HTMLElement).shadowRoot ?? root;
    return Array.from(scope.querySelectorAll('.object-card')).map((c) => ({
      title: (() => {
        const t = c.querySelector('.oc-title');
        const icon = t?.querySelector('.oc-type-icon')?.textContent ?? '';
        return (t?.textContent ?? '').replace(icon, '').trim();
      })(),
      fields: Array.from(c.querySelectorAll('.oc-fval')).map((f) => f.textContent.trim()),
    }));
  }, rootSelector);
}

test('typed-note cards and #tags export as the preview shows them (#2526)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-cards-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-cards-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-cards-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="trip"]').first()).toBeVisible({ timeout: 10_000 });

    const preview = await test.step('open the note in the preview', async () => {
      await win.locator('[data-relative-path="trip"]').first().click();
      await win.locator('[data-relative-path="trip/plan.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .object-card')).toHaveCount(1, { timeout: 15_000 });
      return cards(win, '.preview');
    });
    expect(preview).toEqual([{ title: 'Kampa Museum', fields: ['Prague', 'museum'] }]);
    await win.locator('.preview').screenshot({ path: 'test-results/export-cards-preview.png' });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'trip/plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    expect(html).toContain('<span class="note-tag" data-tag="trip/prague">#trip/prague</span>');
    expect(html).toContain('<em>Plain Note</em>'); // the untyped link: the export's ordinary rendering, no card

    const exported = await test.step('compare against the preview', async () => {
      await win.evaluate((doc) => {
        const host = document.createElement('div');
        host.id = 'export-under-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
        const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
        host.attachShadow({ mode: 'open' }).innerHTML = styles + body;
        document.body.appendChild(host);
      }, html);
      return cards(win, '#export-under-test');
    });
    expect(exported).toEqual(preview);
    await win.locator('#export-under-test').screenshot({ path: 'test-results/export-cards-export.png' });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
