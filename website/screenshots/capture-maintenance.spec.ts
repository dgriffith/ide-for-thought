/**
 * Docs screenshot harness — Maintenance section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase, then
 * captures the single Maintenance-page shot.
 *
 * ── HARD CASE / FLAGGED ──────────────────────────────────────────────────────
 * The Maintenance page documents actions that live ONLY in the native Electron
 * *File* menu (Rebuild All Indexes, Rebuild Semantic Index, Interrupt Cell,
 * Restart Calculations, Clear Recent Thoughtbases — see src/main/menu.ts). None
 * of these are registered in the renderer command-palette registry
 * (src/renderer/lib/command-palette/registry.ts), and Playwright cannot
 * screenshot OS-native menu bars / popups — they are not part of the page's web
 * contents.
 *
 * There is therefore NO faithful in-app DOM surface for this shot. As a
 * best-guess placeholder this recipe captures the in-app command palette (⌘K),
 * the nearest "menu of actions" surface, so the page has *something* to render.
 * A human must either (a) hand-capture the real macOS File menu, or (b) accept
 * the palette substitute knowing it does NOT contain the File-menu maintenance
 * items. Do not ship this as-is without review.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, shoot, type Harness } from './lib/harness';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

test('maintenance', async () => {
  // A project must be open for the palette keybinding to fire (hasProject gate
  // in handle-keydown.ts). Open any note so the editor — and its command
  // context — is live behind the palette.
  await openNote(h.win, 'Mandolin Family Tree');
  // ⌘K opens the command palette (src/renderer/lib/keymap/handle-keydown.ts:37 —
  // ⌘⇧P is taken by "Cycle Preview Mode", so the palette uses ⌘K).
  await h.win.keyboard.press('Meta+k');
  await h.win.waitForTimeout(600);
  // Crop to the palette dialog itself (class .dialog, role=dialog).
  await shoot(h.win, 'maintenance', h.win.getByRole('dialog', { name: 'Command palette' }));
});
