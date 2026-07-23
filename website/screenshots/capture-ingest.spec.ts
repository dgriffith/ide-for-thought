/**
 * Docs screenshot harness — Ingest section.
 *
 * Launches the packaged app once against a copy of the demo thoughtbase, then
 * captures the three ingest doc shots. Unlike the Notes section (rendered note
 * content), every ingest shot is a piece of UI chrome — a panel, a prompt, or a
 * dialog — so each test navigates to the state and crops the element (or the
 * full window) rather than using shootPreview.
 *
 * Confidence per shot:
 *   • ingest-adding-sources — SOLID. Sources panel + the "add source" prompt.
 *   • ingest-clipper        — FLAGGED. The real doc shot is the browser-
 *     extension popup, which Playwright driving the Electron app CANNOT capture.
 *     This recipe grabs the closest in-app surface (Settings → Browser Clipper)
 *     as a placeholder; a human must screenshot the extension popup in a real
 *     browser and swap it in.
 *   • ingest-pdf            — FLAGGED. The OCR "offer to recognize" dialog only
 *     renders after a scanned (image-only) PDF is ingested through App's ingest
 *     handler, which sets the OCR-flow store. There is no scanned PDF in the
 *     vault and no state-injection hook, so this recipe drives the intended path
 *     (palette → Ingest URL → prompt) with a PLACEHOLDER url; it needs a real
 *     scanned PDF reachable offline (or a renderer test hook) to actually land.
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

/** Dismiss any open modal/menu so each test starts from a clean surface. */
async function reset(): Promise<void> {
  await h.win.keyboard.press('Escape');
  await h.win.waitForTimeout(200);
  await h.win.keyboard.press('Escape');
  await h.win.waitForTimeout(200);
}

/** Open the command palette (⌘K) and run the first match for `query`. */
async function runCommand(query: string): Promise<void> {
  await h.win.keyboard.press('Meta+KeyK');
  const input = h.win.locator('.dialog[aria-label="Command palette"] input.input');
  await input.waitFor({ timeout: 5000 });
  await input.fill(query);
  await h.win.waitForTimeout(300);
  await input.press('Enter');
  await h.win.waitForTimeout(400);
}

// ── ingest-adding-sources ────────────────────────────────────────────────
// The Sources panel with its "+" add-source affordance and the box you paste a
// web address or paper identifier into. Clicking "+" opens the smart-paste
// prompt (SourcesPanel.handleAddSource → showPrompt). We pre-fill an example URL
// so the box reads as a real capture. Full-window shot so the Sources panel is
// visible behind the centered prompt.
test('ingest-adding-sources', async () => {
  await reset();
  // Switch the left sidebar to the Sources panel (panel-tab titled "Sources").
  await h.win.getByTitle('Sources', { exact: true }).click();
  await h.win.waitForTimeout(500);
  // Click the "+" add-source button in the filter row.
  await h.win.locator('.add-source-btn').click();
  // The smart-paste PromptDialog opens ("URL, DOI, arXiv id, or PubMed id:").
  const promptInput = h.win.locator('.dialog[aria-labelledby="prompt-dialog-title"] input.input');
  await promptInput.waitFor({ timeout: 5000 });
  await promptInput.fill('https://en.wikipedia.org/wiki/Mandolin');
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'ingest-adding-sources');
  await reset();
});

// ── ingest-clipper ───────────────────────────────────────────────────────
// FLAGGED. The doc wants the browser-clipper POPUP open over a web page — that
// lives in a browser extension (src/main/clipper is the paired local server),
// not in the Electron window, so Playwright driving the app cannot photograph
// it. This captures the in-app Settings → Browser Clipper tab as a stand-in so
// there's a placeholder image; a human must screenshot the extension popup in a
// real browser and swap it in for the shipped doc.
test('ingest-clipper', async () => {
  await reset();
  await runCommand('Settings');
  const settings = h.win.locator('.dialog[aria-label="Settings"]');
  await settings.waitFor({ timeout: 5000 });
  // Select the "Browser Clipper" tab (button.tab with a .tab-label).
  await h.win.locator('button.tab', { hasText: 'Browser Clipper' }).click();
  await h.win.waitForTimeout(500);
  await shoot(h.win, 'ingest-clipper', settings);
  await reset();
});

// ── ingest-pdf ───────────────────────────────────────────────────────────
// FLAGGED. The doc shot is the OCR "offer to recognize a scanned PDF" dialog
// (OcrProgressDialog, confirm stage — title "Run OCR on …"). It only renders
// after App's ingest handler detects a scanned PDF (result.needsOcr) and sets
// the OCR-flow store (sourceFlow.setOcrSession + setOcrPdfBytes). There is no
// scanned PDF in the demo vault, the fixtures mechanism only copies .md files,
// and no renderer hook exposes the store — so this recipe drives the real path
// (palette → "Ingest URL as Source…" → prompt → confirm) with a PLACEHOLDER
// url. To make it land, a human must supply a real image-only PDF reachable by
// the ingest path offline, OR add a renderer test hook that sets the OCR store
// directly. As written, a bogus url yields an ingest-error dialog instead and
// the OCR-dialog wait fails — that failure is expected until wired.
const SCANNED_PDF_URL = 'https://example.com/REPLACE-with-a-scanned-image-only.pdf';
test('ingest-pdf', async () => {
  await reset();
  await runCommand('Ingest URL as Source');
  // handleIngestUrlAsSource → showPrompt('URL to ingest as a source:')
  const promptInput = h.win.locator('.dialog[aria-labelledby="prompt-dialog-title"] input.input');
  await promptInput.waitFor({ timeout: 5000 });
  await promptInput.fill(SCANNED_PDF_URL);
  await promptInput.press('Enter');
  // On a scanned PDF, handleIngestedSourceResult sets the OCR session and the
  // confirm dialog renders. Crop that dialog.
  const ocrDialog = h.win.locator('.dialog', { hasText: 'Run OCR on' });
  await ocrDialog.waitFor({ timeout: 30000 });
  await shoot(h.win, 'ingest-pdf', ocrDialog);
  await reset();
});
