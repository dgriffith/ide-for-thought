/**
 * @vitest-environment happy-dom
 *
 * Live embed mounts survive the `{@html rendered}` swap (#2323, C3 §3c
 * remainder). Covers the two hydrators that mount a real Svelte component per
 * block: `.object-view-block` (a chromeless `TypeView`, #2067) and
 * `.argument-map-block` (a live `ArgumentMap`, #907).
 *
 * Both were re-mounting on every ~120ms render tick, because the fresh
 * placeholder the swap produces never carries `data-*-rendered`. Each mount
 * costs a full SPARQL execution in the main process, measured on this machine:
 * `getTypeInstances('book')` at **90ms p50 for a 1,000-note vault and 355ms at
 * 3,000**; the argument map runs a focus query, a query per BFS hop and a
 * defects query, one of which measured 182ms / 556ms at the same scales.
 *
 * Both hydrators are driven with a **fresh placeholder per tick** (#2229), and
 * every count gate is paired with an assertion that the embed is still on
 * screen — "eight ticks, one mount" is equally satisfied by an embed that
 * renders nothing after tick one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock, graphQueryMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(),
  listMock: vi.fn(),
  noteTypeMapMock: vi.fn(),
  graphQueryMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock },
    graph: { query: graphQueryMock },
  },
}));

import { hydrateObjectViewBlocks } from '../../../src/renderer/lib/markdown/object-view-renderer';
import { hydrateArgumentMapBlocks } from '../../../src/renderer/lib/markdown/argument-map-renderer';
import { blockCacheFor, disposeCaches } from '../../../src/renderer/lib/markdown/hydrated-block-cache';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const TYPE = {
  id: 'book',
  label: 'Book',
  classLocalName: 'Book',
  icon: '📖',
  source: 'stock' as const,
  properties: [{ name: 'author', type: 'text' as const, label: 'Author' }],
};
const INSTANCES = [{ path: 'Dune.md', title: 'Dune', values: { author: 'Frank Herbert' }, cover: null }];

const SPEC = '{"typeId":"book","layout":"list"}';
const SPEC_TABLE = '{"typeId":"book","layout":"table"}';

function previewRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

/** One render tick: brand-new placeholders, exactly as `{@html}` produces. */
function objectTick(root: HTMLElement, ...specs: string[]): HTMLElement[] {
  root.innerHTML = '';
  return specs.map((spec) => {
    const block = document.createElement('div');
    block.className = 'object-view-block';
    block.textContent = spec;
    root.appendChild(block);
    return block;
  });
}

function mapTick(root: HTMLElement, ...focuses: string[]): HTMLElement[] {
  root.innerHTML = '';
  return focuses.map((focus) => {
    const block = document.createElement('div');
    block.className = 'argument-map-block';
    block.dataset.focus = focus;
    root.appendChild(block);
    return block;
  });
}

function objectDeps(revision = 0) {
  return { revision, onOpenNote: vi.fn() };
}
function mapDeps() {
  return { queryPrefixes: '', resolvePath: (t: string) => `${t}.md`, onNavigate: vi.fn() };
}

/** The mounted TypeView's own DOM, so a count gate can't pass on an empty box. */
function viewRendered(block: HTMLElement): boolean {
  return block.textContent?.includes('Dune') ?? false;
}

