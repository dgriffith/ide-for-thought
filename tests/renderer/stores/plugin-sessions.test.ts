/**
 * @vitest-environment jsdom
 *
 * The renderer half of a plugin session (#2825): take the port only from
 * this window, hand it only to the plugin's origin, and carry out intents.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  openSession: vi.fn(),
  closeSession: vi.fn(async () => {}),
  setSessionScope: vi.fn(async () => {}),
  sendSessionEvent: vi.fn(async () => {}),
  intent: null as null | ((e: unknown) => void),
  announce: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    plugins: {
      openSession: h.openSession,
      closeSession: h.closeSession,
      setSessionScope: h.setSessionScope,
      sendSessionEvent: h.sendSessionEvent,
      onIntent: (cb: (e: unknown) => void) => { h.intent = cb; return () => {}; },
    },
  },
}));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));

import { connectPluginFrame, forwardableCommand, setPluginAppOps } from '../../../src/renderer/lib/stores/plugin-sessions.svelte';
import { PLUGIN_SESSION_PORT_MESSAGE } from '../../../src/shared/plugins/session';
import { PLUGIN_API_VERSION, PLUGIN_PORT_MESSAGE } from '../../../src/shared/plugins/api';

function fakeFrame() {
  const postMessage = vi.fn();
  return { frame: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement, postMessage };
}

/** What the preload does: post the port into this window, from this window. */
function deliverPort(sessionId: string, source: unknown = window, origin = window.location.origin) {
  const { port1 } = new MessageChannel();
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: PLUGIN_SESSION_PORT_MESSAGE, sessionId, pluginId: 'board' },
    source: source as Window, origin, ports: [port1],
  }));
  return port1;
}

beforeEach(() => { h.openSession.mockReset(); h.closeSession.mockClear(); });

