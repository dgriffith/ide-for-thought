/**
 * Docs screenshot harness — Export section.
 *
 * Three UI-chrome shots (not rendered note content), so each test navigates to
 * a dialog and crops it:
 *   - export-bibliography   → Settings ▸ Bibliography panel (citation style + imports)
 *   - export-scopes-privacy → the Export dialog's Including / Excluded audit
 *   - export-publishing     → the Publish to Web dialog with a saved target
 *
 * These dialogs are normally launched from the native app menu, which Playwright
 * can't drive. We reach the exact same renderer state by sending the menu's IPC
 * message straight to the window's webContents from the main process — the same
 * channel the menu click uses (src/main/menu.ts → Channels.MENU_*).
 */
import { test } from '@playwright/test';
import { launchDemo, shoot, type Harness } from './lib/harness';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Fire a menu IPC message at the renderer (native menus can't be clicked). */
async function sendMenu(channel: string, arg?: string): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }, { channel, arg }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (arg === undefined) w.webContents.send(channel);
      else w.webContents.send(channel, arg);
    }
  }, { channel, arg });
}

// Settings ▸ Bibliography — the citation-style picker, imported styles list, and
// the "Import .csl style…" button. Same panel the docs page photographs.
test('export-bibliography', async () => {
  await sendMenu('menu:openSettings');
  await h.win.waitForTimeout(600);
  await h.win.locator('.tab', { hasText: 'Bibliography' }).first().click();
  await h.win.waitForTimeout(600);
  await shoot(h.win, 'export-bibliography', h.win.locator('.dialog[aria-label="Settings"]'));
  await h.win.getByRole('button', { name: 'Cancel', exact: true }).click();
  await h.win.waitForTimeout(300);
});

// Export dialog at project scope: the Including list plus the Excluded list,
// where the private fixtures land with their plain-English reasons. No note is
// open, so the family's only available scope is the whole project — exactly the
// wide audit the Scopes & privacy page describes.
test('export-scopes-privacy', async () => {
  await sendMenu('menu:export', 'markdown');
  await h.win.waitForTimeout(800);
  // Make sure we're on the widest scope so both lists are well populated.
  const projectRadio = h.win.locator('input[name="scope"][value="project"]');
  if (await projectRadio.count()) await projectRadio.first().check();
  // Let resolvePlan walk the tree and classify the private notes.
  await h.win.waitForTimeout(1500);
  await shoot(h.win, 'export-scopes-privacy', h.win.locator('.export-dialog'));
  await h.win.getByRole('button', { name: 'Cancel', exact: true }).click();
  await h.win.waitForTimeout(300);
});

// Publish to Web with one saved target, showing the Preview / Publish actions.
// Seed the target first (the copied vault is throwaway) so the dialog shows a
// real card instead of its empty state. We do NOT click Preview/Publish — that
// would hit the network.
test('export-publishing', async () => {
  await h.win.evaluate(async () => {
    // window.api is the app's preload bridge; not in the DOM lib types.
    const api = (window as unknown as { api: { publish: { upsertTarget: (t: unknown) => Promise<unknown> } } }).api;
    await api.publish.upsertTarget({
      id: 'mandolin-garden',
      label: 'Mandolin Garden',
      exporter: 'static-site',
      gitRemote: 'https://github.com/luthier/mandolin-garden.git',
      gitBranch: 'gh-pages',
      subdir: '.',
      commitMessageTemplate: 'Publish {{date}} from Minerva',
    });
  });
  await sendMenu('menu:publish');
  await h.win.waitForTimeout(700);
  await shoot(h.win, 'export-publishing', h.win.locator('.publish-dialog'));
  await h.win.getByRole('button', { name: 'Close', exact: true }).click();
  await h.win.waitForTimeout(300);
});
