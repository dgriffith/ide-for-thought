/**
 * A global view's session (#2640): main reads the query the view declares,
 * runs it, and scopes the session to exactly the notes its rows name — the
 * renderer only asks for a re-run, and never says which notes.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginIdentity } from '../../src/main/plugins/broker';
import type { PluginBlock, PluginView } from '../../src/shared/plugins/format';
import type { GraphQueryResult } from '../../src/shared/graph-query';
import { silenceLogTags } from '../helpers/quiet-logs';

silenceLogTags('plugins');

class FakePort extends EventEmitter {
  other: FakePort | null = null;
  closed = false;
  postMessage(data: unknown) { this.other?.emit('message', { data }); }
  start() {}
  close() { if (this.closed) return; this.closed = true; this.emit('close'); this.other?.close(); }
}

const h = vi.hoisted(() => ({
  identity: null as PluginIdentity | null,
  views: [] as PluginView[],
  blocks: [] as PluginBlock[],
  folder: '',
  queries: [] as string[],
  answer: null as null | (() => Promise<GraphQueryResult>),
}));

vi.mock('electron', () => ({
  MessageChannelMain: class {
    port1 = new FakePort();
    port2 = new FakePort();
    constructor() { this.port1.other = this.port2; this.port2.other = this.port1; }
  },
  clipboard: { writeText: () => {} },
  Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
  BrowserWindow: class {},
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({ codePluginIdentity: () => h.identity, codePluginViews: () => h.views, codePluginBlocks: () => h.blocks }));
vi.mock('../../src/main/plugins/frame-files', () => ({
  pluginFrameRoot: async () => h.folder,
  // The real containment is `frame-files.test.ts`'s; here, a file in the folder or nothing.
  resolvePluginFrameFile: async (url: string) => {
    const file = path.join(h.folder, new URL(url).pathname.slice(1));
    return fs.existsSync(file) ? file : null;
  },
}));
vi.mock('../../src/main/window-manager', () => ({ getRootPath: (id: number) => (id === 1 ? '/tb' : null) }));
vi.mock('../../src/main/ipc/helpers', () => ({ hooks: {} }));
vi.mock('../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: async () => {} }));
vi.mock('../../src/main/history', () => ({ runWithHistorySource: async (_s: unknown, fn: () => Promise<unknown>) => fn() }));
vi.mock('../../src/main/notebase/fs', () => ({ readFile: async () => '# A\n', fileExists: async () => true }));
vi.mock('../../src/main/graph', () => ({
  queryGraph: async (_ctx: unknown, sparql: string) => { h.queries.push(sparql); return h.answer!(); },
  // Notes are `https://tb/note/<path>`; anything else isn't one.
  notePathsForIris: (_ctx: unknown, iris: Iterable<string>) => new Map([...iris]
    .filter((i) => i.startsWith('https://tb/note/'))
    .map((i) => [i, i.slice('https://tb/note/'.length)] as const)),
}));
vi.mock('../../src/main/sources/tables', () => ({ runPluginQuery: async () => ({ ok: true, columns: [], rows: [] }) }));
vi.mock('../../src/main/project-context-types', () => ({ projectContext: (root: string) => ({ rootPath: root }) }));
vi.mock('../../src/main/path-containment', () => ({
  agentPathRefusal: (_root: string, rel: string) => (rel.startsWith('.minerva') ? 'hidden' : null),
  lexicalAgentPathRefusal: (rel: string) => (rel.startsWith('.minerva') ? 'hidden' : null),
}));

import { openPluginSession, sendPluginSessionEvent, setPluginSessionScope } from '../../src/main/plugin-sessions';

const QUEUE: PluginIdentity = { id: 'queue', name: 'Queue', version: '1.0.0', capabilities: ['graph:query', 'notes:read', 'ui'] };
const VIEW: PluginView = { id: 'list', title: 'Queue', place: 'left-sidebar', entry: 'index.html', query: 'list.rq' };
const SPARQL = 'SELECT ?note ?title WHERE { ?note dc:title ?title }';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-view-session-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function rows(...r: Array<Record<string, string>>): () => Promise<GraphQueryResult> {
  return async () => ({ ok: true, columns: ['note', 'title'], results: r });
}

function fakeWindow() {
  const posted: Array<{ ports: FakePort[] }> = [];
  const events = new EventEmitter();
  const win = {
    id: 1,
    isDestroyed: () => false,
    once: (e: string, fn: () => void) => events.once(e, fn),
    webContents: { postMessage: (_c: string, _m: unknown, ports: FakePort[]) => { posted.push({ ports }); }, send: () => {} },
  };
  return { win: win as unknown as Electron.BrowserWindow, posted, close: () => events.emit('closed') };
}

/** The plugin's end: its events, and calls. */
function pluginEnd(port: FakePort) {
  const messages: Array<{ id?: number; event?: string; data?: unknown; result?: unknown; error?: { code: string } }> = [];
  port.on('message', (e: { data: string }) => messages.push(JSON.parse(e.data)));
  let next = 1;
  return {
    events: (name: string) => messages.filter((m) => m.event === name).map((m) => m.data),
    call: async (method: string, params?: unknown) => {
      const id = next++;
      port.postMessage(JSON.stringify({ id, method, params }));
      await vi.waitFor(() => { if (!messages.some((m) => m.id === id)) throw new Error('no answer'); });
      return messages.find((m) => m.id === id)!;
    },
  };
}

