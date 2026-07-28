/**
 * PDF-render BrowserWindow security-flag guard (#1102 follow-up).
 *
 * `renderPdfFromHtml` opens an off-screen BrowserWindow to paint exported HTML
 * for `printToPDF`. That window renders note content (potentially with
 * user-embedded HTML), so it hardens its `webPreferences` inline. This guards
 * the construction site against drift: electron's BrowserWindow is mocked to
 * capture the options, and the window's paint/print calls are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrintToPdfArgs } from '../../../src/main/publish/exporters/note-pdf/options';

const h = vi.hoisted(() => ({ constructed: [] as Array<Record<string, unknown>> }));

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = {
      executeJavaScript: () => Promise.resolve(),
      printToPDF: () => Promise.resolve(Buffer.from('%PDF-1.4 stub')),
    };
    constructor(options: { webPreferences: Record<string, unknown> }) {
      h.constructed.push(options.webPreferences);
    }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return false; }
    destroy() { /* no-op */ }
  }
  return { BrowserWindow };
});

import { renderPdfFromHtml } from '../../../src/main/publish/exporters/note-pdf/electron-render';

beforeEach(() => {
  h.constructed = [];
});

describe('PDF-render BrowserWindow security flags (#1102)', () => {
  it('paints the export HTML in an isolated, sandboxed, node-free, preload-free window', async () => {
    await renderPdfFromHtml('<!doctype html><html><body>hi</body></html>', {} as PrintToPdfArgs);
    expect(h.constructed).toHaveLength(1);
    const wp = h.constructed[0]!;
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.sandbox).toBe(true);
    // No preload — this window only needs to paint HTML; a bridge would be an
    // unnecessary attack surface for user-embedded content.
    expect(wp.preload).toBeUndefined();
  });
});
