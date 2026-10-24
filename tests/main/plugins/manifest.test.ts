/**
 * @vitest-environment node
 *
 * `plugin.json` validation (#2632): every problem reported at once, failing
 * closed on unknown fields and on points plugins can't contribute to yet.
 */
import { describe, it, expect } from 'vitest';
import { PLUGIN_API_VERSION } from '../../../src/shared/plugins/api';
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
    const r = validatePluginManifest({ ...GOOD, code: { capabilities: ['process', 'notes:read'], api: '^1.0.0' } }, CORE);
    expect(r).toEqual({ ok: true, manifest: { ...GOOD, code: { capabilities: ['process', 'notes:read'], api: '^1.0.0' } } });
  });

  it('an installed plugin can\'t have one yet, and is pointed at MCP', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['ui'] } })).toEqual([
      '"code" is only for plugins built into Minerva for now. A plugin you install can\'t run code inside Minerva yet; ship the code as an MCP server instead ("mcpServers").',
    ]);
  });

  it('fails closed: an unknown capability, a repeat, an unknown key, or nothing listed', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['network', 'ui', 'ui'], view: 'view.js', api: '^1.0.0' } }, CORE)).toEqual([
      'Unknown field "code.view".',
      '"code.capabilities" names "network", which isn\'t a capability; they are notes:read, graph:query, ui, notes:write-properties, notes:write, llm:propose, process.',
      '"code.capabilities" lists "ui" twice.',
    ]);
    expect(problemsOf({ ...GOOD, code: { capabilities: [] } }, CORE)).toEqual(['"code.capabilities" must be a non-empty list of what the code does.']);
    expect(problemsOf({ ...GOOD, code: 'yes' }, CORE)).toEqual(['"code" must be an object.']);
  });
});

describe('code.api: the plugin API versions the code was written for (#2826)', () => {
  const CORE = { ...CTX, core: true };

  it('is required when the code uses the API, and not for a program alone', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['notes:read'] } }, CORE)).toEqual([
      `"code.api" must say which plugin API versions the code was written for, like "^${PLUGIN_API_VERSION}".`,
    ]);
    expect(problemsOf({ ...GOOD, code: { capabilities: ['process'] } }, CORE)).toEqual([]);
  });

  it('is a semver range, checked against the plugin API — never the app version', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['ui'], api: 'latest' } }, CORE)).toEqual([
      `"code.api" must be a semver range like "^${PLUGIN_API_VERSION}"; got "latest".`,
    ]);
    expect(problemsOf({ ...GOOD, code: { capabilities: ['ui'], api: '^2.0.0' } }, CORE)).toEqual([
      `"code.api" asks for plugin API ^2.0.0; this Minerva has ${PLUGIN_API_VERSION}.`,
    ]);
    // The app is 4.x in CTX; a plugin written for API 1 still loads.
    expect(problemsOf({ ...GOOD, code: { capabilities: ['ui'], api: '>=1.0.0 <2' } }, CORE)).toEqual([]);
  });
});

describe('code.views: global views (#2640)', () => {
  const CORE = { ...CTX, core: true };
  const VIEW = { id: 'queue', title: 'Reading Queue', place: 'left-sidebar', entry: 'index.html', query: 'queue.rq' };
  const code = (views: unknown, capabilities = ['graph:query', 'ui']) => ({ ...GOOD, code: { capabilities, api: '^1.8.0', views } });

  it('a view names its page, its query and its place', () => {
    const r = validatePluginManifest(code([{ ...VIEW, icon: 'bookmark' }]), CORE);
    expect(r).toEqual({ ok: true, manifest: { ...GOOD, code: { capabilities: ['graph:query', 'ui'], api: '^1.8.0', views: [{ ...VIEW, icon: 'bookmark' }] } } });
  });

  it('needs a frame and a query to read: the ui and graph:query capabilities', () => {
    expect(problemsOf(code([VIEW], ['ui', 'notes:read']), CORE)).toEqual([
      '"code.views" needs the "graph:query" capability: a view is a page fed by a query.',
    ]);
  });

  it('refuses a page or query outside the folder, of the wrong kind, or in a dot-folder', () => {
    expect(problemsOf(code([{ ...VIEW, entry: '../app/index.html', query: 'queries/q.sql' }]), CORE)).toEqual([
      '"code.views[0].entry" must be a path inside the plugin\'s folder, like "views/index.html"; got "../app/index.html".',
      '"code.views[0].query" must be a SPARQL query, an .rq file; got "queries/q.sql".',
    ]);
    expect(problemsOf(code([{ ...VIEW, entry: '/abs.html', query: '.hidden/q.rq' }]), CORE)).toEqual([
      '"code.views[0].entry" must be a path inside the plugin\'s folder, like "views/index.html"; got "/abs.html".',
      '"code.views[0].query" must be a path inside the plugin\'s folder, like "views/queue.rq"; got ".hidden/q.rq".',
    ]);
  });

  it('refuses unknown fields, places, bad ids, duplicates, and an empty list', () => {
    expect(problemsOf(code([{ ...VIEW, place: 'window', html: 'x' }, { ...VIEW, id: 'Bad Id' }, VIEW, VIEW]), CORE)).toEqual([
      'Unknown field "code.views[0].html".',
      '"code.views[0].place" must be one of left-sidebar, right-sidebar, tab; got "window".',
      '"code.views[1].id" must be lowercase letters and digits in dash-separated words, like "queue".',
      '"code.views" has two views with the id "queue".',
    ]);
    expect(problemsOf(code([]), CORE)).toEqual(['"code.views" must be a non-empty list of views.']);
  });
});

