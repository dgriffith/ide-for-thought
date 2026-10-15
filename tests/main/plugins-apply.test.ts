/**
 * @vitest-environment node
 *
 * Applying a plugin change to the running app (#2634): every seam brought in
 * line and every window told; open thoughtbases re-indexed only when the
 * plugins' object types changed; one change at a time; and an apply that
 * finds nothing changed — the echo of the app's own change — doing nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginScan } from '../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  order: [] as string[],
  scans: [] as PluginScan[],
  current: { plugins: [], errors: [] },
  send: vi.fn(),
  watchCb: null as null | (() => void),
}));

const scanWithTypes = (...paths: string[]): PluginScan => ({
  errors: [],
  plugins: [{
    manifest: { id: 'lab', name: 'Lab', version: '1.0.0', minerva: '>=1', description: 'd', contributes: {} },
    root: '/p/lab', provenance: 'plugin:lab@1.0.0',
    contributions: paths.map((p) => ({ point: 'object-types' as const, path: p, absolutePath: `/p/lab/${p}`, kind: 'file' as const })),
  }],
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: h.send } }] },
}));
vi.mock('../../src/main/plugins/registry', async (orig) => ({
  ...(await orig<typeof import('../../src/main/plugins/registry')>()),
  getPluginScan: async () => h.current,
  getPluginInventory: async () => ({
    installed: h.current.plugins.map((plugin) => ({ plugin, record: { enabled: true, source: { kind: 'manual' } } })),
    errors: h.current.errors,
  }),
  reloadPluginScan: async () => { h.order.push('reload'); h.current = h.scans.shift() ?? h.current; return h.current; },
}));
vi.mock('../../src/main/plugins/watch', () => ({ watchPluginsDir: (_d: string, cb: () => void) => { h.watchCb = cb; return () => undefined; } }));
vi.mock('../../src/main/skills/register', () => ({ reloadAndRegisterSkills: async () => { h.order.push('skills'); } }));
vi.mock('../../src/main/saved-queries', () => ({ invalidateSavedQueriesCache: () => { h.order.push('queries'); } }));
vi.mock('../../src/main/menu', () => ({ rebuildMenu: () => { h.order.push('menu'); } }));
vi.mock('../../src/main/project-context', () => ({
  activeProjects: () => ['/tb1', '/tb2'],
  getProjectContext: (rootPath: string) => ({ rootPath }),
  refreshOpenExtensionCatalogs: () => { h.order.push('catalog'); },
}));
vi.mock('../../src/main/graph', () => ({ indexAllNotes: async (ctx: { rootPath: string }) => { h.order.push(`reindex ${ctx.rootPath}`); } }));
vi.mock('../../src/main/citations/assets-cache', () => ({ invalidateCitationAssets: (ctx: { rootPath: string }) => { h.order.push(`csl ${ctx.rootPath}`); } }));

import { applyPluginChange, changePlugins, startPluginsWatcher } from '../../src/main/plugins-apply';
import { Channels } from '../../src/shared/channels';

let n = 0;
/** A scan nothing has been applied for yet: a fresh plugin version each time. */
const fresh = (...paths: string[]): PluginScan => {
  const scan = scanWithTypes(...paths);
  scan.plugins[0]!.manifest.version = `1.0.${++n}`;
  return scan;
};

beforeEach(() => {
  h.order.length = 0;
  h.scans.length = 0;
  h.current = fresh('types/a.md');
  h.send.mockReset();
});

describe('applyPluginChange (#2634)', () => {
  it('brings every seam in line and tells every window — no re-index when types didn\'t change', async () => {
    const same = fresh('types/a.md');
    h.current = same;
    h.scans.push(same);
    await applyPluginChange();
    expect(h.order).toEqual(['reload', 'skills', 'queries', 'menu', 'csl /tb1', 'csl /tb2', 'catalog']);
    expect(h.send).toHaveBeenCalledWith(Channels.PLUGINS_CHANGED);
  });

  it('re-indexes every open thoughtbase when the plugins\' types changed — so a removed type leaves nothing', async () => {
    h.scans.push({ plugins: [], errors: [] });
    await applyPluginChange();
    expect(h.order).toContain('reindex /tb1');
    expect(h.order).toContain('reindex /tb2');
  });

  it('runs one change at a time', async () => {
    h.scans.push(fresh('types/a.md'), fresh('types/a.md'));
    await Promise.all([applyPluginChange(), applyPluginChange()]);
    expect(h.order.filter((o) => o === 'reload' || o === 'catalog')).toEqual(['reload', 'catalog', 'reload', 'catalog']);
  });
});

describe('nothing changed, nothing done (#2634)', () => {
  it('an apply that finds the plugins as last applied does nothing — the echo of a change already applied', async () => {
    const scan = fresh('types/a.md');
    h.scans.push(scan, scan);
    await applyPluginChange();
    const done = h.order.length;
    await applyPluginChange();
    expect(h.order.slice(done)).toEqual(['reload']);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('changePlugins applies after the change; the watcher applies any later edit, however soon', async () => {
    startPluginsWatcher('/plugins');
    h.scans.push(fresh('types/a.md'));
    await changePlugins(async () => { h.order.push('op'); });
    expect(h.order.slice(0, 2)).toEqual(['op', 'reload']);

    h.scans.push(fresh('types/a.md', 'types/b.md')); // an outside edit, straight after
    h.watchCb!();
    await vi.waitFor(() => expect(h.order.filter((o) => o === 'catalog')).toHaveLength(2));
    expect(h.order).toContain('reindex /tb1');
  });
});
