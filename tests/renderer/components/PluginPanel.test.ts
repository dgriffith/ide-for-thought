/**
 * @vitest-environment jsdom
 *
 * A plugin's global view as a sidebar panel (#2640): the frame connects as
 * the view — main decides its notes — and the panel asks for its query again
 * on connect and whenever the graph changes. Plus the registry entries both
 * sidebars build from the views of the plugins that are on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  refreshQuery: vi.fn(async () => {}),
  graphChanged: null as null | (() => void),
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: h.connect }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { onChanged: (fn: () => void) => { h.graphChanged = fn; return () => {}; } } },
}));

import PluginPanel from '../../../src/renderer/lib/components/plugins/PluginPanel.svelte';
import { pluginLeftPanels } from '../../../src/renderer/lib/components/sidebar/panels';
import { pluginRightPanels } from '../../../src/renderer/lib/components/right-sidebar/panels';
import type { ActivePluginView } from '../../../src/renderer/lib/stores/core-plugins.svelte';

beforeEach(() => {
  h.refreshQuery.mockClear();
  h.connect.mockReset();
  h.connect.mockImplementation(async () => ({
    sessionId: 's1', setScope: vi.fn(), sendTheme: vi.fn(async () => {}), sendPreview: vi.fn(async () => {}),
    refreshQuery: h.refreshQuery, close: vi.fn(async () => {}),
  }));
});
afterEach(() => cleanup());

describe('PluginPanel (#2640)', () => {
  it('connects its frame as the view, with no scope of its own, and runs the query on connect and on every graph change', async () => {
    const r = render(PluginPanel, { pluginId: 'reading-queue', viewId: 'queue', entry: 'index.html', title: 'Reading Queue' });
    const frame = r.container.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('minerva-plugin://reading-queue/index.html');
    expect(frame.getAttribute('title')).toBe('Reading Queue');
    await fireEvent.load(frame);
    await waitFor(() => expect(h.connect).toHaveBeenCalledWith(frame, 'reading-queue', [], expect.any(Object), 'queue'));
    await waitFor(() => expect(h.refreshQuery).toHaveBeenCalledTimes(1));
    h.graphChanged!();
    await waitFor(() => expect(h.refreshQuery).toHaveBeenCalledTimes(2));
  });
});

describe('plugin panels in the registries (#2640)', () => {
  const view = (place: 'left-sidebar' | 'right-sidebar', icon?: string): ActivePluginView => ({
    pluginId: 'reading-queue', pluginName: 'Reading Queue',
    view: { id: 'queue', title: 'Queue', place, entry: 'page.html', query: 'q.rq', ...(icon ? { icon } : {}) },
  });

  it('a left panel per view: an id no core panel can have, its title, its icon or a generic one', () => {
    const [entry] = pluginLeftPanels([view('left-sidebar', 'bookmark')]);
    expect(entry).toMatchObject({ id: 'plugin:reading-queue:queue', label: 'Queue', icon: 'bookmark' });
    expect(entry!.props({} as never)).toEqual({ pluginId: 'reading-queue', viewId: 'queue', entry: 'page.html', title: 'Queue' });
    expect(pluginLeftPanels([view('left-sidebar', 'not-an-icon')])[0]!.icon).toBe('objects');
  });

  it('a right panel goes in the Plugins group', () => {
    expect(pluginRightPanels([view('right-sidebar')])[0]).toMatchObject({ id: 'plugin:reading-queue:queue', group: 'plugins', icon: 'objects' });
  });
});
