/**
 * @vitest-environment happy-dom
 *
 * Coverage for the renderer-side OCR pipeline (#343).
 *
 * `runOcr` orchestrates pdfjs-dist + tesseract.js across N pages, fires
 * a progress callback at three points per page, and respects an
 * AbortSignal. The whole pipeline was untested — a tesseract / pdfjs
 * dep bump that drifted the worker API would ship broken silently.
 *
 * Both deps are mocked at module scope so the test never touches the
 * real WASM/Tesseract worker; happy-dom provides a `document` that's
 * just rich enough for `document.createElement('canvas')` (we stub
 * `getContext('2d')` because happy-dom returns null for it).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { getDocumentMock, createWorkerMock, recognizeMock, terminateMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
  createWorkerMock: vi.fn(),
  recognizeMock: vi.fn(),
  terminateMock: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'stub-worker-url' }));
vi.mock('../../../src/renderer/assets/ocr/eng.traineddata?url', () => ({
  default: 'stub://lang/eng.traineddata',
}));

vi.mock('tesseract.js', () => ({
  createWorker: createWorkerMock,
}));

import { runOcr, type OcrProgress } from '../../../src/renderer/lib/ocr/run-ocr';

/**
 * Build a stub PDFDocumentProxy that hands back N stub pages. Each page's
 * `render({...}).promise` resolves immediately so the test doesn't depend
 * on a real canvas backend.
 */
function stubPdf(numPages: number, opts: { onPageRender?: (n: number) => void } = {}) {
  const pageCleanup = vi.fn();
  const docCleanup = vi.fn();
  const docDestroy = vi.fn();
  const getPage = vi.fn(async (n: number) => ({
    getViewport: () => ({ width: 100, height: 200 }),
    render: () => ({
      promise: (async () => {
        opts.onPageRender?.(n);
      })(),
    }),
    cleanup: pageCleanup,
  }));
  return {
    doc: { numPages, getPage, cleanup: docCleanup, destroy: docDestroy },
    getPage,
    pageCleanup,
    docCleanup,
    docDestroy,
  };
}

beforeEach(() => {
  getDocumentMock.mockReset();
  createWorkerMock.mockReset();
  recognizeMock.mockReset();
  terminateMock.mockReset();

  // happy-dom doesn't implement canvas; stub getContext so renderPageToCanvas
  // doesn't trip its "2D canvas context unavailable" guard.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runOcr() (#343)', () => {
  it('returns one extracted text per page in order', async () => {
    const { doc } = stubPdf(3);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    recognizeMock
      .mockResolvedValueOnce({ data: { text: 'page-1-text' } })
      .mockResolvedValueOnce({ data: { text: 'page-2-text' } })
      .mockResolvedValueOnce({ data: { text: 'page-3-text' } });
    createWorkerMock.mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });

    const pages = await runOcr(new Uint8Array(), () => undefined);
    expect(pages).toEqual(['page-1-text', 'page-2-text', 'page-3-text']);
  });

  it('fires onProgress at start, mid, and end of each page in order', async () => {
    const { doc } = stubPdf(3);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    recognizeMock.mockResolvedValue({ data: { text: 'x' } });
    createWorkerMock.mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });

    const events: OcrProgress[] = [];
    await runOcr(new Uint8Array(), (p) => events.push({ ...p }));

    expect(events).toEqual([
      { page: 1, totalPages: 3, pageProgress: 0 },
      { page: 1, totalPages: 3, pageProgress: 0.5 },
      { page: 1, totalPages: 3, pageProgress: 1 },
      { page: 2, totalPages: 3, pageProgress: 0 },
      { page: 2, totalPages: 3, pageProgress: 0.5 },
      { page: 2, totalPages: 3, pageProgress: 1 },
      { page: 3, totalPages: 3, pageProgress: 0 },
      { page: 3, totalPages: 3, pageProgress: 0.5 },
      { page: 3, totalPages: 3, pageProgress: 1 },
    ]);
  });

  it('always tears down the worker and the doc, even on error', async () => {
    const { doc, docCleanup, docDestroy } = stubPdf(1);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    recognizeMock.mockRejectedValueOnce(new Error('tesseract bombed'));
    createWorkerMock.mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });

    await expect(runOcr(new Uint8Array(), () => undefined)).rejects.toThrow('tesseract bombed');
    expect(terminateMock).toHaveBeenCalledTimes(1);
    expect(docCleanup).toHaveBeenCalledTimes(1);
    expect(docDestroy).toHaveBeenCalledTimes(1);
  });

  describe('AbortSignal', () => {
    it('rejects with AbortError when aborted before the first page', async () => {
      const { doc, getPage } = stubPdf(3);
      getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
      recognizeMock.mockResolvedValue({ data: { text: 'x' } });
      createWorkerMock.mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });

      const ctrl = new AbortController();
      ctrl.abort();
      const err = await runOcr(new Uint8Array(), () => undefined, ctrl.signal)
        .then(() => null)
        .catch((e) => e);

      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
      expect(getPage).not.toHaveBeenCalled();
      expect(recognizeMock).not.toHaveBeenCalled();
      expect(terminateMock).toHaveBeenCalledTimes(1); // worker still cleaned up
    });

    it('mid-run abort skips remaining pages and still tears down', async () => {
      // Abort after page 2 finishes — page 3 must never be processed.
      const ctrl = new AbortController();
      const { doc, getPage, docDestroy } = stubPdf(3);
      getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
      recognizeMock.mockImplementation(async () => {
        // Trigger abort once page 2's recognize resolves; the loop will
        // see the signal at the top of iteration 3.
        if (recognizeMock.mock.calls.length === 2) ctrl.abort();
        return { data: { text: 'x' } };
      });
      createWorkerMock.mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock });

      const err = await runOcr(new Uint8Array(), () => undefined, ctrl.signal)
        .then(() => null)
        .catch((e) => e);

      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe('AbortError');
      expect(getPage).toHaveBeenCalledTimes(2);
      expect(recognizeMock).toHaveBeenCalledTimes(2);
      expect(terminateMock).toHaveBeenCalledTimes(1);
      expect(docDestroy).toHaveBeenCalledTimes(1);
    });
  });
});
