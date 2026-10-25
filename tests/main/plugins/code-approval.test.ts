/**
 * @vitest-environment node
 *
 * An installed plugin's code, approved as the files it ships (#2833): the
 * hash every file goes into; the package that carries it and checks the files
 * its code names; install, which needs the approval; approving again, pinned
 * to the hash as it is; the scan, which loads a plugin with code only while
 * its approval matches; and the native question's words.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pluginCodeHash, CODE_HASH_LIMITS } from '../../../src/main/plugins/code-hash';
import { readPluginPackage } from '../../../src/main/plugins/package';
import { approvePluginCode, installPluginFromFolder, setPluginEnabled } from '../../../src/main/plugins/lifecycle';
import { loadPluginRecords } from '../../../src/main/plugins/state';
import { codeApprovalOf, enablePlugins, disablePlugins, reloadPluginScan, getPluginInventory } from '../../../src/main/plugins/registry';
import { codeApprovalQuestion } from '../../../src/main/plugins/code-approval';
import { writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('config', 'plugins');

const APP = '4.1.0';
const CODE = { capabilities: ['notes:read', 'graph:query', 'ui'], api: '^1.0.0', worker: 'logic.js', views: [{ id: 'board', title: 'Board', place: 'left-sidebar', entry: 'index.html', query: 'q.rq' }] };
let tmp: string;
let dir: string;
let src: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-code-approval-')));
  dir = path.join(tmp, '.minerva', 'plugins');
  src = path.join(tmp, 'work');
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => { disablePlugins(); fs.rmSync(tmp, { recursive: true, force: true }); });

const FILES = { 'logic.js': 'export {};\n', 'index.html': '<!doctype html><p>board</p>', 'q.rq': 'SELECT ?n WHERE { ?n a minerva:Note }' };
const codePlugin = (at = src, files: Record<string, string> = FILES, code: Record<string, unknown> = CODE) =>
  writePlugin(at, 'board', {}, files, { name: 'Board', code });
const read = async (root: string) => {
  const r = await readPluginPackage(root, APP);
  if (!r.ok) throw new Error(r.error.problems.join('\n'));
  return r.plugin;
};

describe('pluginCodeHash (#2833)', () => {
  it('changes with any file, a rename or a new one, and not with listing order or a skipped file', async () => {
    const root = codePlugin();
    const first = await pluginCodeHash(root);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await pluginCodeHash(root)).toBe(first);
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), 'x');
    fs.writeFileSync(path.join(root, '.DS_Store'), 'x');
    expect(await pluginCodeHash(root)).toBe(first);

    fs.writeFileSync(path.join(root, 'logic.js'), 'export const changed = 1;\n');
    const edited = await pluginCodeHash(root);
    expect(edited).not.toBe(first);
    fs.renameSync(path.join(root, 'q.rq'), path.join(root, 'r.rq'));
    expect(await pluginCodeHash(root)).not.toBe(edited);
  });

  it('a skill or a type is part of it too: the whole folder is approved', async () => {
    const root = codePlugin();
    const before = await pluginCodeHash(root);
    fs.mkdirSync(path.join(root, 'skills'));
    fs.writeFileSync(path.join(root, 'skills', 'a.md'), 'x');
    expect(await pluginCodeHash(root)).not.toBe(before);
  });

  it('refuses a plugin too big to approve', async () => {
    const root = codePlugin();
    let deep = root;
    for (let i = 0; i <= CODE_HASH_LIMITS.depth + 1; i++) { deep = path.join(deep, 'd'); fs.mkdirSync(deep); }
    fs.writeFileSync(path.join(deep, 'f'), 'x');
    await expect(pluginCodeHash(root)).rejects.toThrow(`nests folders more than ${CODE_HASH_LIMITS.depth} deep`);
  });
});

describe('the package (#2833)', () => {
  it('carries the hash for a plugin with code, and none for a declarative one', async () => {
    const plugin = await read(codePlugin());
    expect(plugin.codeHash).toBe(await pluginCodeHash(plugin.root));
    const plain = writePlugin(path.join(tmp, 'plain'), 'plain', { skills: ['skills/a.md'] }, { 'skills/a.md': '---\nid: a\nname: a\ndescription: d\nmenu: Analysis\n---\nx' });
    expect((await read(plain)).codeHash).toBeUndefined();
  });

  it('refuses one whose code names a file it doesn\'t ship', async () => {
    const root = codePlugin(src, { 'logic.js': 'x' });
    const r = await readPluginPackage(root, APP);
    expect(r.ok ? [] : r.error.problems).toEqual([
      '"index.html", which its code names, isn\'t a file in the plugin.',
      '"q.rq", which its code names, isn\'t a file in the plugin.',
    ]);
  });
});

describe('install and approval (#2833)', () => {
  it('a plugin with code needs an approver; declined, nothing goes in; allowed, the hash is recorded', async () => {
    const from = codePlugin();
    await expect(installPluginFromFolder(dir, from, APP)).rejects.toThrow('It runs code inside Minerva, which needs your approval');
    expect(fs.readdirSync(dir).filter((n) => !n.startsWith('.'))).toEqual([]);

    const asked: string[] = [];
    expect(await installPluginFromFolder(dir, from, APP, { approveCode: async (p) => { asked.push(p.manifest.id); return false; } })).toBeNull();
    expect(asked).toEqual(['board']);
    expect(fs.existsSync(path.join(dir, 'board'))).toBe(false);

    const plugin = await installPluginFromFolder(dir, from, APP, { approveCode: async () => true });
    expect((await loadPluginRecords(dir)).board?.codeApproved).toEqual({ hash: plugin!.codeHash, capabilities: ['notes:read', 'graph:query', 'ui'] });
  });

  it('a declarative plugin installs without asking', async () => {
    const from = writePlugin(src, 'plain', { skills: ['skills/a.md'] }, { 'skills/a.md': '---\nid: a\nname: a\ndescription: d\nmenu: Analysis\n---\nx' });
    let asked = false;
    await installPluginFromFolder(dir, from, APP, { approveCode: async () => { asked = true; return true; } });
    expect(asked).toBe(false);
  });

  it('loads only while its approval matches its files; approving again pins the new hash', async () => {
    enablePlugins({ appVersion: APP, dir });
    await installPluginFromFolder(dir, codePlugin(), APP, { approveCode: async () => true });
    const loaded = async () => (await reloadPluginScan()).plugins.map((p) => p.manifest.id);
    expect(await loaded()).toEqual(['board']);

    // An edit in place: the plugin goes off, still installed and still "enabled".
    fs.writeFileSync(path.join(dir, 'board', 'logic.js'), 'export const evil = 1;\n');
    expect(await loaded()).toEqual([]);
    const entry = (await getPluginInventory()).installed[0]!;
    expect(entry.record.enabled).toBe(true);
    expect(codeApprovalOf(entry.plugin, entry.record)).toBe('changed');

    await approvePluginCode(dir, 'board', entry.plugin);
    expect(await loaded()).toEqual(['board']);
    // Turning it off and on keeps the approval.
    await setPluginEnabled(dir, 'board', false);
    await setPluginEnabled(dir, 'board', true);
    expect(await loaded()).toEqual(['board']);
  });

  it('a plugin put in by hand, with no record, waits for approval', async () => {
    enablePlugins({ appVersion: APP, dir });
    codePlugin(dir);
    expect((await reloadPluginScan()).plugins).toEqual([]);
    const entry = (await getPluginInventory()).installed[0]!;
    expect(codeApprovalOf(entry.plugin, entry.record)).toBe('needed');
  });

  it('refuses an approval of files that changed while the user was reading the question', async () => {
    enablePlugins({ appVersion: APP, dir });
    codePlugin(dir);
    const entry = (await getPluginInventory()).installed[0]!;
    fs.writeFileSync(path.join(dir, 'board', 'index.html'), '<p>swapped</p>');
    await expect(approvePluginCode(dir, 'board', entry.plugin)).rejects.toThrow('changed while it was being approved');
    expect((await loadPluginRecords(dir)).board?.codeApproved).toBeUndefined();
  });
});

describe('the question (#2833)', () => {
  const manifest = { id: 'board', name: 'Board', version: '2.0.0', minerva: '>=4', description: 'A board.', author: 'Ada', contributes: {}, code: { capabilities: ['notes:read', 'notes:write-properties'], api: '^1.0.0' } } as const;
  it('at install, says who, what it can do, and that it is sandboxed', () => {
    const q = codeApprovalQuestion(manifest as never);
    expect(q).toMatchObject({ message: 'Install Board? It runs code inside Minerva.', confirmLabel: 'Install' });
    expect(q.detail).toContain('Board 2.0.0 by Ada: A board.');
    expect(q.detail).toContain('It can read the notes Minerva hands its views and commands; and change the properties of notes it was given.');
    expect(q.detail).toContain("can't reach the network");
  });
  it('on a change, says what it now can and no longer asks to do, or that only its files changed', () => {
    expect(codeApprovalQuestion(manifest as never, { capabilities: ['notes:read', 'ui'] }).detail).toContain(
      'Now it can also: change the properties of notes it was given.\nIt no longer asks to: ',
    );
    expect(codeApprovalQuestion(manifest as never, { capabilities: ['notes:read', 'notes:write-properties'] }).detail)
      .toContain('It asks for the same capabilities as before; its files changed.');
  });
});