beforeEach(() => {
  h.identity = QUEUE;
  h.views = [VIEW];
  h.blocks = [];
  h.folder = tmp;
  h.queries = [];
  fs.writeFileSync(path.join(tmp, 'list.rq'), SPARQL);
  h.answer = rows(
    { note: 'https://tb/note/a.md', title: 'A' },
    { note: 'https://tb/note/.minerva/secrets.json', title: 'Hidden' },
    { note: 'https://elsewhere/x', title: 'Not a note' },
  );
});

describe('a global view session (#2640)', () => {
  it("runs the view's own query and scopes the session to the notes it names, whatever scope was sent", async () => {
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', ['smuggled.md'], { view: 'list' });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    expect((await plugin.call('notes.list')).result).toEqual({ paths: [] });

    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('query')).toHaveLength(1));
    expect(h.queries).toEqual([SPARQL]);
    expect(plugin.events('query')[0]).toEqual({
      columns: ['note', 'title'],
      rows: [
        { note: 'https://tb/note/a.md', title: 'A' },
        { note: 'https://tb/note/.minerva/secrets.json', title: 'Hidden' },
        { note: 'https://elsewhere/x', title: 'Not a note' },
      ],
      // A hidden note isn't the plugin's to name, though the row stays.
      notes: { 'https://tb/note/a.md': 'a.md' },
      truncated: false,
      error: null,
    });
    expect((await plugin.call('notes.list')).result).toEqual({ paths: ['a.md'] });
    expect((await plugin.call('notes.read', { path: 'smuggled.md' })).error?.code).toBe('scope');
    w.close();
  });

  it('follows the graph: a re-run replaces the scope', async () => {
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', [], { view: 'list' });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('query')).toHaveLength(1));
    h.answer = rows({ note: 'https://tb/note/b.md', title: 'B' });
    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('query')).toHaveLength(2));
    expect((await plugin.call('notes.list')).result).toEqual({ paths: ['b.md'] });
    w.close();
  });

  it('drops a slower earlier run that answers after a later one', async () => {
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', [], { view: 'list' });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.answer = async () => { await gate; return rows({ note: 'https://tb/note/old.md', title: 'Old' })(); };
    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    h.answer = rows({ note: 'https://tb/note/new.md', title: 'New' });
    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('query')).toHaveLength(1));
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(plugin.events('query')).toHaveLength(1);
    expect((await plugin.call('notes.list')).result).toEqual({ paths: ['new.md'] });
    w.close();
  });

  it("sends a failed query as the plugin's to show, with nothing in scope", async () => {
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', [], { view: 'list' });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    h.answer = async () => ({ ok: false, error: 'Parse error on line 1' });
    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('query')).toHaveLength(1));
    expect(plugin.events('query')[0]).toEqual({ columns: [], rows: [], notes: {}, truncated: false, error: 'Parse error on line 1' });
    w.close();
  });

  it("says so, without main's paths, when the query file is missing", async () => {
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', [], { view: 'list' });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    fs.rmSync(path.join(tmp, 'list.rq'));
    sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('query')).toHaveLength(1));
    expect((plugin.events('query')[0] as { error: string }).error).toBe("The view's query couldn't run; the details are in Minerva's log.");
    expect(h.queries).toEqual([]);
    w.close();
  });

  it('refuses a view the plugin does not declare', () => {
    expect(() => openPluginSession(fakeWindow().win, 'queue', [], { view: 'other' })).toThrow('Queue has no view "other"');
  });

  it("won't take a scope from the renderer, and only a view or block session runs a query", async () => {
    const w = fakeWindow();
    const view = openPluginSession(w.win, 'queue', [], { view: 'list' });
    expect(() => setPluginSessionScope(w.win, view.sessionId, ['a.md'])).toThrow("A global view's scope is Minerva's to set");
    const plain = openPluginSession(w.win, 'queue', ['a.md']);
    await expect(sendPluginSessionEvent(w.win, plain.sessionId, { kind: 'refreshQuery' })).rejects.toThrow('Only a global view or a live block runs a query');
    w.close();
  });
});

