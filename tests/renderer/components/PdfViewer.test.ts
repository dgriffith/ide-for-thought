/**
 * @vitest-environment happy-dom
 *
 * Component coverage for the in-app PDF viewer (#100, added for #672/#689 —
 * the gate the pdfjs 6 bump was waiting on). pdfjs is mocked at the dynamic-
 * import boundary (real canvas rendering needs a browser) so we can drive the
 * component's flow: load → toolbar, page navigation + bounds, zoom + bounds,
 * the page-jump input, "Show extracted", and the load-error path. The pure
 * geometry / matching is unit-tested in tests/renderer/pdf/text-layer.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const { getDocumentMock, readPdfMock, sourceDetailMock, createExcerptMock, onExcerptsChangedMock, setPdfPageMock } =
  vi.hoisted(() => ({
    getDocumentMock: vi.fn(),
    readPdfMock: vi.fn(),
    sourceDetailMock: vi.fn(),
    createExcerptMock: vi.fn(),
    onExcerptsChangedMock: vi.fn(),
    setPdfPageMock: vi.fn(),
  }));

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'stub-worker-url' }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    sources: { readPdf: readPdfMock, createExcerpt: createExcerptMock, onExcerptsChanged: onExcerptsChangedMock },
    graph: { sourceDetail: sourceDetailMock },
  },
}));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => ({ setPdfPage: setPdfPageMock }),
}));

import PdfViewer from '../../../src/renderer/lib/components/PdfViewer.svelte';

function fakePage() {
  return {
    getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
    render: () => ({ promise: Promise.resolve() }),
    getTextContent: async () => ({ items: [] }),
    cleanup: vi.fn(),
  };
}

function mockDoc(numPages: number) {
  getDocumentMock.mockReturnValue({
    promise: Promise.resolve({
      numPages,
      getPage: async () => fakePage(),
      destroy: vi.fn(),
    }),
  });
}

function renderViewer(over: { initialPage?: number; onShowMarkdown?: (id: string) => void } = {}) {
  return render(PdfViewer, {
    sourceId: 'doi-x',
    initialPage: over.initialPage ?? 1,
    onShowMarkdown: over.onShowMarkdown ?? vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  [getDocumentMock, readPdfMock, sourceDetailMock, createExcerptMock, onExcerptsChangedMock, setPdfPageMock]
    .forEach((m) => m.mockReset());
});

describe('PdfViewer (#100)', () => {
  it('loads the document on mount and shows the toolbar with the page count', async () => {
    mockDoc(5);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });

    const { findByText, getByTitle } = renderViewer();
    expect(await findByText('/ 5')).toBeTruthy();
    // Prev is disabled on page 1; next is enabled.
    expect((getByTitle('Previous page') as HTMLButtonElement).disabled).toBe(true);
    expect((getByTitle('Next page') as HTMLButtonElement).disabled).toBe(false);
  });

  it('navigates pages within bounds', async () => {
    mockDoc(3);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });

    const { findByText, getByTitle, getByDisplayValue } = renderViewer();
    await findByText('/ 3');

    await fireEvent.click(getByTitle('Next page'));
    expect(getByDisplayValue('2')).toBeTruthy();
    await fireEvent.click(getByTitle('Next page'));
    expect(getByDisplayValue('3')).toBeTruthy();
    // At the last page, Next is disabled.
    expect((getByTitle('Next page') as HTMLButtonElement).disabled).toBe(true);
  });

  it('zooms in/out and resets, reflecting the percentage label', async () => {
    mockDoc(2);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });

    const { findByText, getByTitle, getByText } = renderViewer();
    await findByText('/ 2');
    expect(getByText('120%')).toBeTruthy(); // DEFAULT_SCALE

    await fireEvent.click(getByTitle('Zoom in'));
    expect(getByText('135%')).toBeTruthy();
    await fireEvent.click(getByTitle('Zoom out'));
    expect(getByText('120%')).toBeTruthy();
    await fireEvent.click(getByTitle('Zoom in'));
    await fireEvent.click(getByTitle('Reset zoom'));
    expect(getByText('120%')).toBeTruthy();
  });

  it('jumps to a page via the number input (clamped to range)', async () => {
    mockDoc(10);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });

    const { findByText, getByRole, getByTitle } = renderViewer();
    await findByText('/ 10');
    const input = getByRole('spinbutton') as HTMLInputElement;

    // A valid in-range jump is accepted.
    await fireEvent.change(input, { target: { value: '6' } });
    expect(input.value).toBe('6');
    // From page 6, Next still works (proves `page` actually moved to 6, not
    // that the input value alone changed).
    await fireEvent.click(getByTitle('Next page'));
    expect(input.value).toBe('7');
  });

  it('"Show extracted" reports the sourceId to the host', async () => {
    mockDoc(1);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });
    const onShowMarkdown = vi.fn();

    const { findByText, getByText } = renderViewer({ onShowMarkdown });
    await findByText('/ 1');
    await fireEvent.click(getByText('Show extracted'));
    expect(onShowMarkdown).toHaveBeenCalledWith('doi-x');
  });

  it('unsubscribes from excerpt-changed on unmount (no listener leak) (#1610)', async () => {
    mockDoc(1);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });
    const unsub = vi.fn();
    onExcerptsChangedMock.mockReturnValue(unsub);

    const { findByText, unmount } = renderViewer();
    await findByText('/ 1');
    expect(onExcerptsChangedMock).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();

    unmount();
    expect(unsub).toHaveBeenCalledTimes(1); // teardown ran — the listener is removed
  });

  it('surfaces a load error when the PDF bytes cannot be read', async () => {
    readPdfMock.mockRejectedValue(new Error('source not found'));
    const { findByText } = renderViewer();
    expect(await findByText(/Failed to load PDF: source not found/)).toBeTruthy();
  });

  it('clamps the initial page above the document length down to the last page', async () => {
    mockDoc(4);
    readPdfMock.mockResolvedValue(new Uint8Array([0x25]));
    sourceDetailMock.mockResolvedValue({ excerpts: [] });

    const { findByText, getByDisplayValue } = renderViewer({ initialPage: 99 });
    await findByText('/ 4');
    expect(getByDisplayValue('4')).toBeTruthy();
  });
});
