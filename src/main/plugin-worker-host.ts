/**
 * The plugin worker host (#2830, design `docs/plugin-code.md` → *Logic: a
 * sandboxed worker host*): where a plugin's code with no UI runs — a
 * command's handler, an ingestor's parser, an exporter's writer.
 *
 * One host per plugin and thoughtbase: an unattached `WebContentsView` (not a
 * window, so it never counts as one), `sandbox: true`, no Node, on the
 * plugin's own origin, showing Minerva's host page
 * (`plugins/worker-host-page.ts`), which runs the plugin's logic module in a
 * Web Worker. The worker has no `fs`, no `require`, no network (the origin's
 * CSP), and no DOM; it talks to Minerva only over its session port, through
 * the broker, with the capabilities it declared.
 *
 * - **Data in, data out.** A call hands the handler JSON and gets JSON back.
 *   The notes it may read are the call's `scope`; main does every file write.
 * - **Deadlines.** Every call has one (`PLUGIN_LOGIC_DEADLINE_MS` unless the
 *   caller says). A host that misses it is destroyed — its process ends, the
 *   loop with it — and the call fails naming the plugin. The next call starts
 *   a fresh host: "stopped until next used".
 * - **One call at a time** per host, so the scope is the call's own.
 * - **Lazy.** Nothing starts until a call; a host idle for
 *   `PLUGIN_HOST_IDLE_MS` is stopped. Measured: each host is its own renderer
 *   process, ~86–90 MB working set (site isolation: a plugin is its own
 *   origin, so two plugins can't share one).
 * - **Never at startup**: nothing here runs before a call.
 *
 * The page needs one thing a preload-free page can't have — a `MessagePort`
 * from main — so the host has a preload of two lines that forwards it and
 * exposes nothing (`preload/worker-host-preload.ts`). Plugin code never runs
 * in the page, only in the worker it starts.
 */
import { MessageChannelMain, WebContentsView } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../shared/logger';
import type { PluginCapability } from '../shared/plugins/capabilities';
import { pluginFrameOrigin, WORKER_HOST_PORT_CHANNEL } from '../shared/plugins/frame';
import { createPluginSession, PluginCallError, type BrokerPort, type PluginRefusal, type PluginSession } from './plugins/broker';
import { codePluginIdentity, codePluginWorker } from './plugins/code-plugins';
import { brokerDepsFor, portFor } from './plugin-sessions';
import { WORKER_HOST_PAGE_PATH } from './plugins/frame-files';
import { HARDENED_WEB_PREFERENCES } from './security';
import { createProjectStore } from './project-store';
import { projectContext } from './project-context-types';

/** A call that missed its deadline, so its host was stopped (#2831: an inspection reports it as a finding). */
export class PluginDeadlineError extends PluginCallError {
  constructor(message: string) { super(message); this.name = 'PluginDeadlineError'; }
}

/** How long a call may run before its host is stopped. */
export const PLUGIN_LOGIC_DEADLINE_MS = 10_000;
/** How long a host may sit unused before it is stopped. */
export const PLUGIN_HOST_IDLE_MS = 60_000;
/** How long a host may take to load its page and connect. */
const HOST_START_MS = 10_000;

/** What one host is to the manager: somewhere to post the port, and a way to end it. */
export interface HostView {
  /** Load the host page; resolves once it has. */
  load(url: string): Promise<void>;
  /** Give the host page its port, and the module to start. */
  post(entry: string, port: unknown): void;
  destroy(): void;
  readonly destroyed: boolean;
  /** Whatever must stay alive for the host to: Electron's view. */
  readonly view?: unknown;
}

/** Makes a host view and a channel: Electron's, or a test's. */
export interface HostFactory {
  view(): HostView;
  channel(): { local: BrokerPort; remote: unknown };
}

