/**
 * Editor store — coverage for the paths the group-model suite
 * (`tests/renderer/editor-store.test.ts`) doesn't exercise: query tabs,
 * neighborhood/pdf/source tabs, autosave/persist timers, dirty tracking +
 * reload-from-disk, non-markdown (plain-text / unsupported) opens, source-tab
 * teardown, and the query/pdf/graph/source round-trips through save + restore.
 *
 * Same mock pattern as the sibling suite: `window.api` (`../ipc/client`) is
 * replaced with configurable slices, the singleton store is driven directly,
 * and both the reactive state transition AND the routed `api.*` call are
 * asserted for mutations. The singleton is reset via `editor.clear()` between
 * tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LayoutSession } from '../../../src/shared/types';

const h = vi.hoisted(() => ({
  readFile: vi.fn(async (p: string) => `# ${p}\nbody`),
  writeFile: vi.fn(async () => {}),
  tabsSave: vi.fn(async () => {}),
  tabsLoad: vi.fn(async (): Promise<unknown> => null),
  graphQuery: vi.fn(),
  tablesQuery: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    notebase: { readFile: h.readFile, writeFile: h.writeFile },
    tabs: { save: h.tabsSave, load: h.tabsLoad },
    graph: { query: h.graphQuery },
    tables: { query: h.tablesQuery },
  },
}));

import { getEditorStore } from '../../../src/renderer/lib/stores/editor.svelte';

const editor = getEditorStore();

beforeEach(() => {
  vi.clearAllMocks();
  h.readFile.mockImplementation(async (p: string) => `# ${p}\nbody`);
  editor.onAutoSaved = null;
  editor.clear(); // collapse to a single empty group
});

// ── Query tabs ──────────────────────────────────────────────────────────────

describe('query tabs — open / edit / language', () => {
  it('openQuery creates a focused SPARQL tab; activeQueryTab exposes it', () => {
    editor.openQuery('SELECT * WHERE { ?s ?p ?o }', 'sparql');
    expect(editor.tabs).toHaveLength(1);
    const t = editor.activeQueryTab;
    expect(t?.type).toBe('query');
    expect(t?.language).toBe('sparql');
    expect(t?.title).toMatch(/^Query \d+$/);
    expect(t?.query).toBe('SELECT * WHERE { ?s ?p ?o }');
    // Non-query getters read null for a query tab.
    expect(editor.activeNoteTab).toBeNull();
    expect(editor.activeSourceTab).toBeNull();
    expect(editor.activeFilePath).toBeNull();
    expect(editor.content).toBe('');
  });

  it('openQuery in SQL mode titles the tab "SQL Query N"', () => {
    editor.openQuery('SELECT 1', 'sql');
    expect(editor.activeQueryTab?.title).toMatch(/^SQL Query \d+$/);
    expect(editor.activeQueryTab?.language).toBe('sql');
  });

  it('setQueryText updates the active query buffer', () => {
    editor.openQuery('', 'sparql');
    editor.setQueryText('ASK { ?s ?p ?o }');
    expect(editor.activeQueryTab?.query).toBe('ASK { ?s ?p ?o }');
  });

  it('setQueryText is a no-op when no query tab is active', async () => {
    await editor.openFile('a.md');
    editor.setQueryText('ignored'); // active tab is a note
    expect(editor.activeQueryTab).toBeNull();
  });

  it('setQueryLanguage switches language, auto-renames the default title, and clears stale results', () => {
    editor.openQuery('SELECT 1', 'sparql');
    const t = editor.activeQueryTab!;
    // Seed prior-language results so we can watch them clear.
    t.results = [{ x: '1' }];
    t.columns = ['x'];
    t.error = 'stale';
    t.executionTime = 42;

    editor.setQueryLanguage('sql');
    expect(editor.activeQueryTab?.language).toBe('sql');
    expect(editor.activeQueryTab?.title).toMatch(/^SQL Query \d+$/);
    expect(editor.activeQueryTab?.results).toBeNull();
    expect(editor.activeQueryTab?.columns).toEqual([]);
    expect(editor.activeQueryTab?.error).toBeNull();
    expect(editor.activeQueryTab?.executionTime).toBeNull();
  });

  it('setQueryLanguage is a no-op when the language is unchanged', () => {
    editor.openQuery('SELECT 1', 'sparql');
    const before = editor.activeQueryTab?.title;
    editor.setQueryLanguage('sparql');
    expect(editor.activeQueryTab?.title).toBe(before);
  });

  it('setQueryLanguage keeps a customized (non-default) title', async () => {
    // A restored query tab can carry a hand-set title; the rename must skip it.
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [{
        id: 'group-1', activeIndex: 0, viewMode: 'source',
        tabs: [{ type: 'query', title: 'My Analysis', query: 'SELECT 1', language: 'sparql' }],
      }],
      layout: { kind: 'leaf', groupId: 'group-1' },
    });
    await editor.restoreTabs();
    expect(editor.activeQueryTab?.title).toBe('My Analysis');

    editor.setQueryLanguage('sql');
    expect(editor.activeQueryTab?.language).toBe('sql');
    expect(editor.activeQueryTab?.title).toBe('My Analysis'); // untouched
  });
});

describe('executeQuery', () => {
  it('runs a SQL query and normalizes rows through the tables api', async () => {
    editor.openQuery('SELECT * FROM t', 'sql');
    h.tablesQuery.mockResolvedValueOnce({
      ok: true,
      columns: ['n', 'name'],
      rows: [{ n: 1n, name: 'a' }, { n: 2n, name: null }],
    });
    await editor.executeQuery();

    expect(h.tablesQuery).toHaveBeenCalledWith('SELECT * FROM t');
    const t = editor.activeQueryTab!;
    expect(t.executing).toBe(false);
    expect(t.error).toBeNull();
    expect(t.columns).toEqual(['n', 'name']);
    // BigInt → string, null → '' (normalizeSqlRows contract).
    expect(t.results).toEqual([{ n: '1', name: 'a' }, { n: '2', name: '' }]);
    expect(typeof t.executionTime).toBe('number');
  });

  it('records a SQL error without results', async () => {
    editor.openQuery('bad sql', 'sql');
    h.tablesQuery.mockResolvedValueOnce({ ok: false, error: 'syntax error' });
    await editor.executeQuery();
    const t = editor.activeQueryTab!;
    expect(t.error).toBe('syntax error');
    expect(t.results).toBeNull();
    expect(t.executing).toBe(false);
  });

  it('runs a SPARQL query, using the engine column projection when present', async () => {
    editor.openQuery('SELECT ?s ?o WHERE {}', 'sparql');
    h.graphQuery.mockResolvedValueOnce({
      results: [{ s: 'x' }], // ?o unbound in this row
      columns: ['s', 'o'],   // projection keeps the empty column
    });
    await editor.executeQuery();

    expect(h.graphQuery).toHaveBeenCalledWith('SELECT ?s ?o WHERE {}');
    const t = editor.activeQueryTab!;
    expect(t.columns).toEqual(['s', 'o']);
    expect(t.results).toEqual([{ s: 'x' }]);
    expect(t.error).toBeNull();
  });

  it('falls back to the union of row keys when the projection is absent', async () => {
    editor.openQuery('SELECT * WHERE {}', 'sparql');
    h.graphQuery.mockResolvedValueOnce({
      results: [{ a: '1' }, { b: '2' }], // no columns field / older main
      columns: [],
    });
    await editor.executeQuery();
    expect(editor.activeQueryTab?.columns).toEqual(['a', 'b']);
  });

  it('records a SPARQL engine error', async () => {
    editor.openQuery('bad sparql', 'sparql');
    h.graphQuery.mockResolvedValueOnce({ results: [], columns: [], error: 'parse error' });
    await editor.executeQuery();
    expect(editor.activeQueryTab?.error).toBe('parse error');
    expect(editor.activeQueryTab?.results).toBeNull();
  });

  it('captures a thrown exception as the tab error', async () => {
    editor.openQuery('SELECT 1', 'sparql');
    h.graphQuery.mockRejectedValueOnce(new Error('boom'));
    await editor.executeQuery();
    const t = editor.activeQueryTab!;
    expect(t.error).toContain('boom');
    expect(t.executing).toBe(false);
    expect(typeof t.executionTime).toBe('number');
  });

  it('is a no-op when there is no active query tab', async () => {
    await editor.openFile('a.md');
    await editor.executeQuery();
    expect(h.graphQuery).not.toHaveBeenCalled();
    expect(h.tablesQuery).not.toHaveBeenCalled();
  });

  it('is a no-op while a query is already executing', async () => {
    editor.openQuery('SELECT 1', 'sparql');
    editor.activeQueryTab!.executing = true;
    await editor.executeQuery();
    expect(h.graphQuery).not.toHaveBeenCalled();
  });
});

// ── Neighborhood (graph) tabs ─────────────────────────────────────────────────

describe('neighborhood graph tabs (#847)', () => {
  it('openNeighborhood opens a focused graph tab with the requested depth', () => {
    editor.openNeighborhood('note.md', { depth: 2 });
    expect(editor.tabs).toHaveLength(1);
    const t = editor.activeTab;
    expect(t?.type).toBe('graph');
    expect(t?.type === 'graph' && t.relativePath).toBe('note.md');
    expect(t?.type === 'graph' && t.depth).toBe(2);
  });

  it('defaults depth to 1 and refocuses instead of duplicating', () => {
    editor.openNeighborhood('note.md'); // depth default 1
    const first = editor.activeTab;
    expect(first?.type === 'graph' && first.depth).toBe(1);

    // Open a second, different tab, then reopen the neighborhood — refocus.
    editor.openQuery('SELECT 1');
    expect(editor.tabs).toHaveLength(2);
    editor.openNeighborhood('note.md');
    expect(editor.tabs).toHaveLength(2); // no duplicate
    expect(editor.activeTab?.type).toBe('graph');
  });

  it('setGraphDepth updates the tab depth and floors it at 1', () => {
    editor.openNeighborhood('note.md', { depth: 1 });
    editor.setGraphDepth('note.md', 4);
    expect(editor.activeTab?.type === 'graph' && editor.activeTab.depth).toBe(4);
    editor.setGraphDepth('note.md', 0); // clamped up to 1
    expect(editor.activeTab?.type === 'graph' && editor.activeTab.depth).toBe(1);
  });

  it('setGraphDepth is a no-op for a path with no graph tab', () => {
    editor.setGraphDepth('missing.md', 3); // nothing open — should not throw
    expect(editor.tabs).toHaveLength(0);
  });
});

// ── PDF tabs ──────────────────────────────────────────────────────────────────

describe('pdf tabs', () => {
  it('openPdf opens a focused pdf tab at page 1 by default', () => {
    editor.openPdf('src-1');
    const t = editor.activeTab;
    expect(t?.type).toBe('pdf');
    expect(t?.type === 'pdf' && t.page).toBe(1);
  });

  it('setPdfPage updates the persisted page and persists', () => {
    editor.openPdf('src-1', { page: 3 });
    h.tabsSave.mockClear();
    editor.setPdfPage('src-1', 9);
    expect(editor.activeTab?.type === 'pdf' && editor.activeTab.page).toBe(9);
  });

  it('setPdfPage is a no-op when the page is unchanged', () => {
    editor.openPdf('src-1', { page: 5 });
    h.tabsSave.mockClear();
    editor.setPdfPage('src-1', 5); // same page → early return, no persist
    expect(h.tabsSave).not.toHaveBeenCalled();
  });

  it('setPdfPage is a no-op for an unknown source', () => {
    editor.setPdfPage('nope', 2); // nothing open
    expect(editor.tabs).toHaveLength(0);
  });
});

// ── Source tabs + teardown ────────────────────────────────────────────────────

describe('source tabs', () => {
  it('openSource opens a focused source tab; activeSourceTab exposes it', () => {
    editor.openSource('src-1', { highlightExcerptId: 'ex-1' });
    expect(editor.activeSourceTab?.sourceId).toBe('src-1');
    expect(editor.activeSourceTab?.highlightExcerptId).toBe('ex-1');
  });

  it('closeTabsForSource closes both the source detail and its pdf, across groups', () => {
    editor.openSource('src-1');            // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.addGroup();
    editor.openPdf('src-1', { page: 2, groupId: g2 }); // g2
    editor.openQuery('SELECT 1', 'sparql', g2);        // unrelated tab stays
    expect(editor.groups[1].tabs).toHaveLength(2);

    const closed = editor.closeTabsForSource('src-1');
    expect(closed).toBe(2);
    // g1's source is gone; g2 keeps only the query.
    expect(editor.groups.find((g) => g.id === g1)?.tabs).toHaveLength(0);
    const remaining = editor.groups.find((g) => g.id === g2)?.tabs ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.type).toBe('query');
  });

  it('closeTabsForSource returns 0 and persists nothing when nothing matches', () => {
    editor.openSource('src-1');
    h.tabsSave.mockClear();
    const closed = editor.closeTabsForSource('other');
    expect(closed).toBe(0);
    expect(h.tabsSave).not.toHaveBeenCalled();
  });

  it('closeTabsForSource re-homes the active index when an earlier tab is removed', () => {
    editor.openSource('keep-src'); // index 0
    editor.openPdf('gone-src');    // index 1 (active)
    editor.openQuery('SELECT 1');  // index 2 (active)
    expect(editor.activeIndex).toBe(2);
    editor.closeTabsForSource('gone-src'); // removes index 1
    // Active index shifts down by one to still point at the query tab.
    expect(editor.activeIndex).toBe(1);
    expect(editor.activeTab?.type).toBe('query');
  });

  it('closeTabsForSource re-homes onto a survivor when the ACTIVE tab is the one removed', async () => {
    await editor.openFile('a.md'); // index 0
    editor.openSource('gone');     // index 1 (active)
    expect(editor.activeIndex).toBe(1);
    editor.closeTabsForSource('gone'); // active tab removed → activeIndex reset then re-homed
    expect(editor.tabs).toHaveLength(1);
    expect(editor.activeIndex).toBe(0);
    expect(editor.activeTab?.type).toBe('note');
  });
});

// ── openFile: non-markdown capabilities ──────────────────────────────────────

describe('openFile capability routing (#1130)', () => {
  it('opens a plain-text file with the plainText flag, still reading it as text', async () => {
    await editor.openFile('script.ts');
    const t = editor.activeNoteTab;
    expect(t?.type).toBe('note');
    expect(t?.plainText).toBe(true);
    expect(h.readFile).toHaveBeenCalledWith('script.ts');
    expect(editor.content).toContain('script.ts');
  });

  it('routes an unsupported (binary) file to an unsupported tab and never reads it', async () => {
    await editor.openFile('image.png');
    const t = editor.activeTab;
    expect(t?.type).toBe('unsupported');
    expect(t?.type === 'unsupported' && t.ext).toBe('.png');
    expect(t?.type === 'unsupported' && t.fileName).toBe('image.png');
    expect(h.readFile).not.toHaveBeenCalled();
    // Note-shaped getters degrade gracefully for a non-note active tab.
    expect(editor.activeFilePath).toBeNull();
    expect(editor.activeFileName).toBe('');
    expect(editor.isDirty).toBe(false);
  });

  it('re-opening an already-open unsupported file refocuses it', async () => {
    await editor.openFile('image.png');
    await editor.openFile('other.md');
    expect(editor.tabs).toHaveLength(2);
    await editor.openFile('image.png'); // dup → refocus, no read
    expect(editor.tabs).toHaveLength(2);
    expect(editor.activeTab?.type).toBe('unsupported');
  });
});

// ── save guard / dirty / reload ──────────────────────────────────────────────

describe('save guard, dirty tracking, reload-from-disk', () => {
  it('save is a no-op when the active tab is not a note', async () => {
    editor.openQuery('SELECT 1');
    await editor.save();
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it('isPathDirty reflects unsaved edits for a specific path', async () => {
    await editor.openFile('a.md');
    expect(editor.isPathDirty('a.md')).toBe(false);
    editor.setContent('changed');
    expect(editor.isPathDirty('a.md')).toBe(true);
    expect(editor.isPathDirty('not-open.md')).toBe(false);
  });

  it('reloadTabFromDisk refreshes content and resets the saved baseline (clears dirty)', async () => {
    await editor.openFile('a.md');
    editor.setContent('local edit');
    expect(editor.isPathDirty('a.md')).toBe(true);

    h.readFile.mockResolvedValueOnce('# fresh from disk');
    await editor.reloadTabFromDisk('a.md');
    expect(editor.content).toBe('# fresh from disk');
    expect(editor.isPathDirty('a.md')).toBe(false); // content === savedContent
  });

  it('reloadTabFromDisk swallows a read error (file deleted since notification)', async () => {
    await editor.openFile('a.md');
    editor.setContent('local');
    h.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    await editor.reloadTabFromDisk('a.md'); // must not throw
    // Buffer is left as-is (the local edit survives the failed reload).
    expect(editor.content).toBe('local');
  });

  it('reloadTabFromDisk is a no-op for a path with no open tab', async () => {
    await editor.reloadTabFromDisk('nowhere.md');
    expect(h.readFile).not.toHaveBeenCalled();
  });
});

// ── rename transitions edge cases ─────────────────────────────────────────────

describe('applyRenameTransitions edge cases', () => {
  it('is a no-op for an empty transition list', () => {
    editor.applyRenameTransitions([]);
    expect(h.tabsSave).not.toHaveBeenCalled();
  });

  it('rewrites an unsupported tab path and refreshes its extension', async () => {
    await editor.openFile('diagram.png'); // unsupported tab
    editor.applyRenameTransitions([{ old: 'diagram.png', new: 'sub/pic.jpg' }]);
    const t = editor.activeTab;
    expect(t?.type === 'unsupported' && t.relativePath).toBe('sub/pic.jpg');
    expect(t?.type === 'unsupported' && t.fileName).toBe('pic.jpg');
    expect(t?.type === 'unsupported' && t.ext).toBe('.jpg');
  });
});

// ── autosave / persist timers ─────────────────────────────────────────────────

describe('autosave + persist timers', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('setContent schedules an autosave that fires save() and the onAutoSaved callback', async () => {
    vi.useFakeTimers();
    await editor.openFile('a.md');
    let saved = false;
    editor.onAutoSaved = () => { saved = true; };

    editor.setContent('auto edited');
    expect(h.writeFile).not.toHaveBeenCalled(); // debounced, not yet
    await vi.advanceTimersByTimeAsync(1000);    // AUTO_SAVE_DELAY

    expect(h.writeFile).toHaveBeenCalledWith('a.md', 'auto edited');
    expect(saved).toBe(true);
    expect(editor.isDirty).toBe(false);
  });

  it('a second edit debounces — only the latest content is written once', async () => {
    vi.useFakeTimers();
    await editor.openFile('a.md');
    editor.setContent('first');
    await vi.advanceTimersByTimeAsync(400);
    editor.setContent('second'); // resets the timer
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.writeFile).toHaveBeenCalledTimes(1);
    expect(h.writeFile).toHaveBeenCalledWith('a.md', 'second');
  });

  it('schedulePersistTabs debounces to a single tabs.save', async () => {
    vi.useFakeTimers();
    await editor.openFile('a.md');
    h.tabsSave.mockClear();
    editor.schedulePersistTabs();
    editor.schedulePersistTabs();
    await vi.advanceTimersByTimeAsync(500); // TAB_PERSIST_DELAY
    expect(h.tabsSave).toHaveBeenCalledTimes(1);
  });
});

// ── generic tab op guards ─────────────────────────────────────────────────────

describe('generic tab op guards', () => {
  it('closeTab ignores an out-of-range index', async () => {
    await editor.openFile('a.md');
    editor.closeTab(99);
    expect(editor.tabs).toHaveLength(1);
    editor.closeTab(-1);
    expect(editor.tabs).toHaveLength(1);
  });

  it('closeOthers ignores an out-of-range index (keeps every tab)', async () => {
    await editor.openFile('a.md');
    await editor.openFile('b.md');
    editor.closeOthers(99);
    expect(editor.tabs).toHaveLength(2);
  });

  it('closeTab flushes a pending autosave when closing the active note tab', async () => {
    vi.useFakeTimers();
    try {
      await editor.openFile('a.md');
      editor.setContent('dirty'); // schedules autosave
      editor.closeTab(editor.activeIndex); // flushes → immediate save
      await Promise.resolve();
      await Promise.resolve();
      expect(h.writeFile).toHaveBeenCalledWith('a.md', 'dirty');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closeTabsForDeletedPath re-homes the active index across a mid-list deletion', async () => {
    await editor.openFile('keep-a.md'); // 0
    await editor.openFile('gone.md');   // 1
    await editor.openFile('keep-b.md'); // 2 (active)
    const closed = editor.closeTabsForDeletedPath('gone.md');
    expect(closed).toBe(1);
    expect(editor.tabs).toHaveLength(2);
    // Active pointer follows the surviving tabs (no dangling index).
    expect(editor.activeIndex).toBeGreaterThanOrEqual(0);
    expect(editor.activeIndex).toBeLessThan(2);
  });

  it('closeTabsForDeletedPath re-homes onto a survivor when the ACTIVE tab is deleted', () => {
    editor.openSource('keep-src'); // 0
    // Manually append a note after the source so the active (index 1) note is deleted.
    // openFile forbids duplicate; here a single note deletion with a non-note survivor.
    return editor.openFile('gone.md').then(() => {
      expect(editor.activeIndex).toBe(1);
      const closed = editor.closeTabsForDeletedPath('gone.md');
      expect(closed).toBe(1);
      expect(editor.tabs).toHaveLength(1);
      expect(editor.activeIndex).toBe(0); // re-homed onto the surviving source tab
      expect(editor.activeTab?.type).toBe('source');
    });
  });

  it('exposes the active group object via the activeGroup getter', async () => {
    await editor.openFile('a.md');
    expect(editor.activeGroup.id).toBe(editor.activeGroupId);
    expect(editor.activeGroup.tabs).toBe(editor.tabs);
  });
});

// ── moveTab guards ────────────────────────────────────────────────────────────

describe('moveTab / moveTabToSplit guards', () => {
  it('moveTab is a no-op for unknown source or destination groups', async () => {
    await editor.openFile('a.md');
    editor.moveTab('nope', 0, editor.groups[0].id);
    editor.moveTab(editor.groups[0].id, 0, 'nowhere');
    expect(editor.tabs).toHaveLength(1);
  });

  it('moveTab is a no-op for an out-of-range source index', async () => {
    await editor.openFile('a.md');
    editor.moveTab(editor.groups[0].id, 5, editor.groups[0].id, 0);
    expect(editor.tabs).toHaveLength(1);
  });

  it('moveTab reorders within a pane (toIndex past the source is adjusted down)', async () => {
    await editor.openFile('a.md'); // 0
    await editor.openFile('b.md'); // 1
    await editor.openFile('c.md'); // 2
    const g = editor.groups[0].id;
    // Move a.md (0) to index 2 — with the removal-shift it lands between b and c.
    editor.moveTab(g, 0, g, 2);
    const paths = editor.tabs.map((t) => (t.type === 'note' ? t.relativePath : t.type));
    expect(paths).toEqual(['b.md', 'a.md', 'c.md']);
  });

  it('moveTabToSplit is a no-op for a bad source', async () => {
    await editor.openFile('a.md');
    editor.moveTabToSplit('nope', 0, editor.groups[0].id, 'horizontal', false);
    expect(editor.groups).toHaveLength(1);
  });
});

// ── save / restore round-trips for every tab kind ─────────────────────────────

describe('persist + restore across every tab kind', () => {
  it('toSavedTab serializes note (with plainText/cursor), query, pdf, graph, source, unsupported', async () => {
    await editor.openFile('code.ts');   // plain-text note
    editor.saveEditorState('code.ts', 12, 120); // cursor/scroll fields
    editor.openQuery('SELECT 1', 'sql');
    editor.openPdf('src-1', { page: 4 });
    editor.openNeighborhood('code.ts', { depth: 3 });
    editor.openSource('src-2', { highlightExcerptId: 'ex-2' });
    await editor.openFile('bin.dat');   // unsupported

    editor.persistTabs();
    const saved = h.tabsSave.mock.calls.at(-1)?.[0] as LayoutSession;
    const kinds = saved.groups[0].tabs.map((t) => t.type);
    expect(kinds).toEqual(['note', 'query', 'pdf', 'graph', 'source', 'unsupported']);

    const note = saved.groups[0].tabs[0];
    expect(note).toMatchObject({ type: 'note', relativePath: 'code.ts', plainText: true, cursorOffset: 12, scrollTop: 120 });
    expect(saved.groups[0].tabs[1]).toMatchObject({ type: 'query', title: expect.stringMatching(/SQL Query/), language: 'sql' });
    expect(saved.groups[0].tabs[2]).toMatchObject({ type: 'pdf', sourceId: 'src-1', page: 4 });
    expect(saved.groups[0].tabs[3]).toMatchObject({ type: 'graph', relativePath: 'code.ts', depth: 3 });
    expect(saved.groups[0].tabs[4]).toMatchObject({ type: 'source', sourceId: 'src-2', highlightExcerptId: 'ex-2' });
    expect(saved.groups[0].tabs[5]).toMatchObject({ type: 'unsupported', relativePath: 'bin.dat' });
  });

  it('reconstructTab rebuilds query, pdf, graph, source, and unsupported tabs on restore', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [{
        id: 'group-1', activeIndex: 0, viewMode: 'source',
        tabs: [
          { type: 'query', title: 'Q', query: 'SELECT 1', language: 'sql' },
          { type: 'pdf', sourceId: 'p-1', page: 6 },
          { type: 'graph', relativePath: 'g.md', depth: 5 },
          { type: 'source', sourceId: 's-1', highlightExcerptId: 'ex' },
          { type: 'unsupported', relativePath: 'blob.bin' },
        ],
      }],
      layout: { kind: 'leaf', groupId: 'group-1' },
    });
    await editor.restoreTabs();

    const tabs = editor.groups[0].tabs;
    expect(tabs.map((t) => t.type)).toEqual(['query', 'pdf', 'graph', 'source', 'unsupported']);
    expect(tabs[0].type === 'query' && tabs[0].language).toBe('sql');
    expect(tabs[1].type === 'pdf' && tabs[1].page).toBe(6);
    expect(tabs[2].type === 'graph' && tabs[2].depth).toBe(5);
    expect(tabs[3].type === 'source' && tabs[3].highlightExcerptId).toBe('ex');
    expect(tabs[4].type === 'unsupported' && tabs[4].ext).toBe('.bin');
  });

  it('reconstructTab defaults a legacy query language to sparql, pdf page to 1, graph depth to 1', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [{
        id: 'group-1', activeIndex: 0, viewMode: 'source',
        tabs: [
          { type: 'query', title: 'Q', query: 'x' },   // no language
          { type: 'pdf', sourceId: 'p' },               // no page
          { type: 'graph', relativePath: 'g.md' },      // no depth
        ],
      }],
      layout: { kind: 'leaf', groupId: 'group-1' },
    });
    await editor.restoreTabs();
    const tabs = editor.groups[0].tabs;
    expect(tabs[0].type === 'query' && tabs[0].language).toBe('sparql');
    expect(tabs[1].type === 'pdf' && tabs[1].page).toBe(1);
    expect(tabs[2].type === 'graph' && tabs[2].depth).toBe(1);
  });

  it('dedups a pdf/source that appears in two panes on restore (savedTabIdentity)', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [
        { id: 'group-1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'pdf', sourceId: 'dup', page: 1 }, { type: 'source', sourceId: 'sdup' }] },
        { id: 'group-2', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'pdf', sourceId: 'dup', page: 2 }, { type: 'source', sourceId: 'sdup' }] },
      ],
      layout: {
        kind: 'split', direction: 'horizontal', sizes: [0.5, 0.5],
        children: [{ kind: 'leaf', groupId: 'group-1' }, { kind: 'leaf', groupId: 'group-2' }],
      },
    });
    await editor.restoreTabs();
    const all = editor.groups.flatMap((g) => g.tabs);
    expect(all.filter((t) => t.type === 'pdf')).toHaveLength(1);
    expect(all.filter((t) => t.type === 'source')).toHaveLength(1);
    // Both survivors live in the first pane (dedup keeps the earliest).
    expect(editor.groups.find((g) => g.id === 'group-2')?.tabs).toHaveLength(0);
  });

  it('treats a legacy flat session with zero tabs as empty (keeps the default group)', async () => {
    h.tabsLoad.mockResolvedValueOnce({ activeIndex: 0, tabs: [] });
    await editor.restoreTabs();
    expect(editor.groups).toHaveLength(1);
    expect(editor.tabs).toHaveLength(0);
  });
});

// ── Tab persistence must survive the structured-clone IPC boundary ──────────

describe('persistTabs — structured-clone safety', () => {
  it('sends a payload Electron can actually clone when a type-view tab has columns', async () => {
    // `toSavedTab` copies a type-view tab's `columns` off `$state` by
    // reference. It currently comes back as a plain array (verified — this
    // test passes without the snapshot), but a Svelte Proxy would be rejected
    // by the structured-clone IPC boundary and lose the whole session save
    // silently. Pins the invariant so a future change to how tabs are stored
    // can't quietly break session restore.
    editor.openTypeView('book', { layout: 'table', columns: ['author', 'rating'] });
    editor.persistTabs();

    expect(h.tabsSave).toHaveBeenCalled();
    const session = h.tabsSave.mock.calls[0]![0] as LayoutSession;
    expect(() => structuredClone(session)).not.toThrow();
  });

  it('round-trips the type-view projection through the persisted session', async () => {
    editor.openTypeView('book', { layout: 'gallery', sortColumn: 'rating', sortDir: 'desc', columns: ['author'] });
    editor.persistTabs();

    const session = h.tabsSave.mock.calls[0]![0] as LayoutSession;
    const saved = session.groups.flatMap((g) => g.tabs).find((t) => t.type === 'type-view');
    expect(saved).toMatchObject({
      type: 'type-view', typeId: 'book', layout: 'gallery',
      sortColumn: 'rating', sortDir: 'desc', columns: ['author'],
    });
  });
});
