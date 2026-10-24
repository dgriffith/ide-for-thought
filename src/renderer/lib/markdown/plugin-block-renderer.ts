/**
 * Plugins' live blocks in the preview (#2641): each `.plugin-block`
 * placeholder (`preview/plugin-blocks.ts`) gets the plugin's frame,
 * `PluginBlock`, mounted into a wrapper the block cache keeps across render
 * ticks (`hydrated-block-cache.ts`) — and parks across the `{@html}` swap,
 * so the frame's page isn't reloaded on every keystroke (wrinkle 5).
 *
 * Keyed on who draws it, the note it's in and its text: editing the block's
 * text is a new block, with a new session given the new text; editing the
 * note around it keeps the frame.
 */
import { mount, unmount } from 'svelte';
import PluginBlock from '../components/plugins/PluginBlock.svelte';
import { corePluginsStore } from '../stores/core-plugins.svelte';
import { adoptWrapper, blockCacheFor, blockKey, createContentWrapper } from './hydrated-block-cache';
import { PLUGIN_BLOCK_CLASS } from '../preview/plugin-blocks';

const SLOT = 'plugin-block';

/** Mount every plugin block under `root` not mounted yet, re-adopting the ones already live. */
export function hydratePluginBlocks(root: HTMLElement): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(`.${PLUGIN_BLOCK_CLASS}[data-plugin-block-pending]`));
  const cache = blockCacheFor(root, SLOT);
  const counts = new Map<string, number>();
  for (const el of blocks) {
    const pluginId = el.dataset.pluginId ?? '';
    const blockId = el.dataset.blockId ?? '';
    const notePath = el.dataset.notePath ?? '';
    const source = el.textContent ?? '';
    const key = blockKey(counts, [pluginId, blockId, notePath, source].join('\u0000'));
    // Its plugin turned off since the note rendered: the text stays, as code.
    const def = corePluginsStore.block(pluginId, blockId);
    if (!def || !notePath) continue;
    el.removeAttribute('data-plugin-block-pending');

    const cached = cache.take(root, key);
    el.innerHTML = '';
    if (cached) {
      adoptWrapper(el, cached);
      continue;
    }
    const wrapper = createContentWrapper();
    el.appendChild(wrapper);
    const instance = mount(PluginBlock, {
      target: wrapper,
      props: { pluginId, blockId, entry: def.entry, title: el.dataset.blockTitle ?? def.title, notePath, source },
    });
    cache.put(root, key, wrapper, () => { void unmount(instance); });
  }
  cache.sweep(root);
}
