/**
 * @vitest-environment jsdom
 *
 * The type-view selection's menu-only mode (#2774): an embed with note actions
 * gets the right-click menu for the one note under the pointer, and no
 * multi-select.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTypeViewSelection } from '../../../src/renderer/lib/components/type-view-selection.svelte';

const ORDER = ['a.md', 'b.md', 'c.md'];
const mouse = (o: Partial<MouseEventInit> = {}) => new MouseEvent('click', { clientX: 10, clientY: 20, cancelable: true, ...o });

function make(mode: 'panel' | 'menuOnly' | 'off') {
  const onOpen = vi.fn();
  const onEdit = vi.fn();
  const sel = createTypeViewSelection({
    order: () => ORDER,
    enabled: () => mode === 'panel',
    menuOnly: () => mode === 'menuOnly',
    onOpen,
    onEdit,
  });
  return { sel, onOpen, onEdit };
}

describe('menu-only (an embed with note actions)', () => {
  it('right-click opens the menu for exactly that note', () => {
    const { sel } = make('menuOnly');
    const e = mouse();
    sel.contextMenu(e, 'b.md');
    expect(e.defaultPrevented).toBe(true);
    expect(sel.menu).toEqual({ x: 10, y: 20 });
    expect(sel.selectedPaths).toEqual(['b.md']);
    sel.contextMenu(mouse(), 'c.md');
    expect(sel.selectedPaths).toEqual(['c.md']);
  });

  it('modifier clicks don\'t multi-select; a click just opens the note', () => {
    const { sel, onOpen } = make('menuOnly');
    sel.click(mouse({ metaKey: true }), 'a.md');
    expect(onOpen).toHaveBeenCalledWith('a.md');
    expect(sel.selectedPaths).toEqual([]);
  });

  it('closing the menu lets go of the note, by click-away or Escape', () => {
    const { sel } = make('menuOnly');
    sel.contextMenu(mouse(), 'a.md');
    sel.closeMenu();
    expect(sel.menu).toBeNull();
    expect(sel.selectedPaths).toEqual([]);
    sel.contextMenu(mouse(), 'a.md');
    sel.keydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sel.menu).toBeNull();
    expect(sel.selectedPaths).toEqual([]);
  });

  it('⌘A selects nothing', () => {
    const { sel } = make('menuOnly');
    sel.keydown(new KeyboardEvent('keydown', { key: 'a', metaKey: true }));
    expect(sel.selectedPaths).toEqual([]);
  });

  it('Edit Properties hands over the note, then lets go of it', () => {
    const { sel, onEdit } = make('menuOnly');
    sel.contextMenu(mouse(), 'b.md');
    sel.editSelected();
    expect(onEdit).toHaveBeenCalledWith(['b.md']);
    expect(sel.selectedPaths).toEqual([]);
  });
});

describe('with neither mode (an export, or no host actions)', () => {
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
