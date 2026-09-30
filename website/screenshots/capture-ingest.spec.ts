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
 *   • ingest-pdf            — SOLID (#1399). The OCR "offer to recognize"
 *     dialog only renders after a scanned (image-only) PDF is ingested through
 *     App's ingest handler, which sets the OCR-flow store. The recipe serves
 *     `fixtures/ingest/scanned-mandolin-method.pdf` — two 1-bit page images, no
 *     text layer, rendered from public-domain-style method-book prose — from a
 *     loopback HTTP server and ingests it through the real palette → "Ingest
 *     URL as Source…" path, so nothing about the flow is faked.
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
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
  const promptInput = h.win.locator('[role="dialog"][aria-labelledby="prompt-dialog-title"] input');
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
// The OCR "offer to recognize a scanned PDF" dialog (OcrProgressDialog, confirm
// stage — title "Run OCR on …"). It renders once App's ingest handler sees
// `result.needsOcr` and sets the OCR-flow store, so the recipe ingests a real
// image-only PDF over loopback HTTP. The dialog is captured at its confirm
// stage and dismissed; OCR itself never runs.
const SCANNED_PDF = path.join(__dirname, 'fixtures', 'ingest', 'scanned-mandolin-method.pdf');
test('ingest-pdf', async () => {
  await reset();
  const pdf = fs.readFileSync(SCANNED_PDF);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
    res.end(pdf);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await runCommand('Ingest URL as Source');
    // handleIngestUrlAsSource → showPrompt('URL to ingest as a source:'). The
    // prompt sits on the shared ui/Dialog shell (`.card[role=dialog]`), so select
    // it by role + label rather than a `.dialog` class it no longer has.
    const promptInput = h.win.locator('[role="dialog"][aria-labelledby="prompt-dialog-title"] input');
    await promptInput.waitFor({ timeout: 5000 });
    await promptInput.fill(`http://127.0.0.1:${port}/scanned-mandolin-method.pdf`);
    await promptInput.press('Enter');
    const ocrDialog = h.win.locator('.dialog', { hasText: 'Run OCR on' });
    await ocrDialog.waitFor({ timeout: 30000 });
    await h.win.waitForTimeout(400);
    await shoot(h.win, 'ingest-pdf', ocrDialog);
  } finally {
    server.close();
  }
  await reset();
});
