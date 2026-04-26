/**
 * @vitest-environment happy-dom
 *
 * Wedge test for Svelte component coverage (#396).
 *
 * happy-dom is already wired (#343 / run-ocr.test.ts) and proven to
 * work for renderer-side tests. This is the first test that mounts a
 * Svelte component via @testing-library/svelte — it pays the
 * setup-cost once so future component tests are cheap.
 *
 * Scope is deliberately narrow: confirm the OCR-progress dialog
 * renders the right stage, fires the right callbacks, and reflects
 * the runOcr progress callback into the visible "Page N of M" text.
 * The runOcr orchestration itself is covered by
 * tests/renderer/ocr/run-ocr.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

// Mock the runOcr import before the component imports it. We hand
// the mock a settable behaviour so each test can stub a different
// shape (resolve, reject with AbortError, fire-progress-then-resolve).
const { runOcrMock } = vi.hoisted(() => ({ runOcrMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ocr/run-ocr', () => ({ runOcr: runOcrMock }));

import OcrProgressDialog from '../../../src/renderer/lib/components/OcrProgressDialog.svelte';

const fakeBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

afterEach(() => {
  cleanup();
  runOcrMock.mockReset();
});

function defaultProps(overrides: Partial<Parameters<typeof OcrProgressDialog>[0]['props']> = {}) {
  return {
    pdfBytes: fakeBytes,
    pageCount: 5,
    title: 'scan.pdf',
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe('OcrProgressDialog (#396 — first Svelte component test)', () => {
  it('renders the confirm stage with title, page count, and estimate', () => {
    const { getByText } = render(OcrProgressDialog, defaultProps());
    expect(getByText('Run OCR on "scan.pdf"?')).toBeTruthy();
    // 5 pages × ~3s/page = 15s, formatted as "15s".
    expect(getByText(/5 pages.*15s/)).toBeTruthy();
    expect(getByText('Skip')).toBeTruthy();
    expect(getByText('Run OCR')).toBeTruthy();
  });

  it('singular "page" when pageCount is 1', () => {
    const { getByText } = render(OcrProgressDialog, defaultProps({ pageCount: 1 }));
    expect(getByText(/1 page\b.*\bestimated/)).toBeTruthy();
  });

  it('Skip fires onCancel; runOcr is never called', async () => {
    const onCancel = vi.fn();
    const { getByText } = render(OcrProgressDialog, defaultProps({ onCancel }));
    await fireEvent.click(getByText('Skip'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(runOcrMock).not.toHaveBeenCalled();
  });

  it('Run OCR transitions to the running stage and invokes runOcr', async () => {
    // Hold runOcr open so the running stage is visible. Resolve via
    // the deferred promise once the test has asserted the UI.
    let resolveRun: (pages: string[]) => void = () => undefined;
    runOcrMock.mockImplementation(
      (_bytes, _onProgress, _signal) => new Promise<string[]>((r) => { resolveRun = r; }),
    );
    const onDone = vi.fn();
    const { getByText, findByText } = render(OcrProgressDialog, defaultProps({ onDone }));

    await fireEvent.click(getByText('Run OCR'));

    // The running-stage UI shows up while runOcr is pending.
    expect(await findByText('Running OCR…')).toBeTruthy();
    expect(getByText('Loading PDF…')).toBeTruthy(); // pre-first-progress text
    expect(getByText('Cancel')).toBeTruthy();
    expect(runOcrMock).toHaveBeenCalledTimes(1);
    const [bytesArg, , signalArg] = runOcrMock.mock.calls[0];
    expect(bytesArg).toBe(fakeBytes);
    expect(signalArg).toBeInstanceOf(AbortSignal);

    // Wrap up so the test doesn't leak a pending promise.
    resolveRun(['extracted text']);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(['extracted text']));
  });

  it('reflects the runOcr progress callback into "Page N of M" text', async () => {
    let captureProgress: ((p: { page: number; totalPages: number; pageProgress?: number }) => void) | null = null;
    runOcrMock.mockImplementation((_bytes, onProgress) => {
      captureProgress = onProgress;
      return new Promise<string[]>(() => undefined); // never resolves — we only care about progress UI
    });
    const { getByText, findByText } = render(OcrProgressDialog, defaultProps({ pageCount: 3 }));

    await fireEvent.click(getByText('Run OCR'));
    await findByText('Loading PDF…');

    // Fire a synthetic progress event from runOcr's perspective.
    captureProgress!({ page: 2, totalPages: 3, pageProgress: 0.5 });

    expect(await findByText('Page 2 of 3')).toBeTruthy();
  });

  it('Cancel during running aborts via the controller (no onCancel call until rejection)', async () => {
    let abortSignal: AbortSignal | null = null;
    runOcrMock.mockImplementation((_bytes, _onProgress, signal: AbortSignal) => {
      abortSignal = signal;
      return new Promise<string[]>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('OCR cancelled', 'AbortError'));
        });
      });
    });
    const onCancel = vi.fn();
    const { getByText, findByText } = render(OcrProgressDialog, defaultProps({ onCancel }));

    await fireEvent.click(getByText('Run OCR'));
    await findByText('Cancel');

    await fireEvent.click(getByText('Cancel'));
    expect(abortSignal!.aborted).toBe(true);

    // Wait for the rejection to flow through the catch.
    await new Promise((r) => setTimeout(r, 0));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the error stage when runOcr throws a non-abort error', async () => {
    runOcrMock.mockRejectedValueOnce(new Error('tesseract bombed'));
    const { getByText, findByText } = render(OcrProgressDialog, defaultProps());

    await fireEvent.click(getByText('Run OCR'));

    expect(await findByText('OCR failed')).toBeTruthy();
    expect(getByText('tesseract bombed')).toBeTruthy();
    expect(getByText('Close')).toBeTruthy();
  });

  it('Close on the error stage fires onCancel', async () => {
    runOcrMock.mockRejectedValueOnce(new Error('boom'));
    const onCancel = vi.fn();
    const { getByText, findByText } = render(OcrProgressDialog, defaultProps({ onCancel }));

    await fireEvent.click(getByText('Run OCR'));
    await findByText('OCR failed');
    await fireEvent.click(getByText('Close'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
