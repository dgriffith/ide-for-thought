/**
 * Argument maps export the way the preview shows them (#2514, epic #2508).
 *
 * A real claim with a real supporting note (seeded as `argument-map.spec.ts`
 * seeds it), embedded in outline and diagram view, opened in the preview,
 * exported through the real `publish.runExport`, and compared: the same focus
 * and nodes, the diagram as inline SVG, and no interactive controls left in a
 * static page.
 */
import { test, expect, type Page } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva } from './helpers/launch';

const BASE_URI = 'https://sample.minerva.dev/argument-map-export-e2e/';
const noteUri = (rel: string) => `${BASE_URI}note/${rel.replace(/\.(md|ttl)$/, '').split('/').map(encodeURIComponent).join('/')}`;

function seed(projectDir: string): void {
  fs.mkdirSync(path.join(projectDir, '.minerva'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.minerva', 'config.json'), JSON.stringify({ baseUri: BASE_URI }));
  fs.mkdirSync(path.join(projectDir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'notes', 'The Claim.md'), '---\ntitle: The Claim\n---\n\n# The Claim\n\nSome assertion.\n\n```turtle\nthis: a thought:Claim .\n```\n');
  fs.writeFileSync(path.join(projectDir, 'notes', 'Cited Evidence.md'), `---\ntitle: Cited Evidence\nsupports: ${noteUri('notes/The Claim.md')}\n---\n\n# Cited Evidence\n\nThe supporting case.\n`);
  fs.writeFileSync(path.join(projectDir, 'Host.md'), '---\ntitle: Host\n---\n\n# Host\n\n:::argument\n[[The Claim]]\n:::\n\n:::argument\nview: diagram\n---\n[[The Claim]]\n:::\n');
}

/** Per map: its focus label, its outline node link texts, whether it holds a diagram, and whether controls remain. */
async function maps(win: Page, rootSelector: string) {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const scope = (root as HTMLElement).shadowRoot ?? root;
    return Array.from(scope.querySelectorAll('.argument-map')).map((m) => ({
      focus: m.querySelector('.argument-map-focus')?.textContent?.trim() ?? null,
      nodes: Array.from(m.querySelectorAll('.argument-outline .node-link')).map((a) => a.textContent.trim()),
      diagram: m.querySelector('svg') !== null,
      controls: m.querySelector('.argument-map-controls, input[type="range"]') !== null,
    }));
  }, rootSelector);
}

test('argument maps export with the preview\'s focus and nodes, diagram as SVG, no controls (#2514)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-argmap-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-argmap-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-argmap-out-'));
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    const preview = await test.step('open the note in the preview', async () => {
      await win.locator('[data-relative-path="Host.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .argument-outline .node-link').first()).toBeVisible({ timeout: 20_000 });
      await expect(win.locator('.preview .argument-map svg')).toHaveCount(1, { timeout: 20_000 });
      return maps(win, '.preview');
    });
    expect(preview).toEqual([
      { focus: 'The Claim', nodes: ['Cited Evidence'], diagram: false, controls: true },
      { focus: 'The Claim', nodes: [], diagram: true, controls: true },
    ]);
    await win.locator('.preview').screenshot({ path: 'test-results/export-argmap-preview.png' });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Host.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    expect(html, 'no raw directive in the export').not.toContain(':::argument');
    expect(html).not.toContain('Loading argument structure');
    expect(html).toMatch(/<svg[^>]*id="mermaid-export-/);

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
      return maps(win, '#export-under-test');
    });
    expect(exported).toEqual(preview.map((m) => ({ ...m, controls: false })));
    await win.locator('#export-under-test').screenshot({ path: 'test-results/export-argmap-export.png' });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
