/**
 * Which built-in plugins are on, as the renderer reads it (#2828), and the
 * global views those that are on draw (#2640): the panels the sidebars add.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PluginList } from '../../../src/shared/plugins/format';

const VIEW = { id: 'queue', title: 'Queue', place: 'left-sidebar' as const, entry: 'index.html', query: 'queue.rq' };
const h = vi.hoisted(() => ({ list: null as unknown as () => Promise<PluginList>, changed: null as null | (() => void) }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { plugins: { list: () => h.list(), onChanged: (fn: () => void) => { h.changed = fn; return () => {}; } } },
}));

import { corePluginsStore } from '../../../src/renderer/lib/stores/core-plugins.svelte';

const summary = (id: string, enabled: boolean, views?: typeof VIEW[]) => ({
  id, name: id.toUpperCase(), version: '1.0.0', description: '', enabled, source: { kind: 'core' as const }, contributes: {}, ...(views ? { views } : {}),
});

describe('corePluginsStore.views (#2640)', () => {
  it('offers no panel before the list has loaded, then the views of the plugins that are on, by place', async () => {
    h.list = async () => ({
      core: [summary('a', true, [VIEW, { ...VIEW, id: 'side', place: 'right-sidebar' as never }]), summary('b', false, [VIEW]), summary('c', true)],
      installed: [], errors: [], folder: '/p',
    });
    expect(corePluginsStore.views('left-sidebar')).toEqual([]);
    await vi.waitFor(() => expect(corePluginsStore.views('left-sidebar')).toHaveLength(1));
    expect(corePluginsStore.views('left-sidebar')).toEqual([{ pluginId: 'a', pluginName: 'A', view: VIEW }]);
    expect(corePluginsStore.views('right-sidebar').map((v) => v.view.id)).toEqual(['side']);
  });

  it('follows a plugin turned off', async () => {
    h.list = async () => ({ core: [summary('a', false, [VIEW])], installed: [], errors: [], folder: '/p' });
    h.changed!();
    await vi.waitFor(() => expect(corePluginsStore.views('left-sidebar')).toEqual([]));
  });
});
