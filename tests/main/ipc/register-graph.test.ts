/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-graph.ts` (#1840).
 *
 * The graph registrar is where the #1631 rules are most visible in one file: a
 * `withRootPath` throw (GRAPH_QUERY), a discriminated `{ ok: false }` failure
 * arm (TABLES_QUERY), plain empty-value fallbacks (alias/frontmatter/inspection
 * lists), and — in GRAPH_GROUND_CHECK — the one handler that deliberately
 * REJECTS instead of passing an in-band `error` off as "no matches". All four
 * are pinned here so a refactor can't quietly swap one for another.
 *
 * It also covers the rebase (#1443 B), whose ordering is load-bearing: the base
 * is persisted, then every index is rebuilt from files with `rebaseFrom` so old
 * IRIs are rewritten, and CSVs are registered before note tables.
 *
 * `withRootPath*` are re-implemented in the helpers mock with the real
 * semantics (helpers.ts drags in electron + graph/search/vectors, so it can't
 * be imported here); what's under test is WHICH wrapper each handler chose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  win: { id: 1, isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } },
  // electron / fs
  showSaveDialog: vi.fn(),
  copyFile: vi.fn(),
  // graph
  queryGraph: vi.fn(),
  setBaseUri: vi.fn(),
  graphIndexAllNotes: vi.fn(),
  schemaForCompletion: vi.fn(),
  getSourceDetail: vi.fn(),
  getExcerptSource: vi.fn(),
  getAliasMap: vi.fn(),
  getAliasEntries: vi.fn(),
  getAllFrontmatterKeys: vi.fn(),
  persistGraph: vi.fn(),
  // search / tables
  searchIndexAllNotes: vi.fn(),
  runQuery: vi.fn(),
  listTables: vi.fn(),
  registerAllCsvs: vi.fn(),
  registerAllNoteTables: vi.fn(),
  // health checks / settings
  getInspections: vi.fn(),
  runAllChecks: vi.fn(),
  getInspectionSettings: vi.fn(),
  saveInspectionSettings: vi.fn(),
  // project config / evidence
  patchProjectConfig: vi.fn(),
  readProjectConfig: vi.fn(),
  proposeExcerptEvidence: vi.fn(),
  // call-order log — the rebuild sequence is load-bearing
  order: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showSaveDialog: h.showSaveDialog },
}));

vi.mock('node:fs/promises', () => ({ default: { copyFile: h.copyFile }, copyFile: h.copyFile }));

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
  withRootPathWin:
    <A extends unknown[], R>(fn: (rootPath: string, win: unknown, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, h.win, ...args);
      },
}));

vi.mock('../../../src/main/graph/index', () => ({
  queryGraph: h.queryGraph,
  setBaseUri: h.setBaseUri,
  indexAllNotes: h.graphIndexAllNotes,
  schemaForCompletion: h.schemaForCompletion,
  getSourceDetail: h.getSourceDetail,
  getExcerptSource: h.getExcerptSource,
  getAliasMap: h.getAliasMap,
  getAliasEntries: h.getAliasEntries,
  getAllFrontmatterKeys: h.getAllFrontmatterKeys,
  persistGraph: h.persistGraph,
}));
vi.mock('../../../src/main/search/index', () => ({ indexAllNotes: h.searchIndexAllNotes }));
vi.mock('../../../src/main/sources/tables', () => ({
  runQuery: h.runQuery,
  listTables: h.listTables,
  registerAllCsvs: h.registerAllCsvs,
  registerAllNoteTables: h.registerAllNoteTables,
}));
vi.mock('../../../src/main/graph/health-checks', () => ({
  getInspections: h.getInspections,
  runAllChecks: h.runAllChecks,
}));
vi.mock('../../../src/main/config/inspection-settings', () => ({
  getInspectionSettings: h.getInspectionSettings,
  saveInspectionSettings: h.saveInspectionSettings,
}));
vi.mock('../../../src/main/project-config', () => ({
  patchProjectConfig: h.patchProjectConfig,
  readProjectConfig: h.readProjectConfig,
}));
vi.mock('../../../src/main/llm/attach-evidence', () => ({ proposeExcerptEvidence: h.proposeExcerptEvidence }));

import { registerGraph } from '../../../src/main/ipc/register-graph';
import { Channels } from '../../../src/shared/channels';

registerGraph();

const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!({}, ...args);
/** Await a handler's answer whether it replied synchronously or with a promise
 *  (the `withRootPathOr` fallbacks are returned synchronously). */
const callAsync = async (channel: string, ...args: unknown[]): Promise<unknown> => call(channel, ...args);
/** The ProjectContext the registrar builds from the root path. */
const CTX = { rootPath: ROOT, _brand: 'ProjectContext' };

beforeEach(() => {
  vi.resetAllMocks();
  openProject = ROOT;
  h.order.length = 0;
  h.win.isDestroyed.mockReturnValue(false);
  h.readProjectConfig.mockReturnValue({});
  h.queryGraph.mockResolvedValue({ results: [], columns: [] });
});

describe('register-graph — the #1631 project guard', () => {
  it('GRAPH_QUERY throws with no project rather than answering "no rows"', () => {
    // An empty result set would read as "your query matched nothing" — a
    // different, and wrong, answer to "there is no graph to query".
    openProject = null;
    expect(() => call(Channels.GRAPH_QUERY, 'SELECT * WHERE {}')).toThrow('No project open');
    expect(h.queryGraph).not.toHaveBeenCalled();
  });

  it('GRAPH_SET_BASE_URI throws with no project', () => {
    openProject = null;
    expect(() => call(Channels.GRAPH_SET_BASE_URI, 'https://example.org/kb/')).toThrow('No project open');
    expect(h.patchProjectConfig).not.toHaveBeenCalled();
  });

  it('TABLES_QUERY reports the failure on its discriminated union, not by rejecting', async () => {
    // Rule 3: the query panel renders `{ ok: false, error }` inline, so this
    // handler's contract is "never rejects" — including for "no project".
    openProject = null;
    await expect(callAsync(Channels.TABLES_QUERY, 'SELECT 1')).resolves.toEqual({
      ok: false, error: 'No project open',
    });
    expect(h.runQuery).not.toHaveBeenCalled();
  });

  it('GRAPH_ATTACH_EXCERPT_EVIDENCE reports "no project" on its union too', async () => {
    openProject = null;
    await expect(callAsync(Channels.GRAPH_ATTACH_EXCERPT_EVIDENCE, 'ex1', 'claim.md', 'grounds'))
      .resolves.toEqual({ ok: false, error: 'no project open' });
    expect(h.proposeExcerptEvidence).not.toHaveBeenCalled();
  });

  // Empty-value fallbacks: for each of these "no project" and "an empty
  // thoughtbase" render identically, so the fallback is a value, not an error.
  const emptyFallbacks: [string, unknown[], unknown][] = [
    [Channels.TABLES_LIST, [], []],
    [Channels.GRAPH_SCHEMA_FOR_COMPLETION, [], null],
    [Channels.GRAPH_ALIAS_MAP, [], {}],
    [Channels.GRAPH_ALIAS_ENTRIES, [], []],
    [Channels.GRAPH_FRONTMATTER_KEYS, [], []],
    [Channels.INSPECTIONS_LIST, [], []],
    [Channels.INSPECTIONS_RUN, [], []],
    [Channels.GRAPH_GROUND_CHECK, ['some claim'], []],
  ];

  it.each(emptyFallbacks)('%s answers with its empty value and no project', async (channel, args, expected) => {
    openProject = null;
    await expect(callAsync(channel, ...args)).resolves.toEqual(expected);
  });

  // #1894 — this used to be `withRootPathOr(undefined, …)`, so calling it with
  // no project silently resolved as if the export had happened.
  it('GRAPH_EXPORT throws with no project rather than silently doing nothing', () => {
    openProject = null;
    expect(() => call(Channels.GRAPH_EXPORT)).toThrow('No project open');
    expect(h.showSaveDialog).not.toHaveBeenCalled();
  });

  // NOT pinned here, deliberately: GRAPH_SOURCE_DETAIL / GRAPH_EXCERPT_SOURCE
  // return `null` for BOTH "no project" and "no such source" — the overloaded
  // sentinel CLAUDE.md's #1631 migration backlog already lists. Asserting it
  // would bless it; their with-project delegation is covered below instead.
});

describe('register-graph — queries and lookups', () => {
  it('GRAPH_QUERY passes the SPARQL straight through to the store', async () => {
    h.queryGraph.mockResolvedValue({ results: [{ s: 'x' }], columns: ['s'] });
    await expect(callAsync(Channels.GRAPH_QUERY, 'SELECT ?s WHERE {}'))
      .resolves.toEqual({ results: [{ s: 'x' }], columns: ['s'] });
    expect(h.queryGraph).toHaveBeenCalledWith(CTX, 'SELECT ?s WHERE {}');
  });

  it('TABLES_QUERY hands a bad-SQL failure back verbatim', async () => {
    // A user's malformed SQL is a normal input, not a bug — the union arm is
    // the answer, so nothing here should throw.
    h.runQuery.mockResolvedValue({ ok: false, error: 'Parser Error: syntax error' });
    await expect(callAsync(Channels.TABLES_QUERY, 'SELEKT 1'))
      .resolves.toEqual({ ok: false, error: 'Parser Error: syntax error' });
  });

  it('TABLES_LIST reports the registered tables', async () => {
    h.listTables.mockResolvedValue([{ name: 'notes' }]);
    await expect(callAsync(Channels.TABLES_LIST)).resolves.toEqual([{ name: 'notes' }]);
    expect(h.listTables).toHaveBeenCalledWith(CTX);
  });

  it('GRAPH_SOURCE_DETAIL delegates to the graph with a project open', async () => {
    h.getSourceDetail.mockReturnValue({ id: 's1', title: 'A Source' });
    expect(call(Channels.GRAPH_SOURCE_DETAIL, 's1')).toEqual({ id: 's1', title: 'A Source' });
    expect(h.getSourceDetail).toHaveBeenCalledWith(CTX, 's1');
  });

  it('GRAPH_EXCERPT_SOURCE delegates to the graph with a project open', () => {
    h.getExcerptSource.mockReturnValue('s1');
    expect(call(Channels.GRAPH_EXCERPT_SOURCE, 'ex1')).toBe('s1');
    expect(h.getExcerptSource).toHaveBeenCalledWith(CTX, 'ex1');
  });

  it('GRAPH_ATTACH_EXCERPT_EVIDENCE routes the role through to the proposal', async () => {
    h.proposeExcerptEvidence.mockResolvedValue({ ok: true, proposalId: 'p1' });
    await expect(callAsync(Channels.GRAPH_ATTACH_EXCERPT_EVIDENCE, 'ex1', 'claim.md', 'rebuts'))
      .resolves.toEqual({ ok: true, proposalId: 'p1' });
    expect(h.proposeExcerptEvidence).toHaveBeenCalledWith(ROOT, 'ex1', 'claim.md', 'rebuts');
  });
});

describe('register-graph — GRAPH_GROUND_CHECK (#1631 rule 1 in action)', () => {
  it('rejects when the engine reports an in-band error instead of returning "no matches"', async () => {
    // `queryGraph` reports failures in-band for its query-panel callers. This
    // handler has no such surface, so a dropped `error` would silently read as
    // "nothing grounds this claim" — the worst possible wrong answer here.
    h.queryGraph.mockResolvedValue({ results: [], columns: [], error: 'engine exploded' });
    await expect(callAsync(Channels.GRAPH_GROUND_CHECK, 'a claim'))
      .rejects.toThrow(/grounding query failed: engine exploded/);
  });

  it('returns the matched nodes when the query succeeds', async () => {
    const rows = [{ node: 'n1', label: 'Some Note', type: 'note' }];
    h.queryGraph.mockResolvedValue({ results: rows, columns: ['node', 'label', 'type'] });
    await expect(callAsync(Channels.GRAPH_GROUND_CHECK, 'Some')).resolves.toEqual(rows);
  });

  it('escapes quotes and newlines so the claim text cannot break out of the literal', async () => {
    await call(Channels.GRAPH_GROUND_CHECK, 'he said "hi"\nthen left');
    const sparql = h.queryGraph.mock.calls[0]![1] as string;
    expect(sparql).toContain('LCASE("he said \\"hi\\" then left")');
    // A raw quote would terminate the string literal and change the query.
    expect(sparql).not.toContain('"hi"');
  });
});

describe('register-graph — rebase to a new base IRI (#1443 B)', () => {
  const NEW_BASE = 'https://example.org/kb/';

  function trackOrder(): void {
    h.graphIndexAllNotes.mockImplementation(async () => { h.order.push('graph'); });
    h.searchIndexAllNotes.mockImplementation(async () => { h.order.push('search'); });
    h.registerAllCsvs.mockImplementation(async () => { h.order.push('csvs'); });
    h.registerAllNoteTables.mockImplementation(async () => { h.order.push('noteTables'); });
  }

  it('refuses an invalid base IRI without touching config or indexes', async () => {
    const result = await call(Channels.GRAPH_SET_BASE_URI, 'not-a-url');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('absolute http(s) URL') });
    expect(h.patchProjectConfig).not.toHaveBeenCalled();
    expect(h.setBaseUri).not.toHaveBeenCalled();
    expect(h.graphIndexAllNotes).not.toHaveBeenCalled();
  });

  it('persists the new base, then rebuilds every index from the files', async () => {
    h.readProjectConfig.mockReturnValue({ baseUri: 'https://old.example/kb/' });
    trackOrder();

    await expect(callAsync(Channels.GRAPH_SET_BASE_URI, NEW_BASE)).resolves.toEqual({ ok: true });

    expect(h.patchProjectConfig).toHaveBeenCalledWith(ROOT, { baseUri: NEW_BASE });
    expect(h.setBaseUri).toHaveBeenCalledWith(CTX, NEW_BASE);
    // Proposals aren't file-derived, so the OLD base has to be handed to the
    // rebuild for their IRIs + payload turtle to be rewritten old→new.
    expect(h.graphIndexAllNotes).toHaveBeenCalledWith(CTX, { rebaseFrom: 'https://old.example/kb/' });
    // CSVs before note tables, both after the store reset, so the schema
    // triples survive the rebuild (#1358).
    expect(h.order).toEqual(['graph', 'search', 'csvs', 'noteTables']);
  });

  it('omits rebaseFrom entirely when the thoughtbase had no base IRI yet', async () => {
    h.readProjectConfig.mockReturnValue({});
    await call(Channels.GRAPH_SET_BASE_URI, NEW_BASE);
    expect(h.graphIndexAllNotes).toHaveBeenCalledWith(CTX, undefined);
  });

  it('trims the submitted IRI before storing it', async () => {
    await call(Channels.GRAPH_SET_BASE_URI, '  https://example.org/kb/  ');
    expect(h.patchProjectConfig).toHaveBeenCalledWith(ROOT, { baseUri: NEW_BASE });
  });

  it('tells the window its tables changed once the rebuild lands', async () => {
    await call(Channels.GRAPH_SET_BASE_URI, NEW_BASE);
    expect(h.win.webContents.send).toHaveBeenCalledWith(Channels.TABLES_CHANGED);
  });

  it('skips the broadcast when the window closed mid-rebuild', async () => {
    h.win.isDestroyed.mockReturnValue(true);
    await expect(callAsync(Channels.GRAPH_SET_BASE_URI, NEW_BASE)).resolves.toEqual({ ok: true });
    expect(h.win.webContents.send).not.toHaveBeenCalled();
  });
});

describe('register-graph — inspections', () => {
  it('INSPECTIONS_LIST returns the cached results', async () => {
    h.getInspections.mockReturnValue([{ id: 'orphans', hits: [] }]);
    await expect(callAsync(Channels.INSPECTIONS_LIST)).resolves.toEqual([{ id: 'orphans', hits: [] }]);
  });

  it('INSPECTIONS_RUN runs the checks under the current settings', async () => {
    const settings = { enabled: ['orphans'], staleDays: 90 };
    h.getInspectionSettings.mockResolvedValue(settings);
    h.runAllChecks.mockResolvedValue([{ id: 'orphans', hits: ['a.md'] }]);

    await expect(callAsync(Channels.INSPECTIONS_RUN)).resolves.toEqual([{ id: 'orphans', hits: ['a.md'] }]);
    expect(h.runAllChecks).toHaveBeenCalledWith(CTX, settings);
  });

  it('INSPECTIONS_GET_SETTINGS works with no project — the prefs are per-machine', async () => {
    // The Settings dialog is reachable from an empty window (#1792), so this
    // handler deliberately takes no rootPath.
    openProject = null;
    h.getInspectionSettings.mockResolvedValue({ enabled: [], staleDays: 90 });
    await expect(callAsync(Channels.INSPECTIONS_GET_SETTINGS)).resolves.toEqual({ enabled: [], staleDays: 90 });
  });

  it('INSPECTIONS_SET_SETTINGS returns what actually landed, not what was asked for', async () => {
    const asked = { enabled: ['orphans', 'bogus-id'], staleDays: 0 };
    const stored = { enabled: ['orphans'], staleDays: 1 };
    h.getInspectionSettings.mockResolvedValue(stored);

    // Saving clamps the day values and drops ids the panel can't offer, so the
    // caller must not keep displaying its own input.
    await expect(callAsync(Channels.INSPECTIONS_SET_SETTINGS, asked)).resolves.toEqual(stored);
    expect(h.saveInspectionSettings).toHaveBeenCalledWith(asked);
  });
});

describe('register-graph — GRAPH_EXPORT', () => {
  it('flushes the graph to disk before copying the snapshot out', async () => {
    // graph.ttl is a cold snapshot — copying without persisting first would
    // export a stale file missing everything since the last flush.
    h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/out/graph.ttl' });
    h.persistGraph.mockImplementation(async () => { h.order.push('persist'); });
    h.copyFile.mockImplementation(async () => { h.order.push('copy'); });

    await call(Channels.GRAPH_EXPORT);

    expect(h.order).toEqual(['persist', 'copy']);
    expect(h.copyFile).toHaveBeenCalledWith('/vault/.minerva/graph.ttl', '/out/graph.ttl');
  });

  it('writes nothing when the Save panel is cancelled', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await call(Channels.GRAPH_EXPORT);
    expect(h.persistGraph).not.toHaveBeenCalled();
    expect(h.copyFile).not.toHaveBeenCalled();
  });

  it('writes nothing when the panel returns no path', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '' });
    await call(Channels.GRAPH_EXPORT);
    expect(h.copyFile).not.toHaveBeenCalled();
  });
});
