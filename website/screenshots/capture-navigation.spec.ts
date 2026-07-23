/**
 * Docs screenshot harness — Navigation section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase (with
 * the showcase notes from ./fixtures dropped in), then drives the real
 * navigation surfaces — command palette, quick switch, wiki-link hover,
 * project-wide search, the editor breadcrumb bar, and the title-bar
 * back/forward arrows — and crops each to website/docs/img/<id>.png.
 *
 * Unlike the Notes section (a manifest loop over rendered notes), each
 * navigation shot needs a bespoke recipe: a keyboard-launched dialog, a hover
 * state, or a specific chrome element. So this file is one hand-written `test`
 * per doc page. The test name is the doc page basename, which becomes the image
 * id that wires the shot to that page.
 *
 * Every dialog is opened by the real key/command path (not by poking state):
 *   - Command palette  → ⌘K  (window keymap → toggleCommandPalette)
 *   - Quick switch     → ⌘P  (window keymap → toggleQuickOpen)
 *   - Find in Notes    → run the "Find in Notes…" command from the palette
 *                        (the OS menu can't be screenshot; the palette can)
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, setView, shoot, type Harness } from './lib/harness';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Dismiss any open overlay so leftover dialog state can't bleed into the
 *  next serial test. */
async function closeOverlays(): Promise<void> {
  await h.win.keyboard.press('Escape');
  await h.win.waitForTimeout(200);
}

// ── Command palette (⌘K): a launcher for actions, with a query typed ────────
test('navigation-command-palette', async () => {
  await h.win.keyboard.press('Meta+k');
  await h.win.waitForTimeout(400);
  const dialog = h.win.getByRole('dialog', { name: 'Command palette' });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  // Type a query so the shot shows the ranked, filtered list (matches the
  // doc copy, which uses "link").
  const cpInput = h.win.getByPlaceholder('Type a command…');
  await cpInput.click();
  await cpInput.fill('link');
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'navigation-command-palette', dialog);
  await closeOverlays();
});

// ── Quick switch (⌘P): jump to a note / source / query by name ──────────────
test('navigation-quick-switch', async () => {
  await h.win.keyboard.press('Meta+p');
  await h.win.waitForTimeout(400);
  const dialog = h.win.getByRole('dialog', { name: 'Go to' });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  // "mandolin" matches notes and sources, so the list + scope chips (with
  // their counts) read as the mixed picker the doc describes.
  const gotoInput = h.win.getByPlaceholder('Go to...');
  await gotoInput.click();
  await gotoInput.fill('mandolin');
  await h.win.waitForTimeout(500);
  await shoot(h.win, 'navigation-quick-switch', dialog);
  await closeOverlays();
});

// ── Wiki-links: peek at a linked note by hovering the [[link]] in Preview ───
test('navigation-wiki-links', async () => {
  await openNote(h.win, 'nav-wiki-links');
  await setView(h.win, 'Preview');
  // Rest the pointer on the first wiki-link; the async note-preview fetcher
  // resolves the target note and fills the hover popover (.cite-tooltip).
  const link = h.win.locator('.preview .wiki-link').first();
  await link.waitFor({ state: 'visible', timeout: 5000 });
  await link.hover();
  await h.win.waitForTimeout(1200);
  // The popover is an absolutely-positioned child of .preview, so crop the
  // whole pane to keep the link + its popover together.
  await shoot(h.win, 'navigation-wiki-links', h.win.locator('.preview').first());
});

// ── Search (Find in Notes): project-wide text search with results ───────────
test('navigation-search', async () => {
  // The OS menu / ⌘⇧F path can't be screenshot-driven, so open the dialog via
  // its command-palette entry instead — same code path (setFindInNotesMode).
  await h.win.keyboard.press('Meta+k');
  await h.win.waitForTimeout(400);
  await h.win.getByRole('dialog', { name: 'Command palette' })
    .waitFor({ state: 'visible', timeout: 5000 });
  const cpInput = h.win.getByPlaceholder('Type a command…');
  await cpInput.click();
  await cpInput.fill('find in notes');
  await h.win.waitForTimeout(400);
  await h.win.keyboard.press('Enter');
  // The Find dialog: type a query and let the debounced search + IPC settle so
  // the grouped results render.
  const find = h.win.getByPlaceholder('Find in notes…');
  await find.waitFor({ state: 'visible', timeout: 5000 });
  await find.fill('mandolin');
  await h.win.waitForTimeout(1200);
  const dialog = h.win.locator('.dialog').filter({ hasText: 'Find & Replace' });
  await shoot(h.win, 'navigation-search', dialog);
  await closeOverlays();
});

// ── Breadcrumbs: the folder trail above a note that lives in nested folders ──
test('navigation-breadcrumbs', async () => {
  // Jump to a note nested under notes/mandolin-history via Quick switch so the
  // breadcrumb bar has a real folder path to show (openNote can't reach a
  // collapsed folder). The bar derives purely from the active file's path.
  await h.win.keyboard.press('Meta+p');
  await h.win.waitForTimeout(400);
  await h.win.getByRole('dialog', { name: 'Go to' })
    .waitFor({ state: 'visible', timeout: 5000 });
  const gotoInput = h.win.getByPlaceholder('Go to...');
  await gotoInput.click();
  await gotoInput.fill('Rise of Bluegrass');
  await h.win.waitForTimeout(500);
  await h.win.keyboard.press('Enter');
  const bar = h.win.locator('.breadcrumbs').first();
  await bar.waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'navigation-breadcrumbs', bar);
});

// ── Back / forward: the title-bar arrows after moving between notes ─────────
test('navigation-back-forward', async () => {
  // Two sidebar opens build a history trail: after the second, Back is active
  // and Forward is dimmed — exactly the state the doc image describes.
  await openNote(h.win, 'Mandolin Family Tree');
  await openNote(h.win, 'nav-wiki-links');
  await h.win.waitForTimeout(400);
  // Crop the whole title bar so the arrows read in context (breadcrumb trail
  // to their right), per the doc's "at the left edge of the title bar".
  await shoot(h.win, 'navigation-back-forward', h.win.locator('.titlebar').first());
});
