/**
 * @vitest-environment node
 *
 * The plugin registry (#2633): off until the app turns it on, one scan shared
 * by every seam that asks, and nothing thrown into a caller.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _disablePluginsForTests,
  contributionsTo,
  enablePlugins,
  getPluginInventory,
  getPluginScan,
  loadedPluginScan,
  reloadPluginScan,
} from '../../../src/main/plugins/registry';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins');
let dir: string;

// The records file sits beside the plugins folder, so the folder is one level
// down: its plugins.json must be this test's, not the shared temp dir's.
beforeEach(() => { dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-registry-')), 'plugins'); fs.mkdirSync(dir); });
afterEach(() => {
  _disablePluginsForTests();
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('plugin registry (#2633)', () => {
  it('is empty until the app enables it — tests, the CLI and the eval harness see no plugins', async () => {
    expect(await getPluginScan()).toEqual({ plugins: [], errors: [] });
  });

  it('reads the folder once, and shares the scan', async () => {
    enablePlugins({ appVersion: '4.0.0', dir: FIXTURES });
    const a = getPluginInventory();
    expect(getPluginInventory()).toBe(a);
    expect((await getPluginScan()).plugins.map((p) => p.manifest.id)).toEqual(['cookbook', 'reading-list', 'solarized', 'word-tools']);
  });

  it('reload reads it again', async () => {
    enablePlugins({ appVersion: '4.0.0', dir });
    expect((await getPluginScan()).plugins).toEqual([]);
    fs.cpSync(path.join(FIXTURES, 'reading-list'), path.join(dir, 'reading-list'), { recursive: true });
    expect((await getPluginScan()).plugins).toEqual([]); // cached
    expect((await reloadPluginScan()).plugins.map((p) => p.manifest.id)).toEqual(['reading-list']);
  });

  it('a refused plugin is reported in the scan; an unreadable folder is no plugins, not a throw', async () => {
    fs.mkdirSync(path.join(dir, 'broken'));
    enablePlugins({ appVersion: '4.0.0', dir });
    expect((await getPluginScan()).errors).toEqual([{ folder: 'broken', label: 'broken', problems: ['It has no plugin.json.'] }]);

    const notADir = path.join(dir, 'file');
    fs.writeFileSync(notADir, 'x');
    enablePlugins({ appVersion: '4.0.0', dir: path.join(notADir, 'plugins') });
    expect(await getPluginScan()).toEqual({ plugins: [], errors: [] });
  });

  it('contributionsTo lists one point\'s contributions with their plugin', async () => {
    enablePlugins({ appVersion: '4.0.0', dir: FIXTURES });
    const scan = await getPluginScan();
    expect(contributionsTo(scan, 'object-types').map(({ plugin, contribution }) => [plugin.manifest.id, contribution.path]))
      .toEqual([['cookbook', 'types/recipe.md'], ['reading-list', 'types/book-note.md']]);
    expect(contributionsTo(scan, 'csl-styles')).toEqual([]);
  });

  it('a disabled plugin is in the inventory but not in what the seams load (#2634)', async () => {
    fs.cpSync(path.join(FIXTURES, 'reading-list'), path.join(dir, 'reading-list'), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(dir), 'plugins.json'), JSON.stringify({ plugins: { 'reading-list': { enabled: false, source: { kind: 'manual' } } } }));
    enablePlugins({ appVersion: '4.0.0', dir });
    const inv = await getPluginInventory();
    expect(inv.installed.map((i) => [i.plugin.manifest.id, i.record.enabled])).toEqual([['reading-list', false]]);
    expect((await getPluginScan()).plugins).toEqual([]);
    expect(loadedPluginScan().plugins).toEqual([]);
  });
});
