/**
 * @vitest-environment node
 *
 * Saved queries from plugins (#2633), and the guard on the query mutators.
 *
 * - A plugin's queries list with scope "plugin" and their plugin, after the
 *   thoughtbase's and the global ones; the memoized listing picks up a scan
 *   that finishes after it was built.
 * - Every mutator acts only on a `.rq`/`.sql` directly inside the global or
 *   this thoughtbase's queries folder: never a plugin's file, never an
 *   arbitrary path the renderer sends.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { value: '' } }));
vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? userDataDir.value : '') },
}));

import { assertMutableQueryPath, invalidateSavedQueriesCache, listSavedQueries } from '../../src/main/saved-queries';
import { _disablePluginsForTests, enablePlugins, getPluginScan } from '../../src/main/plugins/registry';
import { writePlugin } from '../helpers/plugins';

let tmp: string;
let root: string;
let plugins: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-queries-'));
  userDataDir.value = path.join(tmp, 'userData');
  root = path.join(tmp, 'tb');
  plugins = path.join(tmp, 'plugins');
  for (const d of [path.join(userDataDir.value, 'queries'), path.join(root, '.minerva', 'queries'), plugins]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(root, '.minerva', 'queries', 'mine.rq'), '# @name Mine\nSELECT * {}');
  fs.writeFileSync(path.join(userDataDir.value, 'queries', 'global.sql'), '# @name Global one\nSELECT 1');
  writePlugin(plugins, 'reading-list', { 'saved-queries': ['queries/unread.rq'] }, {
    'queries/unread.rq': '# @name Unread books\nSELECT ?n { ?n a types:BookNote }',
  }, { name: 'Reading List' });
  invalidateSavedQueriesCache();
});
afterEach(() => {
  _disablePluginsForTests();
  invalidateSavedQueriesCache();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('plugin saved queries (#2633)', () => {
  it('list after the thoughtbase and global ones, as scope "plugin" with their plugin', async () => {
    enablePlugins({ appVersion: '4.0.0', dir: plugins });
    await getPluginScan();
    expect(listSavedQueries(root).map((q) => [q.name, q.scope, q.plugin?.name])).toEqual([
      ['Mine', 'project', undefined],
      ['Global one', 'global', undefined],
      ['Unread books', 'plugin', 'Reading List'],
    ]);
  });

  it('a scan that finishes after the listing was memoized is picked up on the next read', async () => {
    enablePlugins({ appVersion: '4.0.0', dir: plugins });
    expect(listSavedQueries(root).some((q) => q.scope === 'plugin')).toBe(false); // scan not finished
    await getPluginScan();
    expect(listSavedQueries(root).some((q) => q.scope === 'plugin')).toBe(true);
  });

  it('none without plugins enabled', () => {
    expect(listSavedQueries(root).map((q) => q.scope)).toEqual(['project', 'global']);
  });
});

describe('assertMutableQueryPath (#2633)', () => {
  it('allows a query in the global or this thoughtbase\'s queries folder', () => {
    expect(() => assertMutableQueryPath(path.join(root, '.minerva', 'queries', 'mine.rq'), root)).not.toThrow();
    expect(() => assertMutableQueryPath(path.join(userDataDir.value, 'queries', 'global.sql'), root)).not.toThrow();
    expect(() => assertMutableQueryPath(path.join(userDataDir.value, 'queries', 'global.sql'), null)).not.toThrow();
  });

  it('refuses a plugin\'s query, another thoughtbase\'s, an arbitrary file, and a traversal', () => {
    for (const p of [
      path.join(plugins, 'reading-list', 'queries', 'unread.rq'),
      path.join(tmp, 'other', '.minerva', 'queries', 'x.rq'),
      path.join(root, '.minerva', 'queries', 'mine.rq'), // with no thoughtbase open
      path.join(root, 'notes', 'secret.md'),
      path.join(root, '.minerva', 'queries', '..', 'config.json'),
      path.join(root, '.minerva', 'queries', 'not-a-query.txt'),
    ]) {
      const rootFor = p.endsWith('mine.rq') ? null : root;
      expect(() => assertMutableQueryPath(p, rootFor), p).toThrow(/Not a saved query this app can change/);
    }
  });
});
