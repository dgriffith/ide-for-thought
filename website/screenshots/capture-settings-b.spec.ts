/**
 * Docs screenshot harness — Settings (group B) section.
 *
 * Captures the "Ingest & compute" and "AI" Settings tabs. Each shot opens the
 * Settings dialog via the command palette (⌘K → "Settings…" — the renderer
 * keymap does not wire ⌘, ; only the OS menu accelerator does, and Playwright
 * can't drive native menus), switches to the target tab, and crops the dialog.
 *
 * One test per doc page; the test name IS the page basename so the image wires
 * to that page. The image crops the whole Settings dialog (nav rail + panel) so
 * the reader sees which tab is active and its content together.
 */
import { test, expect } from '@playwright/test';
import { launchDemo, shoot, type Harness } from './lib/harness';

interface Shot {
  /** Output image id === doc page basename. */
  id: string;
  /** Exact `.tab-label` text of the Settings tab to activate. */
  tab: string;
  /** Extra settle (ms) for panels that load async state on mount. */
  settle?: number;
}

const SHOTS: Shot[] = [
  { id: 'settings-web',     tab: 'Web' },
  { id: 'settings-sources', tab: 'Sources' },
  { id: 'settings-clipper', tab: 'Browser Clipper' },
  { id: 'settings-compute', tab: 'Compute', settle: 1200 }, // python probe
  { id: 'settings-ai',      tab: 'AI',      settle: 600 },
  { id: 'settings-skills',  tab: 'Skills',  settle: 900 },   // skill catalog load
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

/** Open the Settings dialog through the command palette. Leaves it on the
 *  default (Editor) tab; the caller switches to the tab it wants. */
async function openSettings(win: Harness['win']): Promise<void> {
  // ⌘K opens the palette (needs a loaded project, which the demo vault is).
  await win.keyboard.press('Meta+k');
  const input = win.locator('input.input');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill('Settings');
  await win.waitForTimeout(200);
  await win.locator('.result-item', { hasText: 'Settings' }).first().click();
  await expect(win.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(400);
}

for (const shot of SHOTS) {
  test(shot.id, async () => {
    await openSettings(h.win);
    // Activate the target tab. `.tab-label` carries exactly the tab's label
    // text, so an anchored regex disambiguates it from the group-cluster
    // headings (e.g. the "AI" group label shares text with the AI tab).
    const label = new RegExp(`^${shot.tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    await h.win.locator('.tab-label', { hasText: label }).first().click();
    await h.win.waitForTimeout(shot.settle ?? 500);
    await shoot(h.win, shot.id, h.win.getByRole('dialog', { name: 'Settings' }));
    // Close the dialog so the next shot's palette isn't occluded by it.
    await h.win.keyboard.press('Escape');
    await h.win.waitForTimeout(300);
  });
}
