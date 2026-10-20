/**
 * @vitest-environment node
 *
 * `plugin.json` validation (#2632): every problem reported at once, failing
 * closed on unknown fields and on points plugins can't contribute to yet.
 */
import { describe, it, expect } from 'vitest';
import { validatePluginManifest, PLUGIN_ID } from '../../../src/main/plugins/manifest';
import { PLUGIN_CONTRIBUTION_POINTS } from '../../../src/shared/plugins/format';
import { EXTENSION_POINTS } from '../../../src/shared/extensions/points';

const CTX = { folder: 'reading-list', appVersion: '4.1.0' };
const GOOD = {
  id: 'reading-list',
  name: 'Reading List',
  version: '1.0.0',
  minerva: '>=4.0.0',
  description: 'Books.',
  contributes: { 'object-types': ['types/book-note.md'] },
};
const problemsOf = (raw: unknown, ctx = CTX) => {
  const r = validatePluginManifest(raw, ctx);
  return r.ok ? [] : r.problems;
};

describe('validatePluginManifest (#2632)', () => {
  it('accepts a good manifest, keeping the optional fields only when given', () => {
    expect(validatePluginManifest(GOOD, CTX)).toEqual({ ok: true, manifest: GOOD });
    const full = { ...GOOD, author: 'Ada', license: 'MIT', $schema: 'https://example/plugin.schema.json' };
    expect(validatePluginManifest(full, CTX)).toEqual({ ok: true, manifest: { ...GOOD, author: 'Ada', license: 'MIT' } });
  });

  it('reports every problem at once', () => {
    expect(problemsOf({ id: 'Reading_List', version: 'one', minerva: 'whenever', contributes: {} })).toEqual([
      '"id" must be lowercase letters and digits in dash-separated words (like "reading-list"); got "Reading_List".',
      '"name" is required.',
      '"description" is required.',
      '"version" must be a semver version like "1.0.0"; got "one".',
      '"minerva" must be a semver range like ">=4.0.0"; got "whenever".',
      '"contributes" is empty; a plugin must contribute something.',
    ]);
  });

  it('fails closed on an unknown field — a misspelt contributes contributes nothing', () => {
    const { contributes, ...rest } = GOOD;
    expect(problemsOf({ ...rest, contribute: contributes })).toEqual(['Unknown field "contribute".', '"contributes" is required.']);
  });

  it('the id must match the folder', () => {
    expect(problemsOf(GOOD, { ...CTX, folder: 'books' })).toEqual(['"id" is "reading-list" but the folder is "books"; they must match.']);
  });

  it('a Minerva outside the plugin\'s range refuses it, saying which it needs', () => {
    expect(problemsOf({ ...GOOD, minerva: '>=5.0.0' })).toEqual(['It needs Minerva >=5.0.0; this is 4.1.0.']);
    expect(problemsOf({ ...GOOD, minerva: '^4.0.0' }, { ...CTX, appVersion: '4.2.0-beta.1' })).toEqual([]);
  });

  it('refuses a point plugins can\'t contribute to yet, naming the ones they can', () => {
    expect(problemsOf({ ...GOOD, contributes: { inspections: ['inspections/x.json'] } })).toEqual([
      `"contributes" names "inspections", which plugins can't contribute to; they can contribute to ${Object.keys(PLUGIN_CONTRIBUTION_POINTS).join(', ')}.`,
    ]);
    expect(problemsOf({ ...GOOD, contributes: { toString: ['x'] } })[0]).toMatch(/names "toString"/);
  });

  it('a contribution is a non-empty list of paths', () => {
    expect(problemsOf({ ...GOOD, contributes: { skills: 'skills/a.md' } })).toEqual(['"contributes.skills" must be a non-empty list of file paths.']);
    expect(problemsOf({ ...GOOD, contributes: { skills: [] } })).toEqual(['"contributes.skills" must be a non-empty list of file paths.']);
    expect(problemsOf({ ...GOOD, contributes: { skills: [''] } })).toEqual(['"contributes.skills" must be a non-empty list of file paths.']);
  });

  it('caps lengths and refuses non-objects', () => {
    expect(problemsOf({ ...GOOD, name: 'x'.repeat(81) })).toEqual(['"name" is 81 characters; at most 80.']);
    expect(problemsOf([])).toEqual(['plugin.json must be a JSON object.']);
    expect(problemsOf({ ...GOOD, author: 7 })).toEqual(['"author" must be a non-empty string.']);
  });

  it('PLUGIN_ID takes dash-separated lowercase words only', () => {
    for (const ok of ['a', 'reading-list', 'lab2', 'a-b-c']) expect(PLUGIN_ID.test(ok)).toBe(true);
    for (const bad of ['', 'A', '-a', 'a-', 'a--b', '2lab', 'a_b', 'a.b', 'a/b', '..']) expect(PLUGIN_ID.test(bad)).toBe(false);
  });
});

describe('PLUGIN_CONTRIBUTION_POINTS (#2632)', () => {
  it('names real extension points, each with a folder of its own', () => {
    const ids = new Set(EXTENSION_POINTS.map((p) => p.id));
    for (const point of Object.keys(PLUGIN_CONTRIBUTION_POINTS)) expect(ids, point).toContain(point);
    const folders = Object.values(PLUGIN_CONTRIBUTION_POINTS).map((s) => s.folder);
    expect(new Set(folders).size).toBe(folders.length);
  });
});

describe('the code section (#2823)', () => {
  const CORE = { ...CTX, core: true };

  it('a built-in plugin declares what its code does, from the closed list', () => {
    const r = validatePluginManifest({ ...GOOD, code: { capabilities: ['process', 'notes:read'] } }, CORE);
    expect(r).toEqual({ ok: true, manifest: { ...GOOD, code: { capabilities: ['process', 'notes:read'] } } });
  });

  it('an installed plugin can\'t have one yet, and is pointed at MCP', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['ui'] } })).toEqual([
      '"code" is only for plugins built into Minerva for now. A plugin you install can\'t run code inside Minerva yet; ship the code as an MCP server instead ("mcpServers").',
    ]);
  });

  it('fails closed: an unknown capability, a repeat, an unknown key, or nothing listed', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['network', 'ui', 'ui'], view: 'view.js' } }, CORE)).toEqual([
      'Unknown field "code.view".',
      '"code.capabilities" names "network", which isn\'t a capability; they are notes:read, graph:query, ui, notes:write-properties, notes:write, llm:propose, process.',
      '"code.capabilities" lists "ui" twice.',
    ]);
    expect(problemsOf({ ...GOOD, code: { capabilities: [] } }, CORE)).toEqual(['"code.capabilities" must be a non-empty list of what the code does.']);
    expect(problemsOf({ ...GOOD, code: 'yes' }, CORE)).toEqual(['"code" must be an object.']);
  });
});
