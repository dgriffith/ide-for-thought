/**
 * @vitest-environment node
 *
 * A thoughtbase's recommended plugins (#2635): read leniently from the shared
 * `.minerva/config.json`, bounded, and only ever described — opening a
 * thoughtbase that recommends plugins installs, enables and fetches nothing.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeRecommendations, pluginRecommendations, RECOMMENDATION_LIMITS } from '../../../src/main/plugins/recommendations';
import { _disablePluginsForTests, enablePlugins, reloadPluginScan } from '../../../src/main/plugins/registry';
import { setPluginEnabled } from '../../../src/main/plugins/lifecycle';
import { invalidateProjectConfigCache } from '../../../src/main/config/project-config-cache';
import { writePluginRecommendingThoughtbase } from '../../helpers/hostile-thoughtbase';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins');
let tmp: string;
let pluginsDir: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-recs-')));
  pluginsDir = path.join(tmp, 'home', 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  enablePlugins({ appVersion: '4.0.0', dir: pluginsDir });
});
afterEach(() => {
  _disablePluginsForTests();
  invalidateProjectConfigCache();
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Every file under `dir`, relative, sorted. */
const tree = (dir: string): string[] => (fs.readdirSync(dir, { recursive: true }) as string[]).sort();

describe('decodeRecommendations (#2635)', () => {
  it('keeps the shape, and offers Install only for a git URL Minerva can fetch', () => {
    expect(decodeRecommendations([
      { id: 'lab', source: 'https://github.com/ada/lab#v1', name: ' Lab ', reason: 'Its types.', types: ['Sample', 'sample', 'bad id!'] },
      { id: 'site', source: 'https://example.com/lab-plugin' },
      { id: 'bare' },
    ])).toEqual([
      { id: 'lab', name: 'Lab', reason: 'Its types.', source: 'https://github.com/ada/lab#v1', installUrl: 'https://github.com/ada/lab#v1', types: ['sample'] },
      // An https page parses as a URL, so it's offered; the fetch itself says if it isn't a repository.
      { id: 'site', source: 'https://example.com/lab-plugin', installUrl: 'https://example.com/lab-plugin', types: [] },
      { id: 'bare', types: [] },
    ]);
  });

  it.each([
    ['not a list', { id: 'lab' }],
    ['null', null],
  ])('reads %s as no recommendations', (_what, raw) => {
    expect(decodeRecommendations(raw)).toEqual([]);
  });

  it('skips a bad id or a repeat, and caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p-${i}` }));
    const out = decodeRecommendations([{ id: 'Lab' }, { id: 'a/b' }, { id: 'ok' }, { id: 'ok' }, ...many]);
    expect(out[0]!.id).toBe('ok');
    expect(out).toHaveLength(RECOMMENDATION_LIMITS.entries);
  });
});

describe('pluginRecommendations (#2635)', () => {
  it('leaves out a plugin installed and on, and marks one turned off', async () => {
    const root = path.join(tmp, 'tb');
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    fs.writeFileSync(path.join(root, '.minerva', 'config.json'), JSON.stringify({
      recommendedPlugins: [{ id: 'reading-list' }, { id: 'lab', source: 'https://github.com/ada/lab' }],
    }));
    fs.cpSync(path.join(FIXTURES, 'reading-list'), path.join(pluginsDir, 'reading-list'), { recursive: true });
    await reloadPluginScan();
    expect((await pluginRecommendations(root)).map((r) => [r.id, r.status])).toEqual([['lab', 'missing']]);

    await setPluginEnabled(pluginsDir, 'reading-list', false);
    await reloadPluginScan();
    expect((await pluginRecommendations(root)).map((r) => [r.id, r.status])).toEqual([['reading-list', 'disabled'], ['lab', 'missing']]);
  });

  it('a hostile thoughtbase recommending plugins installs, enables and fetches nothing', async () => {
    const { root, honest } = writePluginRecommendingThoughtbase(path.join(tmp, 'hostile'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const before = tree(path.dirname(pluginsDir));

    const recs = await pluginRecommendations(root);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tree(path.dirname(pluginsDir))).toEqual(before);
    // Its extra fields (autoInstall, enabled) are dropped, not carried along.
    expect(recs[0]).toEqual({
      id: honest.id, name: 'Reading List', reason: 'Book notes use its type.',
      source: honest.source, installUrl: honest.source, types: ['book-note'], status: 'missing',
    });
    expect(recs.map((r) => r.id)).not.toContain('../../.ssh');
    // Shown, but never offered for install: credentials, a local file, an option-looking pin.
    for (const id of ['creds', 'local', 'pin']) {
      const r = recs.find((x) => x.id === id)!;
      expect(r.installUrl).toBeUndefined();
    }
    expect(recs).toHaveLength(RECOMMENDATION_LIMITS.entries);
  });

  it('a thoughtbase with no config recommends nothing', async () => {
    expect(await pluginRecommendations(path.join(tmp, 'empty'))).toEqual([]);
  });
});
