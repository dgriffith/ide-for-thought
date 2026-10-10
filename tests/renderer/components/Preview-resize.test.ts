/**
 * @vitest-environment happy-dom
 *
 * Resizing an image or an object-view embed in the preview (#2666). Mounts the
 * REAL Preview with the real markdown pipeline and drives the handle with
 * pointer events; the host's `onApplyEdit` puts the new source into a real
 * CodeMirror view with history — the same `applyExternalContent` the Editor
 * runs on an outside change — so the test can check the edit is undoable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';

const h = vi.hoisted(() => ({
  api: {
    notebase: { readFile: vi.fn() },
    types: { noteProperties: vi.fn() },
    shell: { openExternal: vi.fn(), revealFile: vi.fn(), openInDefault: vi.fn(), openInTerminal: vi.fn() },
  },
  announce: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ getToolInfosByCategory: () => [] }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));
vi.mock('../../../src/renderer/lib/markdown/mermaid-renderer', () => ({ hydrateMermaidBlocks: vi.fn(), invalidateMermaidTheme: vi.fn() }));
vi.mock('../../../src/renderer/lib/markdown/vega-renderer', () => ({ hydrateVegaBlocks: vi.fn(), invalidateVegaTheme: vi.fn() }));
vi.mock('../../../src/renderer/lib/markdown/card-callout', () => ({ hydrateCardCallouts: vi.fn() }));
// The embed's own mount is covered by object-view-renderer.test.ts; here only
// the frame and its handle matter.
vi.mock('../../../src/renderer/lib/markdown/object-view-renderer', () => ({ hydrateObjectViewBlocks: vi.fn() }));
vi.mock('../../../src/renderer/lib/preview/hydrate', () => ({
  highlightCodeBlocks: vi.fn(), hydrateLocalImages: vi.fn(), hydrateRemoteImages: vi.fn(),
  hydrateYouTubeThumbnails: vi.fn(), hydrateTransclusions: vi.fn(), hydrateLocalMedia: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/preview/citation-render', () => ({ applyCslMarkers: vi.fn(), resolveCiteQuoteLabels: vi.fn() }));
vi.mock('../../../src/renderer/lib/preview/typed-link-render', () => ({ hydrateTypedCards: vi.fn() }));
vi.mock('../../../src/renderer/lib/preview/query-blocks', () => ({ executeQueryBlock: vi.fn() }));

import Preview from '../../../src/renderer/lib/components/Preview.svelte';
import { applyExternalContent } from '../../../src/renderer/lib/editor/external-content';
import { KEYBOARD_COMMIT_DELAY_MS } from '../../../src/renderer/lib/preview/embed-resize';

let view: EditorView | null = null;

/** An "open editor" holding `doc`, and the Preview wired to write into it. */
function setup(doc: string, over: Record<string, unknown> = {}) {
  view = new EditorView({ state: EditorState.create({ doc, extensions: [history()] }), parent: document.body });
  const onApplyEdit = vi.fn((next: string) => { applyExternalContent(view!, next); });
  const utils = render(Preview, { content: doc, notePath: 'notes/n.md', onApplyEdit, ...over });
  return { ...utils, onApplyEdit };
}

async function drag(handle: Element, dx: number, dy: number): Promise<void> {
  await fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  await fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  await fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
}

beforeEach(() => {
  h.api.notebase.readFile.mockResolvedValue('');
  h.api.types.noteProperties.mockResolvedValue({ type: null, properties: {} });
});
afterEach(() => {
  cleanup();
  view?.destroy();
  view = null;
  vi.clearAllMocks();
});