describe('a live block session (#2641)', () => {
  const BLOCK: PluginBlock = { id: 'card', title: 'Card', fence: 'card', entry: 'index.html', query: 'list.rq' };
  const BLOCK_NO_QUERY: PluginBlock = { id: 'card', title: 'Card', fence: 'card', entry: 'index.html' };

  it('is scoped to the note it sits in plus the notes its query names, and hears all three as block', async () => {
    h.blocks = [BLOCK];
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', ['smuggled.md'], { block: 'card', notePath: 'notes/here.md', source: 'limit: 3\n', exportMode: true });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    expect((await plugin.call('notes.list')).result).toEqual({ paths: [] });
    await sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    // Awaited: the block is sent by the time the refresh answers, so an export request can follow it.
    await vi.waitFor(() => expect(plugin.events('block')).toHaveLength(1));
    expect(plugin.events('block')[0]).toEqual({
      block: 'card', source: 'limit: 3\n', notePath: 'notes/here.md', exportMode: true,
      query: expect.objectContaining({ notes: { 'https://tb/note/a.md': 'a.md' }, error: null }),
    });
    expect((await plugin.call('notes.list')).result).toEqual({ paths: ['a.md', 'notes/here.md'] });
    expect(plugin.events('query')).toEqual([]);
    w.close();
  });

  it('with no query of its own, it reaches only its note, and its query is null', async () => {
    h.blocks = [BLOCK_NO_QUERY];
    const w = fakeWindow();
    const { sessionId } = openPluginSession(w.win, 'queue', [], { block: 'card', notePath: 'here.md', source: '' });
    const plugin = pluginEnd(w.posted[0]!.ports[0]!);
    await sendPluginSessionEvent(w.win, sessionId, { kind: 'refreshQuery' });
    await vi.waitFor(() => expect(plugin.events('block')).toHaveLength(1));
    expect(plugin.events('block')[0]).toEqual({ block: 'card', source: '', notePath: 'here.md', exportMode: false, query: null });
    expect(h.queries).toEqual([]);
    expect((await plugin.call('notes.list')).result).toEqual({ paths: ['here.md'] });
    w.close();
  });

  it("refuses a block the plugin doesn't declare, and the renderer can't rescope one", () => {
    h.blocks = [BLOCK];
    const w = fakeWindow();
    expect(() => openPluginSession(w.win, 'queue', [], { block: 'other', notePath: 'a.md', source: '' })).toThrow('Queue has no block "other"');
    const { sessionId } = openPluginSession(w.win, 'queue', [], { block: 'card', notePath: 'a.md', source: '' });
    expect(() => setPluginSessionScope(w.win, sessionId, ['b.md'])).toThrow("A live block's scope is Minerva's to set");
    w.close();
  });
});
