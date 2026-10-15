/**
 * @vitest-environment node
 *
 * Plugin object types (#2633): stock < plugin < thoughtbase. A plugin type
 * keeps its own id (notes write `type: book-note`), can't replace a stock
 * type or an earlier plugin's, and a thoughtbase's own file overrides it —
 * with the plugin's definition underneath to revert to.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { readPluginPackages } from '../../../src/main/plugins/package';
import { _disablePluginsForTests, enablePlugins } from '../../../src/main/plugins/registry';
import { writePlugin, typeFile } from '../../helpers/plugins';

let pluginsDir: string;
let root: string;
beforeEach(() => {
  // One level down, so its plugins.json (beside it) is this test's own.
  pluginsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-types-')), 'plugins');
  fs.mkdirSync(pluginsDir);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-types-tb-'));
});
afterEach(() => {
  _disablePluginsForTests();
  for (const d of [path.dirname(pluginsDir), root]) fs.rmSync(d, { recursive: true, force: true });
});

const catalog = async () => loadTypeCatalog(root, await readPluginPackages('4.0.0', pluginsDir));
const userType = (file: string, text: string) => {
  fs.mkdirSync(path.join(root, '.minerva', 'types'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minerva', 'types', file), text);
};

describe('plugin object types (#2633)', () => {
  it('load under their own id and class, carrying their plugin', async () => {
    writePlugin(pluginsDir, 'reading-list', { 'object-types': ['types/book-note.md'] }, { 'types/book-note.md': typeFile('Book Note') }, { name: 'Reading List' });
    const { types, errors } = await catalog();
    expect(errors).toEqual([]);
    const t = types.find((x) => x.id === 'book-note');
    expect(t).toMatchObject({ source: 'plugin', classLocalName: 'BookNote', plugin: { id: 'reading-list', name: 'Reading List', version: '1.0.0' } });
  });

  it('can\'t replace a stock type, or an earlier plugin\'s', async () => {
    writePlugin(pluginsDir, 'a-first', { 'object-types': ['types/x.md'] }, { 'types/x.md': typeFile('Lab Sample') });
    writePlugin(pluginsDir, 'b-second', { 'object-types': ['types/book.md', 'types/x.md'] }, {
      'types/book.md': typeFile('Book'),
      'types/x.md': typeFile('Lab Sample'),
    });
    const { types, errors } = await catalog();
    expect(types.find((t) => t.id === 'book')?.source).toBe('stock');
    expect(types.find((t) => t.id === 'lab-sample')?.plugin?.id).toBe('a-first');
    expect(errors.map((e) => [e.source, e.label, e.message])).toEqual([
      ['plugin', 'b-second: Book', 'id "book" is already a stock type; a plugin can\'t replace it'],
      ['plugin', 'b-second: Lab Sample', 'id "lab-sample" is already the a-first plugin\'s type; a plugin can\'t replace it'],
    ]);
  });

  it('a thoughtbase\'s own file overrides a plugin type, keeping the plugin underneath to revert to', async () => {
    writePlugin(pluginsDir, 'reading-list', { 'object-types': ['types/book-note.md'] }, { 'types/book-note.md': typeFile('Book Note') });
    userType('book-note.md', typeFile('Book Note', 'icon: "🔖"\n'));
    const { types, errors } = await catalog();
    expect(errors).toEqual([]);
    expect(types.find((t) => t.id === 'book-note')).toMatchObject({
      source: 'user', icon: '🔖', overridesStock: true, plugin: { id: 'reading-list' },
    });
    // Revert: the thoughtbase's file goes, and the plugin's definition is back.
    fs.rmSync(path.join(root, '.minerva', 'types', 'book-note.md'));
    expect((await catalog()).types.find((t) => t.id === 'book-note')).toMatchObject({ source: 'plugin' });
  });

  it('a plugin type can extend a stock type, and a thoughtbase type can extend a plugin\'s', async () => {
    writePlugin(pluginsDir, 'reading-list', { 'object-types': ['types/book-note.md'] }, { 'types/book-note.md': typeFile('Book Note', 'parent: book\n') });
    userType('rare-book.md', typeFile('Rare Book', 'parent: book-note\n'));
    const { types, errors } = await catalog();
    expect(errors).toEqual([]);
    expect(types.find((t) => t.id === 'book-note')?.parent).toBe('book');
    expect(types.find((t) => t.id === 'rare-book')?.parent).toBe('book-note');
  });

  it('by default it reads the app\'s scan — empty until the app enables plugins', async () => {
    writePlugin(pluginsDir, 'reading-list', { 'object-types': ['types/book-note.md'] }, { 'types/book-note.md': typeFile('Book Note') });
    expect((await loadTypeCatalog(root)).types.some((t) => t.id === 'book-note')).toBe(false);
    enablePlugins({ appVersion: '4.0.0', dir: pluginsDir });
    expect((await loadTypeCatalog(root)).types.some((t) => t.id === 'book-note')).toBe(true);
  });
});
