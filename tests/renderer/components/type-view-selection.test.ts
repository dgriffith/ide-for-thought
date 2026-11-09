/**
 * @vitest-environment jsdom
 *
 * The type-view selection: on with note actions — in the view's tab and, since
 * #2940, in a note's embed alike (#2774's one-note menu mode is gone) — and off
 * without them. And building a selection from the keyboard (#2942).
 */
import { describe, it, expect, vi } from 'vitest';
import { createTypeViewSelection } from '../../../src/renderer/lib/components/type-view-selection.svelte';
import { getAnnouncerStore } from '../../../src/renderer/lib/stores/announcer.svelte';

const ORDER = ['a.md', 'b.md', 'c.md'];
const mouse = (o: Partial<MouseEventInit> = {}) => new MouseEvent('click', { clientX: 10, clientY: 20, cancelable: true, ...o });

function make(mode: 'panel' | 'off') {
  const onOpen = vi.fn();
  const onEdit = vi.fn();
  const sel = createTypeViewSelection({
    order: () => ORDER,
    enabled: () => mode === 'panel',
    onOpen,
    onEdit,
  });
  return { sel, onOpen, onEdit };
}

describe('off (an export, or no host actions)', () => {
  it('right-click does nothing', () => {
    const { sel } = make('off');
    const e = mouse();
    sel.contextMenu(e, 'a.md');
    expect(e.defaultPrevented).toBe(false);
    expect(sel.menu).toBeNull();
  });
});

describe('the panel keeps its multi-select', () => {
  it('right-click on a selected row keeps the whole selection', () => {
    const { sel } = make('panel');
    sel.click(mouse({ metaKey: true }), 'a.md');
    sel.click(mouse({ metaKey: true }), 'b.md');
    sel.contextMenu(mouse(), 'b.md');
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md']);
    sel.closeMenu();
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md']);
  });
});

describe('a menu for a note named inside a row (#2775)', () => {
  it('targets that note and leaves the row selection exactly as it was', () => {
    const { sel, onEdit } = make('panel');
    sel.click(mouse({ metaKey: true }), 'a.md');
    const e = mouse();
    sel.contextMenuFor(e, 'people/Ada.md');
    expect(e.defaultPrevented).toBe(true);
    expect(sel.menu).toEqual({ x: 10, y: 20, target: 'people/Ada.md' });
    expect(sel.selectedPaths).toEqual(['a.md']);
    sel.editSelected();
    expect(onEdit).toHaveBeenCalledWith(['people/Ada.md']);
    expect(sel.selectedPaths).toEqual(['a.md']);
  });

  it('does nothing in an export', () => {
    const off = make('off');
    off.sel.contextMenuFor(mouse(), 'people/Ada.md');
    expect(off.sel.menu).toBeNull();
  });
});

describe('openMenuFor — a plugin layout asking for the row menu (#2828)', () => {
  it('in a panel, selects exactly those notes and opens the menu at the point', () => {
    const { sel } = make('panel');
    sel.openMenuFor(['b.md', 'c.md'], 40, 60);
    expect(sel.selectedPaths).toEqual(['b.md', 'c.md']);
    expect(sel.menu).toEqual({ x: 40, y: 60 });
    sel.openMenuFor(['a.md'], 1, 2);
    expect(sel.selectedPaths).toEqual(['a.md']);
  });

  it('with no menu at all, nothing', () => {
    const off = make('off');
    off.sel.openMenuFor(['a.md'], 5, 5);
    expect(off.sel.menu).toBeNull();
    expect(off.sel.selectedPaths).toEqual([]);
  });

  it('opens nothing for no notes', () => {
    const { sel } = make('panel');
    sel.openMenuFor([], 1, 1);
    expect(sel.menu).toBeNull();
  });
});

