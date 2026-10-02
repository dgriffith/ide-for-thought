/**
 * Mermaid diagrams export the way the preview shows them (#2513, epic #2508).
 *
 * Real mermaid in the real app: a flowchart with long labels and a diagram
 * that doesn't parse, opened in the preview, exported through the real
 * `publish.runExport`, and compared — the same labels, as inline SVG, none
 * clipped when drawn in the export page's font (#1802's failure, in exports),
 * and the preview's own error box for the broken one.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const LABELS = ['Write a note about the museum', 'Knowledge graph indexes it', 'Export to a static site'];

function seed(dir: string): void {
  fs.mkdirSync(path.join(dir, 'trip'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'trip', 'plan.md'), [
    '# Plan', '',
    '```mermaid', 'graph TD', `  A[${LABELS[0]}] --> B[${LABELS[1]}]`, `  B --> C[${LABELS[2]}]`, '```', '',
    '```mermaid', 'graph TD; A--', '```', '',
  ].join('\n'));
}

/** Per diagram: its node label texts, and how many labels overflow their box. */
async function diagrams(win: Page, rootSelector: string): Promise<Array<{ labels: string[]; clipped: number; error: string | null }>> {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const scope = (root as HTMLElement).shadowRoot ?? root;
    return Array.from(scope.querySelectorAll('.mermaid-block')).map((block) => {
      const labels = Array.from(block.querySelectorAll('.nodeLabel')).map((n) => n.textContent.trim()).filter(Boolean);
      let clipped = 0;
      for (const fo of Array.from(block.querySelectorAll('foreignObject'))) {
        const inner = fo.firstElementChild as HTMLElement | null;
        if (inner && inner.scrollWidth > fo.getBoundingClientRect().width + 1) clipped++;
      }
      return { labels, clipped, error: block.querySelector('.mermaid-error pre')?.textContent?.trim() ?? null };
    });
  }, rootSelector);
}

test('mermaid diagrams export as inline SVG with every label intact (#2513)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-mermaid-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-mermaid-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-mermaid-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="trip"]').first()).toBeVisible({ timeout: 10_000 });

    const preview = await test.step('open the note in the preview', async () => {
      await win.locator('[data-relative-path="trip"]').first().click();
      await win.locator('[data-relative-path="trip/plan.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .mermaid-block svg')).toHaveCount(1, { timeout: 20_000 });
      await expect(win.locator('.preview .mermaid-error')).toHaveCount(1, { timeout: 20_000 });
      return diagrams(win, '.preview');
    });
    expect(preview.map((d) => d.labels)).toEqual([LABELS, []]);
    await win.locator('.preview').screenshot({ path: 'test-results/export-mermaid-preview.png' });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'trip/plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    // No diagram left as a code box. (The broken one's error box quotes its line,
    // as the preview's does — that's the error, not the source.)
    expect(html, 'diagram source left as a code box').not.toMatch(/<code[^>]*>[^<]*graph TD/);
    expect(html).toMatch(/<svg[^>]*id="mermaid-export-/);

    const exported = await test.step('compare against the preview, in the export page\'s own styles', async () => {
      await win.evaluate((doc) => {
        const host = document.createElement('div');
        host.id = 'export-under-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
        const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
        host.attachShadow({ mode: 'open' }).innerHTML = styles + body;
        document.body.appendChild(host);
      }, html);
      return diagrams(win, '#export-under-test');
    });
    expect(exported.map((d) => d.labels)).toEqual(preview.map((d) => d.labels));
    // The same error, word for word — the export feeds mermaid the exact source the preview does.
    expect(exported[0]!.error).toBeNull();
    expect(exported[1]!.error).toBe(preview[1]!.error);
    expect(preview[1]!.error).toContain('Parse error');
    expect(exported[0]!.clipped, 'a label overflows its box in the export\'s font').toBe(0);
    await win.locator('#export-under-test').screenshot({ path: 'test-results/export-mermaid-export.png' });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
