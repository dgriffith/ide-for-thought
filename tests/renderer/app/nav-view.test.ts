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
    openTypeView: vi.fn(),
    groups: [] as Array<{ tabs: unknown[] }>,
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
  h.editor.groups = [];
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

  it('falls back to the extracted source when the pdf check rejects', async () => {
    h.pref.getPreferredSourceView.mockReturnValue('pdf');
    h.api.sources.hasPdf.mockRejectedValue(new Error('boom'));
    view.handleOpenSource('s4b');
    // The async IIFE awaits hasPdf then branches — let the microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.editor.openSource).toHaveBeenCalledWith('s4b');
    expect(h.editor.openPdf).not.toHaveBeenCalled();
    expect(h.nav.record).toHaveBeenCalledWith({ type: 'source', sourceId: 's4b' });
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

describe('handleNavigate with targets named after Object.prototype members (#2456 follow-up)', () => {
  // The renderer's alias map arrives over IPC as an ordinary object, so a bare
  // `aliases[key]` lookup answered `[[constructor]]` with `Object` — a
  // function, which was then handed to `openFile` as a path.
  const PROTO_NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];
  const wire = (entries: [string, string][]) =>
    structuredClone(Object.fromEntries(entries)) as Record<string, string>;

  beforeEach(() => {
    h.notebase.files = [{ relativePath: 'notes/other.md', isDirectory: false, name: 'other.md' }];
  });

  it('falls through to `<name>.md` when no such note or alias exists', async () => {
    ctx.getAliasMap = () => wire([['intro', 'notes/other.md']]);
    for (const name of PROTO_NAMES) {
      h.editor.openFile.mockClear();
      await view.handleNavigate(name);
      expect(h.editor.openFile).toHaveBeenCalledWith(`${name}.md`);
    }
  });

  it('opens the note or alias that really has that name', async () => {
    h.notebase.files = [
      { relativePath: 'notes/other.md', isDirectory: false, name: 'other.md' },
      { relativePath: 'deep/constructor.md', isDirectory: false, name: 'constructor.md' },
    ];
    ctx.getAliasMap = () => wire([['tostring', 'notes/other.md'], ['__proto__', 'notes/other.md']]);

    await view.handleNavigate('constructor');
    expect(h.editor.openFile).toHaveBeenLastCalledWith('deep/constructor.md');
    await view.handleNavigate('toString');
    expect(h.editor.openFile).toHaveBeenLastCalledWith('notes/other.md');
    await view.handleNavigate('__proto__');
    expect(h.editor.openFile).toHaveBeenLastCalledWith('notes/other.md');
    await view.handleNavigate('valueOf');
    expect(h.editor.openFile).toHaveBeenLastCalledWith('valueOf.md');
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

describe('object views on the back/forward stack', () => {
  const mapTab = { type: 'type-view', typeId: 'place', folder: 'trip/prague', layout: 'map', sortColumn: null, sortDir: 'asc', columns: null, filters: [{ property: 'city', values: ['Prague'] }], columnOrder: [], showEmptyColumns: true };
  const mapPos = { type: 'type-view', typeId: 'place', folder: 'trip/prague', view: { layout: 'map', sortColumn: null, sortDir: 'asc', columns: null, filters: [{ property: 'city', values: ['Prague'] }], columnOrder: [], showEmptyColumns: true } };

  it('leaving a view for a note (a map pin) records the view first', async () => {
    h.editor.activeTab = mapTab;
    await view.handleFileSelect('trip/prague/Kampa.md');
    expect(h.nav.record.mock.calls.map((c) => c[0])).toEqual([mapPos, { type: 'note', relativePath: 'trip/prague/Kampa.md', offset: 0 }]);
  });

  it('opening a type from the Objects panel records where you were, then the view', () => {
    h.editor.activeTab = { type: 'note' };
    h.editor.activeFilePath = 'a.md';
    view.handleOpenTypeView('book');
    expect(h.editor.openTypeView).toHaveBeenCalledWith('book');
    expect(h.nav.record.mock.calls.map((c) => c[0])).toEqual([
      { type: 'note', relativePath: 'a.md', offset: 0 },
      { type: 'type-view', typeId: 'book', folder: null },
    ]);
  });

  it('Back to a still-open view focuses it as it is now', async () => {
    h.editor.groups = [{ tabs: [mapTab] }];
    h.nav.goBack.mockReturnValue(mapPos);
    await view.handleNavBack();
    expect(h.editor.openTypeView).toHaveBeenCalledWith('place', { folder: 'trip/prague' });
    expect(h.nav.doneNavigating).toHaveBeenCalled();
  });

  it('Back to a closed view reopens it the way it was', async () => {
    h.nav.goBack.mockReturnValue(mapPos);
    await view.handleNavBack();
    expect(h.editor.openTypeView).toHaveBeenCalledWith('place', { ...mapPos.view, folder: 'trip/prague' });
  });

  it('a kanban view records its groupBy, and Back to it closed reopens grouped the same way (#2601)', async () => {
    const boardView = { layout: 'kanban', sortColumn: null, sortDir: 'asc', columns: null, filters: [], mapStyle: 'auto', groupBy: 'status', columnOrder: [], showEmptyColumns: true };
    h.editor.activeTab = { type: 'type-view', typeId: 'project', folder: null, ...boardView };
    await view.handleFileSelect('p.md');
    const recorded = h.nav.record.mock.calls[0]![0] as { view: unknown };
    expect(recorded.view).toEqual(boardView);
    h.nav.goBack.mockReturnValue(recorded);
    await view.handleNavBack();
    expect(h.editor.openTypeView).toHaveBeenCalledWith('project', { ...boardView, folder: null });
  });

  it('a kanban view records its column order and Show empty columns, and Back reopens it the same way (#2614)', async () => {
    const boardView = { layout: 'kanban', sortColumn: null, sortDir: 'asc', columns: null, filters: [], mapStyle: 'auto', groupBy: null, columnOrder: ['done', 'active'], showEmptyColumns: false };
    h.editor.activeTab = { type: 'type-view', typeId: 'project', folder: null, ...boardView };
    await view.handleFileSelect('p.md');
    const recorded = h.nav.record.mock.calls[0]![0] as { view: { columnOrder: string[] } };
    expect(recorded.view).toEqual(boardView);
    // A copy: a later reorder on the live tab doesn't rewrite history.
    expect(recorded.view.columnOrder).not.toBe(boardView.columnOrder);
    h.nav.goBack.mockReturnValue(recorded);
    await view.handleNavBack();
    expect(h.editor.openTypeView).toHaveBeenCalledWith('project', { ...boardView, folder: null });
  });
});
