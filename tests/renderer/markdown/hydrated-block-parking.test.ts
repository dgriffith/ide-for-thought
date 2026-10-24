/**
 * @vitest-environment happy-dom
 *
 * Parking hydrated blocks across the `{@html}` swap (`hydrated-block-cache.ts`,
 * wrinkle 5). An iframe that leaves the document unloads, so a plugin frame in
 * an embed (a Kanban board) reloaded on every render tick and went blank.
 * Before the swap, live wrappers move into a hidden holder that stays in the
 * document; adoption moves them into the new placeholder; both moves use
 * `moveBefore` where the DOM has it. The real frame survival is the e2e's
 * (`plugin-embed-survives-edits.spec.ts`); this pins the moves and the sweep.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { adoptWrapper, blockCacheFor, createContentWrapper, disposeCaches, parkHydratedBlocks } from '../../../src/renderer/lib/markdown/hydrated-block-cache';

function preview() {
  const container = document.createElement('div');
  const root = document.createElement('div');
  container.appendChild(root);
  document.body.appendChild(container);
  return { container, root };
}

/** One rendered block under `root`, cached in `slot`. */
function mounted(root: HTMLElement, slot: string, key: string, destroy = vi.fn()) {
  const placeholder = document.createElement('div');
  root.appendChild(placeholder);
  const wrapper = createContentWrapper();
  placeholder.appendChild(wrapper);
  blockCacheFor(root, slot).put(root, key, wrapper, destroy);
  return { wrapper, destroy };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('parkHydratedBlocks', () => {
  it("moves every live wrapper out of the swap's way, still in the document, for the next pass to adopt", () => {
    const { container, root } = preview();
    const a = mounted(root, 'object-view', 'a');
    const b = mounted(root, 'mermaid', 'b');
    parkHydratedBlocks(root);
    const holder = container.querySelector<HTMLElement>('[data-hydrated-block-parking]')!;
    expect(holder.hidden).toBe(true);
    expect([a.wrapper.parentElement, b.wrapper.parentElement]).toEqual([holder, holder]);
    expect(a.wrapper.isConnected).toBe(true);

    root.innerHTML = '<div id="next"></div>'; // the swap
    const cache = blockCacheFor(root, 'object-view');
    const taken = cache.take(root, 'a')!;
    expect(taken).toBe(a.wrapper);
    adoptWrapper(root.querySelector<HTMLElement>('#next')!, taken);
    expect(a.wrapper.parentElement?.id).toBe('next');
    disposeCaches(root);
  });

  it('the sweep destroys and removes a parked wrapper nobody adopted, so a frame in it goes too', () => {
    const { container, root } = preview();
    const gone = mounted(root, 'object-view', 'gone');
    parkHydratedBlocks(root);
    root.innerHTML = '';
    blockCacheFor(root, 'object-view').sweep(root);
    expect(gone.destroy).toHaveBeenCalledTimes(1);
    expect(gone.wrapper.isConnected).toBe(false);
    expect(container.querySelector('[data-hydrated-block-parking]')!.children).toHaveLength(0);
    disposeCaches(root);
    expect(container.querySelector('[data-hydrated-block-parking]')).toBeNull();
  });

  it("moves with moveBefore where the DOM has it, which keeps a frame's page", () => {
    const { root } = preview();
    const a = mounted(root, 'object-view', 'a');
    const moves: Array<[Node, Node | null]> = [];
    const proto = Element.prototype as unknown as { moveBefore?: (n: Node, c: Node | null) => void };
    const had = proto.moveBefore;
    proto.moveBefore = function (this: Element, node: Node, child: Node | null) { moves.push([node, child]); this.insertBefore(node, child); };
    try {
      parkHydratedBlocks(root);
      root.innerHTML = '<div id="next"></div>';
      adoptWrapper(root.querySelector<HTMLElement>('#next')!, blockCacheFor(root, 'object-view').take(root, 'a')!);
    } finally {
      if (had) proto.moveBefore = had; else delete proto.moveBefore;
    }
    expect(moves).toEqual([[a.wrapper, null], [a.wrapper, null]]);
    disposeCaches(root);
  });

  it('a detached wrapper is put back with a plain insert', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const wrapper = createContentWrapper();
    adoptWrapper(target, wrapper);
    expect(wrapper.parentElement).toBe(target);
  });
});