describe('connectPluginFrame (#2825)', () => {
  it("hands this window's port to the frame, aimed at the plugin's origin only", async () => {
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('s1')); return { sessionId: 's1' }; });
    const { frame, postMessage } = fakeFrame();
    const conn = await connectPluginFrame(frame, 'board', ['a.md']);
    expect(h.openSession).toHaveBeenCalledWith('board', ['a.md']);
    expect(conn.sessionId).toBe('s1');
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg, origin, ports] = postMessage.mock.calls[0]!;
    expect(msg).toEqual({ type: PLUGIN_PORT_MESSAGE, apiVersion: PLUGIN_API_VERSION });
    expect(origin).toBe('minerva-plugin://board');
    expect(ports).toHaveLength(1);
    await conn.setScope(['b.md']);
    expect(h.setSessionScope).toHaveBeenCalledWith('s1', ['b.md']);
  });

  it("opens a global view's session by its id, with no scope, and asks for its query again (#2640)", async () => {
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('gv')); return { sessionId: 'gv' }; });
    const { frame } = fakeFrame();
    const conn = await connectPluginFrame(frame, 'reading-queue', ['ignored.md'], undefined, { view: 'queue' });
    expect(h.openSession).toHaveBeenCalledWith('reading-queue', [], { view: 'queue' });
    await conn.refreshQuery();
    expect(h.sendSessionEvent).toHaveBeenCalledWith('gv', { kind: 'refreshQuery' });
  });

  it('takes a port that arrived before openSession answered', async () => {
    h.openSession.mockImplementation(async () => { deliverPort('early'); return { sessionId: 'early' }; });
    const { frame, postMessage } = fakeFrame();
    await connectPluginFrame(frame, 'board', []);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores a port posted by anything but this window — a plugin frame posting its own', async () => {
    vi.useFakeTimers();
    try {
      h.openSession.mockImplementation(async () => {
        queueMicrotask(() => {
          deliverPort('s2', { not: 'window' });                 // another frame's window
          deliverPort('s2', window, 'minerva-plugin://board');   // right source, wrong origin
        });
        return { sessionId: 's2' };
      });
      const { frame, postMessage } = fakeFrame();
      const pending = connectPluginFrame(frame, 'board', []);
      const settled = expect(pending).rejects.toThrow('never arrived');
      await vi.advanceTimersByTimeAsync(6000);
      await settled;
      expect(postMessage).not.toHaveBeenCalled();
      expect(h.closeSession).toHaveBeenCalledWith('s2');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('intents (#2825, #2827)', () => {
  const ops = { openNote: vi.fn(), revealNote: vi.fn(), runCommand: vi.fn() };
  setPluginAppOps(ops);
  const key = (k: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
    ({ kind: 'key' as const, key: k, meta: !!mods.meta, ctrl: false, alt: !!mods.alt, shift: !!mods.shift });

  it('announces, opens and reveals through the app', async () => {
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('s3')); return { sessionId: 's3' }; });
    await connectPluginFrame(fakeFrame().frame, 'board', []);
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: { kind: 'announce', text: 'Moved' } });
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: { kind: 'openNote', path: 'a.md' } });
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: { kind: 'revealNote', path: 'b.md' } });
    expect(h.announce).toHaveBeenCalledWith('Moved');
    expect(ops.openNote).toHaveBeenCalledWith('a.md');
    expect(ops.revealNote).toHaveBeenCalledWith('b.md');
  });

  it('gives focus back to the host of the frame that asked, and no other', async () => {
    const first = vi.fn();
    const second = vi.fn();
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('f1')); return { sessionId: 'f1' }; });
    await connectPluginFrame(fakeFrame().frame, 'board', [], { releaseFocus: first });
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('f2')); return { sessionId: 'f2' }; });
    const conn = await connectPluginFrame(fakeFrame().frame, 'board', [], { releaseFocus: second });
    h.intent!({ sessionId: 'f2', pluginId: 'board', intent: { kind: 'releaseFocus' } });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    await conn.close();
    h.intent!({ sessionId: 'f2', pluginId: 'board', intent: { kind: 'releaseFocus' } });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs a forwarded shortcut only for a command a plugin view may run', () => {
    expect(forwardableCommand(key('k', { meta: true }))).toBe('view.commandPalette');
    expect(forwardableCommand(key('p', { meta: true }))).toBe('nav.quickOpen');
    // ⌘N makes a note and ⌘S saves: not for a plugin's fake keystroke.
    expect(forwardableCommand(key('n', { meta: true }))).toBeNull();
    expect(forwardableCommand(key('s', { meta: true }))).toBeNull();
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: key('k', { meta: true }) });
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: key('n', { meta: true }) });
    expect(ops.runCommand.mock.calls).toEqual([['view.commandPalette']]);
  });

  it("routes view.setState to the frame's host, and sends a view state", async () => {
    const setViewState = vi.fn();
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('v1')); return { sessionId: 'v1' }; });
    const conn = await connectPluginFrame(fakeFrame().frame, 'kanban', [], { releaseFocus: vi.fn(), setViewState });
    h.intent!({ sessionId: 'v1', pluginId: 'kanban', intent: { kind: 'setViewState', patch: { columnOrder: ['b'] } } });
    expect(setViewState).toHaveBeenCalledWith({ columnOrder: ['b'] });
    const state = { layout: 'kanban' } as never;
    await conn.sendView(state);
    expect(h.sendSessionEvent).toHaveBeenLastCalledWith('v1', { kind: 'view', state });
  });

  it("routes the note menu, previews and the export answer to the frame's host, and asks for an export", async () => {
    const host = { releaseFocus: vi.fn(), showNoteMenu: vi.fn(), previewNote: vi.fn(), hidePreview: vi.fn(), exportHtml: vi.fn() };
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('k1')); return { sessionId: 'k1' }; });
    const conn = await connectPluginFrame(fakeFrame().frame, 'kanban', [], host);
    const send = (intent: unknown) => h.intent!({ sessionId: 'k1', pluginId: 'kanban', intent });
    send({ kind: 'showNoteMenu', paths: ['a.md'], x: 3, y: 4, target: false, label: null });
    send({ kind: 'previewNote', path: 'a.md', rect: { x: 1, y: 2, width: 3, height: 4 }, via: 'pointer', extra: ['Jul 1'], omit: ['date'] });
    send({ kind: 'hidePreview', path: 'a.md', via: 'pointer' });
    send({ kind: 'exportHtml', requestId: 'r', html: '<p>x</p>' });
    expect(host.showNoteMenu).toHaveBeenCalledWith(['a.md'], 3, 4, { target: false, label: null });
    expect(host.previewNote).toHaveBeenCalledWith('a.md', { x: 1, y: 2, width: 3, height: 4 }, 'pointer', { extra: ['Jul 1'], omit: ['date'] });
    expect(host.hidePreview).toHaveBeenCalledWith('a.md', 'pointer');
    expect(host.exportHtml).toHaveBeenCalledWith('r', '<p>x</p>');
    await conn.requestExport('r2');
    expect(h.sendSessionEvent).toHaveBeenLastCalledWith('k1', { kind: 'exportRequest', requestId: 'r2' });
  });

  it("routes the view's selection intents to the frame's host", async () => {
    const host = { releaseFocus: vi.fn(), viewClick: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn() };
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('sel')); return { sessionId: 'sel' }; });
    await connectPluginFrame(fakeFrame().frame, 'kanban', [], host);
    const send = (intent: unknown) => h.intent!({ sessionId: 'sel', pluginId: 'kanban', intent });
    send({ kind: 'viewClick', path: 'a.md', meta: true, ctrl: false, shift: false });
    send({ kind: 'selectAll' });
    send({ kind: 'clearSelection' });
    expect(host.viewClick).toHaveBeenCalledWith('a.md', { meta: true, ctrl: false, shift: false });
    expect(host.selectAll).toHaveBeenCalledTimes(1);
    expect(host.clearSelection).toHaveBeenCalledTimes(1);
  });

  it('sends the theme and a drop as session events', async () => {
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('s4')); return { sessionId: 's4' }; });
    const conn = await connectPluginFrame(fakeFrame().frame, 'board', []);
    await conn.sendTheme('light', { '--bg': '#fff' });
    await conn.drop(['a.md'], 4, 5);
    expect(h.sendSessionEvent.mock.calls).toEqual([
      ['s4', { kind: 'theme', mode: 'light', vars: { '--bg': '#fff' } }],
      ['s4', { kind: 'drop', paths: ['a.md'], x: 4, y: 5 }],
    ]);
  });
});
