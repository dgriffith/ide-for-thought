/**
 * Editor store — editor-group model (#811).
 *
 * Phase 1 of #810 promotes the `tabs[]` / `activeIndex` / `viewMode` singleton
 * into a collection of editor groups. These tests pin (a) one-group parity —
 * the app behaves exactly as before when only one group exists — and (b) the
 * new group-scoped mutation surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  readFile: vi.fn(async (p: string) => `# ${p}\nbody`),
  writeFile: vi.fn(async () => {}),
  tabsSave: vi.fn(async () => {}),
  tabsLoad: vi.fn(async () => null),
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
