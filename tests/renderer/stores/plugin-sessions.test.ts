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
  intent: null as null | ((e: unknown) => void),
  announce: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    plugins: {
      openSession: h.openSession,
      closeSession: h.closeSession,
      setSessionScope: h.setSessionScope,
      onIntent: (cb: (e: unknown) => void) => { h.intent = cb; return () => {}; },
    },
  },
}));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));

import { connectPluginFrame, setPluginNoteOpener } from '../../../src/renderer/lib/stores/plugin-sessions.svelte';
import { PLUGIN_SESSION_PORT_MESSAGE } from '../../../src/shared/plugins/session';
import { PLUGIN_PORT_MESSAGE } from '../../../src/shared/plugins/api';

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
    expect(msg).toEqual({ type: PLUGIN_PORT_MESSAGE, apiVersion: '1.0.0' });
    expect(origin).toBe('minerva-plugin://board');
    expect(ports).toHaveLength(1);
    await conn.setScope(['b.md']);
    expect(h.setSessionScope).toHaveBeenCalledWith('s1', ['b.md']);
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

describe('intents (#2825)', () => {
  it('announces, and opens a note through the opener App gives it', async () => {
    h.openSession.mockImplementation(async () => { queueMicrotask(() => deliverPort('s3')); return { sessionId: 's3' }; });
    await connectPluginFrame(fakeFrame().frame, 'board', []);
    const open = vi.fn();
    setPluginNoteOpener(open);
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: { kind: 'announce', text: 'Moved' } });
    h.intent!({ sessionId: 's3', pluginId: 'board', intent: { kind: 'openNote', path: 'a.md' } });
    expect(h.announce).toHaveBeenCalledWith('Moved');
    expect(open).toHaveBeenCalledWith('a.md');
  });
});
