/**
 * @vitest-environment node
 *
 * The plugin API runtime in a plugin's worker (#2830): with no `window`, it
 * takes its port from the Minerva page that started the worker (on `self`),
 * leaves theme and keyboard alone, and answers Minerva's calls to the
 * handlers registered with `handle()` — announcing each, so a call made
 * before it was registered waits for it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { MinervaPlugin } from '../../plugin-api/index';
import { PLUGIN_API_VERSION, PLUGIN_PORT_MESSAGE } from '../../src/shared/plugins/api';

let api: { connect(options?: unknown): Promise<MinervaPlugin> };
beforeAll(async () => {
  // A dedicated worker's global: an event target the page posts to.
  (globalThis as { self?: unknown }).self = new EventTarget();
  api = await import('../../plugin-api/index.js');
});

/** Connect a worker-side client; answers the client and Minerva's end of the port. */
async function connected() {
  const { port1: host, port2: plugin } = new MessageChannel();
  const fromPlugin: unknown[] = [];
  host.onmessage = (m) => { fromPlugin.push(JSON.parse(m.data as string)); };
  const pending = api.connect();
  (globalThis as unknown as { self: EventTarget }).self.dispatchEvent(new MessageEvent('message', {
    data: { type: PLUGIN_PORT_MESSAGE, apiVersion: PLUGIN_API_VERSION }, ports: [plugin],
  }));
  const minerva = await pending;
  const until = async (pred: () => boolean) => { for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 5)); };
  return { minerva, host, fromPlugin, until };
}

describe('the plugin API runtime, in a worker (#2830)', () => {
  it("takes its port on self, and answers a handler's result to Minerva's call", async () => {
    const { minerva, host, fromPlugin, until } = await connected();
    expect(minerva.apiVersion).toBe(PLUGIN_API_VERSION);
    minerva.handle('parse', (args) => ({ rows: (args as { text: string }).text.split('\n').length }));
    await until(() => fromPlugin.length > 0);
    expect(fromPlugin).toEqual([{ handles: 'parse' }]);
    host.postMessage(JSON.stringify({ call: 7, handler: 'parse', args: { text: 'a\nb' } }));
    await until(() => fromPlugin.length > 1);
    expect(fromPlugin[1]).toEqual({ reply: 7, result: { rows: 2 } });
    minerva.close();
  });

  it("answers a throw, a rejection and a missing handler with why; unregistering withdraws it", async () => {
    const { minerva, host, fromPlugin, until } = await connected();
    minerva.handle('throws', () => { throw new Error('bad input'); });
    minerva.handle('rejects', async () => { throw new Error('later bad'); });
    const off = minerva.handle('gone', () => 1);
    off();
    host.postMessage(JSON.stringify({ call: 1, handler: 'throws', args: null }));
    host.postMessage(JSON.stringify({ call: 2, handler: 'rejects', args: null }));
    host.postMessage(JSON.stringify({ call: 3, handler: 'nope', args: null }));
    await until(() => fromPlugin.filter((m) => 'reply' in (m as object)).length === 3);
    const replies = (fromPlugin.filter((m) => 'reply' in (m as object)) as Array<{ reply: number }>).sort((a, b) => a.reply - b.reply);
    expect(replies).toEqual([
      { reply: 1, error: 'bad input' },
      { reply: 2, error: 'later bad' },
      { reply: 3, error: 'it has no handler "nope"' },
    ]);
    expect(fromPlugin).toContainEqual({ unhandles: 'gone' });
    minerva.close();
  });
});

describe('the message limit, in the runtime (#2832)', () => {
  it('refuses a call over the limit itself, sending nothing, and answers an over-size result with why', async () => {
    const { PLUGIN_MESSAGE_LIMIT_BYTES } = await import('../../src/shared/plugins/api');
    const { minerva, host, fromPlugin, until } = await connected();
    // The broker can't answer a message too big to read by its id: unrefused here, this call would never settle.
    await expect(minerva.call('ui.copyText', { text: 'x'.repeat(PLUGIN_MESSAGE_LIMIT_BYTES) }))
      .rejects.toMatchObject({ name: 'PluginApiError', code: 'too-large' });
    minerva.handle('huge', () => 'y'.repeat(PLUGIN_MESSAGE_LIMIT_BYTES));
    host.postMessage(JSON.stringify({ call: 9, handler: 'huge', args: null }));
    await until(() => fromPlugin.some((m) => (m as { reply?: number }).reply === 9));
    expect(fromPlugin.filter((m) => !('handles' in (m as object)))).toEqual([{ reply: 9, error: `its answer is over ${PLUGIN_MESSAGE_LIMIT_BYTES} bytes` }]);
    minerva.close();
  });
});
