/**
 * Docs screenshot harness — Editor section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase (with
 * the showcase notes from ./fixtures dropped in). Unlike the Notes section —
 * which photographs rendered Preview output — these shots are about the *editing
 * surface itself*, so they open a note in **Source** view and crop the live
 * CodeMirror editor (styled-as-you-type markup, the wiki-link suggestion list,
 * and the dictation pill).
 *
 * Because there is no shootPreview-equivalent for the editor pane (it fills the
 * full window height), `shootEditor` measures the real content extent — the
 * lowest non-empty `.cm-line`, plus any open autocomplete tooltip — and clips to
 * it, mirroring the crop trick in harness.ts's shootPreview.
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchDemo, openNote, setView, shoot, IMG_DIR, type Harness } from './lib/harness';
import type { Page } from '@playwright/test';

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/**
 * Crop the active CodeMirror editor to its rendered content height (plus any
 * open autocomplete tooltip), so a short note yields a tight image instead of
 * the full fixed-height pane with empty space below.
 */
async function shootEditor(win: Page, id: string): Promise<void> {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const ed = win.locator('.cm-editor').first();
  const box = await ed.boundingBox();
  if (!box) throw new Error(`editor not visible for ${id}`);
  const contentHeight = await ed.evaluate((n) => {
    const top = n.getBoundingClientRect().top;
    let bottom = top;
    for (const line of Array.from(n.querySelectorAll('.cm-line'))) {
      const r = line.getBoundingClientRect();
      if (r.height === 0) continue;
      if ((line.textContent ?? '').trim().length === 0) continue;
      bottom = Math.max(bottom, r.bottom);
    }
    // Include an open completion tooltip so the suggestion list isn't clipped.
    const tip = n.querySelector('.cm-tooltip-autocomplete');
    if (tip) bottom = Math.max(bottom, tip.getBoundingClientRect().bottom);
    return bottom - top + 24; // bottom breathing room
  });
  const height = Math.min(contentHeight, Math.round(box.height));
  await win.screenshot({
    path: path.join(IMG_DIR, `${id}.png`),
    clip: { x: box.x, y: box.y, width: box.width, height },
  });
}

// ── The writing surface: markup styled in place ─────────────────────────────
// Heading with its "#" still showing, bold with "**" intact, an italic run, a
// tinted highlight, and a wiki-link chip — all in the editor, not Preview.
test('editor-writing-surface', async () => {
  await openNote(h.win, 'editor-writing-surface');
  await setView(h.win, 'Source');
  await h.win.waitForTimeout(400);
  await shootEditor(h.win, 'editor-writing-surface');
});

// ── Markdown formatting: the everyday basics rendered in the editor ─────────
// Heading, bold + italic, a bulleted list with a nested item, a quote, a
// horizontal divider, and an inline-code span, side by side.
test('editor-markdown-formatting', async () => {
  await openNote(h.win, 'editor-markdown-formatting');
  await setView(h.win, 'Source');
  await h.win.waitForTimeout(400);
  await shootEditor(h.win, 'editor-markdown-formatting');
});

// ── Link autocomplete: type "[[" and the suggestion list opens ──────────────
// Open a short note, drop the cursor at the end, and type "[[Mandolin" so the
// wiki-link completion list filters to the several mandolin notes in the vault.
test('editor-link-autocomplete', async () => {
  await openNote(h.win, 'editor-link-autocomplete');
  await setView(h.win, 'Source');
  await h.win.waitForTimeout(400);

  // Place the cursor at the end of the last line, then type a partial link.
  const lastLine = h.win.locator('.cm-line').last();
  await lastLine.click();
  await h.win.keyboard.press('End');
  await h.win.keyboard.type(' [[Mandolin', { delay: 40 });
  // Let the completion source resolve and the tooltip render.
  await h.win.locator('.cm-tooltip-autocomplete').first().waitFor({ state: 'visible', timeout: 4000 });
  await h.win.waitForTimeout(400);

  await shootEditor(h.win, 'editor-link-autocomplete');
  await h.win.keyboard.press('Escape'); // dismiss the list before the next test
});

// ── Voice dictation: the floating "Listening…" pill ─────────────────────────
// FLAGGED: the pill (`.dictation-pill`) is Svelte-rendered from live voice-store
// state — it only appears once recording actually starts, which needs mic
// permission and (first run) a Whisper model download. In the packaged harness
// that will most likely surface a model-download or permission-error pill rather
// than a clean "Listening…" state. Best-guess recipe below; needs human review /
// a hand-staged capture.
test('editor-voice-dictation', async () => {
  await openNote(h.win, 'editor-voice-dictation');
  await setView(h.win, 'Source');
  await h.win.waitForTimeout(400);

  // Put the cursor in the body so the pill reads as dictating into this note.
  await h.win.locator('.cm-line').last().click();
  await h.win.keyboard.press('End');

  // ⌘⇧V toggles editor dictation. See src/renderer/lib/editor/dictation.ts.
  await h.win.keyboard.press('Meta+Shift+V');
  // Give the pill a moment to mount (recording / model-progress / error).
  await h.win.waitForTimeout(2500);

  // Full window so the bottom-centered pill is in frame regardless of state.
  await shoot(h.win, 'editor-voice-dictation');

  // Best-effort teardown so a lingering recording doesn't bleed into afterAll.
  await h.win.keyboard.press('Escape').catch(() => {});
});