const electronFactory: HostFactory = {
  view() {
    const view = new WebContentsView({
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        // A host isn't on screen: don't throttle the calls it's running.
        backgroundThrottling: false,
        preload: path.join(__dirname, 'worker-host-preload.cjs'),
      },
    });
    const wc = view.webContents;
    return {
      // Held for the host's life: an unattached view nothing references is
      // garbage, and collecting it destroys its webContents — mid-load, that
      // rejected `loadURL` with ERR_FAILED, about one first call in six.
      view,
      load: (url) => wc.loadURL(url),
      post: (entry, port) => wc.postMessage(WORKER_HOST_PORT_CHANNEL, { entry }, [port as Electron.MessagePortMain]),
      destroy: () => { if (!wc.isDestroyed()) wc.close(); },
      get destroyed() { return wc.isDestroyed(); },
    };
  },
  channel() {
    const { port1, port2 } = new MessageChannelMain();
    return { local: portFor(port1), remote: port2 };
  },
};

interface Host {
  /** The thoughtbase's hosts, which this one is in while it runs. */
  peers: Map<string, Host>;
  pluginId: string;
  version: string;
  view: HostView;
  session: PluginSession;
  idle: ReturnType<typeof setTimeout> | null;
}

interface ThoughtbaseHosts {
  /** Running hosts, by plugin id. */
  hosts: Map<string, Host>;
  /** The last call queued per plugin: each waits for the one before, on whatever host is current then. */
  queues: Map<string, Promise<unknown>>;
}

let factory: HostFactory = electronFactory;
let idleMs = PLUGIN_HOST_IDLE_MS;
// Per thoughtbase (#2240): its hosts stop when it closes.
const hostStore = createProjectStore<ThoughtbaseHosts>({
  dispose: (state) => { for (const host of [...state.hosts.values()]) stop(host, 'its thoughtbase closed'); },
});

function hostsOf(rootPath: string): ThoughtbaseHosts {
  const ctx = projectContext(rootPath);
  let state = hostStore.get(ctx);
  if (!state) { state = { hosts: new Map(), queues: new Map() }; hostStore.set(ctx, state); }
  return state;
}

function stop(host: Host, why: string): void {
  if (host.peers.get(host.pluginId) === host) host.peers.delete(host.pluginId);
  if (host.idle) clearTimeout(host.idle);
  host.session.close();
  host.view.destroy();
  logger('plugins').info(`plugin ${host.pluginId}: worker host stopped (${why})`);
}

/**
 * `p`, or `onTimeout()`'s error after `ms`. `afterTimeout` runs once the
 * timeout has won — stopping a host closes its session, which rejects the
 * very call being timed out, and that must not beat the deadline's own error.
 */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error, afterTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(onTimeout());
        if (afterTimeout) queueMicrotask(afterTimeout);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function start(pluginId: string, rootPath: string, peers: Map<string, Host>): Promise<Host> {
  const identity = codePluginIdentity(pluginId);
  if (!identity) throw new PluginCallError(`"${pluginId}" is not an enabled plugin with code.`);
  const entry = codePluginWorker(pluginId);
  if (!entry) throw new PluginCallError(`${identity.name} has no logic to run (no "code.worker").`);
  const view = factory.view();
  const { local, remote } = factory.channel();
  const session = createPluginSession({
    identity,
    rootPath,
    scope: [],
    port: local,
    deps: brokerDepsFor(null, `worker:${randomUUID()}`, pluginId),
    stillValid: () => {
      const now = codePluginIdentity(pluginId);
      if (!now) return `${identity.name} has been turned off.`;
      if (now.version !== identity.version) return `${identity.name} was updated.`;
      return null;
    },
  });
  const host: Host = { peers, pluginId, version: identity.version, view, session, idle: null };
  try {
    await withTimeout(view.load(`${pluginFrameOrigin(pluginId)}/${WORKER_HOST_PAGE_PATH}`), HOST_START_MS,
      () => new PluginCallError(`${identity.name}'s worker host didn't start in time.`));
  } catch (e) {
    session.close();
    view.destroy();
    if (e instanceof PluginCallError) throw e;
    logger('plugins').warn(`plugin ${pluginId}: worker host page didn't load:`, e);
    throw new PluginCallError(`${identity.name}'s worker host didn't start.`);
  }
  view.post(entry, remote);
  peers.set(pluginId, host);
  logger('plugins').info(`plugin ${pluginId}: worker host started`);
  return host;
}

