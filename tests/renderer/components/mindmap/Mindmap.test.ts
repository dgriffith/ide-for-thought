/**
 * @vitest-environment jsdom
 *
 * The mindmap component (#2964): a tree to assistive tech (treeitems with
 * level, position, expanded and selected), one tab stop with focus roving by
 * the issue's keys, folding (Space, →, the edge button) through the host,
 * selecting and opening, both orientations, and 1,000 nodes drawn.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import Mindmap from '../../../../src/renderer/lib/components/mindmap/Mindmap.svelte';
import type { MindmapTree } from '../../../../src/shared/mindmap/mindmap-layout';

// jsdom has no ResizeObserver, which `bind:clientWidth` uses; the map draws without one, unfitted.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => cleanup());

const t = (id: string, children: MindmapTree[] = []): MindmapTree => ({ id, label: `Node ${id}`, children });
const TREE = t('root', [t('a', [t('a1'), t('a2')]), t('b'), t('c', [t('c1')])]);

async function draw(props: Record<string, unknown> = {}) {
  const r = render(Mindmap, { tree: TREE, label: 'Trip outline', ...props });
  await waitFor(() => expect(r.container.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(0));
  const item = (id: string) => r.container.querySelector<SVGGElement>(`[data-node-id="${id}"]`)!;
  return { ...r, item };
}

describe('Mindmap (#2964)', () => {
  it('is a tree: each node a treeitem with its level, place among its siblings, expanded and selected', async () => {
    const { container, item } = await draw({ selected: 'b' });
    expect(container.querySelector('svg')!.getAttribute('role')).toBe('tree');
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Trip outline');
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(7);
    expect(item('a2').getAttribute('aria-level')).toBe('3');
    expect([item('a2').getAttribute('aria-posinset'), item('a2').getAttribute('aria-setsize')]).toEqual(['2', '2']);
    expect(item('a').getAttribute('aria-expanded')).toBe('true');
    expect(item('b').hasAttribute('aria-expanded')).toBe(false); // a leaf
    expect(item('b').getAttribute('aria-selected')).toBe('true');
  });

  it('has one tab stop — the selected node, else the root', async () => {
    const { container, item } = await draw();
    expect([...container.querySelectorAll('[tabindex="0"]')].map((e) => e.getAttribute('data-node-id'))).toEqual(['root']);
    cleanup();
    const again = await draw({ selected: 'c' });
    expect(again.item('c').getAttribute('tabindex')).toBe('0');
    expect(item).toBeDefined();
  });

  it('↑ ↓ between siblings, → to the first child, ← to the parent, Home and End', async () => {
    const { item } = await draw();
    item('root').focus();
    await fireEvent.keyDown(item('root'), { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(item('a')));
    await fireEvent.keyDown(item('a'), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(item('b')));
    await fireEvent.keyDown(item('b'), { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(item('a')));
    await fireEvent.keyDown(item('a'), { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(item('a1')));
    await fireEvent.keyDown(item('a1'), { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(item('a')));
    await fireEvent.keyDown(item('a'), { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(item('c1')));
    await fireEvent.keyDown(item('c1'), { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(item('root')));
  });

  it('Space folds through the host; a folded node hides its subtree and says how many it hides', async () => {
    const onFold = vi.fn();
    const { item, container, rerender } = await draw({ onFold });
    await fireEvent.keyDown(item('a'), { key: ' ' });
    expect(onFold).toHaveBeenCalledWith('a', true);
    await rerender({ tree: TREE, folded: ['a'], onFold });
    await waitFor(() => expect(container.querySelector('[data-node-id="a1"]')).toBeNull());
    expect(item('a').getAttribute('aria-expanded')).toBe('false');
    expect(item('a').getAttribute('aria-label')).toBe('Node a, 2 hidden');
    expect(item('a').querySelector('.mm-fold text')!.textContent).toBe('2');
    // → on a folded node unfolds it.
    await fireEvent.keyDown(item('a'), { key: 'ArrowRight' });
    expect(onFold).toHaveBeenLastCalledWith('a', false);
    // The edge button folds too, without selecting.
    const onSelect = vi.fn();
    await rerender({ tree: TREE, folded: [], onFold, onSelect });
    await fireEvent.click(item('c').querySelector('.mm-fold')!);
    expect(onFold).toHaveBeenLastCalledWith('c', true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a click selects, a double-click or Enter opens', async () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const { item } = await draw({ onSelect, onActivate });
    await fireEvent.click(item('b'));
    await fireEvent.dblClick(item('c'));
    await fireEvent.keyDown(item('a1'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(onActivate.mock.calls).toEqual([['c'], ['a1']]);
  });

  it('draws radially too', async () => {
    const { container } = await draw({ orientation: 'radial' });
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(7);
    expect(container.querySelectorAll('.mm-link')).toHaveLength(6);
  });

  it('draws a 1,000-node tree: every node and every link', async () => {
    let n = 0;
    const grow = (depth: number): MindmapTree => ({ id: `n${n++}`, label: `Node ${n}`, children: depth === 0 ? [] : Array.from({ length: 9 }, () => grow(depth - 1)) });
    const big: MindmapTree = { id: 'big', label: 'Big', children: Array.from({ length: 111 }, () => grow(1)).slice(0, 100) };
    const total = 1 + 100 * 10; // a root, 100 nodes, 900 leaves
    const { container } = render(Mindmap, { tree: big });
    await waitFor(() => expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(total), { timeout: 10_000 });
    expect(container.querySelectorAll('.mm-link')).toHaveLength(total - 1);
  });
});
