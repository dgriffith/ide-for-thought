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
  getPluginScan,
  reloadPluginScan,
} from '../../../src/main/plugins/registry';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins');
let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-registry-')); });
afterEach(() => {
  _disablePluginsForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('plugin registry (#2633)', () => {
  it('is empty until the app enables it — tests, the CLI and the eval harness see no plugins', async () => {
    expect(await getPluginScan()).toEqual({ plugins: [], errors: [] });
  });

  it('reads the folder once, and shares the scan', async () => {
    enablePlugins({ appVersion: '4.0.0', dir: FIXTURES });
    const a = getPluginScan();
    expect(getPluginScan()).toBe(a);
    expect((await a).plugins.map((p) => p.manifest.id)).toEqual(['reading-list']);
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
      .toEqual([['reading-list', 'types/book-note.md']]);
    expect(contributionsTo(scan, 'csl-styles')).toEqual([]);
  });
});
