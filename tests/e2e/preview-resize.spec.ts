/**
 * Resizing an image and an object-view embed in the preview (#2666), in real
 * Chromium: a pointer drag on the handle (not HTML5 drag-and-drop) writes the
 * size into the open editor's document, ⌘Z there takes it back, and the
 * keyboard steps the size and keeps focus on the handle across the re-render.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '---', ''].join('\n'));
  write('places/Kampa Museum.md', '---\ntype: place\ncity: Prague\n---\n# Kampa Museum\n');
  fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from(PNG_BASE64, 'base64'));
  write('Shots.md', '# Shots\n\n![shot|200](pic.png)\n\n```object-view\n{"typeId":"place","layout":"list"}\n```\n');
}

/** Drag from a handle's centre by (dx, dy) with real mouse events. */
async function dragHandle(win: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await win.mouse.move(x + dx, y + dy, { steps: 4 });
  await win.mouse.up();
}

/**
 * Run `action`, which changes the note, then wait for the preview to re-render
 * it (#2680). The preview re-renders a content change ~120ms later, debounced,
 * and `{@html}` swaps in all-new nodes, resize handles included. A step that
 * reaches for a handle before the swap gets one that's about to be detached:
 * "not attached to the DOM", a drag that lands on a vanishing element, or keys
 * sent to a handle that's gone. A slow CI runner widens that window. So: hold
 * a node from the current render and wait until it's gone.
 */
async function changingPreview(win: Page, preview: Locator, action: () => Promise<void>): Promise<void> {
  const marker = await preview.locator('h1').first().elementHandle();
  await action();
  await win.waitForFunction((el) => !el.isConnected, marker, { timeout: 10_000 });
}

test('preview resize handles write the size into the note, undoably (#2666)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-resize-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-resize-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 950, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    const row = win.locator('[data-relative-path="Shots.md"]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.click();
    await win.getByRole('button', { name: 'Side by side', exact: true }).click();
    const source = win.locator('.cm-content').first();
    const preview = win.locator('.preview').first();
    await expect(preview.locator('img.local-image')).toHaveAttribute('width', '200', { timeout: 10_000 });

    await test.step('drag the image corner wider', async () => {
      await preview.locator('.resizable-image').hover();
      await changingPreview(win, preview, async () => {
        await dragHandle(win, preview.locator('.resizable-image [data-resize-handle]'), 80, 0);
        await expect(source).toContainText('![shot|280](pic.png)');
      });
      await expect(preview.locator('img.local-image')).toHaveAttribute('width', '280');
    });

    await test.step('⌘Z in the editor takes the resize back', async () => {
      await source.click();
      await changingPreview(win, preview, async () => {
        await win.keyboard.press('Meta+z');
        await expect(source).toContainText('![shot|200](pic.png)');
      });
    });

    await test.step('drag the object view\'s bottom edge shorter', async () => {
      const block = preview.locator('.object-view-block[data-object-view-rendered="ok"]');
      await expect(block).toContainText('Kampa Museum', { timeout: 10_000 });
      await preview.locator('.fence-object-view').hover();
      // Upward: the handle sits near the window's bottom edge, and a drag
      // past the viewport isn't delivered to the page.
      await changingPreview(win, preview, async () => {
        await dragHandle(win, preview.locator('.fence-object-view [data-resize-handle]'), 0, -100);
        await expect(source).toContainText('"height":260');
      });
      await expect.poll(() => block.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(260);
    });

    await test.step('Alt+arrows step the image and keep focus on its handle', async () => {
      const handle = preview.locator('.resizable-image [data-resize-handle]');
      await handle.focus();
      await changingPreview(win, preview, async () => {
        await win.keyboard.press('Alt+ArrowRight');
        await win.keyboard.press('Alt+ArrowRight');
        await expect(source).toContainText('![shot|240](pic.png)');
      });
      await expect.poll(() => win.evaluate(() => document.activeElement?.hasAttribute('data-resize-handle') ?? false)).toBe(true);
      await win.keyboard.press('Alt+0');
      await expect(source).toContainText('![shot](pic.png)');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
