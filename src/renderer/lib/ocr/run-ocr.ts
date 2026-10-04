/**
 * Renderer-side OCR pipeline for scanned PDFs (#95).
 *
 * We run here (not in a hidden BrowserWindow) because tesseract.js
 * already spawns its own Web Workers internally — the main thread
 * stays responsive enough for a progress dialog while OCR runs. Using
 * the live renderer sidesteps a second window entrypoint.
 *
 * Pipeline per page:
 *   1. pdfjs renders the page to a canvas at 2× device pixel ratio
 *      (rough knee between OCR accuracy and memory).
 *   2. Canvas is handed straight to the Tesseract worker.
 *   3. Tesseract returns text; the canvas is released.
 *
 * The Tesseract worker is created once and reused across pages so we
 * don't pay the language-load cost repeatedly. traineddata ships
 * bundled in-tree; Vite gives us a URL for the file via `?url`.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import engTrainedDataUrl from '../../assets/ocr/eng.traineddata?url';
// The worker script and WASM core ship in the bundle (#2564). Left unset,
// tesseract.js fetches both from cdn.jsdelivr.net at run time — no SRI, a
// host anyone can publish to, and under our CSP (`script-src 'self'`) its
// `importScripts` of the CDN URL is refused, so OCR needs them local anyway.
// One core variant: SIMD + LSTM-only, matching `createWorker('eng', 1)`
// (OEM 1 = LSTM only) on Chromium, which always has WASM SIMD.
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';

// Point pdfjs at its worker script. Vite bundles `pdf.worker.min.mjs` as
// an asset and gives us a URL; pdfjs uses it to spawn its worker.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface OcrProgress {
  /** 1-based page number currently being OCR'd. */
  page: number;
  totalPages: number;
  /** Fractional progress inside the current page (0..1). */
  pageProgress?: number;
}

export async function runOcr(
  pdfBytes: Uint8Array,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  // pdfjs 6 moved full teardown from the document proxy to the loading task —
  // `PDFDocumentProxy` now only exposes `cleanup()`; `destroy()` lives on the
  // task returned by `getDocument()`. Hold the task so we can tear it down.
  const loadingTask = pdfjs.getDocument({ data: pdfBytes });
  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;

  const worker = await createTesseractWorker();
  try {
    const pages: string[] = [];
    for (let n = 1; n <= totalPages; n++) {
      if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
      onProgress({ page: n, totalPages, pageProgress: 0 });
      const canvas = await renderPageToCanvas(doc, n);
      onProgress({ page: n, totalPages, pageProgress: 0.5 });
      const { data } = await worker.recognize(canvas);
      pages.push(data.text);
      // Drop the canvas's backing store once we've handed it off —
      // the bitmap for a 2×-scaled page can easily top 20MB on large
      // scans, and without this GC keeps it alive until the whole
      // loop finishes.
      canvas.width = 0; canvas.height = 0;
      onProgress({ page: n, totalPages, pageProgress: 1 });
    }
    return pages;
  } finally {
    await worker.terminate();
    await doc.cleanup();
    await loadingTask.destroy();
  }
}

async function createTesseractWorker(): Promise<TesseractWorker> {
  // Point Tesseract at the bundled traineddata. `langPath` expects a
  // directory ending in `/` that contains `<lang>.traineddata`; our
  // ?url import gives the file URL, so we strip the filename. Using
  // `gzip: false` since the bundled blob is raw, not compressed.
  //
  // Known gap (#2564): under `file://` the worker's fetch of this sibling
  // asset fails, so OCR doesn't complete in the packaged app (it does under
  // the dev server). Serving the renderer from `app://` fixes that; the
  // in-memory `{ code, data }` form would too, but tesseract.js 7.0.0's
  // worker joins those by `.data` instead of `.code`.
  const lastSlash = engTrainedDataUrl.lastIndexOf('/');
  const langPath = engTrainedDataUrl.slice(0, lastSlash + 1);
  const worker = await createWorker('eng', 1, {
    langPath,
    gzip: false,
    // Loaded from the bundle, never the CDN default (#2564).
    workerPath: tesseractWorkerUrl,
    // A core path ending in `.js` is loaded as-is (no SIMD sniffing, no CDN).
    corePath: tesseractCoreUrl,
  });
  return worker;
}

async function renderPageToCanvas(
  doc: pdfjs.PDFDocumentProxy,
  pageNumber: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  // 2× scale gives OCR a decent shot at small type without blowing up
  // memory for poster-sized PDFs. Users with high-DPI scans can bump
  // this later via a setting.
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();
  return canvas;
}
