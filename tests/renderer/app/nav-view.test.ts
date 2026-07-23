/**
 * Behavioral net for the nav-ops + source-view-ops handlers extracted from
 * App.svelte (#670). Mocks the api client, the editor / navigation / notebase
 * stores, and the source-view-preference module (to avoid localStorage).
 * Verifies the moved handler bodies (open source / PDF / excerpt, show-markdown,
 * source-deleted, back nav), not just that menus reach them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const api = {
    graph: { excerptSource: vi.fn() },
    sources: { hasPdf: vi.fn() },
  };
  const editor = {
    openFile: vi.fn(),
    openPdf: vi.fn(),
    openSource: vi.fn(),
    closeTabsForSource: vi.fn(),
    switchTab: vi.fn(),
    tabs: [] as unknown[],
    activeTab: undefined as unknown,
    activeFilePath: null as string | null,
    content: '',
  };
  const nav = {
    record: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    doneNavigating: vi.fn(),
  };
  const notebase = { files: [] as unknown[] };
  const pref = { getPreferredSourceView: vi.fn(), setPreferredSourceView: vi.fn() };
  return { api, editor, nav, notebase, pref };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/navigation.svelte', () => ({ getNavigationStore: () => h.nav }));
vi.mock('../../../src/renderer/lib/source-view-preference', () => ({
  getPreferredSourceView: h.pref.getPreferredSourceView,
  setPreferredSourceView: h.pref.setPreferredSourceView,
}));

import { createNavView, type NavViewCtx } from '../../../src/renderer/lib/app/nav-view';

let ctx: NavViewCtx;
let view: ReturnType<typeof createNavView>;

beforeEach(() => {
  vi.clearAllMocks();
  // navigateToPosition (note branch) defers gotoOffset via requestAnimationFrame,
  // which isn't defined under the node test env — stub it as a no-op scheduler.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { void cb; return 0; });
  h.editor.tabs = [];
  h.editor.activeTab = undefined;
  h.editor.activeFilePath = null;
  h.editor.content = '';
  h.pref.getPreferredSourceView.mockReturnValue(null);
  ctx = {
    getEditorComponent: () => undefined,
    setPendingSearchQuery: vi.fn(),
    setPendingPreviewAnchor: vi.fn(),
    getViewMode: () => 'source',
    getAliasMap: () => ({}),
  };
  view = createNavView(ctx);
});

describe('handleOpenPdf', () => {
  it('remembers the pdf preference, opens the pdf, and records nav', () => {
    view.handleOpenPdf('s1');
    expect(h.pref.setPreferredSourceView).toHaveBeenCalledWith('s1', 'pdf');
    expect(h.editor.openPdf).toHaveBeenCalledWith('s1');
    expect(h.nav.record).toHaveBeenCalledWith({ type: 'source', sourceId: 's1' });
  });
});

describe('handleShowMarkdownFromPdf', () => {
  it('remembers the markdown preference and opens the extracted source', () => {
    view.handleShowMarkdownFromPdf('s2');
    expect(h.pref.setPreferredSourceView).toHaveBeenCalledWith('s2', 'markdown');
    expect(h.editor.openSource).toHaveBeenCalledWith('s2');
  });
});

describe('handleSourceDeleted', () => {
  it('closes every tab bound to the deleted source', () => {
    view.handleSourceDeleted('s3');
    expect(h.editor.closeTabsForSource).toHaveBeenCalledWith('s3');
  });
});

describe('handleOpenSource', () => {
  it('routes to the pdf view when preferred and a pdf exists', async () => {
    h.pref.getPreferredSourceView.mockReturnValue('pdf');
    h.api.sources.hasPdf.mockResolvedValue(true);
    view.handleOpenSource('s4');
    // The pdf branch fires `void hasPdf(...).then(...)` — let the microtask run.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.api.sources.hasPdf).toHaveBeenCalledWith('s4');
    expect(h.editor.openPdf).toHaveBeenCalledWith('s4');
    expect(h.editor.openSource).not.toHaveBeenCalled();
  });

  it('opens the extracted source with the highlight when an excerpt is requested', () => {
    h.pref.getPreferredSourceView.mockReturnValue('markdown');
    view.handleOpenSource('s5', 'ex1');
    expect(h.api.sources.hasPdf).not.toHaveBeenCalled();
    expect(h.editor.openSource).toHaveBeenCalledWith('s5', { highlightExcerptId: 'ex1' });
    expect(h.nav.record).toHaveBeenCalledWith({ type: 'source', sourceId: 's5', highlightExcerptId: 'ex1' });
  });
});

describe('handleOpenExcerpt', () => {
  it('resolves the excerpt to its source and opens it with the highlight', async () => {
    h.api.graph.excerptSource.mockResolvedValue({ sourceId: 's6' });
    h.pref.getPreferredSourceView.mockReturnValue('markdown');
    await view.handleOpenExcerpt('ex2');
    expect(h.api.graph.excerptSource).toHaveBeenCalledWith('ex2');
    expect(h.editor.openSource).toHaveBeenCalledWith('s6', { highlightExcerptId: 'ex2' });
  });

  it('does nothing when the excerpt has no source', async () => {
    h.api.graph.excerptSource.mockResolvedValue(null);
    await view.handleOpenExcerpt('ex3');
    expect(h.editor.openSource).not.toHaveBeenCalled();
  });
});

describe('handleJumpToMatch', () => {
  it('records the departure position and the search-match landing on the nav stack', async () => {
    h.editor.content = 'line one\nline two\nline three';
    h.editor.activeTab = { type: 'note' };
    h.editor.activeFilePath = 'from.md';
    ctx.getEditorComponent = () => ({ getOffset: () => 4, gotoOffset: vi.fn(), restorePosition: vi.fn() });

    await view.handleJumpToMatch('hit.md', 2, 5); // line 2 (1-based), col 5 (0-based)

    expect(h.editor.openFile).toHaveBeenCalledWith('hit.md');
    // Departure: where we left from, at its cursor offset.
    expect(h.nav.record).toHaveBeenCalledWith({ type: 'note', relativePath: 'from.md', offset: 4 });
    // Arrival: offset of (line 2, col 5) = len("line one") + 1 newline + 5 = 14.
    expect(h.nav.record).toHaveBeenCalledWith({ type: 'note', relativePath: 'hit.md', offset: 14 });
  });
});

describe('handleNavBack', () => {
  it('opens the note position returned by goBack', async () => {
    h.nav.goBack.mockReturnValue({ type: 'note', relativePath: 'a.md', offset: 5 });
    await view.handleNavBack();
    expect(h.editor.openFile).toHaveBeenCalledWith('a.md');
  });

  it('opens nothing when goBack returns null', async () => {
    h.nav.goBack.mockReturnValue(null);
    await view.handleNavBack();
    expect(h.editor.openFile).not.toHaveBeenCalled();
    expect(h.editor.openSource).not.toHaveBeenCalled();
  });
});