describe('code.blocks: live blocks (#2641)', () => {
  const CORE = { ...CTX, core: true };
  const BLOCK = { id: 'card', title: 'Recipe card', fence: 'recipe-card', entry: 'index.html' };
  const code = (blocks: unknown, capabilities = ['ui']) => ({ ...GOOD, code: { capabilities, api: '^1.9.0', blocks } });

  it('a block names its page and one fence or directive; a query is optional', () => {
    expect(validatePluginManifest(code([BLOCK]), CORE)).toEqual({ ok: true, manifest: { ...GOOD, code: { capabilities: ['ui'], api: '^1.9.0', blocks: [BLOCK] } } });
    const directive = { id: 'list', title: 'List', directive: 'reading-list', entry: 'list.html', query: 'q.rq' };
    expect(problemsOf(code([directive], ['ui', 'graph:query']), CORE)).toEqual([]);
  });

  it('needs ui, and graph:query for a query', () => {
    expect(problemsOf(code([{ ...BLOCK, query: 'q.rq' }], ['notes:read']), CORE)).toEqual([
      '"code.blocks" needs the "ui" capability: a block is a page Minerva frames.',
      '"code.blocks[0].query" needs the "graph:query" capability: Minerva runs it for the block.',
    ]);
  });

  it("can't take a name Minerva draws itself — a built-in block, a directive, a cell language", () => {
    expect(problemsOf(code([
      { ...BLOCK, id: 'a', fence: 'mermaid' },
      { ...BLOCK, id: 'b', fence: 'python' },
      { id: 'c', title: 'C', directive: 'argument', entry: 'x.html' },
      { id: 'd', title: 'D', directive: 'query-list', entry: 'x.html' },
    ]), CORE)).toEqual([
      '"code.blocks[0].fence" is "mermaid", which Minerva draws itself; pick another name.',
      '"code.blocks[1].fence" is "python", which Minerva draws itself; pick another name.',
      '"code.blocks[2].directive" is "argument", which Minerva draws itself; pick another name.',
      '"code.blocks[3].directive" is "query-list", which Minerva draws itself; pick another name.',
    ]);
  });

  it('refuses neither or both of fence and directive, a bad name, a -hidden name, and the same name twice', () => {
    expect(problemsOf(code([
      { id: 'a', title: 'A', entry: 'x.html' },
      { ...BLOCK, id: 'b', directive: 'also' },
      { ...BLOCK, id: 'c', fence: 'Not A Name' },
      { ...BLOCK, id: 'd', fence: 'card-hidden' },
      { ...BLOCK, id: 'e' },
      { ...BLOCK, id: 'f' },
    ]), CORE)).toEqual([
      '"code.blocks[0]" must name exactly one of "fence" (a ```name block) and "directive" (a :::name block).',
      '"code.blocks[1]" must name exactly one of "fence" (a ```name block) and "directive" (a :::name block).',
      '"code.blocks[2].fence" must be lowercase letters and digits in dash-separated words, like "recipe-card".',
      '"code.blocks[3].fence" must be lowercase letters and digits in dash-separated words, like "recipe-card".',
      '"code.blocks" has two blocks drawing the fence "recipe-card".',
    ]);
  });
});
