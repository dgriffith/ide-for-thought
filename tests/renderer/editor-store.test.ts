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
