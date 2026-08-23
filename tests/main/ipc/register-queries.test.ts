/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-queries.ts` (#1840).
 *
 * Saved queries are the one family in the IPC layer that is deliberately NOT
 * project-scoped: a query can live in the thoughtbase (`project` scope) or on
 * the machine (`global` scope), and the global ones have to be listable,
 * renamable and reorderable with no project open at all. That's why these
 * handlers reach for `rootPathFromEvent` directly instead of `withRootPath*` —
 * `rootPath` is an *input* to the scope decision, not a precondition. This
 * file pins that reading, and the two consequences that fall out of it:
 *
 *   - with no project open, `QUERIES_LIST` still answers the global queries,
 *     and every non-scoped mutation still works;
 *   - `QUERIES_MOVE` into project scope with no project open THROWS rather
 *     than quietly landing the query somewhere else (#1631 rule 1).
 *
 * Plus the bookkeeping the native menu depends on: every mutation rebuilds the
 * Query menu, and only after the store agreed the change happened. `SEARCH_QUERY`
 * is the one `withRootPathOr` handler here — an empty result list is what a
 * search with nothing to search returns, so the fallback is a legitimate value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  /** Call-order log — the menu rebuild must follow the store mutation. */
  const order: string[] = [];
  return {
    handlers: new Map<string, Handler>(),
    order,
    /** Wrap a store fn so its call lands in the order log before its result. */
    logged: (name: string, fn: (...a: unknown[]) => unknown) =>
      (...a: unknown[]) => { order.push(name); return fn(...a); },
    listSavedQueries: vi.fn(),
    saveQuery: vi.fn(),
    deleteQuery: vi.fn(),
    renameQuery: vi.fn(),
    moveQueryScope: vi.fn(),
    setQueryGroup: vi.fn(),
    setQueryOrder: vi.fn(),
    rebuildMenu: vi.fn(),
    search: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  rootPathFromEvent: () => openProject,
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
}));

vi.mock('../../../src/main/saved-queries', () => ({
  listSavedQueries: h.listSavedQueries,
  saveQuery: h.logged('saveQuery', h.saveQuery),
  deleteQuery: h.logged('deleteQuery', h.deleteQuery),
  renameQuery: h.logged('renameQuery', h.renameQuery),
  moveQueryScope: h.logged('moveQueryScope', h.moveQueryScope),
  setQueryGroup: h.logged('setQueryGroup', h.setQueryGroup),
  setQueryOrder: h.logged('setQueryOrder', h.setQueryOrder),
}));
vi.mock('../../../src/main/menu', () => ({
  rebuildMenu: (...a: unknown[]) => { h.order.push('rebuildMenu'); return h.rebuildMenu(...a); },
}));
vi.mock('../../../src/main/search/index', () => ({ search: h.search }));
vi.mock('../../../src/main/project-context-types', () => ({
  projectContext: (rootPath: string) => ({ rootPath }),
}));

import { registerQueries } from '../../../src/main/ipc/register-queries';
import { Channels } from '../../../src/shared/channels';

registerQueries();

const call = (channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args);

const GLOBAL_QUERY = {
  id: 'orphans', name: 'Orphans', description: '', query: 'SELECT *', language: 'sparql',
  scope: 'global', filePath: '/home/u/.minerva/queries/orphans.sparql', group: null, order: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  openProject = ROOT;
});

describe('QUERIES_LIST', () => {
  it('lists project + global queries when a thoughtbase is open', () => {
    h.listSavedQueries.mockReturnValue([GLOBAL_QUERY]);
    expect(call(Channels.QUERIES_LIST)).toEqual([GLOBAL_QUERY]);
    expect(h.listSavedQueries).toHaveBeenCalledWith(ROOT);
  });

  it('still answers the global queries with no project open', () => {
    // `rootPath` is an input to the scope decision here, not a precondition:
    // the store takes `string | null` and simply skips the project directory.
    // A `withRootPath` guard would have hidden the user's machine-wide queries
    // whenever they closed a thoughtbase.
    openProject = null;
    h.listSavedQueries.mockReturnValue([GLOBAL_QUERY]);

    expect(call(Channels.QUERIES_LIST)).toEqual([GLOBAL_QUERY]);
    expect(h.listSavedQueries).toHaveBeenCalledWith(null);
  });
});

describe('QUERIES_SAVE', () => {
  it('saves, then rebuilds the Query menu', () => {
    h.saveQuery.mockReturnValue(GLOBAL_QUERY);

    const result = call(Channels.QUERIES_SAVE, 'project', 'Orphans', 'Notes nobody links to', 'SELECT *', 'sparql', 'Health');

    expect(result).toEqual(GLOBAL_QUERY);
    expect(h.saveQuery).toHaveBeenCalledWith(ROOT, 'project', 'Orphans', 'Notes nobody links to', 'SELECT *', 'sparql', 'Health');
    // Rebuilding first would put an entry on the menu for a file that might
    // not have been written.
    expect(h.order).toEqual(['saveQuery', 'rebuildMenu']);
  });

  it('recognises exactly one language besides SPARQL', () => {
    h.saveQuery.mockReturnValue(GLOBAL_QUERY);

    call(Channels.QUERIES_SAVE, 'global', 'Rows', '', 'SELECT 1', 'sql');
    expect(h.saveQuery).toHaveBeenLastCalledWith(ROOT, 'global', 'Rows', '', 'SELECT 1', 'sql', null);

    // Anything unrecognised lands on SPARQL rather than reaching the store as a
    // language it has no file extension for.
    call(Channels.QUERIES_SAVE, 'global', 'Rows', '', 'SELECT 1', 'duckdb');
    expect(h.saveQuery).toHaveBeenLastCalledWith(ROOT, 'global', 'Rows', '', 'SELECT 1', 'sparql', null);
  });

  it('defaults the group to null when the caller omits it', () => {
    h.saveQuery.mockReturnValue(GLOBAL_QUERY);
    call(Channels.QUERIES_SAVE, 'global', 'Rows', '', 'SELECT 1', 'sparql');
    // `null` = ungrouped, and it has to be explicit: `undefined` would serialize
    // an `@group` line reading "undefined".
    expect(h.saveQuery).toHaveBeenCalledWith(ROOT, 'global', 'Rows', '', 'SELECT 1', 'sparql', null);
  });

  it('leaves the menu alone when the save failed', () => {
    h.saveQuery.mockImplementation(() => { throw new Error('EACCES: permission denied'); });
    expect(() => call(Channels.QUERIES_SAVE, 'global', 'Rows', '', 'SELECT 1', 'sparql')).toThrow(/EACCES/);
    expect(h.rebuildMenu).not.toHaveBeenCalled();
  });
});

describe('the file-addressed mutations work with or without a project', () => {
  it('QUERIES_DELETE removes the query and rebuilds the menu', () => {
    call(Channels.QUERIES_DELETE, GLOBAL_QUERY.filePath);
    expect(h.deleteQuery).toHaveBeenCalledWith(GLOBAL_QUERY.filePath);
    expect(h.order).toEqual(['deleteQuery', 'rebuildMenu']);
  });

  it('QUERIES_RENAME returns the new path and rebuilds the menu', () => {
    h.renameQuery.mockReturnValue('/home/u/.minerva/queries/lonely-notes.sparql');

    const result = call(Channels.QUERIES_RENAME, GLOBAL_QUERY.filePath, 'Lonely notes');

    expect(result).toBe('/home/u/.minerva/queries/lonely-notes.sparql');
    expect(h.order).toEqual(['renameQuery', 'rebuildMenu']);
  });

  it('QUERIES_RENAME propagates a failed rename and leaves the menu alone', () => {
    h.renameQuery.mockImplementation(() => { throw new Error('ENOENT: no such file'); });
    expect(() => call(Channels.QUERIES_RENAME, '/gone.sparql', 'New')).toThrow(/ENOENT/);
    expect(h.rebuildMenu).not.toHaveBeenCalled();
  });

  it('QUERIES_SET_GROUP sets a group and clears it with null', () => {
    call(Channels.QUERIES_SET_GROUP, GLOBAL_QUERY.filePath, 'Health');
    expect(h.setQueryGroup).toHaveBeenCalledWith(GLOBAL_QUERY.filePath, 'Health');

    call(Channels.QUERIES_SET_GROUP, GLOBAL_QUERY.filePath, null);
    expect(h.setQueryGroup).toHaveBeenLastCalledWith(GLOBAL_QUERY.filePath, null);
    expect(h.rebuildMenu).toHaveBeenCalledTimes(2);
  });

  it('QUERIES_SET_ORDER writes the whole ordering in one call', () => {
    const entries = [{ filePath: '/a.sparql', order: 0 }, { filePath: '/b.sparql', order: null }];
    call(Channels.QUERIES_SET_ORDER, entries);
    expect(h.setQueryOrder).toHaveBeenCalledWith(entries);
    expect(h.order).toEqual(['setQueryOrder', 'rebuildMenu']);
  });

  it.each([
    [Channels.QUERIES_DELETE, ['/g.sparql']],
    [Channels.QUERIES_SET_GROUP, ['/g.sparql', 'Health']],
    [Channels.QUERIES_SET_ORDER, [[]]],
  ])('%s still works on a global query with no project open', (channel, args) => {
    openProject = null;
    expect(() => call(channel, ...args)).not.toThrow();
    expect(h.rebuildMenu).toHaveBeenCalled();
  });
});

describe('QUERIES_MOVE', () => {
  it('hands the open project to the store as the destination root', () => {
    h.moveQueryScope.mockReturnValue('/vault/.minerva/queries/orphans.sparql');

    const result = call(Channels.QUERIES_MOVE, GLOBAL_QUERY.filePath, 'project');

    expect(result).toBe('/vault/.minerva/queries/orphans.sparql');
    expect(h.moveQueryScope).toHaveBeenCalledWith(GLOBAL_QUERY.filePath, 'project', ROOT);
    expect(h.order).toEqual(['moveQueryScope', 'rebuildMenu']);
  });

  it('moves a project query out to global scope', () => {
    h.moveQueryScope.mockReturnValue('/home/u/.minerva/queries/orphans.sparql');
    call(Channels.QUERIES_MOVE, '/vault/.minerva/queries/orphans.sparql', 'global');
    expect(h.moveQueryScope).toHaveBeenCalledWith('/vault/.minerva/queries/orphans.sparql', 'global', ROOT);
  });

  it('throws when asked to move into a thoughtbase that is not open', () => {
    // The store refuses this rather than silently writing to the global dir, and
    // the handler lets the throw reach the renderer (#1631 rule 1) instead of
    // reporting a path the query isn't at.
    openProject = null;
    h.moveQueryScope.mockImplementation(() => { throw new Error('Cannot move to Thoughtbase scope: no project open.'); });

    expect(() => call(Channels.QUERIES_MOVE, GLOBAL_QUERY.filePath, 'project')).toThrow(/no project open/i);
    expect(h.moveQueryScope).toHaveBeenCalledWith(GLOBAL_QUERY.filePath, 'project', null);
    expect(h.rebuildMenu).not.toHaveBeenCalled();
  });
});

describe('SEARCH_QUERY', () => {
  it('searches the open project\'s index', async () => {
    const hits = [{ path: 'notes/paxos.md', title: 'Paxos', excerpt: '…consensus…' }];
    h.search.mockResolvedValue(hits);

    await expect(call(Channels.SEARCH_QUERY, 'consensus')).resolves.toEqual(hits);
    expect(h.search).toHaveBeenCalledWith({ rootPath: ROOT }, 'consensus');
  });

  it('answers an empty result list with no project open', async () => {
    openProject = null;
    // `withRootPathOr([], …)`: "no notes matched" is what a search over nothing
    // means, so the fallback reads the same as a genuine miss — the results
    // pane shows "no results", not an error.
    await expect(call(Channels.SEARCH_QUERY, 'consensus')).resolves.toEqual([]);
    expect(h.search).not.toHaveBeenCalled();
  });

  it('is the same empty answer a project with no matches gives', async () => {
    h.search.mockResolvedValue([]);
    const noMatches = await call(Channels.SEARCH_QUERY, 'zzzz');

    openProject = null;
    const noProject = await call(Channels.SEARCH_QUERY, 'zzzz');

    expect(noProject).toEqual(noMatches);
  });
});
