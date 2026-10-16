/**
 * @vitest-environment node
 *
 * Installing, enabling, disabling and removing plugins (#2634) — the files
 * and the records. Applying a change to the running app is plugins-apply's.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  installPluginFromFolder,
  installPluginFromZip,
  PluginExistsError,
  removePlugin,
  setPluginEnabled,
} from '../../../src/main/plugins/lifecycle';
import { loadPluginRecords, pluginsStateFile } from '../../../src/main/plugins/state';
import { readPluginPackages } from '../../../src/main/plugins/package';
import { writePlugin, typeFile } from '../../helpers/plugins';
import { buildZip } from '../../helpers/zip';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('config');

const APP = '4.0.0';
let tmp: string;
let dir: string;
let src: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-lifecycle-')));
  dir = path.join(tmp, '.minerva', 'plugins');
  src = path.join(tmp, 'work');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(src, { recursive: true });
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A plugin to install, in `src/<folder>` — the folder needn't be named for the id. */
const source = (folder: string, id = 'lab', label = 'Sample') =>
  writePlugin(path.join(src, folder), id, { 'object-types': ['types/sample.md'] }, { 'types/sample.md': typeFile(label) });

const installed = async () => (await readPluginPackages(APP, dir)).plugins.map((p) => p.manifest.id);
const leftovers = () => fs.readdirSync(dir).filter((n) => n.startsWith('.'));

