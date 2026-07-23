/**
 * Marketing-site screenshot harness (#website).
 *
 * Same machinery as the docs capture specs (launches the packaged app against a
 * copy of the demo thoughtbase), but the shots are the full-window "hero" images
 * the marketing pages call for, written to `website/img/<id>.png`. The page
 * placeholders are swapped in by `website/screenshots/swap-marketing-shots.mjs`,
 * keyed on each `.shot`'s `data-shot="<id>"`.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, setView, shoot, MARKETING_IMG_DIR, type Harness } from './lib/harness';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => { h = await launchDemo(); });
test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Full-window marketing shot into website/img/<id>.png. */
async function shootWindow(id: string) {
  await shoot(h.win, id, undefined, MARKETING_IMG_DIR);
}

/** Ensure the right sidebar is open/closed — captures share one app instance,
 *  so each full-window shot must set the chrome it wants rather than inherit
 *  the previous shot's. */
async function setRightSidebar(open: boolean) {
  const visible = await h.win.locator('aside.right-sidebar').isVisible().catch(() => false);
  if (visible !== open) await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await h.win.waitForTimeout(300);
}

// ── Hero — the app in its best light: a rich note in split view. ────────────
// Used for both index.html and features.html heroes.
test('index-hero', async () => {
  await openNote(h.win, 'Ancient Roots - The Oud and the Lute Family');
  await setView(h.win, 'Side by side');
  await setRightSidebar(false);
  await h.win.waitForTimeout(1200);
  await shootWindow('index-hero');
});

// ── A thoughtbase with depth — a rendered note + the outgoing-links web. ─────
test('thoughtbase-depth', async () => {
  await openNote(h.win, 'Ancient Roots - The Oud and the Lute Family');
  await setView(h.win, 'Preview');
  await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await h.win.waitForTimeout(500);
  await h.win.locator('.group-tab[title="Links"]').first().click();
  await h.win.waitForTimeout(300);
  await h.win.locator('.sub-tab[title="Outgoing"]').first().click();
  await h.win.waitForTimeout(700);
  await shootWindow('thoughtbase-depth');
});

// ── Editor / writing surface — the source pane at work. ─────────────────────
test('editor-split', async () => {
  await openNote(h.win, 'editor-writing-surface');
  await setView(h.win, 'Side by side');
  await setRightSidebar(false);
  await h.win.waitForTimeout(900);
  await shootWindow('editor-split');
});

// ── Data analysis — a note with live charts / query result blocks. ──────────
test('data-analysis', async () => {
  await openNote(h.win, 'charts');
  await setView(h.win, 'Preview');
  await setRightSidebar(false);
  await h.win.waitForTimeout(1800);
  await shootWindow('data-analysis');
});
