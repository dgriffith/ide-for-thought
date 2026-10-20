/**
 * @vitest-environment jsdom
 *
 * The generated plugin API runtime (`plugin-api/index.js`, #2826), run as a
 * plugin frame runs it: it takes its port only from the parent, answers each
 * call by id, maps the broker's errors to PluginApiError, and closes cleanly.
 */
import { describe, it, expect, vi } from 'vitest';
// Plain JS, typed by its generated sibling `index.d.ts` — so this file is
// also a check that the two agree.
import * as api from '../../plugin-api/index.js';
import type { MinervaPlugin } from '../../plugin-api/index';
import { PLUGIN_API_VERSION, PLUGIN_PORT_MESSAGE } from '../../src/shared/plugins/api';

/** A fake broker on the far end of the port: answers from `answer`. */
function hostWith(answer: (req: { id: number; method: string; params: unknown }) => unknown) {
  const { port1: host, port2: plugin } = new MessageChannel();
  const seen: Array<{ method: string; params: unknown }> = [];
  host.onmessage = (m) => {
    const req = JSON.parse(m.data as string) as { id: number; method: string; params: unknown };
    seen.push({ method: req.method, params: req.params });
    host.postMessage(JSON.stringify({ id: req.id, ...(answer(req) as object) }));
  };
  return { plugin, seen };
}

function handOver(port: MessagePort, source: unknown = window.parent) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: PLUGIN_PORT_MESSAGE, apiVersion: PLUGIN_API_VERSION }, source: source as Window, ports: [port],
  }));
}

describe('the plugin API runtime (#2826)', () => {
  it('connects on the parent\'s port and calls each method by name', async () => {
    const { plugin, seen } = hostWith((req) => (req.method === 'notes.list' ? { result: { paths: ['a.md'] } } : { result: {} }));
    const pending = api.connect();
    handOver(plugin);
    const minerva = await pending;
    expect(minerva.apiVersion).toBe(PLUGIN_API_VERSION);
    expect(await minerva.notes.list()).toEqual({ paths: ['a.md'] });
    await minerva.notes.setProperties({ path: 'a.md', properties: { status: 'done' } });
    await minerva.call('ui.announce', { text: 'hi' });
    expect(seen).toEqual([
      { method: 'notes.list', params: {} },
      { method: 'notes.setProperties', params: { path: 'a.md', properties: { status: 'done' } } },
      { method: 'ui.announce', params: { text: 'hi' } },
    ]);
    minerva.close();
  });

  it('rejects with PluginApiError carrying the broker\'s code', async () => {
    const { plugin } = hostWith(() => ({ error: { code: 'capability', message: 'notes.write needs "notes:write"' } }));
    const pending = api.connect();
    handOver(plugin);
    const minerva = await pending;
    const err = await minerva.notes.write({ path: 'a.md', content: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.PluginApiError);
    expect(err).toMatchObject({ code: 'capability', message: 'notes.write needs "notes:write"' });
    minerva.close();
  });

  it('ignores a port from anything but the parent, and times out', async () => {
    vi.useFakeTimers();
    try {
      const pending = api.connect({ timeoutMs: 1000 });
      const settled = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
      handOver(new MessageChannel().port2, { not: 'the parent' });
      await vi.advanceTimersByTimeAsync(1500);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() rejects the calls still waiting', async () => {
    const { port1: _silent, port2: plugin } = new MessageChannel();
    const pending = api.connect();
    handOver(plugin);
    const minerva = await pending;
    const waiting = minerva.graph.query({ sparql: 'SELECT * {}' });
    minerva.close();
    await expect(waiting).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('exposes one function per method in the broker table', async () => {
    const { PLUGIN_METHODS } = await import('../../src/shared/plugins/api');
    const { plugin } = hostWith(() => ({ result: {} }));
    const pending = api.connect();
    handOver(plugin);
    const minerva = await pending as unknown as Record<string, Record<string, unknown>>;
    for (const name of Object.keys(PLUGIN_METHODS)) {
      const [area, method] = name.split('.');
      expect(typeof minerva[area!]![method!], name).toBe('function');
    }
    (minerva as unknown as MinervaPlugin).close();
  });
});

describe('events, theme and keyboard (#2827)', () => {
  async function connected(options?: Parameters<typeof api.connect>[0]) {
    const { port1: host, port2: plugin } = new MessageChannel();
    const calls: Array<{ method: string; params: unknown }> = [];
    host.onmessage = (m) => {
      const req = JSON.parse(m.data as string) as { id: number; method: string; params: unknown };
      calls.push({ method: req.method, params: req.params });
      host.postMessage(JSON.stringify({ id: req.id, result: {} }));
    };
    const pending = api.connect(options);
    handOver(plugin);
    const minerva = await pending;
    const emit = (event: string, data: unknown) => host.postMessage(JSON.stringify({ event, data }));
    return { minerva, calls, emit };
  }
  const press = (init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };

  it('delivers events to on() listeners until they stop listening', async () => {
    const { minerva, emit } = await connected({ theme: false });
    const drops: unknown[] = [];
    const stop = minerva.on('drop', (d) => drops.push(d));
    emit('drop', { paths: ['a.md'], x: 1, y: 2 });
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    stop();
    emit('drop', { paths: ['b.md'], x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(drops).toEqual([{ paths: ['a.md'], x: 1, y: 2 }]);
    minerva.close();
  });

  it("sets the theme's tokens on :root, unless told not to", async () => {
    const { minerva, emit } = await connected();
    emit('theme', { mode: 'contrast', vars: { '--bg': 'rgb(0, 0, 0)', '--accent': 'yellow' } });
    await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue('--bg')).toBe('rgb(0, 0, 0)'));
    expect(document.documentElement.dataset.minervaTheme).toBe('contrast');
    minerva.close();
    document.documentElement.removeAttribute('style');

    const off = await connected({ theme: false });
    off.emit('theme', { mode: 'light', vars: { '--bg': 'white' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
    off.minerva.close();
  });

  it('gives focus back on an unhandled Escape, and passes on an unhandled shortcut', async () => {
    const { minerva, calls } = await connected({ theme: false });
    press({ key: 'Escape' });
    press({ key: 'k', metaKey: true });
    press({ key: 'a' });            // plain typing: not passed on
    press({ key: 'Meta', metaKey: true }); // a modifier alone: not passed on
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handled.preventDefault();       // the plugin handled it: left alone
    window.dispatchEvent(handled);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      { method: 'ui.releaseFocus', params: {} },
      { method: 'ui.forwardKey', params: { key: 'k', meta: true, ctrl: false, alt: false, shift: false } },
    ]);
    minerva.close();
    press({ key: 'Escape' });       // closed: listening no more
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(2);
  });

  it('keyboard: false leaves the keys alone', async () => {
    const { minerva, calls } = await connected({ theme: false, keyboard: false });
    press({ key: 'Escape' });
    press({ key: 'k', metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    minerva.close();
  });
});
