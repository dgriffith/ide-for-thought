/**
 * `:::mindmap` blocks in the preview (#2966): each `.mindmap-block`
 * placeholder gets a live MindmapBlock, kept across re-renders of an
 * unchanged block (the hydrated-block cache), as `:::argument`'s are.
 */
import { mount, unmount } from 'svelte';
import MindmapBlock from '../components/mindmap/MindmapBlock.svelte';
import { parseMindmapBlock } from '../../../shared/mindmap/note-hierarchy';
import { adoptWrapper, blockCacheFor, blockKey, createContentWrapper } from './hydrated-block-cache';

const SLOT = 'mindmap';

export interface MindmapBlockDeps {
  resolvePath: (target: string) => string | null;
  onNavigate: (relativePath: string) => void;
}

export function hydrateMindmapBlocks(root: HTMLElement, deps: MindmapBlockDeps): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mindmap-block:not([data-mindmap-rendered])'));
  const cache = blockCacheFor(root, SLOT);
  const counts = new Map<string, number>();
  for (const el of blocks) {
    const body = el.dataset.spec ?? '';
    const key = blockKey(counts, body);
    const cached = cache.take(root, key);
    if (cached) {
      el.innerHTML = '';
      adoptWrapper(el, cached);
      el.setAttribute('data-mindmap-rendered', 'ok');
      continue;
    }
    const spec = parseMindmapBlock(body);
    const wrapper = createContentWrapper();
    el.innerHTML = '';
    el.appendChild(wrapper);
    const instance = mount(MindmapBlock, {
      target: wrapper,
      props: { spec, focusPath: spec.focus ? deps.resolvePath(spec.focus) : null, onNavigate: deps.onNavigate },
    });
    el.setAttribute('data-mindmap-rendered', 'ok');
    cache.put(root, key, wrapper, () => { void unmount(instance); });
  }
  cache.sweep(root);
}
