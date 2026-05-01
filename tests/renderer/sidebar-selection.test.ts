/**
 * Sidebar selection store — keyboard cursor + multi-selection (#428).
 *
 * The store is a module-level singleton; each test starts with a
 * `clear()` so state doesn't leak across cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getSidebarSelectionStore } from '../../src/renderer/lib/stores/sidebar-selection.svelte';

const store = getSidebarSelectionStore();

beforeEach(() => {
  store.clear();
});

describe('selection store — single-selection click semantics', () => {
  it('setSingle replaces selection + updates anchor + focus', () => {
    store.setSingle('a.md');
    expect([...store.selected]).toEqual(['a.md']);
    expect(store.anchor).toBe('a.md');
    expect(store.focused).toBe('a.md');
  });

  it('toggle adds when absent, removes when present, anchors + focuses on the toggled path', () => {
    store.setSingle('a.md');
    store.toggle('b.md');
    expect(new Set(store.selected)).toEqual(new Set(['a.md', 'b.md']));
    expect(store.anchor).toBe('b.md');
    expect(store.focused).toBe('b.md');
    store.toggle('b.md');
    expect([...store.selected]).toEqual(['a.md']);
  });

  it('clear resets selected, anchor, and focus', () => {
    store.setSingle('a.md');
    store.toggle('b.md');
    store.clear();
    expect([...store.selected]).toEqual([]);
    expect(store.anchor).toBeNull();
    expect(store.focused).toBeNull();
  });
});

describe('selectRange — visible-order-aware extension from anchor', () => {
  const visible = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];

  it('extends from current anchor to the target path', () => {
    store.setSingle('b.md');
    store.selectRange('d.md', visible);
    expect([...store.selected].sort()).toEqual(['b.md', 'c.md', 'd.md']);
    // Anchor stays put so subsequent shift-clicks keep extending from b.
    expect(store.anchor).toBe('b.md');
    // Focus follows the most-recently-extended-to path.
    expect(store.focused).toBe('d.md');
  });

  it('falls back to single-select when anchor is missing or absent from visibleOrder', () => {
    store.selectRange('c.md', visible);
    // No anchor → setSingle.
    expect([...store.selected]).toEqual(['c.md']);
    expect(store.anchor).toBe('c.md');
  });
});

describe('moveFocus — keyboard cursor through the visible order (#428)', () => {
  const visible = ['a.md', 'b.md', 'c.md', 'd.md'];

  it('with no focus yet, lands on the first row going down and the last going up', () => {
    expect(store.moveFocus('down', visible)).toBe('a.md');
    store.clear();
    expect(store.moveFocus('up', visible)).toBe('d.md');
  });

  it('moves one row in the requested direction', () => {
    store.setFocus('b.md');
    expect(store.moveFocus('down', visible)).toBe('c.md');
    expect(store.focused).toBe('c.md');
    expect(store.moveFocus('up', visible)).toBe('b.md');
  });

  it('clamps at the ends instead of wrapping', () => {
    store.setFocus('a.md');
    expect(store.moveFocus('up', visible)).toBe('a.md');
    store.setFocus('d.md');
    expect(store.moveFocus('down', visible)).toBe('d.md');
  });

  it('returns null on an empty visible list', () => {
    expect(store.moveFocus('down', [])).toBeNull();
  });

  it('recovers when focus drifts off the visible order (e.g. file deleted)', () => {
    store.setFocus('z-not-in-visible.md');
    expect(store.moveFocus('down', visible)).toBe('a.md');
    expect(store.focused).toBe('a.md');
  });
});

describe('selectAll', () => {
  it('selects every visible row, anchors + focuses on the first', () => {
    store.selectAll(['a.md', 'b.md', 'c.md']);
    expect([...store.selected].sort()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(store.anchor).toBe('a.md');
    expect(store.focused).toBe('a.md');
  });

  it('handles an empty list cleanly', () => {
    store.selectAll([]);
    expect([...store.selected]).toEqual([]);
    expect(store.anchor).toBeNull();
    expect(store.focused).toBeNull();
  });
});