beforeEach(async () => {
  instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
  listMock.mockResolvedValue({ types: [TYPE], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  graphQueryMock.mockResolvedValue({ results: [], columns: [] });
  await objectTypesStore.refresh();
  instancesMock.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('object-view embeds across render ticks (#2323)', () => {
  it('queries the graph ONCE across eight ticks, and every tick still shows the view', async () => {
    const root = previewRoot();
    for (let i = 0; i < 8; i++) {
      const [block] = objectTick(root, SPEC);
      hydrateObjectViewBlocks(root, objectDeps());
      await waitFor(() => expect(viewRendered(block!)).toBe(true));
      expect(block!.getAttribute('data-object-view-rendered')).toBe('ok');
    }
    expect(instancesMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the live mount — the same DOM node comes back, not a rebuild', async () => {
    const root = previewRoot();
    const [first] = objectTick(root, SPEC);
    hydrateObjectViewBlocks(root, objectDeps());
    await waitFor(() => expect(viewRendered(first!)).toBe(true));
    const mounted = first!.firstElementChild!;

    const [second] = objectTick(root, SPEC);
    hydrateObjectViewBlocks(root, objectDeps());

    expect(second!.firstElementChild).toBe(mounted);
  });

  /**
   * The subtlety preserving the mount introduces. `mount()` only propagates
   * later writes through a `$state` props object, and nothing noticed while
   * every tick re-mounted with a fresh `revision`. Without the reactive props
   * holder, a save would silently stop refreshing the embed.
   */
  it('a graph change still re-projects the preserved view', async () => {
    const root = previewRoot();
    const [block] = objectTick(root, SPEC);
    hydrateObjectViewBlocks(root, objectDeps(0));
    await waitFor(() => expect(viewRendered(block!)).toBe(true));
    expect(instancesMock).toHaveBeenCalledTimes(1);

    // A save bumps `revision`; the post-render effect re-runs over the same DOM.
    hydrateObjectViewBlocks(root, objectDeps(1));
    await waitFor(() => expect(instancesMock).toHaveBeenCalledTimes(2));
    expect(viewRendered(block!)).toBe(true);
  });

  it('editing the fence spec re-mounts — the cache is not a freeze', async () => {
    const root = previewRoot();
    objectTick(root, SPEC);
    hydrateObjectViewBlocks(root, objectDeps());
    await waitFor(() => expect(instancesMock).toHaveBeenCalledTimes(1));

    const [edited] = objectTick(root, SPEC_TABLE);
    hydrateObjectViewBlocks(root, objectDeps());
    await waitFor(() => expect(viewRendered(edited!)).toBe(true));
    expect(instancesMock).toHaveBeenCalledTimes(2);
  });

  it('two blocks with identical specs each keep their own mount', async () => {
    const root = previewRoot();
    const first = objectTick(root, SPEC, SPEC);
    hydrateObjectViewBlocks(root, objectDeps());
    await waitFor(() => expect(viewRendered(first[1]!)).toBe(true));
    expect(instancesMock).toHaveBeenCalledTimes(2);
    const mounts = first.map((b) => b.firstElementChild);

    const second = objectTick(root, SPEC, SPEC);
    hydrateObjectViewBlocks(root, objectDeps());

    expect(instancesMock).toHaveBeenCalledTimes(2);
    expect(second[0]!.firstElementChild).toBe(mounts[0]);
    expect(second[1]!.firstElementChild).toBe(mounts[1]);
    expect(viewRendered(second[0]!)).toBe(true);
    expect(viewRendered(second[1]!)).toBe(true);
  });

  it('a malformed spec renders inline and is cached, not re-parsed every tick', async () => {
    const root = previewRoot();
    for (let i = 0; i < 4; i++) {
      const [block] = objectTick(root, '{not json');
      hydrateObjectViewBlocks(root, objectDeps());
      expect(block!.getAttribute('data-object-view-rendered')).toBe('error');
      expect(block!.textContent).toContain('Object view error');
    }
    expect(instancesMock).not.toHaveBeenCalled();
    expect(blockCacheFor(root, 'object-view').size).toBe(1);
  });

  it('does not accumulate per tick, and unmounts a block deleted from the note', async () => {
    const root = previewRoot();
    for (let i = 0; i < 5; i++) {
      objectTick(root, SPEC, SPEC_TABLE);
      hydrateObjectViewBlocks(root, objectDeps());
    }
    const cache = blockCacheFor(root, 'object-view');
    await waitFor(() => expect(cache.size).toBe(2));

    objectTick(root, SPEC);
    hydrateObjectViewBlocks(root, objectDeps());
    expect(cache.size).toBe(1);

    // Switching to a note with no embeds at all must still sweep — otherwise
    // the outgoing note's mounts stay resident until the preview is destroyed.
    objectTick(root);
    hydrateObjectViewBlocks(root, objectDeps());
    expect(cache.size).toBe(0);
  });

  it('one preview root does not sweep another one mounts', async () => {
    const a = previewRoot();
    const b = previewRoot();
    objectTick(a, SPEC);
    hydrateObjectViewBlocks(a, objectDeps());
    objectTick(b, SPEC_TABLE);
    hydrateObjectViewBlocks(b, objectDeps());
    await waitFor(() => expect(instancesMock).toHaveBeenCalledTimes(2));

    objectTick(b, SPEC_TABLE);
    hydrateObjectViewBlocks(b, objectDeps());

    expect(blockCacheFor(a, 'object-view').size).toBe(1);
    const [again] = objectTick(a, SPEC);
    hydrateObjectViewBlocks(a, objectDeps());
    expect(instancesMock).toHaveBeenCalledTimes(2);
    expect(viewRendered(again!)).toBe(true);
  });
});

describe('argument-map embeds across render ticks (#2323)', () => {
  it('runs the BFS ONCE across eight ticks, and every tick still shows the map', async () => {
    const root = previewRoot();
    for (let i = 0; i < 8; i++) {
      const [block] = mapTick(root, '[[Some Claim]]');
      hydrateArgumentMapBlocks(root, mapDeps());
      await waitFor(() => expect(block!.querySelector('.argument-map')).toBeTruthy());
      expect(block!.getAttribute('data-argument-map-rendered')).toBe('ok');
    }
    expect(graphQueryMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the live mount rather than rebuilding it', async () => {
    const root = previewRoot();
    const [first] = mapTick(root, '[[Some Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());
    await waitFor(() => expect(first!.querySelector('.argument-map')).toBeTruthy());
    const mounted = first!.firstElementChild!;

    const [second] = mapTick(root, '[[Some Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());

    expect(second!.firstElementChild).toBe(mounted);
    expect(second!.querySelector('.argument-map')).toBeTruthy();
  });

  it('a different focus re-mounts, and the config is part of the key', async () => {
    const root = previewRoot();
    mapTick(root, '[[Some Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());
    await waitFor(() => expect(graphQueryMock).toHaveBeenCalledTimes(1));

    mapTick(root, '[[Another Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());
    await waitFor(() => expect(graphQueryMock).toHaveBeenCalledTimes(2));

    // Same focus, different `:::argument` config — editing `depth=` in the
    // directive must produce a fresh map, not restore the old depth.
    const [withConfig] = mapTick(root, '[[Another Claim]]');
    withConfig!.dataset.config = '{"depth":"3"}';
    hydrateArgumentMapBlocks(root, mapDeps());
    await waitFor(() => expect(graphQueryMock).toHaveBeenCalledTimes(3));
    expect(withConfig!.querySelector('.argument-map')).toBeTruthy();
  });

  it('a focus-less block renders its inline error once, not every tick', async () => {
    const root = previewRoot();
    for (let i = 0; i < 4; i++) {
      const [block] = mapTick(root, '');
      hydrateArgumentMapBlocks(root, mapDeps());
      expect(block!.getAttribute('data-argument-map-rendered')).toBe('error');
      expect(block!.textContent).toContain('focus wiki-link');
    }
    expect(graphQueryMock).not.toHaveBeenCalled();
    expect(blockCacheFor(root, 'argument-map').size).toBe(1);
  });

  it('sweeps a deleted map, and disposeCaches tears down the rest', async () => {
    const root = previewRoot();
    mapTick(root, '[[Some Claim]]', '[[Another Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());
    const cache = blockCacheFor(root, 'argument-map');
    await waitFor(() => expect(cache.size).toBe(2));

    mapTick(root, '[[Some Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());
    expect(cache.size).toBe(1);

    disposeCaches(root);
    expect(blockCacheFor(root, 'argument-map').size).toBe(0);

    // Disposed, so the next tick mounts afresh rather than restoring a
    // component that no longer exists.
    graphQueryMock.mockClear();
    const [block] = mapTick(root, '[[Some Claim]]');
    hydrateArgumentMapBlocks(root, mapDeps());
    await waitFor(() => expect(block!.querySelector('.argument-map')).toBeTruthy());
    expect(graphQueryMock).toHaveBeenCalled();
  });
});