describe('Preview resize handles (#2666)', () => {
  const imageNote = '# Shots\n\nBefore ![shot|200](pic.png) after.\n';

  it('a drag on an image writes its width into the markdown, undoably', async () => {
    const { container, onApplyEdit } = setup(imageNote);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('width')).toBe('200');
    expect(img.getAttribute('alt')).toBe('shot');

    await drag(container.querySelector('.resizable-image [data-resize-handle]')!, 60, 0);

    expect(onApplyEdit).toHaveBeenCalledTimes(1);
    expect(view!.state.doc.toString()).toBe('# Shots\n\nBefore ![shot|260](pic.png) after.\n');
    expect(h.announce).toHaveBeenCalledWith('Image width 260 pixels');
    // ⌘Z in the editor takes exactly that edit back.
    undo(view!);
    expect(view!.state.doc.toString()).toBe(imageNote);
  });

  it('double-clicking the handle resets the image to its natural size', async () => {
    const { container } = setup(imageNote);
    await fireEvent.dblClick(container.querySelector('.resizable-image [data-resize-handle]')!);
    expect(view!.state.doc.toString()).toBe('# Shots\n\nBefore ![shot](pic.png) after.\n');
  });

  it('Alt+arrows step the size (one write after the run), Alt+0 resets', async () => {
    const { container, onApplyEdit } = setup(imageNote);
    const handle = container.querySelector<HTMLElement>('.resizable-image [data-resize-handle]')!;
    handle.focus();
    await fireEvent.keyDown(handle, { key: 'ArrowRight', altKey: true });
    await fireEvent.keyDown(handle, { key: 'ArrowRight', altKey: true });
    expect(h.announce).toHaveBeenLastCalledWith('Image width 240 pixels');
    expect(onApplyEdit).not.toHaveBeenCalled();
    await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1), { timeout: KEYBOARD_COMMIT_DELAY_MS * 4 });
    expect(view!.state.doc.toString()).toContain('![shot|240](pic.png)');

    await fireEvent.keyDown(handle, { key: '0', altKey: true });
    expect(onApplyEdit).toHaveBeenCalledTimes(2);
    expect(view!.state.doc.toString()).toContain('![shot](pic.png)');
  });

  it('a drag on an object view\'s bottom edge writes `height` into its spec, undoably', async () => {
    const note = '# Places\n\n```object-view\n{"typeId":"place","layout":"list"}\n```\n';
    const { container } = setup(note);
    expect(container.querySelector('.object-view-block')!.getAttribute('data-view-height')).toBe('360');

    await drag(container.querySelector('.fence-object-view [data-resize-handle]')!, 0, 120);

    expect(view!.state.doc.toString()).toBe('# Places\n\n```object-view\n{"typeId":"place","layout":"list","height":480}\n```\n');
    undo(view!);
    expect(view!.state.doc.toString()).toBe(note);
  });

  it('dragging back to 360 removes the field rather than writing the default', async () => {
    // A heading first: under happy-dom, DOMPurify drops the wrapper of the
    // document's very first element (not so in Chromium).
    const note = '# P\n\n```object-view\n{"typeId":"place","layout":"list","height":400}\n```\n';
    const { container } = setup(note);
    await drag(container.querySelector('.fence-object-view [data-resize-handle]')!, 0, -40);
    expect(view!.state.doc.toString()).toBe('# P\n\n```object-view\n{"typeId":"place","layout":"list"}\n```\n');
  });

  describe('object-view width (#2709)', () => {
    const board = '# Board\n\n```object-view\n{"typeId":"task","layout":"kanban"}\n```\n';
    const widthHandle = (c: HTMLElement) => c.querySelector<HTMLElement>('.fence-object-view [data-resize-axis="width"]')!;

    it('a drag on the right edge writes `width` into the spec, undoably', async () => {
      const { container } = setup(board);
      const handle = widthHandle(container);
      expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
      expect(handle.getAttribute('aria-valuetext')).toBe('column width');
      // Unmeasurable under happy-dom: the drag starts from the 704px column.
      await drag(handle, 400, 0);
      expect(view!.state.doc.toString()).toBe('# Board\n\n```object-view\n{"typeId":"task","layout":"kanban","width":1104}\n```\n');
      expect(h.announce).toHaveBeenCalledWith('View width 1104 pixels');
      undo(view!);
      expect(view!.state.doc.toString()).toBe(board);
    });

    it('renders a stored width on the fence, as `--view-width` the CSS reads', () => {
      const { container } = setup('# B\n\n```object-view\n{"typeId":"task","layout":"kanban","width":1200}\n```\n');
      const frame = container.querySelector<HTMLElement>('.fence-object-view')!;
      expect(frame.getAttribute('data-view-width')).toBe('1200');
      expect(widthHandle(container).getAttribute('aria-valuenow')).toBe('1200');
    });

    it('double-click resets to the column — the field is removed', async () => {
      const { container } = setup('# B\n\n```object-view\n{"typeId":"task","layout":"kanban","width":1200}\n```\n');
      await fireEvent.dblClick(widthHandle(container));
      expect(view!.state.doc.toString()).toBe('# B\n\n```object-view\n{"typeId":"task","layout":"kanban"}\n```\n');
      expect(h.announce).toHaveBeenCalledWith('View width reset to the column');
    });

    it('Alt+←/→ step the width and Alt+↑/↓ the height; Alt+0 on a handle resets only its own', async () => {
      const note = '# B\n\n```object-view\n{"typeId":"task","layout":"kanban","width":1000,"height":500}\n```\n';
      const { container, onApplyEdit, rerender } = setup(note);
      // The app feeds each edit back as the Preview's content; do the same.
      const feedBack = () => rerender({ content: view!.state.doc.toString() });
      const handle = widthHandle(container);
      handle.focus();
      await fireEvent.keyDown(handle, { key: 'ArrowLeft', altKey: true });
      expect(h.announce).toHaveBeenLastCalledWith('View width 960 pixels');
      await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1), { timeout: KEYBOARD_COMMIT_DELAY_MS * 4 });
      expect(view!.state.doc.toString()).toContain('"width":960,"height":500');
      await feedBack();

      await fireEvent.keyDown(widthHandle(container), { key: 'ArrowDown', altKey: true });
      expect(h.announce).toHaveBeenLastCalledWith('View height 540 pixels');
      await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(2), { timeout: KEYBOARD_COMMIT_DELAY_MS * 4 });
      expect(view!.state.doc.toString()).toContain('"width":960,"height":540');
      await feedBack();

      await fireEvent.keyDown(widthHandle(container), { key: '0', altKey: true });
      expect(view!.state.doc.toString()).toContain('{"typeId":"task","layout":"kanban","height":540}');
    });

    it('plain arrows on the width handle step the width, as a slider\'s should', async () => {
      const { container, onApplyEdit } = setup('# B\n\n```object-view\n{"typeId":"task","layout":"kanban","width":1000}\n```\n');
      const handle = widthHandle(container);
      handle.focus();
      await fireEvent.keyDown(handle, { key: 'ArrowUp' });
      expect(h.announce).toHaveBeenLastCalledWith('View width 960 pixels');
      await waitFor(() => expect(onApplyEdit).toHaveBeenCalledTimes(1), { timeout: KEYBOARD_COMMIT_DELAY_MS * 4 });
    });

    it('Alt+0 away from a handle resets both dimensions in one edit', async () => {
      const note = '# B\n\n```object-view\n{"typeId":"task","layout":"kanban","width":1000,"height":500}\n```\n';
      const { container, onApplyEdit } = setup(note);
      const toolbar = container.querySelector<HTMLElement>('.fence-object-view .fence-collapse-btn')!;
      toolbar.focus();
      await fireEvent.keyDown(toolbar, { key: '0', altKey: true });
      expect(onApplyEdit).toHaveBeenCalledTimes(1);
      expect(view!.state.doc.toString()).toContain('{"typeId":"task","layout":"kanban"}');
      undo(view!);
      expect(view!.state.doc.toString()).toBe(note);
    });
  });

  it('offers no handles when the host can\'t write the size back', () => {
    const { container } = render(Preview, { content: imageNote, notePath: 'notes/n.md' });
    expect(container.querySelector('[data-resize-handle]')).toBeNull();
    // …but the image still renders at its stored size.
    expect(container.querySelector('img')!.getAttribute('width')).toBe('200');
  });
});
