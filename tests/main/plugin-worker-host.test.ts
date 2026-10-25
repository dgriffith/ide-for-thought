/**
 * The plugin worker host's lifecycle (#2830), over a fake view and channel:
 * a host starts on the first call and is reused; a call that misses its
 * deadline stops it and fails naming the plugin, and the next call — even
 * one already queued behind it — gets a fresh host; an idle host stops; a
 * plugin that isn't enabled code, or has no logic, is refused; and a plugin
 * change or a closed thoughtbase stops its hosts. The real host is the e2e's
 * (`plugin-worker-host.spec.ts`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrokerPort, PluginIdentity } from '../../src/main/plugins/broker';

const h = vi.hoisted(() => ({
  identity: null as PluginIdentity | null,
  worker: 'logic.js',
}));
vi.mock('electron', () => ({ WebContentsView: class {}, MessageChannelMain: class {} }));
vi.mock('../../src/main/plugins/code-plugins', () => ({ codePluginIdentity: () => h.identity, codePluginWorker: () => h.worker }));
vi.mock('../../src/main/plugin-sessions', () => ({
  portFor: () => { throw new Error('the fake factory makes its own ports'); },
  brokerDepsFor: () => ({
    readNote: async () => '', noteExists: async () => true, writeNote: async () => {}, queryGraph: async () => ({ ok: true, results: [], columns: [] }),
    querySql: async () => ({ ok: true, columns: [], rows: [] }), pathRefusal: () => null, scopeRefusal: () => null,
    intent: () => {}, copyText: () => {}, showMenu: async () => null,
  }),
}));

import {
  _setWorkerHostFactoryForTests, _workerHostCountForTests, invokePluginLogic, stopStaleWorkerHosts,
  type HostFactory,
} from '../../src/main/plugin-worker-host';
import { silenceLogTags } from '../helpers/quiet-logs';
import { disposeAllProjectStores } from '../../src/main/project-store';
import { projectContext } from '../../src/main/project-context-types';

silenceLogTags('plugins');

const LAB: PluginIdentity = { id: 'lab', name: 'Lab', version: '1.0.0', capabilities: ['notes:read'] };
const NEVER = Symbol('never answers');
/** A handler, and how it calls the broker back, as a plugin's logic would. */
type Ask = (method: string, params?: unknown) => Promise<{ result?: unknown; error?: { code: string; message: string } }>;
type Behaviour = Record<string, (args: unknown, ask: Ask) => unknown>;

/** Views and channels whose "plugin" announces its handlers and answers calls, as the runtime does. */
function fake(behaviour: Behaviour) {
  const made = { views: 0, destroyed: 0, loaded: [] as string[] };
  const factory: HostFactory = {
    view() {
      made.views += 1;
      let gone = false;
      return {
        load: async (url) => { made.loaded.push(url); },
        post: (_entry, remote) => (remote as { start(): void }).start(),
        destroy: () => { if (!gone) { gone = true; made.destroyed += 1; } },
        get destroyed() { return gone; },
      };
    },
    channel() {
      let toBroker: (data: unknown) => void = () => {};
      const asked = new Map<number, (reply: { result?: unknown; error?: { code: string; message: string } }) => void>();
      let nextAsk = 1;
      const ask: Ask = (method, params) => new Promise((resolve) => {
        const id = nextAsk++;
        asked.set(id, resolve);
        toBroker(JSON.stringify({ id, method, params }));
      });
      const local: BrokerPort = {
        send(text) {
          const m = JSON.parse(text) as { id?: number; call?: number; handler?: string; args?: unknown };
          if (typeof m.id === 'number' && asked.has(m.id)) { asked.get(m.id)!(m as never); asked.delete(m.id); return; }
          if (typeof m.call !== 'number') return;
          const fn = behaviour[m.handler!];
          Promise.resolve().then(() => fn!(m.args, ask)).then(
            (result) => { if (result !== NEVER) toBroker(JSON.stringify({ reply: m.call, result })); },
            (e: Error) => toBroker(JSON.stringify({ reply: m.call, error: e.message })),
          );
        },
        onMessage: (fn) => { toBroker = fn; },
        onClose: () => {},
        close: () => {},
      };
      const remote = { start: () => { for (const name of Object.keys(behaviour)) toBroker(JSON.stringify({ handles: name })); } };
      return { local, remote };
    },
  };
  return { made, factory };
}

