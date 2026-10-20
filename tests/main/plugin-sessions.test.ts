/**
 * Plugin sessions wired to the running app (#2825): who may open one, where
 * its port goes, and when it ends — with the window, the thoughtbase, the
 * plugin's version, or the plugin itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { PluginIdentity } from '../../src/main/plugins/broker';

class FakePort extends EventEmitter {
  other: FakePort | null = null;
  closed = false;
  postMessage(data: unknown) { this.other?.emit('message', { data }); }
  start() {}
  close() { if (this.closed) return; this.closed = true; this.emit('close'); this.other?.close(); }
}

const h = vi.hoisted(() => ({
  identity: null as PluginIdentity | null,
  roots: new Map<number, string>(),
  written: [] as Array<{ rel: string; source: unknown }>,
  copied: [] as string[],
  menus: [] as string[][],
  pick: null as string | null,
}));

vi.mock('electron', () => ({
  MessageChannelMain: class {
    port1 = new FakePort();
    port2 = new FakePort();
    constructor() { this.port1.other = this.port2; this.port2.other = this.port1; }
  },
  clipboard: { writeText: (t: string) => { h.copied.push(t); } },
  Menu: {
    buildFromTemplate: (template: Array<{ label?: string; click?: () => void; type?: string; enabled?: boolean }>) => ({
      popup: ({ callback }: { callback: () => void }) => {
        h.menus.push(template.map((t) => (t.type === 'separator' ? '---' : `${t.label}${t.enabled === false ? ' (off)' : ''}`)));
        template.find((t) => t.label === h.pick)?.click?.();
        callback();
      },
    }),
  },
  BrowserWindow: class {},
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({ codePluginIdentity: () => h.identity }));
vi.mock('../../src/main/window-manager', () => ({ getRootPath: (id: number) => h.roots.get(id) ?? null }));
vi.mock('../../src/main/ipc/helpers', () => ({ hooks: {} }));
vi.mock('../../src/main/notebase/write-pipeline', () => ({
  writeAndReindex: async (_root: string, rel: string) => { h.written.push({ rel, source: currentSource }); },
}));
let currentSource: unknown = null;
vi.mock('../../src/main/history', () => ({
  runWithHistorySource: async (source: unknown, fn: () => Promise<unknown>) => { currentSource = source; try { return await fn(); } finally { currentSource = null; } },
}));
vi.mock('../../src/main/notebase/fs', () => ({
  readFile: async () => '# A\n',
  fileExists: async () => true,
}));
vi.mock('../../src/main/graph', () => ({ queryGraph: async () => ({ ok: true, columns: [], results: [] }) }));
vi.mock('../../src/main/sources/tables', () => ({ runPluginQuery: async () => ({ ok: true, columns: [], rows: [] }) }));
vi.mock('../../src/main/project-context-types', () => ({ projectContext: (root: string) => ({ rootPath: root }) }));
vi.mock('../../src/main/path-containment', () => ({
  agentPathRefusal: (_root: string, rel: string) => (rel.startsWith('.minerva') ? 'hidden' : null),
  lexicalAgentPathRefusal: (rel: string) => (rel.startsWith('.minerva') ? 'hidden' : null),
}));

import {
  closePluginSession,
  closeStalePluginSessions,
  openPluginSession,
  sendPluginSessionEvent,
  setPluginSessionScope,
  _pluginSessionCountForTests,
} from '../../src/main/plugin-sessions';
import { Channels } from '../../src/shared/channels';

const BOARD: PluginIdentity = { id: 'board', name: 'Board', version: '1.0.0', capabilities: ['notes:read', 'notes:write', 'ui'] };

function fakeWindow(id: number) {
  const posted: Array<{ channel: string; msg: unknown; ports: FakePort[] }> = [];
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const events = new EventEmitter();
  let destroyed = false;
  const win = {
    id,
    isDestroyed: () => destroyed,
    once: (e: string, fn: () => void) => events.once(e, fn),
    webContents: {
      postMessage: (channel: string, msg: unknown, ports: FakePort[]) => { posted.push({ channel, msg, ports }); },
      send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
    },
  };
  return { win: win as unknown as Electron.BrowserWindow, posted, sent, closeWindow: () => { destroyed = true; events.emit('closed'); } };
}

/** The plugin's end of the session, as a request/answer helper. */
function pluginEnd(port: FakePort) {
  const answers: Array<{ id: number; result?: unknown; error?: { code: string; message: string } }> = [];
  port.on('message', (e: { data: string }) => answers.push(JSON.parse(e.data)));
  let next = 1;
  return async (method: string, params?: unknown) => {
    const id = next++;
    port.postMessage(JSON.stringify({ id, method, params }));
    await vi.waitFor(() => { if (!answers.some((a) => a.id === id)) throw new Error('no answer'); });
    return answers.find((a) => a.id === id)!;
  };
}

