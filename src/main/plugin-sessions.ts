/**
 * Plugin sessions, wired to the running app (#2825). The broker
 * (`plugins/broker.ts`) holds the rules; this is the composition root that
 * gives it real I/O and real ports.
 *
 * Opening one: the window's renderer (the trusted host) asks for a session
 * for a plugin and the notes its view was given. Main checks the plugin is
 * enabled code, makes a `MessageChannelMain`, keeps one end for the broker
 * and posts the other to the window, whose preload passes it into the page;
 * the page transfers it to the plugin's frame on that plugin's exact origin.
 * The plugin frame has no preload of its own, so main can't hand it over
 * directly.
 *
 * A session belongs to one window and one thoughtbase. Before every call the
 * broker asks `stillValid`: the plugin still enabled code at the same
 * version, and the window still on the thoughtbase the session was opened
 * for. It also closes with the window.
 */
import { BrowserWindow, clipboard, Menu, MessageChannelMain, type MessagePortMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { Channels } from '../shared/channels';
import { logger } from '../shared/logger';
import { PLUGIN_THEME_TOKENS } from '../shared/plugins/frame';
import type { PluginHostEvent } from '../shared/plugins/session';
import { createPluginSession, type BrokerDeps, type BrokerPort, type PluginSession } from './plugins/broker';
import { codePluginIdentity } from './plugins/code-plugins';
import { getRootPath } from './window-manager';
import { hooks } from './ipc/helpers';
import { writeAndReindex } from './notebase/write-pipeline';
import * as notebaseFs from './notebase/fs';
import { runWithHistorySource } from './history';
import { queryGraph } from './graph';
import { runPluginQuery } from './sources/tables';
import { projectContext } from './project-context-types';
import { agentPathRefusal, lexicalAgentPathRefusal, type AgentPathRefusal } from './path-containment';

const REFUSAL_WORDS: Record<AgentPathRefusal, string> = {
  hidden: "it is in a hidden folder or Minerva's own data",
  outside: 'it is outside the thoughtbase',
  root: 'it is the thoughtbase itself',
};

interface Entry { session: PluginSession; windowId: number; pluginId: string }
const sessions = new Map<string, Entry>();

function portFor(port: MessagePortMain): BrokerPort {
  return {
    send: (text) => port.postMessage(text),
    onMessage: (fn) => { port.on('message', (e) => fn(e.data)); port.start(); },
    onClose: (fn) => port.on('close', fn),
    close: () => port.close(),
  };
}

function depsFor(win: BrowserWindow, sessionId: string, pluginId: string): BrokerDeps {
  return {
    readNote: (root, rel) => notebaseFs.readFile(root, rel),
    noteExists: (root, rel) => notebaseFs.fileExists(root, rel),
    writeNote: async (root, rel, content, source) => {
      await runWithHistorySource(source, () => writeAndReindex(root, rel, content, hooks));
    },
    queryGraph: (root, sparql) => queryGraph(projectContext(root), sparql),
    querySql: (root, sql) => runPluginQuery(projectContext(root), sql),
    pathRefusal: (root, rel) => {
      const why = agentPathRefusal(root, rel);
      return why ? REFUSAL_WORDS[why] : null;
    },
    scopeRefusal: (rel) => {
      const why = lexicalAgentPathRefusal(rel);
      return why ? REFUSAL_WORDS[why] : null;
    },
    intent: (intent) => {
      if (!win.isDestroyed()) win.webContents.send(Channels.PLUGINS_INTENT, { sessionId, pluginId, intent });
    },
    copyText: (text) => { void clipboard.writeText(text); },
    showMenu: (items) => new Promise((resolve) => {
      if (win.isDestroyed()) { resolve(null); return; }
      let chosen: string | null = null;
      const menu = Menu.buildFromTemplate(items.map((item) => ('separator' in item
        ? { type: 'separator' as const }
        : { label: item.label, enabled: item.enabled !== false, click: () => { chosen = item.id; } })));
      // `callback` runs when the menu closes, after any click.
      menu.popup({ window: win, callback: () => resolve(chosen) });
    }),
  };
}

/** Tell a session's plugin something its host saw (#2827): the theme, or a drop. */
export function sendPluginSessionEvent(win: BrowserWindow, sessionId: string, event: PluginHostEvent): void {
  const entry = entryFor(win, sessionId);
  if (!entry) throw new Error('No such plugin session in this window.');
  if (event.kind === 'theme') {
    // Only the declared tokens, as short strings: a theme event can't carry anything else.
    const given: Record<string, unknown> = event.vars !== null && typeof event.vars === 'object' ? event.vars : {};
    const vars: Record<string, string> = {};
    for (const token of PLUGIN_THEME_TOKENS) {
      const value = given[token];
      if (typeof value === 'string' && value.length <= 200) vars[token] = value;
    }
    entry.session.emit('theme', { mode: String(event.mode).slice(0, 40), vars });
    return;
  }
  if (event.kind === 'preview') {
    // Only a note the session may reach, and a description's length of text.
    const path = String(event.path);
    if (!entry.session.scope().includes(path)) return;
    const description = typeof event.description === 'string' ? event.description.slice(0, 2000) : null;
    entry.session.emit('preview', { path, description });
    return;
  }
  if (event.kind === 'exportRequest') {
    entry.session.emit('export', { requestId: String(event.requestId).slice(0, 64) });
    return;
  }
  if (event.kind === 'view') {
    // The view's notes are what the session may reach: the host scopes it to
    // exactly the instances it sends, and the notes their link fields name
    // (for those notes' menus, #2828); a refused path is left out of both.
    const state = event.state;
    if (state === null || typeof state !== 'object' || !Array.isArray(state.instances)) throw new Error('A view event carries a view state.');
    const refs = state.instances.flatMap((i) => (Array.isArray(i.fields) ? i.fields.flatMap((f) => (typeof f.ref === 'string' ? [f.ref] : [])) : []));
    entry.session.setScope([...state.instances.map((i) => i.path), ...refs]);
    const scope = new Set(entry.session.scope());
    entry.session.emit('view', {
      ...state,
      instances: state.instances
        .filter((i) => scope.has(i.path))
        .map((i) => ({ ...i, fields: (i.fields ?? []).map((f) => (f.ref && !scope.has(f.ref) ? { name: f.name, label: f.label, text: f.text } : f)) })),
    });
    return;
  }
  // A drop is the user's gesture: the notes join the scope before the plugin hears of them.
  const paths = entry.session.addToScope(Array.isArray(event.paths) ? event.paths.slice(0, 500) : []);
  if (paths.length === 0) return;
  entry.session.emit('drop', { paths, x: Number(event.x) || 0, y: Number(event.y) || 0 });
}

/** Open a session for `pluginId` in `win`, given `scope`; the port follows on `PLUGINS_SESSION_PORT`. */
export function openPluginSession(win: BrowserWindow, pluginId: string, scope: readonly string[]): { sessionId: string } {
  const identity = codePluginIdentity(pluginId);
  if (!identity) throw new Error(`"${pluginId}" is not an enabled plugin with code.`);
  const rootPath = getRootPath(win.id);
  if (!rootPath) throw new Error('A plugin session needs an open thoughtbase.');

  const sessionId = randomUUID();
  const { port1, port2 } = new MessageChannelMain();
  const session = createPluginSession({
    identity,
    rootPath,
    scope,
    port: portFor(port1),
    deps: depsFor(win, sessionId, pluginId),
    stillValid: () => {
      const now = codePluginIdentity(pluginId);
      if (!now) return `${identity.name} has been turned off.`;
      if (now.version !== identity.version) return `${identity.name} was updated; open it again.`;
      if (win.isDestroyed() || getRootPath(win.id) !== rootPath) return 'The thoughtbase this view belonged to was closed.';
      return null;
    },
  });
  sessions.set(sessionId, { session, windowId: win.id, pluginId });
  session.onClose(() => sessions.delete(sessionId));
  win.once('closed', () => session.close());
  win.webContents.postMessage(Channels.PLUGINS_SESSION_PORT, { sessionId, pluginId }, [port2]);
  logger('plugins').info(`plugin ${pluginId}: session opened with ${session.scope().length} note(s) in scope`);
  return { sessionId };
}

function entryFor(win: BrowserWindow, sessionId: string): Entry | null {
  const entry = sessions.get(sessionId);
  return entry && entry.windowId === win.id ? entry : null;
}

/** Replace a session's scope. A session of another window is not this window's to change. */
export function setPluginSessionScope(win: BrowserWindow, sessionId: string, scope: readonly string[]): void {
  const entry = entryFor(win, sessionId);
  if (!entry) throw new Error('No such plugin session in this window.');
  entry.session.setScope(scope);
}

/** Close a session; closing one that has already ended is fine. */
export function closePluginSession(win: BrowserWindow, sessionId: string): void {
  entryFor(win, sessionId)?.session.close();
}

/** Close every session whose plugin is no longer enabled code — after a plugin change. */
export function closeStalePluginSessions(): void {
  for (const { session, pluginId } of [...sessions.values()]) {
    if (!codePluginIdentity(pluginId)) session.close();
  }
}

/** Open sessions, for tests. */
export function _pluginSessionCountForTests(): number {
  return sessions.size;
}