describe('installPluginFromFolder (#2634)', () => {
  it('copies the plugin in under its id, checked, and records where it came from', async () => {
    const from = source('downloads');
    const plugin = await installPluginFromFolder(dir, from, APP);
    expect(plugin.manifest.id).toBe('lab');
    expect(plugin.root).toBe(path.join(dir, 'lab'));
    expect(fs.existsSync(path.join(from, 'plugin.json'))).toBe(true); // a copy, not a move
    expect(await installed()).toEqual(['lab']);
    expect((await loadPluginRecords(dir)).lab).toMatchObject({ enabled: true, source: { kind: 'folder', path: from }, installedAt: expect.any(String) });
    expect(leftovers()).toEqual([]);
  });

  it('a plugin that would be refused leaves nothing behind, and says every problem', async () => {
    const from = writePlugin(path.join(src, 'bad'), 'lab', { 'object-types': ['types/missing.md'], skills: ['skills/also-missing.md'] });
    await expect(installPluginFromFolder(dir, from, APP)).rejects.toThrow(/It can't be installed: .*types\/missing\.md.*doesn't exist.*skills\/also-missing\.md/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('refuses a folder holding a link, one with no or a bad manifest, and one already in the plugins folder', async () => {
    const linked = source('linked');
    fs.symlinkSync(path.join(linked, 'types', 'sample.md'), path.join(linked, 'types', 'alias.md'));
    await expect(installPluginFromFolder(dir, linked, APP)).rejects.toThrow(/holds a link \(types\/alias\.md\)/);

    fs.mkdirSync(path.join(src, 'empty'));
    await expect(installPluginFromFolder(dir, path.join(src, 'empty'), APP)).rejects.toThrow(/has no plugin\.json/);

    const badId = source('bad-id');
    fs.writeFileSync(path.join(badId, 'plugin.json'), JSON.stringify({ id: 'Not An Id' }));
    await expect(installPluginFromFolder(dir, badId, APP)).rejects.toThrow(/no valid "id"/);

    await installPluginFromFolder(dir, source('first'), APP);
    await expect(installPluginFromFolder(dir, path.join(dir, 'lab'), APP)).rejects.toThrow(/already in the plugins folder/);
    expect(leftovers()).toEqual([]);
  });

  it('won\'t install over a plugin without replace; with replace, the old copy goes only once the new one passes', async () => {
    await installPluginFromFolder(dir, source('v1', 'lab', 'Old Sample'), APP);
    const v2 = source('v2', 'lab', 'New Sample');
    await expect(installPluginFromFolder(dir, v2, APP)).rejects.toBeInstanceOf(PluginExistsError);

    // A broken v3 leaves v1 where it was.
    const v3 = writePlugin(path.join(src, 'v3'), 'lab', { 'object-types': ['types/missing.md'] });
    await expect(installPluginFromFolder(dir, v3, APP, { replace: true })).rejects.toThrow(/can't be installed/);
    expect(fs.readFileSync(path.join(dir, 'lab', 'types', 'sample.md'), 'utf-8')).toContain('Old Sample');

    await installPluginFromFolder(dir, v2, APP, { replace: true });
    expect(fs.readFileSync(path.join(dir, 'lab', 'types', 'sample.md'), 'utf-8')).toContain('New Sample');
    expect(leftovers()).toEqual([]);
  });
});

describe('setPluginEnabled and removePlugin (#2634)', () => {
  it('turning a plugin off records it; on again keeps its source', async () => {
    const from = source('downloads');
    await installPluginFromFolder(dir, from, APP);
    await setPluginEnabled(dir, 'lab', false);
    expect((await loadPluginRecords(dir)).lab).toMatchObject({ enabled: false, source: { kind: 'folder', path: from } });
    await setPluginEnabled(dir, 'lab', true);
    expect((await loadPluginRecords(dir)).lab?.enabled).toBe(true);
  });

  it('a plugin dropped in by hand can be turned off too', async () => {
    writePlugin(dir, 'manual', { 'object-types': ['types/sample.md'] }, { 'types/sample.md': typeFile('Sample') });
    await setPluginEnabled(dir, 'manual', false);
    expect((await loadPluginRecords(dir)).manual).toEqual({ enabled: false, source: { kind: 'manual' } });
    await expect(setPluginEnabled(dir, 'nope', false)).rejects.toThrow(/No plugin "nope" is installed/);
    await expect(setPluginEnabled(dir, '../x', false)).rejects.toThrow(/isn't a plugin id/);
  });

  it('remove deletes the folder and the record — or, for a linked plugin, only the link', async () => {
    await installPluginFromFolder(dir, source('downloads'), APP);
    await removePlugin(dir, 'lab');
    expect(fs.existsSync(path.join(dir, 'lab'))).toBe(false);
    expect((await loadPluginRecords(dir)).lab).toBeUndefined();

    const work = source('in-place');
    fs.symlinkSync(work, path.join(dir, 'lab'));
    await removePlugin(dir, 'lab');
    expect(fs.existsSync(path.join(dir, 'lab'))).toBe(false);
    expect(fs.existsSync(path.join(work, 'plugin.json'))).toBe(true); // the author's folder is untouched
    await expect(removePlugin(dir, '../../etc')).rejects.toThrow(/isn't a plugin id/);
  });

  it('a corrupt plugins.json refuses a change and is left as it is', async () => {
    writePlugin(dir, 'manual', { 'object-types': ['types/sample.md'] }, { 'types/sample.md': typeFile('Sample') });
    fs.writeFileSync(pluginsStateFile(dir), '{ not json');
    await expect(setPluginEnabled(dir, 'manual', false)).rejects.toThrow();
    expect(fs.readFileSync(pluginsStateFile(dir), 'utf-8')).toBe('{ not json');
    expect(await loadPluginRecords(dir)).toEqual({}); // display reads it as no records
  });
});

describe('installPluginFromZip (#2634)', () => {
  const manifest = (id = 'lab') => JSON.stringify({ id, name: 'Lab', version: '1.0.0', minerva: '>=3.0.0', description: 'd', contributes: { 'object-types': ['types/sample.md'] } });
  const zip = (entries: Parameters<typeof buildZip>[0], name = 'lab.zip') => {
    const p = path.join(src, name);
    fs.writeFileSync(p, buildZip(entries));
    return p;
  };

  it('installs a plugin from GitHub\'s "Download ZIP" shape, recording the archive and its SHA-256', async () => {
    const p = zip([
      { name: 'lab-main/plugin.json', data: manifest() },
      { name: 'lab-main/types/sample.md', data: typeFile('Sample'), method: 'deflate' },
    ]);
    const plugin = await installPluginFromZip(dir, p, APP);
    expect(plugin.root).toBe(path.join(dir, 'lab'));
    expect(fs.readFileSync(path.join(dir, 'lab', 'types', 'sample.md'), 'utf-8')).toContain('Sample');
    const sha256 = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    expect((await loadPluginRecords(dir)).lab).toMatchObject({ enabled: true, source: { kind: 'zip', name: 'lab.zip', sha256 } });
    expect(leftovers()).toEqual([]);
  });

  it('an unsafe archive, or a plugin that would be refused, installs nothing and leaves nothing', async () => {
    await expect(installPluginFromZip(dir, zip([
      { name: 'plugin.json', data: manifest() },
      { name: '../../escape.md', data: 'pwned' },
    ]), APP)).rejects.toThrow();
    await expect(installPluginFromZip(dir, zip([
      { name: 'plugin.json', data: manifest() },
      { name: 'types/sample.md', symlink: '/etc/passwd' },
    ]), APP)).rejects.toThrow(/is a link/);
    await expect(installPluginFromZip(dir, zip([{ name: 'plugin.json', data: manifest() }]), APP))
      .rejects.toThrow(/It can't be installed: .*types\/sample\.md.*doesn't exist/);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'escape.md'))).toBe(false);
  });

  it('won\'t install over a plugin without replace', async () => {
    const p = zip([{ name: 'plugin.json', data: manifest() }, { name: 'types/sample.md', data: typeFile('Sample') }]);
    await installPluginFromZip(dir, p, APP);
    await expect(installPluginFromZip(dir, p, APP)).rejects.toBeInstanceOf(PluginExistsError);
    await installPluginFromZip(dir, p, APP, { replace: true });
    expect(leftovers()).toEqual([]);
  });
});
