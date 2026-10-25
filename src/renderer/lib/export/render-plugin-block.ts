/**
 * Render a plugin's live block for an export (#2641) with the SAME component
 * the preview mounts — `PluginBlock`, its plugin's frame — in export mode,
 * then snapshot it as static HTML: the path a plugin-drawn layout takes
 * (#2828, `render-object-view.ts`). The plugin is sent the block, then an
 * `export` request, and answers with static HTML that `PluginBlock` draws
 * sanitized in the frame's place.
 *
 * Off-screen, inside a `data-theme="light"` element, as every export block
 * is. A plugin that's off, or that doesn't answer in time, fails the block,
 * which the export shows as a one-line note.
 */
import { mount, tick, unmount } from 'svelte';
import PluginBlock from '../components/plugins/PluginBlock.svelte';
import { codePluginsStore } from '../stores/code-plugins.svelte';
import { snapshotLiveBlock } from './live-block-snapshot';
import { EXPORT_BLOCK_WIDTH_PX, OBJECT_VIEW_LOAD_TIMEOUT_MS } from './render-object-view';
import type { LiveBlockRequest } from '../../../shared/live-blocks';

export async function renderPluginBlockForExport(req: LiveBlockRequest): Promise<string> {
  if (!req.plugin) throw new Error('the block names no plugin');
  const { pluginId, blockId } = req.plugin;
  const def = codePluginsStore.block(pluginId, blockId);
  if (!def) throw new Error(`${codePluginsStore.name(pluginId)} is turned off on this machine`);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  host.appendChild(themed);
  document.body.appendChild(host);

  let instance: ReturnType<typeof mount> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const drawn = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('the plugin block took too long to draw')), OBJECT_VIEW_LOAD_TIMEOUT_MS);
      instance = mount(PluginBlock, {
        target: themed,
        props: {
          pluginId, blockId, entry: def.entry, title: def.title, notePath: req.notePath, source: req.source, exportMode: true,
          onExport: { onRendered: () => resolve(), onFailed: (reason: string) => reject(new Error(`the plugin block couldn't be drawn: ${reason}`)) },
        },
      });
    });
    await drawn;
    await tick();
    return snapshotLiveBlock(themed);
  } finally {
    clearTimeout(timer);
    if (instance) void unmount(instance);
    host.remove();
  }
}