/** The host for `pluginId` and `rootPath`, started if it isn't — or restarted if the plugin changed under it. */
async function hostFor(pluginId: string, rootPath: string): Promise<Host> {
  const { hosts } = hostsOf(rootPath);
  const existing = hosts.get(pluginId);
  const now = codePluginIdentity(pluginId);
  if (existing && (existing.session.closed || existing.view.destroyed || !now || now.version !== existing.version)) {
    stop(existing, 'its plugin changed');
  } else if (existing) {
    return existing;
  }
  return start(pluginId, rootPath, hosts);
}

export interface PluginLogicCall {
  /** The thoughtbase the call is about. */
  rootPath: string;
  /** The notes the handler may read, and write as its capabilities allow. */
  scope?: readonly string[];
  /** Overrides `PLUGIN_LOGIC_DEADLINE_MS`. */
  deadlineMs?: number;
  /** What the handler may do, below what the plugin declared (#2831); absent, everything it declared. */
  capabilities?: readonly PluginCapability[];
}

let refusalTap: ((refusal: PluginRefusal) => void) | null = null;

/**
 * Hear every call any handler makes that the broker refuses, until set back
 * to null (#2833): `plugin check`'s code stage, which fails a plugin whose code
 * calls outside what it declares. Nothing in the running app sets it.
 */
export function setPluginRefusalTap(tap: ((refusal: PluginRefusal) => void) | null): void {
  refusalTap = tap;
}

/**
 * Run `handler` in plugin `pluginId`'s logic with `args` (JSON-able), and
 * answer with what it returned. Rejects with a `PluginCallError` naming the
 * plugin when it isn't enabled code, has no logic, throws, or misses its
 * deadline — which also stops its host.
 */
export function invokePluginLogic(pluginId: string, handler: string, args: unknown, call: PluginLogicCall): Promise<unknown> {
  const deadline = call.deadlineMs ?? PLUGIN_LOGIC_DEADLINE_MS;
  const { queues } = hostsOf(call.rootPath);
  const turn = (queues.get(pluginId) ?? Promise.resolve()).then(async () => {
    // The host as it is now: the call before may have stopped the last one.
    const host = await hostFor(pluginId, call.rootPath);
    if (host.idle) { clearTimeout(host.idle); host.idle = null; }
    const name = codePluginIdentity(pluginId)?.name ?? pluginId;
    host.session.setScope(call.scope ?? []);
    host.session.limitCapabilities(call.capabilities ?? null);
    host.session.onRefusal(refusalTap);
    try {
      return await withTimeout(
        host.session.call(handler, args),
        deadline,
        () => new PluginDeadlineError(`${name} didn't answer "${handler}" within ${deadline / 1000}s, so it was stopped.`),
        () => stop(host, `"${handler}" ran past ${deadline}ms`),
      );
    } finally {
      if (host.peers.get(pluginId) === host) {
        host.idle = setTimeout(() => stop(host, 'idle'), idleMs);
        host.idle.unref?.();
      }
    }
  });
  // The next call waits for this one, whatever became of it. Not a swallow:
  // the caller has `turn`, rejection and all; this copy only orders the queue.
  const settled = turn.catch((_ignored: unknown) => undefined);
  queues.set(pluginId, settled);
  void settled.then(() => { if (queues.get(pluginId) === settled) queues.delete(pluginId); });
  return turn;
}

function allHosts(): Host[] {
  return hostStore.keys().flatMap((root) => [...(hostStore.get(projectContext(root))?.hosts.values() ?? [])]);
}

/** Stop every host whose plugin is no longer enabled code, or changed — after a plugin change. */
export function stopStaleWorkerHosts(): void {
  for (const host of allHosts()) {
    const now = codePluginIdentity(host.pluginId);
    if (!now || now.version !== host.version) stop(host, 'its plugin changed');
  }
}

/** Running hosts, for tests. */
export function _workerHostCountForTests(): number {
  return allHosts().length;
}

/** Swap the view/channel factory and idle time; `null` restores Electron's. Tests only. */
export function _setWorkerHostFactoryForTests(next: HostFactory | null, idle: number | null = null): void {
  for (const host of allHosts()) stop(host, 'test reset');
  factory = next ?? electronFactory;
  idleMs = idle ?? PLUGIN_HOST_IDLE_MS;
}