describe('selectAll / clear — ⌘A and Escape from a plugin layout (#2828)', () => {
  it('selects every row in a panel, and clears selection and menu', () => {
    const { sel } = make('panel');
    sel.selectAll();
    expect(sel.selectedPaths).toEqual(ORDER);
    sel.openMenuFor(['a.md'], 1, 1);
    sel.clear();
    expect(sel.selectedPaths).toEqual([]);
    expect(sel.menu).toBeNull();
  });

  it('selects nothing without host actions', () => {
    const { sel } = make('off');
    sel.selectAll();
    expect(sel.selectedPaths).toEqual([]);
  });
});

describe('building a selection from the keyboard (#2942)', () => {
  const key = (k: string, o: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, cancelable: true, ...o });
  const ROWS = { ArrowUp: -1, ArrowDown: 1 };
  function panel(order: () => string[] = () => ORDER) {
    return createTypeViewSelection({ order, enabled: () => true, onOpen: vi.fn(), onEdit: vi.fn() });
  }

  it('Space toggles the focused row in and out, without opening it', () => {
    const sel = panel();
    const e = key(' ');
    expect(sel.rowKey(e, 'b.md', ROWS)).toBe(true);
    expect(e.defaultPrevented).toBe(true); // not the button's click
    expect(sel.selectedPaths).toEqual(['b.md']);
    sel.rowKey(key(' '), 'c.md', ROWS);
    expect(sel.selectedPaths).toEqual(['b.md', 'c.md']);
    sel.rowKey(key(' '), 'b.md', ROWS);
    expect(sel.selectedPaths).toEqual(['c.md']);
    expect(getAnnouncerStore().polite).toContain('1 selected');
  });

  it('⇧+arrow extends from this row when nothing is selected, then from the anchor', () => {
    const sel = panel();
    sel.rowKey(key('ArrowDown', { shiftKey: true }), 'a.md', ROWS);
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md']);
    sel.rowKey(key('ArrowDown', { shiftKey: true }), 'b.md', ROWS);
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md', 'c.md']);
    expect(getAnnouncerStore().polite).toContain('3 selected');
    sel.rowKey(key('ArrowUp', { shiftKey: true }), 'c.md', ROWS); // shrinks toward the anchor
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md']);
  });

  it('a plain arrow moves without changing the selection; a step past the end stays put', () => {
    const sel = panel();
    sel.rowKey(key(' '), 'a.md', ROWS);
    const e = key('ArrowDown');
    expect(sel.rowKey(e, 'a.md', ROWS)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(sel.selectedPaths).toEqual(['a.md']);
    sel.rowKey(key('ArrowDown', { shiftKey: true }), 'c.md', ROWS);
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('runs in the order as filtered: a hidden row is neither crossed into nor selected', () => {
    const sel = panel(() => ['a.md', 'c.md']); // b.md filtered out
    sel.rowKey(key('ArrowDown', { shiftKey: true }), 'a.md', ROWS);
    expect(sel.selectedPaths).toEqual(['a.md', 'c.md']);
  });

  it('a layout\'s own steps: a gallery\'s ↓ is a row of cards', () => {
    const sel = panel(() => ['a.md', 'b.md', 'c.md', 'd.md']);
    sel.rowKey(key('ArrowDown', { shiftKey: true }), 'a.md', { ArrowDown: 2 });
    expect(sel.selectedPaths).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('leaves other keys, modified keys, and a selection that is off alone', () => {
    const sel = panel();
    expect(sel.rowKey(key('Enter'), 'a.md', ROWS)).toBe(false);
    expect(sel.rowKey(key(' ', { metaKey: true }), 'a.md', ROWS)).toBe(false);
    expect(sel.selectedPaths).toEqual([]);
    for (const mode of ['off'] as const) {
      const { sel: s } = make(mode);
      expect(s.rowKey(key(' '), 'a.md', ROWS)).toBe(false);
      expect(s.rowKey(key('ArrowDown', { shiftKey: true }), 'a.md', ROWS)).toBe(true); // still moves
      expect(s.selectedPaths).toEqual([]);
    }
  });
});
