/**
 * @vitest-environment node
 *
 * Reading plugin folders (#2632): a package is accepted whole or refused
 * whole, every contributed path is contained in the plugin folder with links
 * followed, and one bad plugin never stops the others.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPluginPackage, readPluginPackages, MAX_CONTRIBUTION_BYTES, MAX_MANIFEST_BYTES } from '../../../src/main/plugins/package';
import type { PluginLoadError } from '../../../src/shared/plugins/format';

const APP = '4.1.0';
let dir: string;

beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugins-'))); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Write a plugin: its manifest (with `contributes`) and the given files. */
function plugin(id: string, contributes: Record<string, string[]>, files: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
  const root = path.join(dir, id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    id, name: id, version: '1.0.0', minerva: '>=4.0.0', description: 'A test plugin.', contributes, ...extra,
  }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

async function problems(root: string): Promise<string[]> {
  const r = await readPluginPackage(root, APP);
  return r.ok ? [] : r.error.problems;
}

describe('readPluginPackage (#2632)', () => {
  it('accepts a plugin and lists its contributions, with provenance', async () => {
    const root = plugin('lab', {
      'object-types': ['types/sample.md'],
      skills: ['skills/summarize.md', './skills/review'],
      'saved-queries': ['queries/a.rq', 'queries/b.SQL'],
    }, {
      'types/sample.md': '---\nlabel: Sample\n---\n',
      'skills/summarize.md': 'x',
      'skills/review/SKILL.md': 'x',
      'queries/a.rq': 'SELECT * {}',
      'queries/b.SQL': 'SELECT 1',
    });
    const r = await readPluginPackage(root, APP);
    if (!r.ok) throw new Error(r.error.problems.join('\n'));
    expect(r.plugin.provenance).toBe('plugin:lab@1.0.0');
    expect(r.plugin.root).toBe(root);
    expect(r.plugin.contributions.map((c) => [c.point, c.path, c.kind])).toEqual([
      ['object-types', 'types/sample.md', 'file'],
      ['skills', 'skills/summarize.md', 'file'],
      ['skills', 'skills/review', 'folder'],
      ['saved-queries', 'queries/a.rq', 'file'],
      ['saved-queries', 'queries/b.SQL', 'file'],
    ]);
    expect(r.plugin.contributions[0]!.absolutePath).toBe(path.join(root, 'types', 'sample.md'));
  });

  it('a manifest problem names the plugin by id and version when it got that far', async () => {
    const root = plugin('lab', { commands: ['commands/x.json'] });
    const r = await readPluginPackage(root, APP);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatchObject({ folder: 'lab', label: 'lab@1.0.0', problems: [expect.stringContaining('"commands"')] });
  });

  it('refuses a contributed file over the size cap, a skill folder\'s SKILL.md included (#2655)', async () => {
    const big = 'x'.repeat(MAX_CONTRIBUTION_BYTES + 1);
    const root = plugin('lab', { skills: ['skills/big.md', 'skills/folder'] }, {
      'skills/big.md': big,
      'skills/folder/SKILL.md': big,
    });
    const found = (await problems(root)).join('\n');
    expect(found).toMatch(/"skills\/big\.md" \(skills\) is 1\.0 MB; a contributed file may be at most 1 MB/);
    expect(found).toMatch(/"skills\/folder" \(skills\)'s SKILL\.md is 1\.0 MB/);
    const ok = plugin('lab2', { skills: ['skills/edge.md'] }, { 'skills/edge.md': 'x'.repeat(MAX_CONTRIBUTION_BYTES) });
    expect(await problems(ok)).toEqual([]);
  });

  it('refuses a missing, unreadable-as-JSON, oversized or linked manifest', async () => {
    fs.mkdirSync(path.join(dir, 'none'));
    expect(await problems(path.join(dir, 'none'))).toEqual(['It has no plugin.json.']);

    const bad = plugin('bad', {});
    fs.writeFileSync(path.join(bad, 'plugin.json'), '{ "id": ');
    expect(await problems(bad)).toEqual([expect.stringMatching(/^plugin\.json isn't valid JSON: /)]);

    const big = plugin('big', {});
    fs.writeFileSync(path.join(big, 'plugin.json'), ' '.repeat(MAX_MANIFEST_BYTES + 1));
    expect(await problems(big)).toEqual(['plugin.json is 65 KB; at most 64 KB.']);

    const linked = plugin('linked', {});
    const elsewhere = path.join(dir, 'elsewhere.json');
    fs.renameSync(path.join(linked, 'plugin.json'), elsewhere);
    fs.symlinkSync(elsewhere, path.join(linked, 'plugin.json'));
    expect(await problems(linked)).toEqual(['plugin.json must be a file in the plugin folder, not a link or a folder.']);
  });

  it('every contributed path is relative, in its point\'s folder, and exists with the right extension', async () => {
    const root = plugin('lab', {
      'object-types': ['/etc/passwd', 'types\\a.md', 'types/../types/a.md', 'types//a.md', 'skills/a.md', 'types', 'types/missing.md', 'types/a.txt'],
    }, { 'types/a.txt': 'x', 'skills/a.md': 'x' });
    expect(await problems(root)).toEqual([
      '"/etc/passwd" (object-types) must be a relative path with "/" separators.',
      '"types\\a.md" (object-types) must be a relative path with "/" separators.',
      '"types/../types/a.md" (object-types) may not contain ".." or empty segments.',
      '"types//a.md" (object-types) may not contain ".." or empty segments.',
      '"skills/a.md" (object-types) must be inside the plugin\'s types/ folder.',
      '"types" (object-types) must be inside the plugin\'s types/ folder.',
      '"types/missing.md" (object-types) doesn\'t exist.',
      '"types/a.txt" (object-types) must be a .md file.',
    ]);
  });

  it('a link that leaves the plugin is refused, as a file or inside a skill folder; one that stays is fine', async () => {
    const outside = path.join(dir, 'outside.md');
    fs.writeFileSync(outside, 'secret');
    const root = plugin('lab', { 'object-types': ['types/escape.md', 'types/inside.md'], skills: ['skills/review'] }, {
      'types/real.md': 'x',
      'skills/review/SKILL.md': 'x',
    });
    fs.symlinkSync(outside, path.join(root, 'types', 'escape.md'));
    fs.symlinkSync(path.join(root, 'types', 'real.md'), path.join(root, 'types', 'inside.md'));
    fs.symlinkSync(outside, path.join(root, 'skills', 'review', 'notes.md'));
    expect(await problems(root)).toEqual([
      '"types/escape.md" (object-types) leaves the plugin folder.',
      '"skills/review" (skills) holds a link that leaves the plugin folder: skills/review/notes.md.',
    ]);
  });

  it('only a skill may be a folder, and it needs SKILL.md; a path listed twice is refused', async () => {
    const root = plugin('lab', { skills: ['skills/empty', 'skills/a.md', 'skills/a.md'], 'note-templates': ['templates/set'] }, {
      'skills/empty/readme.txt': 'x',
      'skills/a.md': 'x',
      'templates/set/a.md': 'x',
    });
    expect(await problems(root)).toEqual([
      '"skills/empty" (skills) is a folder without a SKILL.md.',
      '"skills/a.md" is listed twice (under skills and skills).',
      '"templates/set" (note-templates) is a folder; list its files one by one.',
    ]);
  });

  it('a linked plugin folder is read from its target, and contained there', async () => {
    const real = plugin('real-lab', { 'object-types': ['types/a.md'] }, { 'types/a.md': 'x' });
    const work = path.join(dir, 'work');
    fs.renameSync(real, work);
    fs.writeFileSync(path.join(work, 'plugin.json'), fs.readFileSync(path.join(work, 'plugin.json'), 'utf-8').replace('"real-lab"', '"lab"'));
    const plugins = path.join(dir, 'plugins');
    fs.mkdirSync(plugins);
    fs.symlinkSync(work, path.join(plugins, 'lab'));
    const r = await readPluginPackage(path.join(plugins, 'lab'), APP);
    expect(r.ok && r.plugin.root).toBe(work);
  });
});

describe('readPluginPackages (#2632)', () => {
  it('reads every plugin in name order; a bad one is reported and the rest still load', async () => {
    plugin('b-good', { 'object-types': ['types/a.md'] }, { 'types/a.md': 'x' });
    plugin('a-bad', { 'object-types': ['types/missing.md'] });
    plugin('c-good', { 'saved-queries': ['queries/q.rq'] }, { 'queries/q.rq': 'SELECT * {}' });
    fs.mkdirSync(path.join(dir, '.hidden'));
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    const scan = await readPluginPackages(APP, dir);
    expect(scan.plugins.map((p) => p.manifest.id)).toEqual(['b-good', 'c-good']);
    expect(scan.errors).toEqual<PluginLoadError[]>([
      { folder: 'a-bad', label: 'a-bad@1.0.0', problems: ['"types/missing.md" (object-types) doesn\'t exist.'] },
    ]);
  });

  it('no plugins folder is no plugins; a link to a file is reported', async () => {
    expect(await readPluginPackages(APP, path.join(dir, 'nope'))).toEqual({ plugins: [], errors: [] });
    fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
    fs.symlinkSync(path.join(dir, 'file.txt'), path.join(dir, 'linked'));
    expect((await readPluginPackages(APP, dir)).errors).toEqual([{ folder: 'linked', label: 'linked', problems: ['It isn\'t a folder.'] }]);
  });
});
