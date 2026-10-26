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

import { codePluginsStore } from '../../../src/renderer/lib/stores/code-plugins.svelte';

const summary = (id: string, enabled: boolean, views?: typeof VIEW[]) => ({
  id, name: id.toUpperCase(), version: '1.0.0', description: '', enabled, source: { kind: 'core' as const }, contributes: {}, ...(views ? { views } : {}),
});

describe('codePluginsStore.views (#2640)', () => {
  it('offers no panel before the list has loaded, then the views of the plugins that are on, by place', async () => {
    h.list = async () => ({
      core: [summary('a', true, [VIEW, { ...VIEW, id: 'side', place: 'right-sidebar' as never }]), summary('b', false, [VIEW]), summary('c', true)],
      installed: [], errors: [], folder: '/p',
    });
    expect(codePluginsStore.views('left-sidebar')).toEqual([]);
    await vi.waitFor(() => expect(codePluginsStore.views('left-sidebar')).toHaveLength(1));
    expect(codePluginsStore.views('left-sidebar')).toEqual([{ pluginId: 'a', pluginName: 'A', view: VIEW }]);
    expect(codePluginsStore.views('right-sidebar').map((v) => v.view.id)).toEqual(['side']);
  });

  it('finds one view wherever it shows: undefined never after load, null when its plugin is off', async () => {
    expect(codePluginsStore.view('a', 'queue')).toEqual({ pluginId: 'a', pluginName: 'A', view: VIEW });
    expect(codePluginsStore.view('b', 'queue')).toBeNull();
    expect(codePluginsStore.view('a', 'nope')).toBeNull();
    expect(codePluginsStore.allViews().map((v) => `${v.pluginId}:${v.view.id}`)).toEqual(['a:queue', 'a:side']);
  });

  it('follows a plugin turned off', async () => {
    h.list = async () => ({ core: [summary('a', false, [VIEW])], installed: [], errors: [], folder: '/p' });
    h.changed!();
    await vi.waitFor(() => expect(codePluginsStore.views('left-sidebar')).toEqual([]));
  });
});

describe('installed plugins with code (#2833)', () => {
  const installed = (id: string, extra: Record<string, unknown>) => ({
    ...summary(id, true, [{ ...VIEW, id: `${id}-view` }]), source: { kind: 'folder' as const, path: '/w' }, capabilities: ['ui', 'graph:query'], ...extra,
  });

  it('count beside the built-ins, after them, while their code is approved', async () => {
    h.list = async () => ({
      core: [summary('a', true, [VIEW])],
      installed: [installed('mine', {}), installed('waiting', { codeApproval: 'needed' }), installed('edited', { codeApproval: 'changed' }), installed('off', { enabled: false })],
      errors: [], folder: '/p',
    });
    h.changed!();
    await vi.waitFor(() => expect(codePluginsStore.allViews().map((v) => v.pluginId)).toEqual(['a', 'mine']));
    expect(codePluginsStore.isOn('mine')).toBe(true);
    expect(codePluginsStore.isOn('waiting')).toBe(false);
    expect(codePluginsStore.isOn('edited')).toBe(false);
    expect(codePluginsStore.view('edited', 'edited-view')).toBeNull();
    expect(codePluginsStore.name('mine')).toBe('MINE');
  });

  it('a declarative installed plugin is not one of them', async () => {
    h.list = async () => ({ core: [], installed: [{ ...installed('plain', {}), capabilities: undefined }], errors: [], folder: '/p' });
    h.changed!();
    await vi.waitFor(() => expect(codePluginsStore.allViews()).toEqual([]));
    expect(codePluginsStore.isOn('plain')).toBe(false);
  });
});

describe('plugin command keys (#2879)', () => {
  const withCommands = (id: string, commands: unknown[]) => ({ ...summary(id, true), commands });
  it('resolves which command keeps a key, built-in plugins first, and lists the others', async () => {
    const key = (id: string, k: string) => ({ id, title: id, when: 'project', key: k, run: { handler: id } });
    h.list = async () => ({
      core: [withCommands('a', [key('one', 'CmdOrCtrl+Alt+J')])],
      installed: [{ ...withCommands('mine', [key('two', 'CmdOrCtrl+Alt+J'), key('three', 'CmdOrCtrl+Alt+K')]), source: { kind: 'folder' as const, path: '/w' }, capabilities: ['ui'] }],
      errors: [], folder: '/p',
    } as never);
    h.changed!();
    await vi.waitFor(() => expect(codePluginsStore.commandKeys().keys.size).toBe(2));
    expect(codePluginsStore.keyedCommands().map((c) => [c.command.id, c.key])).toEqual([['one', 'CmdOrCtrl+Alt+J'], ['two', undefined], ['three', 'CmdOrCtrl+Alt+K']]);
    expect(codePluginsStore.commandKeys().conflicts).toEqual([{ pluginId: 'mine', commandId: 'two', title: 'two', key: 'CmdOrCtrl+Alt+J', takenBy: 'A' }]);
  });
});

