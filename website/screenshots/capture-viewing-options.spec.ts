/**
 * Docs screenshot harness — Viewing options section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase (with
 * the showcase notes from ./fixtures dropped in), then captures the four
 * viewing-options doc shots. Unlike the Notes section these are mostly UI-chrome
 * shots (a split layout, the Settings dialog, the command palette) rather than
 * rendered note content, so each test navigates to its state and crops the
 * relevant element or the whole window.
 *
 * Each test is named EXACTLY the doc page basename so the image id wires to that
 * page: viewing-options-view-modes, viewing-options-split-panes-windows,
 * viewing-options-themes, viewing-options-font-size-zoom.
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

// ── View modes ────────────────────────────────────────────────────────────
// A note in "Side by side" mode: source text on the left, the same content
// rendered on the right, with the Source / Side by side / Preview toggle above
// showing Side by side as active. Full-window shot so the toolbar toggle and
// both halves are visible together.
test('viewing-options-view-modes', async () => {
  const win = h.win;
  await openNote(win, 'vw-side-by-side');
  await setView(win, 'Side by side');
  await win.waitForTimeout(600);
  await shoot(win, 'viewing-options-view-modes');
});

// ── Split panes & windows ─────────────────────────────────────────────────
// Two side-by-side panes: the left pane editing one note in Source, the right
// pane reading a different note in Preview. Each pane keeps its own tab bar and
// toolbar. Built by opening a note, clicking the toolbar's "Split right", then
// opening a second note in the new (now active) right pane.
test('viewing-options-split-panes-windows', async () => {
  const win = h.win;
  await openNote(win, 'vw-editing');
  await setView(win, 'Source');
  // Split right creates an empty pane to the right and focuses it.
  await win.locator('[title="Split right"]').first().click();
  await win.waitForTimeout(600);
  // The new (right) pane is active — opening a note lands there.
  await openNote(win, 'vw-reading');
  // Left pane → Source (editing), right pane → Preview (reading). Each pane has
  // its own view-toggle, so target them positionally: nth(0)=left, nth(1)=right.
  await win.locator('.group-pane').nth(0)
    .getByRole('button', { name: 'Source', exact: true }).click();
  await win.waitForTimeout(300);
  await win.locator('.group-pane').nth(1)
    .getByRole('button', { name: 'Preview', exact: true }).click();
  await win.waitForTimeout(800);
  await shoot(win, 'viewing-options-split-panes-windows');
});

// ── Themes ────────────────────────────────────────────────────────────────
// The Appearance tab in Settings, whose first control is the Theme picker.
// NOTE: the Theme picker is a native <select>; its open dropdown (Dark / Light /
// High Contrast / System) is an OS-native popup Playwright cannot screenshot, so
// this crops the Appearance panel with the picker closed. See return summary.
test('viewing-options-themes', async () => {
  const win = h.win;
  // Open Settings via the title-bar cog (title="Settings").
  await win.locator('button[title="Settings"]').first().click();
  await win.waitForTimeout(500);
  // Switch to the Appearance tab.
  await win.locator('button.tab').filter({ hasText: 'Appearance' }).first().click();
  await win.waitForTimeout(500);
  await shoot(win, 'viewing-options-themes', win.locator('.dialog[aria-label="Settings"]'));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
});

// ── Font size & zoom ──────────────────────────────────────────────────────
// The doc wants the OS-native View menu open on its zoom + font-size commands.
// Playwright cannot screenshot the native app menu bar, and the window-zoom
// commands live ONLY in that native menu — the command palette carries just the
// three editor font-size commands. This best-guess substitute opens the command
// palette (Cmd+K) filtered to "Font Size" so those View-category commands show
// as a DOM list. FLAGGED for human review — likely needs a manual native-menu
// capture (or the doc reframed around the in-app font commands).
test('viewing-options-font-size-zoom', async () => {
  const win = h.win;
  await win.keyboard.press('Meta+k');
  await win.waitForTimeout(400);
  await win.locator('.dialog[aria-label="Command palette"] input.input').fill('Font Size');
  await win.waitForTimeout(500);
  await shoot(win, 'viewing-options-font-size-zoom',
    win.locator('.dialog[aria-label="Command palette"]'));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
});