const BEHAVIOUR: Behaviour = {
  echo: (args) => ({ echoed: args }),
  copy: async (_args, ask) => (await ask('ui.copyText', { text: 'x' })).error ?? 'copied',
  spin: () => new Promise(() => {}).then(() => NEVER),
  fails: () => { throw new Error('the parser choked'); },
};
const call = (handler: string, args: unknown = null, extra: { deadlineMs?: number; rootPath?: string } = {}) =>
  invokePluginLogic('lab', handler, args, { rootPath: extra.rootPath ?? '/tb', ...(extra.deadlineMs ? { deadlineMs: extra.deadlineMs } : {}) });

beforeEach(() => { h.identity = LAB; h.worker = 'logic.js'; });
afterEach(() => _setWorkerHostFactoryForTests(null));

describe('invokePluginLogic (#2830)', () => {
  it('caps a call at the capabilities it is given, and only that call (#2831)', async () => {
    h.identity = { ...LAB, capabilities: ['notes:read', 'ui'] };
    const { factory } = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(factory);
    await expect(invokePluginLogic('lab', 'copy', null, { rootPath: '/tb', capabilities: ['notes:read'] }))
      .resolves.toMatchObject({ code: 'capability', message: expect.stringContaining('it only reads') });
    await expect(invokePluginLogic('lab', 'copy', null, { rootPath: '/tb' })).resolves.toBe('copied');
  });

  it("starts a host on the plugin's origin on the first call, and reuses it", async () => {
    const f = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(f.factory);
    await expect(call('echo', { n: 1 })).resolves.toEqual({ echoed: { n: 1 } });
    await expect(call('echo', { n: 2 })).resolves.toEqual({ echoed: { n: 2 } });
    expect(f.made.views).toBe(1);
    expect(f.made.loaded).toEqual(['minerva-plugin://lab/@minerva/worker-host.html']);
  });

  it("a handler's throw fails its call, naming the plugin; the host stays", async () => {
    const f = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(f.factory);
    await expect(call('fails')).rejects.toThrow('Lab: the parser choked');
    await expect(call('echo', 1)).resolves.toEqual({ echoed: 1 });
    expect(f.made.views).toBe(1);
  });

  it('a call past its deadline stops the host and fails naming the plugin; a call queued behind it gets a fresh host', async () => {
    const f = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(f.factory);
    const looped = call('spin', null, { deadlineMs: 40 });
    const queued = call('echo', 'after');
    await expect(looped).rejects.toThrow('Lab didn\'t answer "spin" within 0.04s, so it was stopped.');
    await expect(queued).resolves.toEqual({ echoed: 'after' });
    expect(f.made).toMatchObject({ views: 2, destroyed: 1 });
  });

  it('an idle host is stopped', async () => {
    const f = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(f.factory, 20);
    await call('echo');
    expect(_workerHostCountForTests()).toBe(1);
    await vi.waitFor(() => expect(_workerHostCountForTests()).toBe(0));
    expect(f.made.destroyed).toBe(1);
  });

  it("refuses a plugin that isn't enabled code, and one with no logic, starting nothing", async () => {
    const f = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(f.factory);
    h.identity = null;
    await expect(call('echo')).rejects.toThrow('"lab" is not an enabled plugin with code.');
    h.identity = LAB;
    h.worker = null;
    await expect(call('echo')).rejects.toThrow('Lab has no logic to run (no "code.worker").');
    expect(f.made.views).toBe(0);
  });

  it('a plugin change, or its thoughtbase closing, stops its hosts', async () => {
    const f = fake(BEHAVIOUR);
    _setWorkerHostFactoryForTests(f.factory);
    await call('echo', null, { rootPath: '/a' });
    await call('echo', null, { rootPath: '/b' });
    expect(_workerHostCountForTests()).toBe(2);
    await disposeAllProjectStores(projectContext('/a'));
    expect(_workerHostCountForTests()).toBe(1);
    h.identity = { ...LAB, version: '1.1.0' };
    stopStaleWorkerHosts();
    expect(_workerHostCountForTests()).toBe(0);
    await call('echo', null, { rootPath: '/b' });
    expect(f.made.views).toBe(3);
  });
});
