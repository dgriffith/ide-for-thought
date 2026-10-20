/**
 * Connecting a plugin's frame to Minerva (#2825). The frame (#2824) is on the
 * plugin's own origin with no preload; this store gets it a session from main
 * and hands the session's port to the frame, and nothing else.
 *
 * 1. `api.plugins.openSession(pluginId, scope)` → main opens the session and
 *    posts its port to this window;
 * 2. the preload passes the port into the page as a window message, which is
 *    taken only when `event.source` is this window on this origin, so a
 *    plugin frame can't post a port of its own in its place;
 * 3. the port goes to the frame with `postMessage(…, '<plugin origin>')`, so
 *    only a frame showing that plugin's origin can receive it.
 *
 * The frame must have loaded its page first: a message aimed at the plugin's
 * origin while the frame is still `about:blank` is dropped by the browser.
 *
 * The plugin's `ui` intents arrive here too. `announce` uses the app's live
 * region; `openNote` needs the app's navigation, which `App.svelte` supplies
 * with `setPluginNoteOpener`.
 */
import { api } from '../ipc/client';
import { announce } from './announcer.svelte';
import { logger } from '../../../shared/logger';
import { pluginFrameOrigin } from '../../../shared/plugins/frame';
import { PLUGIN_API_VERSION, PLUGIN_PORT_MESSAGE } from '../../../shared/plugins/api';
import { PLUGIN_SESSION_PORT_MESSAGE, type PluginIntentEvent } from '../../../shared/plugins/session';

/** How long to wait for a session's port after main opened it. */
const PORT_WAIT_MS = 5000;

export interface PluginFrameConnection {
  sessionId: string;
  /** Replace the notes this view was given. */
  setScope(paths: string[]): Promise<void>;
  close(): Promise<void>;
}

const arrived = new Map<string, MessagePort>();
const waiting = new Map<string, (port: MessagePort) => void>();
let noteOpener: ((path: string) => void) | null = null;
let installed = false;

function onWindowMessage(e: MessageEvent): void {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const data = e.data as { type?: unknown; sessionId?: unknown } | null;
  if (data?.type !== PLUGIN_SESSION_PORT_MESSAGE || typeof data.sessionId !== 'string') return;
  const port = e.ports[0];
  if (!port) return;
  const waiter = waiting.get(data.sessionId);
  if (waiter) {
    waiting.delete(data.sessionId);
    waiter(port);
  } else {
    arrived.set(data.sessionId, port);
  }
}

function onIntent({ pluginId, intent }: PluginIntentEvent): void {
  if (intent.kind === 'announce') announce(intent.text);
  else if (noteOpener) noteOpener(intent.path);
  else logger('plugins').warn(`plugin ${pluginId}: asked to open a note, and nothing here opens notes`);
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('message', onWindowMessage);
  api.plugins.onIntent(onIntent);
}

function portFor(sessionId: string): Promise<MessagePort> {
  const early = arrived.get(sessionId);
  if (early) {
    arrived.delete(sessionId);
    return Promise.resolve(early);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(sessionId);
      reject(new Error('The plugin session opened, but its port never arrived.'));
    }, PORT_WAIT_MS);
    waiting.set(sessionId, (port) => { clearTimeout(timer); resolve(port); });
  });
}

/** Give `frame` (already showing plugin `pluginId`'s page) a session over the notes in `scope`. */
export async function connectPluginFrame(frame: HTMLIFrameElement, pluginId: string, scope: string[]): Promise<PluginFrameConnection> {
  install();
  const { sessionId } = await api.plugins.openSession(pluginId, scope);
  let port: MessagePort;
  try {
    port = await portFor(sessionId);
  } catch (e) {
    void api.plugins.closeSession(sessionId);
    throw e;
  }
  const target = frame.contentWindow;
  if (!target) {
    port.close();
    void api.plugins.closeSession(sessionId);
    throw new Error('The plugin frame is gone.');
  }
  target.postMessage({ type: PLUGIN_PORT_MESSAGE, apiVersion: PLUGIN_API_VERSION }, pluginFrameOrigin(pluginId), [port]);
  return {
    sessionId,
    setScope: (paths) => api.plugins.setSessionScope(sessionId, [...paths]),
    close: () => api.plugins.closeSession(sessionId),
  };
}

/** How a plugin's `ui.openNote` opens a note: App's navigation. */
export function setPluginNoteOpener(open: ((path: string) => void) | null): void {
  noteOpener = open;
}