beforeEach(() => {
  h.identity = BOARD;
  h.roots = new Map([[1, '/tb'], [2, '/other']]);
  h.written = [];
  h.copied = [];
});

describe('openPluginSession (#2825)', () => {
  it('posts the port to the window, and the plugin talks to the broker over it', async () => {
    const w = fakeWindow(1);
    const { sessionId } = openPluginSession(w.win, 'board', ['a.md']);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]!.channel).toBe(Channels.PLUGINS_SESSION_PORT);
    expect(w.posted[0]!.msg).toEqual({ sessionId, pluginId: 'board' });
    const call = pluginEnd(w.posted[0]!.ports[0]!);
    expect((await call('notes.list')).result).toEqual({ paths: ['a.md'] });
    w.closeWindow();
  });

  it('refuses a plugin that is not enabled code, and a window with no thoughtbase', () => {
    h.identity = null;
    expect(() => openPluginSession(fakeWindow(1).win, 'board', [])).toThrow('not an enabled plugin with code');
    h.identity = BOARD;
    expect(() => openPluginSession(fakeWindow(9).win, 'board', [])).toThrow('needs an open thoughtbase');
  });

  it('writes with history as the plugin, and sends intents to its own window', async () => {
    const w = fakeWindow(1);
    openPluginSession(w.win, 'board', ['a.md']);
    const call = pluginEnd(w.posted[0]!.ports[0]!);
    await call('notes.write', { path: 'a.md', content: 'x' });
    expect(h.written).toEqual([{ rel: 'a.md', source: { origin: 'plugin', cause: 'Board (plugin:board@1.0.0)' } }]);
    await call('ui.openNote', { path: 'a.md' });
    expect(w.sent).toEqual([{ channel: Channels.PLUGINS_INTENT, payload: { sessionId: expect.any(String), pluginId: 'board', intent: { kind: 'openNote', path: 'a.md' } } }]);
    await call('ui.copyText', { text: 'hi' });
    expect(h.copied).toEqual(['hi']);
    w.closeWindow();
  });
});

describe('a session ends (#2825)', () => {
  it('with its window', () => {
    const w = fakeWindow(1);
    openPluginSession(w.win, 'board', []);
    const before = _pluginSessionCountForTests();
    w.closeWindow();
    expect(_pluginSessionCountForTests()).toBe(before - 1);
  });

  it('when the window moves to another thoughtbase, at its next call', async () => {
    const w = fakeWindow(1);
    openPluginSession(w.win, 'board', ['a.md']);
    const call = pluginEnd(w.posted[0]!.ports[0]!);
    h.roots.set(1, '/somewhere-else');
    expect((await call('notes.read', { path: 'a.md' })).error?.code).toBe('unavailable');
    w.closeWindow();
  });

  it('when the plugin is upgraded or turned off', async () => {
    const w = fakeWindow(1);
    openPluginSession(w.win, 'board', ['a.md']);
    const call = pluginEnd(w.posted[0]!.ports[0]!);
    h.identity = { ...BOARD, version: '2.0.0' };
    expect((await call('notes.list')).error?.message).toContain('was updated');

    const v = fakeWindow(1);
    h.identity = BOARD;
    openPluginSession(v.win, 'board', []);
    const count = _pluginSessionCountForTests();
    h.identity = null;
    closeStalePluginSessions();
    expect(_pluginSessionCountForTests()).toBe(count - 1);
    expect(v.posted[0]!.ports[0]!.closed).toBe(true);
    w.closeWindow();
    v.closeWindow();
  });
});

describe('a session belongs to its window (#2825)', () => {
  it('another window can neither rescope nor close it', async () => {
    const w = fakeWindow(1);
    const other = fakeWindow(2);
    const { sessionId } = openPluginSession(w.win, 'board', ['a.md']);
    expect(() => setPluginSessionScope(other.win, sessionId, ['b.md'])).toThrow('No such plugin session');
    closePluginSession(other.win, sessionId);
    const call = pluginEnd(w.posted[0]!.ports[0]!);
    expect((await call('notes.list')).result).toEqual({ paths: ['a.md'] });

    setPluginSessionScope(w.win, sessionId, ['b.md', '.minerva/secrets.json']);
    expect((await call('notes.list')).result).toEqual({ paths: ['b.md'] });
    closePluginSession(w.win, sessionId);
    expect(w.posted[0]!.ports[0]!.closed).toBe(true);
    w.closeWindow();
  });
});

