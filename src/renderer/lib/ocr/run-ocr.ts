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
  const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
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
    await doc.destroy();
  }
}

async function createTesseractWorker(): Promise<TesseractWorker> {
  // Point Tesseract at the bundled traineddata. `langPath` expects a
  // directory ending in `/` that contains `<lang>.traineddata`; our
  // ?url import gives the file URL, so we strip the filename. Using
  // `gzip: false` since the bundled blob is raw, not compressed.
  const lastSlash = engTrainedDataUrl.lastIndexOf('/');
  const langPath = engTrainedDataUrl.slice(0, lastSlash + 1);
  const worker = await createWorker('eng', 1, {
    langPath,
    gzip: false,
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
