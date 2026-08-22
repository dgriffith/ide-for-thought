/**
 * Docs screenshot harness — Settings (group A).
 *
 * Captures the first cluster of Settings panels. Each shot opens the Settings
 * dialog (via the command palette → "Settings…"), switches to the target tab by
 * clicking its row in the left rail, and crops the whole dialog so the shot
 * shows the tab list + the active panel. `id` (== the doc page basename) is the
 * output image name; `tab` is the exact tab-label text in the Settings rail.
 *
 * No fixtures are needed — these panels render app chrome, not note content.
 */
import { test } from '@playwright/test';
import { launchDemo, shoot, type Harness } from './lib/harness';

interface Shot { id: string; tab: string; settle?: number }

const SETTINGS_SHOTS: Shot[] = [
  { id: 'settings-editor',       tab: 'Editor' },
  { id: 'settings-appearance',   tab: 'Appearance' },
  { id: 'settings-behaviors',    tab: 'Behaviors' },
  { id: 'settings-notes',        tab: 'Notes' },
  { id: 'settings-versioning',   tab: 'Versioning' },
  { id: 'settings-formatter',    tab: 'Formatter' },
  { id: 'settings-bibliography', tab: 'Bibliography', settle: 800 },
];

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Open the Settings dialog via the command palette if it isn't already open. */
async function ensureSettingsOpen(): Promise<void> {
  const dialog = h.win.locator('[role="dialog"][aria-label="Settings"]');
  if (await dialog.count() > 0 && await dialog.first().isVisible()) return;
  // ⌘K toggles the command palette (see keymap/handle-keydown.ts).
  await h.win.keyboard.press('Meta+k');
  const palette = h.win.locator('[role="dialog"][aria-label="Command palette"]');
  await palette.waitFor({ state: 'visible', timeout: 5000 });
  await palette.getByPlaceholder('Type a command…').fill('Settings');
  await h.win.waitForTimeout(300);
  await h.win.keyboard.press('Enter');
  await dialog.first().waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
}

for (const shot of SETTINGS_SHOTS) {
  test(shot.id, async () => {
    await ensureSettingsOpen();
    // Switch to the target tab by clicking its label in the left rail. The
    // .tab-label span carries the exact tab name; the click bubbles to the
    // enclosing .tab button.
    await h.win.locator('nav.tabs').getByText(shot.tab, { exact: true }).first().click();
    await h.win.waitForTimeout(shot.settle ?? 400);
    await shoot(h.win, shot.id, h.win.locator('[role="dialog"][aria-label="Settings"]'));
  });
}
