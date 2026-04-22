/**
 * Off-screen HTML → PDF rendering using Electron's printToPDF (#249).
 *
 * Kept in its own module so the options-assembly logic stays pure and
 * unit-testable — this file is not touched by any test, only by the
 * Electron main process at runtime.
 *
 * Loading the rendered HTML goes through a temp file rather than a
 * data: URL. `wrapHtml` produces base64-inlined images, so the HTML
 * string can easily clear the practical data-URL length limits on
 * some platforms; a temp file sidesteps that entirely.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BrowserWindow } from 'electron';
import type { PrintToPdfArgs } from './options';

export async function renderPdfFromHtml(
  html: string,
  args: PrintToPdfArgs,
): Promise<Uint8Array> {
  const tmpFile = path.join(
    os.tmpdir(),
    `minerva-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`,
  );
  await fs.writeFile(tmpFile, html, 'utf-8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      // No node integration / preload — this window only needs to paint
      // the exported HTML. Keeping the context strict is cheap insurance.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Force light rendering so a user running a dark-theme OS doesn't
      // get a dark-on-dark PDF when the source note's HTML doesn't pin
      // colors. Chromium's `prefers-color-scheme` propagation respects
      // this override.
      enablePreferredSizeMode: false,
    },
  });

  try {
    await win.loadFile(tmpFile);
    // Chromium paints asynchronously; the first paint happens before
    // web fonts settle and before base64-encoded images finish laying
    // out at their natural size. `document.fonts.ready` covers fonts;
    // a short settle absorbs the rest.
    await win.webContents.executeJavaScript(
      `document.fonts ? document.fonts.ready : Promise.resolve()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    const buffer = await win.webContents.printToPDF(args);
    return new Uint8Array(buffer);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(tmpFile, { force: true }).catch(() => { /* best-effort */ });
  }
}
