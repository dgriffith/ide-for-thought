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
    expect(problemsOf({ ...GOOD, contributes: { commands: ['commands/x.json'] } })).toEqual([
      `"contributes" names "commands", which plugins can't contribute to; they can contribute to ${Object.keys(PLUGIN_CONTRIBUTION_POINTS).join(', ')}.`,
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

  it('an installed plugin may have one (#2833), all code with nothing else to contribute, but never `process`', () => {
    const code = { capabilities: ['ui', 'notes:read'], api: '^1.0.0' };
    expect(validatePluginManifest({ ...GOOD, contributes: {}, code }, CTX)).toEqual({ ok: true, manifest: { ...GOOD, contributes: {}, code } });
    expect(problemsOf({ ...GOOD, code: { capabilities: ['ui', 'process'], api: '^1.0.0' } })).toEqual([
      '"code.capabilities" names "process", which only plugins built into Minerva may declare. A program a plugin runs ships as an MCP server instead ("mcpServers").',
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

describe('code.worker: a plugin\'s logic (#2830)', () => {
  const CORE = { ...CTX, core: true };
  const code = (worker: unknown) => ({ ...GOOD, code: { capabilities: ['notes:read'], api: '^1.10.0', worker } });

  it('names a .js module in the plugin folder', () => {
    expect(validatePluginManifest(code('logic/main.js'), CORE)).toEqual({ ok: true, manifest: { ...GOOD, code: { capabilities: ['notes:read'], api: '^1.10.0', worker: 'logic/main.js' } } });
  });

  it('refuses a path outside the folder, in a dot-folder, or not a .js file', () => {
    expect(problemsOf(code('../app/main.js'), CORE)).toEqual(['"code.worker" must be a path inside the plugin\'s folder, like "views/logic.js"; got "../app/main.js".']);
    expect(problemsOf(code('.hidden/main.js'), CORE)).toEqual(['"code.worker" must be a path inside the plugin\'s folder, like "views/logic.js"; got ".hidden/main.js".']);
    expect(problemsOf(code('logic.ts'), CORE)).toEqual(['"code.worker" must be a JavaScript module, a .js file; got "logic.ts".']);
  });
});

describe('code.commands (#2643)', () => {
  const CORE = { ...CTX, core: true };
  const VIEW = { id: 'queue', title: 'Queue', place: 'left-sidebar', entry: 'index.html', query: 'queue.rq' };
  const code = (commands: unknown, extra: Record<string, unknown> = {}) => ({
    ...GOOD, code: { capabilities: ['notes:read', 'ui', 'graph:query'], api: '^1.10.0', worker: 'logic.js', views: [VIEW], commands, ...extra },
  });
  const commandsOf = (raw: unknown) => {
    const r = validatePluginManifest(raw, CORE);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    return r.manifest.code?.commands;
  };

  it('takes each kind of run, and defaults when to "project"', () => {
    expect(commandsOf(code([
      { id: 'sort', title: ' Sort List ', when: 'selection', editorMenu: true, run: { handler: 'sortSelection' } },
      { id: 'steel', title: 'Steelman', run: { skill: 'steelman' } },
      { id: 'q', title: 'Open Query', when: 'note', run: { query: 'queries/open.rq' } },
      { id: 'v', title: 'Show Queue', run: { view: 'queue' } },
    ]))).toEqual([
      { id: 'sort', title: 'Sort List', when: 'selection', editorMenu: true, run: { handler: 'sortSelection' } },
      { id: 'steel', title: 'Steelman', when: 'project', run: { skill: 'steelman' } },
      { id: 'q', title: 'Open Query', when: 'note', run: { query: 'queries/open.rq' } },
      { id: 'v', title: 'Show Queue', when: 'project', run: { view: 'queue' } },
    ]);
  });

  it('refuses a handler without code.worker, a view it does not declare, and a query outside its folder', () => {
    expect(problemsOf(code([{ id: 'a', title: 'A', run: { handler: 'go' } }], { worker: undefined }), CORE))
      .toEqual(['"code.commands[0].run.handler" needs "code.worker": a handler is a function in the plugin\'s logic module.']);
    expect(problemsOf(code([{ id: 'a', title: 'A', run: { view: 'other' } }]), CORE))
      .toEqual(['"code.commands[0].run.view" must be the id of one of the plugin\'s own views in "code.views"; got "other".']);
    expect(problemsOf(code([{ id: 'a', title: 'A', run: { query: '../x.rq' } }]), CORE))
      .toEqual(['"code.commands[0].run.query" must be a path inside the plugin\'s folder, like "views/queue.rq"; got "../x.rq".']);
  });

  it('refuses a run with no kind or two, an unknown when, a duplicate id, and an unknown field', () => {
    expect(problemsOf(code([{ id: 'a', title: 'A', run: { handler: 'go', skill: 'x' } }]), CORE))
      .toEqual(['"code.commands[0].run" must be an object with exactly one of "handler", "skill", "query", "view".']);
    expect(problemsOf(code([{ id: 'a', title: 'A', when: 'always', run: { skill: 'x' } }]), CORE))
      .toEqual(['"code.commands[0].when" must be one of project, note, selection; got "always".']);
    expect(problemsOf(code([{ id: 'a', title: 'A', run: { skill: 'x' } }, { id: 'a', title: 'B', run: { skill: 'y' } }]), CORE))
      .toEqual(['"code.commands" has two commands with the id "a".']);
    expect(problemsOf(code([{ id: 'a', title: 'A', key: 'Mod-k', run: { skill: 'x' } }]), CORE))
      .toEqual(['Unknown field "code.commands[0].key".']);
  });
});

describe('code.ingestors (#2647)', () => {
  const CORE = { ...CTX, core: true };
  const SRT = { id: 'transcript', label: 'Transcript', accepts: { extensions: ['.srt', '.vtt'] }, parse: { handler: 'parseTranscript' } };
  const code = (ingestors: unknown, extra: Record<string, unknown> = {}) => ({
    ...GOOD, code: { capabilities: ['notes:read'], api: '^1.10.0', worker: 'logic.js', ingestors, ...extra },
  });

  it('takes a file type read by a handler', () => {
    const r = validatePluginManifest(code([{ ...SRT, label: ' Transcript ' }]), CORE);
    expect(r.ok && r.manifest.code?.ingestors).toEqual([SRT]);
  });

  it('needs code.worker, a handler name and the extensions as written', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['notes:read'], api: '^1.10.0', ingestors: [SRT] } }, CORE))
      .toEqual(['"code.ingestors[0].parse.handler" needs "code.worker": a handler is a function in the plugin\'s logic module.']);
    expect(problemsOf(code([{ ...SRT, parse: { mcpTool: 'x/y' } }]), CORE))
      .toEqual(['"code.ingestors[0].parse" must be { "handler": name }, the name a handler registers with minerva.handle().']);
    expect(problemsOf(code([{ ...SRT, accepts: { extensions: ['SRT', '.a.b'] } }]), CORE)).toEqual([
      '"code.ingestors[0].accepts.extensions" names "SRT"; an extension is lowercase, with the dot, like ".srt".',
      '"code.ingestors[0].accepts.extensions" names ".a.b"; an extension is lowercase, with the dot, like ".srt".',
    ]);
  });

  it("refuses a type Minerva reads itself, one claimed twice, and a URL or identifier (that's MCP)", () => {
    expect(problemsOf(code([{ ...SRT, accepts: { extensions: ['.pdf', '.bib'] } }]), CORE)).toEqual([
      '"code.ingestors[0].accepts.extensions" names ".pdf", which Minerva reads itself.',
      '"code.ingestors[0].accepts.extensions" names ".bib", which Minerva reads itself.',
    ]);
    expect(problemsOf(code([SRT, { ...SRT, id: 'other', accepts: { extensions: ['.vtt'] } }]), CORE))
      .toEqual(['"code.ingestors" names ".vtt" twice.']);
    expect(problemsOf(code([{ ...SRT, accepts: { urlMatch: 'example.com' } }]), CORE))
      .toEqual(['"code.ingestors[0].accepts" can only name "extensions" for now: reading a URL or an identifier needs the network, so it\'s an MCP server\'s job.']);
  });
});

describe('code.exporters (#2648)', () => {
  const CORE = { ...CTX, core: true };
  const EPUB = { id: 'epub', label: 'EPUB', input: 'html', scopes: ['single-note', 'project'], write: { handler: 'writeEpub' } };
  const code = (exporters: unknown, extra: Record<string, unknown> = {}) => ({
    ...GOOD, code: { capabilities: ['notes:read'], api: '^1.10.0', worker: 'logic.js', exporters, ...extra },
  });

  it('takes a format written by a handler, scopes in the dialog\'s order', () => {
    const r = validatePluginManifest(code([{ ...EPUB, label: ' EPUB ', scopes: ['project', 'single-note'] }]), CORE);
    expect(r.ok && r.manifest.code?.exporters).toEqual([EPUB]);
  });

  it('needs code.worker, a handler, an input and known scopes', () => {
    expect(problemsOf({ ...GOOD, code: { capabilities: ['notes:read'], api: '^1.10.0', exporters: [EPUB] } }, CORE))
      .toEqual(['"code.exporters[0].write.handler" needs "code.worker": a handler is a function in the plugin\'s logic module.']);
    expect(problemsOf(code([{ ...EPUB, input: 'pdf', scopes: ['source'], write: { mcpTool: 'x/y' } }]), CORE)).toEqual([
      '"code.exporters[0].input" must be "html" or "markdown"; got "pdf".',
      '"code.exporters[0].scopes" must list what it exports, from single-note, folder, project, tree.',
      '"code.exporters[0].write" must be { "handler": name }, the name a handler registers with minerva.handle().',
    ]);
    expect(problemsOf(code([EPUB, EPUB]), CORE)).toEqual(['"code.exporters" has two exporters with the id "epub".']);
  });
});

describe('code.inspections (#2831)', () => {
  const CORE = { ...CTX, core: true };
  const CHECK = { id: 'skipped-heading', label: 'Skipped headings', description: 'Headings that jump a level.', severity: 'info', query: 'notes.rq', run: { handler: 'skippedHeadings' } };
  const code = (inspections: unknown, extra: Record<string, unknown> = {}) => ({
    ...GOOD, code: { capabilities: ['notes:read', 'graph:query'], api: '^1.10.0', worker: 'logic.js', inspections, ...extra },
  });

  it('takes a check run by a handler, with or without a query', () => {
    const { query: _q, ...noQuery } = CHECK;
    const r = validatePluginManifest(code([CHECK, { ...noQuery, id: 'other' }]), CORE);
    expect(r.ok && r.manifest.code?.inspections).toEqual([CHECK, { ...noQuery, id: 'other' }]);
  });

  it('needs code.worker, graph:query for a query, a severity, and an id a type can end in', () => {
    expect(problemsOf(code([CHECK], { worker: undefined }), CORE))
      .toEqual(['"code.inspections[0].run.handler" needs "code.worker": a handler is a function in the plugin\'s logic module.']);
    expect(problemsOf(code([CHECK], { capabilities: ['notes:read'] }), CORE))
      .toEqual(['"code.inspections[0].query" needs the "graph:query" capability, for what its query reads.']);
    expect(problemsOf(code([{ ...CHECK, id: '9lives', severity: 'fatal', query: 'notes.sql' }]), CORE)).toEqual([
      '"code.inspections[0].id" must be a letter, then letters, digits, "_" or "-" (at most 64), like "skipped-heading".',
      '"code.inspections[0].severity" must be one of info, warning, concern; got "fatal".',
      '"code.inspections[0].query" must be a SPARQL query, an .rq file; got "notes.sql".',
    ]);
  });
});
