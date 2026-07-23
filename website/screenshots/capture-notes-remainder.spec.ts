/**
 * Docs screenshot harness — Notes (remainder) section.
 *
 * Covers the four Notes pages not handled by the main `capture.spec.ts` Notes
 * manifest: the Notes overview hub, flashcards, images, and media (YouTube).
 *
 * Same shape as the Notes template: launch the packaged app once against a copy
 * of the demo thoughtbase (with this section's ./fixtures dropped into the vault
 * root), then render each feature note and crop.
 *
 * - `notes-flashcards`, `notes-images`, `notes-media` render note content, so
 *   they open the fixture note, switch to Preview, and `shootPreview` (tight
 *   crop to the rendered content).
 * - `notes` is the section hub — it photographs note *management*: the left
 *   sidebar with a right-click context menu (Rename / Move / Delete) open on a
 *   note, over an open note in Preview. That's chrome, so it's a full-window
 *   `shoot`.
 */
import { test } from '@playwright/test';
import { launchDemo, openNote, setView, shoot, shootPreview, type Harness } from './lib/harness';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

// Section hub: managing notes from the sidebar. Open a rich note in Preview so
// the editor shows real content, then right-click its sidebar row to open the
// file context menu (Rename / Move / Delete — a DOM menu, not an OS menu), and
// capture the whole window.
test('notes', async () => {
  await openNote(h.win, 'notes-overview');
  await setView(h.win, 'Preview');
  const row = h.win
    .locator('aside.sidebar .tree-item.file', { hasText: 'notes-overview' })
    .first();
  await row.click({ button: 'right' });
  // Let the context menu mount + clamp into the viewport.
  await h.win.waitForTimeout(500);
  await shoot(h.win, 'notes');
});

// A `[!card]` callout renders front · "Show answer" disclosure · back. The
// preview post-render pass (hydrateCardCallouts) collapses the answer, which is
// exactly the study-friendly state we want to show.
test('notes-flashcards', async () => {
  await openNote(h.win, 'notes-flashcards-card');
  await setView(h.win, 'Preview');
  await h.win.waitForTimeout(600);
  await shootPreview(h.win, 'notes-flashcards');
});

// An inline image. The fixture links a remote Wikimedia thumbnail; the app's CSP
// allows `img-src https:`, so it loads directly (the local image cache is an
// enhancement). Needs network at capture time.
test('notes-images', async () => {
  await openNote(h.win, 'notes-images-showcase');
  await setView(h.win, 'Preview');
  // Scroll the image into view to trigger lazy load, then give the remote fetch +
  // hydration time to complete before the tight crop.
  await h.win.locator('.preview img').first().scrollIntoViewIfNeeded().catch(() => {});
  await h.win.waitForTimeout(4500);
  await shootPreview(h.win, 'notes-images');
});

// A `youtube` fence renders a click-to-open poster card. The thumbnail comes
// from img.youtube.com (hqdefault.jpg exists for any public video); the preview
// hydrates a cached copy via api.youtube.thumbnail. Needs network at capture.
test('notes-media', async () => {
  await openNote(h.win, 'notes-media-youtube');
  await setView(h.win, 'Preview');
  await h.win.locator('.preview img.youtube-thumb').first().scrollIntoViewIfNeeded().catch(() => {});
  // Poster thumbnail is fetched async — wait before cropping.
  await h.win.waitForTimeout(4500);
  await shootPreview(h.win, 'notes-media');
});
