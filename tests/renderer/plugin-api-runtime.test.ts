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
import { PLUGIN_PORT_MESSAGE } from '../../src/shared/plugins/api';

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
    data: { type: PLUGIN_PORT_MESSAGE, apiVersion: '1.0.0' }, source: source as Window, ports: [port],
  }));
}

describe('the plugin API runtime (#2826)', () => {
  it('connects on the parent\'s port and calls each method by name', async () => {
    const { plugin, seen } = hostWith((req) => (req.method === 'notes.list' ? { result: { paths: ['a.md'] } } : { result: {} }));
    const pending = api.connect();
    handOver(plugin);
    const minerva = await pending;
    expect(minerva.apiVersion).toBe('1.0.0');
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
