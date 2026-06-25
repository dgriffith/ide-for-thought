/**
 * Editor store — editor-group model (#811).
 *
 * Phase 1 of #810 promotes the `tabs[]` / `activeIndex` / `viewMode` singleton
 * into a collection of editor groups. These tests pin (a) one-group parity —
 * the app behaves exactly as before when only one group exists — and (b) the
 * new group-scoped mutation surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LayoutSession } from '../../src/shared/types';

const h = vi.hoisted(() => ({
  readFile: vi.fn(async (p: string) => `# ${p}\nbody`),
  writeFile: vi.fn(async () => {}),
  tabsSave: vi.fn(async () => {}),
  tabsLoad: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock('../../src/renderer/lib/ipc/client', () => ({
  api: {
    notebase: { readFile: h.readFile, writeFile: h.writeFile },
    tabs: { save: h.tabsSave, load: h.tabsLoad },
    graph: { query: vi.fn() },
    tables: { query: vi.fn() },
  },
}));

import { getEditorStore } from '../../src/renderer/lib/stores/editor.svelte';

const editor = getEditorStore();

beforeEach(() => {
  vi.clearAllMocks();
  editor.clear(); // collapse to a single empty group
});

describe('one-group parity (#811)', () => {
  it('starts with exactly one group and no tabs', () => {
    expect(editor.groups).toHaveLength(1);
    expect(editor.tabs).toHaveLength(0);
    expect(editor.activeIndex).toBe(-1);
    expect(editor.activeFilePath).toBeNull();
    expect(editor.viewMode).toBe('source');
  });

  it('open / switch / close behave as before', async () => {
    await editor.openFile('a.md');
    await editor.openFile('b.md');
    expect(editor.tabs).toHaveLength(2);
    expect(editor.activeFilePath).toBe('b.md');

    editor.switchTab(0);
    expect(editor.activeFilePath).toBe('a.md');

    // Re-opening an already-open file just focuses it (no duplicate tab).
    await editor.openFile('b.md');
    expect(editor.tabs).toHaveLength(2);
    expect(editor.activeFilePath).toBe('b.md');

    editor.closeTab(editor.activeIndex);
    expect(editor.tabs).toHaveLength(1);
    expect(editor.activeFilePath).toBe('a.md');
  });

  it('dirty tracking + save', async () => {
    await editor.openFile('a.md');
    expect(editor.isDirty).toBe(false);
    editor.setContent('edited');
    expect(editor.isDirty).toBe(true);
    expect(editor.hasAnyDirty).toBe(true);
    editor.flushAutoSave();
    await Promise.resolve();
    await editor.save();
    expect(h.writeFile).toHaveBeenCalledWith('a.md', 'edited');
    expect(editor.isDirty).toBe(false);
  });

  it('view mode cycles source → preview → editor-preview → source', () => {
    expect(editor.viewMode).toBe('source');
    editor.cycleViewMode();
    expect(editor.viewMode).toBe('preview');
    editor.cycleViewMode();
    expect(editor.viewMode).toBe('editor-preview');
    editor.cycleViewMode();
    expect(editor.viewMode).toBe('source');
    editor.setViewMode('preview');
    expect(editor.viewMode).toBe('preview');
  });
});

describe('group-scoped mutations (#811)', () => {
  it('addGroup creates an independent group with its own tabs + view mode', async () => {
    await editor.openFile('a.md'); // group 1
    const g2 = editor.addGroup('preview');
    expect(editor.groups).toHaveLength(2);

    // Opening into g2 focuses it and leaves group 1's tabs intact.
    await editor.openFile('b.md', g2);
    expect(editor.activeGroupId).toBe(g2);
    expect(editor.activeFilePath).toBe('b.md');
    expect(editor.tabs).toHaveLength(1); // active group (g2) has just b.md
    expect(editor.viewMode).toBe('preview'); // g2's own mode

    // Group 1 still holds a.md with its own source view mode.
    editor.setActiveGroup(editor.groups[0].id);
    expect(editor.activeFilePath).toBe('a.md');
    expect(editor.viewMode).toBe('source');
  });

  it('view mode is per group', async () => {
    const g2 = editor.addGroup();
    editor.setViewMode('preview'); // active = group 1
    editor.setViewMode('editor-preview', g2);
    expect(editor.groups[0].viewMode).toBe('preview');
    expect(editor.groups[1].viewMode).toBe('editor-preview');
  });

  it('closeTabsForDeletedPath sweeps every group', async () => {
    await editor.openFile('keep.md'); // group 1
    const g2 = editor.addGroup();
    await editor.openFile('gone.md', g2);
    expect(editor.groups[1].tabs).toHaveLength(1);

    const closed = editor.closeTabsForDeletedPath('gone.md');
    expect(closed).toBe(1);
    expect(editor.groups[1].tabs).toHaveLength(0);
    // The untouched group keeps its tab.
    expect(editor.groups[0].tabs).toHaveLength(1);
  });

  it('applyRenameTransitions rewrites paths across groups', async () => {
    await editor.openFile('old.md'); // group 1
    const g2 = editor.addGroup();
    await editor.openFile('other.md', g2);

    editor.applyRenameTransitions([{ old: 'old.md', new: 'new.md' }]);
    expect(editor.groups[0].tabs[0].type === 'note' && editor.groups[0].tabs[0].relativePath).toBe('new.md');
    expect(editor.groups[1].tabs[0].type === 'note' && editor.groups[1].tabs[0].relativePath).toBe('other.md');
  });
});

describe('group-addressed editor sourcing (#812)', () => {
  it('noteTabForGroup sources each group independently', async () => {
    await editor.openFile('one.md'); // group 1
    const g2 = editor.addGroup();
    await editor.openFile('two.md', g2);

    const t1 = editor.noteTabForGroup(editor.groups[0].id);
    const t2 = editor.noteTabForGroup(g2);
    expect(t1?.relativePath).toBe('one.md');
    expect(t2?.relativePath).toBe('two.md');
    expect(t1).not.toBe(t2);
  });

  it('returns null for an unknown group or a non-note active tab', () => {
    expect(editor.noteTabForGroup('nope')).toBeNull();
    const g = editor.addGroup();
    editor.openQuery('SELECT 1', 'sparql', g);
    expect(editor.noteTabForGroup(g)).toBeNull();
  });

  it('content / cursor / scroll / history stay independent per group', async () => {
    await editor.openFile('a.md'); // group 1
    const g1 = editor.groups[0].id;
    const g2 = editor.addGroup();
    await editor.openFile('b.md', g2);

    // Edit each group's buffer through the group-targeted setter — what the
    // Editor's onContentChange routes to.
    editor.setContent('edited-A', g1);
    editor.setContent('edited-B', g2);
    expect(editor.noteTabForGroup(g1)?.content).toBe('edited-A');
    expect(editor.noteTabForGroup(g2)?.content).toBe('edited-B');

    // Per-file cursor/scroll/history capture lands on the right group's tab.
    editor.saveEditorState('a.md', 10, 100, { hist: 'A' });
    editor.saveEditorState('b.md', 20, 200, { hist: 'B' });
    const ta = editor.noteTabForGroup(g1);
    const tb = editor.noteTabForGroup(g2);
    expect([ta?.cursorOffset, ta?.scrollTop, ta?.historyJson]).toEqual([10, 100, { hist: 'A' }]);
    expect([tb?.cursorOffset, tb?.scrollTop, tb?.historyJson]).toEqual([20, 200, { hist: 'B' }]);
  });
});

describe('split layout ops (#813)', () => {
  it('starts as a single leaf for the lone group', () => {
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: editor.groups[0].id });
  });

  it('splitGroup grows the tree, creates a new empty group, and focuses it', async () => {
    await editor.openFile('a.md');
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');

    expect(editor.groups).toHaveLength(2);
    expect(editor.activeGroupId).toBe(g2);
    expect(editor.layout).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      children: [{ kind: 'leaf', groupId: g1 }, { kind: 'leaf', groupId: g2 }],
    });
    // New pane is empty; opening a file lands in it (the active group).
    expect(editor.noteTabForGroup(g2)).toBeNull();
    await editor.openFile('b.md');
    expect(editor.noteTabForGroup(g2)?.relativePath).toBe('b.md');
    expect(editor.noteTabForGroup(g1)?.relativePath).toBe('a.md');
  });

  it('new pane inherits the splitting pane\'s view mode', async () => {
    const g1 = editor.groups[0].id;
    editor.setViewMode('preview', g1);
    const g2 = editor.splitGroup(g1, 'vertical');
    expect(editor.groups.find((g) => g.id === g2)?.viewMode).toBe('preview');
  });

  it('collapseGroup removes the pane, rebalances the tree, and reassigns focus', async () => {
    await editor.openFile('a.md');
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    expect(editor.activeGroupId).toBe(g2);

    editor.collapseGroup(g2);
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: g1 });
    expect(editor.activeGroupId).toBe(g1); // focus fell back to the survivor
  });

  it('collapseGroup is a no-op for the last remaining pane', () => {
    const only = editor.groups[0].id;
    editor.collapseGroup(only);
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: only });
  });

  it('closing a split pane\'s last tab collapses it', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    await editor.openFile('b.md'); // into g2 (active)
    expect(editor.groups).toHaveLength(2);

    // Close g2's only tab → pane collapses, tree returns to the lone leaf.
    editor.closeTab(0, g2);
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: g1 });
  });

  it('closing the last tab of the only pane empties it without collapsing', async () => {
    await editor.openFile('a.md');
    const only = editor.groups[0].id;
    editor.closeTab(0);
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: only });
    expect(editor.tabs).toHaveLength(0);
  });

  it('closeAll on a split pane collapses it, same as closing each tab', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    await editor.openFile('b.md'); // into g2 (active)
    await editor.openFile('c.md'); // g2 now has two tabs
    expect(editor.groups).toHaveLength(2);

    // Close-all empties g2 → pane collapses, tree returns to the lone leaf.
    editor.closeAll(g2);
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: g1 });
  });

  it('closeAll on the only pane empties it without collapsing', async () => {
    await editor.openFile('a.md');
    await editor.openFile('b.md');
    const only = editor.groups[0].id;
    editor.closeAll();
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: only });
    expect(editor.tabs).toHaveLength(0);
  });

  it('closeOthers keeps the named tab and leaves the pane intact', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    await editor.openFile('b.md'); // into g2
    await editor.openFile('c.md'); // g2: [b, c]

    editor.closeOthers(0, g2); // keep b.md
    expect(editor.groups).toHaveLength(2);
    expect(editor.noteTabForGroup(g2)?.relativePath).toBe('b.md');
  });

  it('focusNextGroup / focusPreviousGroup cycle in visual order and wrap (#814)', async () => {
    await editor.openFile('a.md');
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal'); // [g1, g2], g2 active
    const g3 = editor.splitGroup(g2, 'horizontal'); // [g1, g2, g3], g3 active
    expect(editor.activeGroupId).toBe(g3);

    editor.focusNextGroup(); // g3 → wrap → g1
    expect(editor.activeGroupId).toBe(g1);
    editor.focusNextGroup(); // g1 → g2
    expect(editor.activeGroupId).toBe(g2);
    editor.focusPreviousGroup(); // g2 → g1
    expect(editor.activeGroupId).toBe(g1);
    editor.focusPreviousGroup(); // g1 → wrap → g3
    expect(editor.activeGroupId).toBe(g3);
  });

  it('focus cycling is a no-op with a single pane', () => {
    const only = editor.groups[0].id;
    editor.focusNextGroup();
    expect(editor.activeGroupId).toBe(only);
    editor.focusPreviousGroup();
    expect(editor.activeGroupId).toBe(only);
  });

  it('closeActiveGroup closes the focused pane and collapses it (#814)', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    await editor.openFile('b.md'); // into g2 (active)
    expect(editor.activeGroupId).toBe(g2);

    editor.closeActiveGroup(); // closes g2
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: g1 });
    expect(editor.activeGroupId).toBe(g1);
  });

  it('closeActiveGroup on the lone pane empties it without collapsing', async () => {
    await editor.openFile('a.md');
    const only = editor.groups[0].id;
    editor.closeActiveGroup();
    expect(editor.groups).toHaveLength(1);
    expect(editor.layout).toEqual({ kind: 'leaf', groupId: only });
    expect(editor.tabs).toHaveLength(0);
  });
});

describe('session persistence — multi-group layout (#816)', () => {
  it('persistTabs writes the versioned multi-group session', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    await editor.openFile('b.md'); // into g2 (active)

    editor.persistTabs();
    const saved = h.tabsSave.mock.calls.at(-1)?.[0] as LayoutSession;
    expect(saved.version).toBe(2);
    expect(saved.activeGroupId).toBe(g2);
    expect(saved.groups).toHaveLength(2);
    expect(saved.layout).toEqual({
      kind: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [{ kind: 'leaf', groupId: g1 }, { kind: 'leaf', groupId: g2 }],
    });
    const sg2 = saved.groups.find((g) => g.id === g2);
    expect(sg2?.tabs).toEqual([{ type: 'note', relativePath: 'b.md', cursorOffset: undefined, scrollTop: undefined }]);
  });

  it('persist → restore round-trips the split arrangement', async () => {
    await editor.openFile('a.md');
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'vertical');
    editor.setViewMode('preview', g2);
    await editor.openFile('b.md');
    editor.persistTabs();
    const saved = h.tabsSave.mock.calls.at(-1)?.[0] as LayoutSession;

    h.tabsLoad.mockResolvedValueOnce(saved);
    await editor.restoreTabs();

    expect(editor.groups).toHaveLength(2);
    expect(editor.layout).toEqual(saved.layout);
    expect(editor.activeGroupId).toBe(g2);
    expect(editor.noteTabForGroup(g1)?.relativePath).toBe('a.md');
    expect(editor.noteTabForGroup(g2)?.relativePath).toBe('b.md');
    expect(editor.groups.find((g) => g.id === g2)?.viewMode).toBe('preview');
  });

  it('restores a saved multi-group session, focus, and view modes', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-2',
      groups: [
        { id: 'group-1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] },
        { id: 'group-2', activeIndex: 0, viewMode: 'preview', tabs: [{ type: 'note', relativePath: 'b.md' }] },
      ],
      layout: {
        kind: 'split', direction: 'horizontal', sizes: [0.4, 0.6],
        children: [{ kind: 'leaf', groupId: 'group-1' }, { kind: 'leaf', groupId: 'group-2' }],
      },
    });
    await editor.restoreTabs();

    expect(editor.groups).toHaveLength(2);
    expect(editor.activeGroupId).toBe('group-2');
    expect((editor.layout as { sizes: number[] }).sizes).toEqual([0.4, 0.6]);
    expect(editor.groups.find((g) => g.id === 'group-2')?.viewMode).toBe('preview');
  });

  it('migrates a legacy flat tabs.json into a single group', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      activeIndex: 1,
      tabs: [
        { type: 'note', relativePath: 'a.md' },
        { type: 'note', relativePath: 'b.md' },
      ],
    });
    await editor.restoreTabs();

    expect(editor.groups).toHaveLength(1);
    expect(editor.layout.kind).toBe('leaf');
    expect(editor.tabs).toHaveLength(2);
    expect(editor.activeIndex).toBe(1);
  });

  it('falls back to one merged pane when the saved layout does not match the groups', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [
        { id: 'group-1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] },
        { id: 'group-2', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'b.md' }] },
      ],
      // Orphaned leaf id — references no restored group → untrusted tree.
      layout: { kind: 'leaf', groupId: 'group-99' },
    });
    await editor.restoreTabs();

    expect(editor.groups).toHaveLength(1);
    expect(editor.layout.kind).toBe('leaf');
    expect(editor.tabs).toHaveLength(2); // both recovered, no data loss
  });

  it('drops a note tab whose file no longer exists on restore', async () => {
    h.readFile.mockImplementationOnce(async () => { throw new Error('ENOENT'); });
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [{
        id: 'group-1', activeIndex: 0, viewMode: 'source',
        tabs: [{ type: 'note', relativePath: 'gone.md' }, { type: 'note', relativePath: 'keep.md' }],
      }],
      layout: { kind: 'leaf', groupId: 'group-1' },
    });
    await editor.restoreTabs();

    expect(editor.tabs).toHaveLength(1);
    expect(editor.noteTabForGroup('group-1')?.relativePath).toBe('keep.md');
  });

  it('corrupt / empty session keeps the start-of-session empty group', async () => {
    h.tabsLoad.mockResolvedValueOnce(null);
    await editor.restoreTabs();
    expect(editor.groups).toHaveLength(1);
    expect(editor.tabs).toHaveLength(0);

    h.tabsLoad.mockResolvedValueOnce({ nonsense: true });
    await editor.restoreTabs();
    expect(editor.groups).toHaveLength(1);
    expect(editor.tabs).toHaveLength(0);
  });

  it('advances the group-id counter past restored ids so later splits do not collide', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-3',
      groups: [
        { id: 'group-3', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] },
        { id: 'group-4', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'b.md' }] },
      ],
      layout: {
        kind: 'split', direction: 'horizontal', sizes: [0.5, 0.5],
        children: [{ kind: 'leaf', groupId: 'group-3' }, { kind: 'leaf', groupId: 'group-4' }],
      },
    });
    await editor.restoreTabs();

    const newId = editor.splitGroup('group-3', 'horizontal');
    expect(['group-3', 'group-4']).not.toContain(newId);
    // The minted id is past the highest restored suffix, not a re-use of one.
    expect(Number(newId.match(/\d+/)?.[0])).toBeGreaterThan(4);
  });
});

describe('forbid duplicate open (#815)', () => {
  const countOpen = (pred: (t: { type: string }) => boolean) =>
    editor.groups.flatMap((g) => g.tabs).filter(pred).length;

  it('opening a note already open in another pane focuses that pane, no second buffer', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    await editor.openFile('b.md'); // into g2 (active)
    expect(editor.activeGroupId).toBe(g2);

    await editor.openFile('a.md'); // already open in g1 → refocus g1
    expect(editor.activeGroupId).toBe(g1);
    expect(editor.noteTabForGroup(g1)?.relativePath).toBe('a.md');
    expect(editor.groups.find((g) => g.id === g2)?.tabs).toHaveLength(1); // g2 untouched
    expect(countOpen((t) => t.type === 'note' && (t as { relativePath: string }).relativePath === 'a.md')).toBe(1);
  });

  it('an explicit target group is overridden when the note is already open elsewhere', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');

    await editor.openFile('a.md', g2); // request g2, but a.md lives in g1
    expect(editor.activeGroupId).toBe(g1);
    expect(editor.groups.find((g) => g.id === g2)?.tabs).toHaveLength(0);
  });

  it('after the only copy is closed, the file can be opened again in any pane', async () => {
    await editor.openFile('a.md'); // g1
    const g1 = editor.groups[0].id;
    editor.splitGroup(g1, 'horizontal'); // → g2 (active)
    await editor.openFile('b.md'); // g2

    editor.closeTab(0, g1); // closes a.md → g1 collapses, only g2 remains
    expect(countOpen((t) => t.type === 'note' && (t as { relativePath: string }).relativePath === 'a.md')).toBe(0);

    await editor.openFile('a.md'); // free to reopen now
    expect(countOpen((t) => t.type === 'note' && (t as { relativePath: string }).relativePath === 'a.md')).toBe(1);
    expect(editor.noteTabForGroup(editor.activeGroupId)?.relativePath).toBe('a.md');
  });

  it('sources and PDFs dedup across panes by id (and refresh highlight/page)', async () => {
    editor.openSource('src-1'); // g1
    const g1 = editor.groups[0].id;
    const g2 = editor.splitGroup(g1, 'horizontal');
    editor.openPdf('src-2'); // g2

    editor.openSource('src-1', { highlightExcerptId: 'ex-9' }); // refocus g1
    expect(editor.activeGroupId).toBe(g1);
    expect(countOpen((t) => t.type === 'source' && (t as { sourceId: string }).sourceId === 'src-1')).toBe(1);
    const srcTab = editor.groups.find((g) => g.id === g1)?.tabs[0];
    expect(srcTab?.type === 'source' && srcTab.highlightExcerptId).toBe('ex-9');

    editor.openPdf('src-2', { page: 7 }); // refocus g2
    expect(editor.activeGroupId).toBe(g2);
    expect(countOpen((t) => t.type === 'pdf' && (t as { sourceId: string }).sourceId === 'src-2')).toBe(1);
    const pdfTab = editor.groups.find((g) => g.id === g2)?.tabs[0];
    expect(pdfTab?.type === 'pdf' && pdfTab.page).toBe(7);
  });

  it('restore drops a duplicate that appears in two panes (keeps the first)', async () => {
    h.tabsLoad.mockResolvedValueOnce({
      version: 2,
      activeGroupId: 'group-1',
      groups: [
        { id: 'group-1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'dup.md' }] },
        {
          id: 'group-2', activeIndex: 0, viewMode: 'source',
          tabs: [{ type: 'note', relativePath: 'dup.md' }, { type: 'note', relativePath: 'other.md' }],
        },
      ],
      layout: {
        kind: 'split', direction: 'horizontal', sizes: [0.5, 0.5],
        children: [{ kind: 'leaf', groupId: 'group-1' }, { kind: 'leaf', groupId: 'group-2' }],
      },
    });
    await editor.restoreTabs();

    expect(countOpen((t) => t.type === 'note' && (t as { relativePath: string }).relativePath === 'dup.md')).toBe(1);
    expect(editor.noteTabForGroup('group-1')?.relativePath).toBe('dup.md'); // kept in the first pane
    const g2Paths = editor.groups.find((g) => g.id === 'group-2')?.tabs
      .map((t) => (t.type === 'note' ? t.relativePath : t.type));
    expect(g2Paths).toEqual(['other.md']);
  });
});
