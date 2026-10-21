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
 * The plugin's `ui` intents arrive here too (#2827). `announce` uses the
 * app's live region; `releaseFocus` goes to the frame's own host; opening,
 * revealing and running a command need the app, which `App.svelte` supplies
 * with `setPluginAppOps`. A forwarded shortcut runs only a command marked
 * `fromPluginViews` in `shared/commands.ts`: a plugin can fake a keystroke.
 */
import { api } from '../ipc/client';
import { announce } from './announcer.svelte';
import { logger } from '../../../shared/logger';
import { pluginFrameOrigin } from '../../../shared/plugins/frame';
import { PLUGIN_API_VERSION, PLUGIN_PORT_MESSAGE, type PluginViewState } from '../../../shared/plugins/api';
import { PLUGIN_SESSION_PORT_MESSAGE, type PluginIntent, type PluginIntentEvent } from '../../../shared/plugins/session';
import { COMMANDS, type CommandId } from '../../../shared/commands';
import { matchesAccelerator } from '../keymap/handle-keydown';

/** How long to wait for a session's port after main opened it. */
const PORT_WAIT_MS = 5000;

export interface PluginFrameConnection {
  sessionId: string;
  /** Replace the notes this view was given. */
  setScope(paths: string[]): Promise<void>;
  /** Send the app's current theme tokens. */
  sendTheme(mode: string, vars: Record<string, string>): Promise<void>;
  /** The user dropped notes on the view, at `x`/`y` in the frame's coordinates; they join its scope. */
  drop(paths: string[], x: number, y: number): Promise<void>;
  /** A type view's state (#2828); its instances become the session's scope. */
  sendView(state: PluginViewState): Promise<void>;
  /** Ask the plugin for its export HTML (#2828); the answer comes to the host's `exportHtml`. */
  requestExport(requestId: string): Promise<void>;
  close(): Promise<void>;
}

/** What one frame's host does for its plugin. */
export interface PluginFrameHost {
  /** Take keyboard focus back from the frame (Escape inside it). */
  releaseFocus(): void;
  /** A layout plugin changing its view's spec (#2828). */
  setViewState?(patch: Record<string, unknown>): void;
  /** The app's note menu for these notes, at a point in the FRAME's coordinates (#2828). */
  showNoteMenu?(paths: string[], x: number, y: number): void;
  /** The app's hover preview beside a box in the frame, and letting it go (#2828). */
  previewNote?(path: string, rect: { x: number; y: number; width: number; height: number }, via: 'pointer' | 'focus'): void;
  hidePreview?(path: string, via: 'pointer' | 'focus'): void;
  /** The plugin's answer to an export request — unsanitized (#2828). */
  exportHtml?(requestId: string, html: string): void;
  /** The view's own selection (#2828). */
  viewClick?(path: string, mods: { meta: boolean; ctrl: boolean; shift: boolean }): void;
  selectAll?(): void;
  clearSelection?(): void;
}

/** What the app does for every plugin view. */
export interface PluginAppOps {
  openNote(path: string): void;
  revealNote(path: string): void;
  runCommand(id: CommandId): void;
}

/** The commands a plugin view may run with a forwarded shortcut, with their keys. */
const FORWARDABLE: ReadonlyArray<{ id: CommandId; key: string }> = COMMANDS
  .filter((c): c is typeof c & { fromPluginViews: true; key: string } => 'fromPluginViews' in c && 'key' in c && typeof c.key === 'string')
  .map((c) => ({ id: c.id, key: c.key }));

const arrived = new Map<string, MessagePort>();
const waiting = new Map<string, (port: MessagePort) => void>();
const hosts = new Map<string, PluginFrameHost>();
let appOps: PluginAppOps | null = null;
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

/** The command a forwarded shortcut names, if a plugin view may run it. */
export function forwardableCommand(key: Extract<PluginIntent, { kind: 'key' }>): CommandId | null {
  const pressed = { key: key.key, metaKey: key.meta, ctrlKey: key.ctrl, altKey: key.alt, shiftKey: key.shift } as KeyboardEvent;
  return FORWARDABLE.find((c) => matchesAccelerator(pressed, c.key))?.id ?? null;
}

function onIntent({ sessionId, pluginId, intent }: PluginIntentEvent): void {
  const log = logger('plugins');
  switch (intent.kind) {
    case 'announce':
      announce(intent.text);
      return;
    case 'releaseFocus':
      hosts.get(sessionId)?.releaseFocus();
      return;
    case 'setViewState':
      hosts.get(sessionId)?.setViewState?.(intent.patch);
      return;
    case 'showNoteMenu':
      hosts.get(sessionId)?.showNoteMenu?.(intent.paths, intent.x, intent.y);
      return;
    case 'previewNote':
      hosts.get(sessionId)?.previewNote?.(intent.path, intent.rect, intent.via);
      return;
    case 'hidePreview':
      hosts.get(sessionId)?.hidePreview?.(intent.path, intent.via);
      return;
    case 'exportHtml':
      hosts.get(sessionId)?.exportHtml?.(intent.requestId, intent.html);
      return;
    case 'viewClick':
      hosts.get(sessionId)?.viewClick?.(intent.path, { meta: intent.meta, ctrl: intent.ctrl, shift: intent.shift });
      return;
    case 'selectAll':
      hosts.get(sessionId)?.selectAll?.();
      return;
    case 'clearSelection':
      hosts.get(sessionId)?.clearSelection?.();
      return;
    case 'key': {
      const id = forwardableCommand(intent);
      if (!id) {
        log.info(`plugin ${pluginId}: a forwarded shortcut that runs nothing a plugin view may run was ignored`);
        return;
      }
      appOps?.runCommand(id);
      return;
    }
    case 'openNote':
    case 'revealNote':
      if (!appOps) { log.warn(`plugin ${pluginId}: asked to ${intent.kind}, and nothing here can`); return; }
      if (intent.kind === 'openNote') appOps.openNote(intent.path);
      else appOps.revealNote(intent.path);
  }
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
export async function connectPluginFrame(
  frame: HTMLIFrameElement,
  pluginId: string,
  scope: string[],
  host?: PluginFrameHost,
): Promise<PluginFrameConnection> {
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
  if (host) hosts.set(sessionId, host);
  return {
    sessionId,
    setScope: (paths) => api.plugins.setSessionScope(sessionId, [...paths]),
    sendTheme: (mode, vars) => api.plugins.sendSessionEvent(sessionId, { kind: 'theme', mode, vars }),
    drop: (paths, x, y) => api.plugins.sendSessionEvent(sessionId, { kind: 'drop', paths: [...paths], x, y }),
    sendView: (state) => api.plugins.sendSessionEvent(sessionId, { kind: 'view', state }),
    requestExport: (requestId) => api.plugins.sendSessionEvent(sessionId, { kind: 'exportRequest', requestId }),
    close: () => {
      hosts.delete(sessionId);
      return api.plugins.closeSession(sessionId);
    },
  };
}

/** What plugin views ask the app to do: App's navigation and command table. */
export function setPluginAppOps(ops: PluginAppOps | null): void {
  appOps = ops;
}