describe('the ui kit, wired (#2827)', () => {
  it('draws the plugin\'s menu natively and answers the clicked item, or null when dismissed', async () => {
    const w = fakeWindow(1);
    openPluginSession(w.win, 'board', []);
    const call = pluginEnd(w.posted[0]!.ports[0]!);
    const items = [{ id: 'done', label: 'Move to Done' }, { separator: true }, { id: 'open', label: 'Open', enabled: false }];
    h.pick = 'Move to Done';
    expect((await call('ui.showMenu', { items })).result).toEqual({ id: 'done' });
    h.pick = null;
    expect((await call('ui.showMenu', { items })).result).toEqual({ id: null });
    expect(h.menus[0]).toEqual(['Move to Done', '---', 'Open (off)']);
    w.closeWindow();
  });

  it('passes only the theme tokens on, as short strings', async () => {
    const w = fakeWindow(1);
    const { sessionId } = openPluginSession(w.win, 'board', []);
    const port = w.posted[0]!.ports[0]!;
    const got: unknown[] = [];
    port.on('message', (e: { data: string }) => got.push(JSON.parse(e.data)));
    sendPluginSessionEvent(w.win, sessionId, {
      kind: 'theme', mode: 'contrast',
      vars: { '--bg': '#000', '--font-sans': 'Inter, sans-serif', '--evil': 'x', '--text': 'y'.repeat(201) },
    });
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]).toEqual({ event: 'theme', data: { mode: 'contrast', vars: { '--bg': '#000', '--font-sans': 'Inter, sans-serif' } } });
    w.closeWindow();
  });

  it('a drop joins the scope first, so the plugin can read what it was handed', async () => {
    const w = fakeWindow(1);
    const { sessionId } = openPluginSession(w.win, 'board', []);
    const port = w.posted[0]!.ports[0]!;
    const events: unknown[] = [];
    port.on('message', (e: { data: string }) => { const m = JSON.parse(e.data); if (m.event) events.push(m); });
    const call = pluginEnd(port);
    sendPluginSessionEvent(w.win, sessionId, { kind: 'drop', paths: ['b.md', '.minerva/secrets.json'], x: 10, y: 20 });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({ event: 'drop', data: { paths: ['b.md'], x: 10, y: 20 } });
    expect((await call('notes.list')).result).toEqual({ paths: ['b.md'] });
    // A drop of nothing it may have sends nothing.
    sendPluginSessionEvent(w.win, sessionId, { kind: 'drop', paths: ['.minerva/config.json'], x: 0, y: 0 });
    expect(events).toHaveLength(1);
    w.closeWindow();
  });

  it('another window cannot send events to a session', () => {
    const w = fakeWindow(1);
    const { sessionId } = openPluginSession(w.win, 'board', []);
    expect(() => sendPluginSessionEvent(fakeWindow(2).win, sessionId, { kind: 'drop', paths: ['a.md'], x: 0, y: 0 })).toThrow('No such plugin session');
    w.closeWindow();
  });
});

describe('the View API, wired (#2828)', () => {
  const state = (paths: string[]) => ({
    layout: 'kanban', type: { id: 'task', label: 'Task' }, properties: [], visible: null,
    instances: paths.map((p) => ({ path: p, title: p, values: {} })),
    sortColumn: null, sortDir: 'asc' as const, spec: {}, readOnly: false, exportMode: false,
  });

  it("a view event scopes the session to exactly the view's notes, and leaves out a refused one", async () => {
    const w = fakeWindow(1);
    const { sessionId } = openPluginSession(w.win, 'board', ['old.md']);
    const port = w.posted[0]!.ports[0]!;
    const events: Array<{ event: string; data: { instances: Array<{ path: string }> } }> = [];
    port.on('message', (e: { data: string }) => { const m = JSON.parse(e.data); if (m.event) events.push(m); });
    const call = pluginEnd(port);
    sendPluginSessionEvent(w.win, sessionId, { kind: 'view', state: state(['a.md', '.minerva/secrets.json', 'b.md']) });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]!.data.instances.map((i) => i.path)).toEqual(['a.md', 'b.md']);
    expect((await call('notes.list')).result).toEqual({ paths: ['a.md', 'b.md'] });
    w.closeWindow();
  });

  it('refuses a view event with no instances', () => {
    const w = fakeWindow(1);
    const { sessionId } = openPluginSession(w.win, 'board', []);
    expect(() => sendPluginSessionEvent(w.win, sessionId, { kind: 'view', state: {} as never })).toThrow('carries a view state');
    w.closeWindow();
  });
});
