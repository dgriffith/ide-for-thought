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
 * A global view's session (#2640) is opened with the view's id instead of a
 * scope: main reads the query the view declares from the plugin's own
 * folder, runs it read-only, and scopes the session to exactly the notes its
 * rows name, the way a type view's instances scope a layout's. The renderer
 * asks for a re-run when the graph changes (`refreshQuery`); it never says
 * which notes.
 *
 * A live block's session (#2641) is opened the same way, with the block, the
 * note it sits in and its text: its scope is that note plus the notes its
 * declared query (if any) names, and it hears of all three as a `block`
 * event.
 *
 * A session belongs to one window and one thoughtbase. Before every call the
 * broker asks `stillValid`: the plugin still enabled code at the same
 * version, and the window still on the thoughtbase the session was opened
 * for. It also closes with the window.
 */
import { BrowserWindow, clipboard, Menu, MessageChannelMain, type MessagePortMain } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { Channels } from '../shared/channels';
import { logger } from '../shared/logger';
import { PLUGIN_THEME_TOKENS, pluginFrameOrigin } from '../shared/plugins/frame';
import { PLUGIN_QUERY_ROW_LIMIT, type PluginQueryResults } from '../shared/plugins/api';
import type { PluginBlock, PluginView } from '../shared/plugins/format';
import type { PluginHostEvent, PluginSessionTarget } from '../shared/plugins/session';
import { createPluginSession, type BrokerDeps, type BrokerPort, type PluginSession } from './plugins/broker';
import { codePluginBlocks, codePluginIdentity, codePluginViews } from './plugins/code-plugins';
import { pluginFrameRoot, resolvePluginFrameFile } from './plugins/frame-files';
import { getRootPath } from './window-manager';
import { hooks } from './ipc/helpers';
import { writeAndReindex } from './notebase/write-pipeline';
import * as notebaseFs from './notebase/fs';
import { runWithHistorySource } from './history';
import { notePathsForIris, queryGraph } from './graph';
import { runPluginQuery } from './sources/tables';
import { projectContext } from './project-context-types';
import { agentPathRefusal, lexicalAgentPathRefusal, type AgentPathRefusal } from './path-containment';

const REFUSAL_WORDS: Record<AgentPathRefusal, string> = {
  hidden: "it is in a hidden folder or Minerva's own data",
  outside: 'it is outside the thoughtbase',
  root: 'it is the thoughtbase itself',
};

interface Entry {
  session: PluginSession;
  windowId: number;
  pluginId: string;
  rootPath: string;
  /**
   * A session Minerva feeds (#2640, #2641): a global view, or a live block
   * with the note it sits in, its text and whether it draws for an export.
   * `run` is the latest query run, so a slower earlier one can't land after it.
   */
  fed?: FedSession;
}

type FedSession =
  | { kind: 'view'; def: PluginView; run: number }
  | { kind: 'block'; def: PluginBlock; notePath: string; source: string; exportMode: boolean; run: number };

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

/**
 * Tell a session's plugin something its host saw (#2827): the theme, or a
 * drop. A `refreshQuery` answers once the plugin has been sent the results,
 * so a host can ask for an export after it.
 */
export async function sendPluginSessionEvent(win: BrowserWindow, sessionId: string, event: PluginHostEvent): Promise<void> {
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
  if (event.kind === 'refreshQuery') {
    if (!entry.fed) throw new Error('Only a global view or a live block runs a query of its own.');
    await feed(entry);
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

/** A view's or block's declared query, read from the plugin's own folder with the frame protocol's containment. */
async function readDeclaredQuery(pluginId: string, query: string): Promise<string> {
  const file = await resolvePluginFrameFile(`${pluginFrameOrigin(pluginId)}/${query}`, pluginFrameRoot);
  if (!file) throw new Error(`The query ${query} isn't in the plugin.`);
  return fs.promises.readFile(file, 'utf8');
}

/** Run a declared query: its rows, and the notes they name. A query that fails is the plugin's to show. */
async function runDeclaredQuery(entry: Entry, query: string, fed: FedSession): Promise<PluginQueryResults> {
  try {
    const sparql = await readDeclaredQuery(entry.pluginId, query);
    const ctx = projectContext(entry.rootPath);
    const result = await queryGraph(ctx, sparql);
    if (!result.ok) return { columns: [], rows: [], notes: {}, truncated: false, error: result.error };
    const rows = result.results.slice(0, PLUGIN_QUERY_ROW_LIMIT).map((row) => {
      const out: Record<string, string> = {};
      if (row !== null && typeof row === 'object') {
        for (const [k, v] of Object.entries(row)) if (v !== null && v !== undefined) out[k] = String(v);
      }
      return out;
    });
    const notes = notePathsForIris(ctx, rows.flatMap((r) => Object.values(r)));
    return { columns: result.columns, rows, notes: Object.fromEntries(notes), truncated: result.results.length > rows.length, error: null };
  } catch (e) {
    logger('plugins').warn(`plugin ${entry.pluginId}: ${fed.kind} ${fed.def.id}'s query failed:`, e);
    return { columns: [], rows: [], notes: {}, truncated: false, error: `The ${fed.kind}'s query couldn't run; the details are in Minerva's log.` };
  }
}

/**
 * Feed a session Minerva feeds: run its query, set its scope, then tell the
 * plugin. A global view (#2640) is scoped to the notes its rows name and
 * sent them as `query`; a live block (#2641) to its own note plus those, and
 * sent its text, its note and the results as `block`.
 */
async function feed(entry: Entry): Promise<void> {
  const fed = entry.fed!;
  const run = ++fed.run;
  const query = fed.def.query;
  const results = query === undefined ? null : await runDeclaredQuery(entry, query, fed);
  if (run !== fed.run || entry.session.closed) return;
  entry.session.setScope([...(fed.kind === 'block' ? [fed.notePath] : []), ...Object.values(results?.notes ?? {})]);
  // A note the scope refused (a hidden folder) isn't the plugin's to name.
  const scope = new Set(entry.session.scope());
  if (results) results.notes = Object.fromEntries(Object.entries(results.notes).filter(([, rel]) => scope.has(rel)));
  if (fed.kind === 'view') {
    entry.session.emit('query', results!);
    return;
  }
  entry.session.emit('block', { block: fed.def.id, source: fed.source, notePath: fed.notePath, query: results, exportMode: fed.exportMode });
}

/** What a session is fed by, from what it was opened for; throws for a view or block the plugin doesn't declare. */
function fedFor(pluginId: string, name: string, target: PluginSessionTarget | undefined): FedSession | undefined {
  if (target === undefined) return undefined;
  if ('view' in target) {
    const def = codePluginViews(pluginId).find((v) => v.id === target.view);
    if (!def) throw new Error(`${name} has no view "${target.view}".`);
    return { kind: 'view', def, run: 0 };
  }
  const def = codePluginBlocks(pluginId).find((b) => b.id === target.block);
  if (!def) throw new Error(`${name} has no block "${target.block}".`);
  return { kind: 'block', def, notePath: target.notePath, source: target.source, exportMode: target.exportMode === true, run: 0 };
}

/**
 * Open a session for `pluginId` in `win`, given `scope` — or, for a global
 * view (#2640) or a live block (#2641), `target`, whose query (and note)
 * decide the scope, and `scope` is ignored. The port follows on
 * `PLUGINS_SESSION_PORT`.
 */
export function openPluginSession(win: BrowserWindow, pluginId: string, scope: readonly string[], target?: PluginSessionTarget): { sessionId: string } {
  const identity = codePluginIdentity(pluginId);
  if (!identity) throw new Error(`"${pluginId}" is not an enabled plugin with code.`);
  const fed = fedFor(pluginId, identity.name, target);
  const rootPath = getRootPath(win.id);
  if (!rootPath) throw new Error('A plugin session needs an open thoughtbase.');

  const sessionId = randomUUID();
  const { port1, port2 } = new MessageChannelMain();
  const session = createPluginSession({
    identity,
    rootPath,
    scope: fed ? [] : scope,
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
  sessions.set(sessionId, { session, windowId: win.id, pluginId, rootPath, ...(fed ? { fed } : {}) });
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
  if (entry.fed) throw new Error(`A ${entry.fed.kind === 'view' ? "global view's" : "live block's"} scope is Minerva's to set.`);
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
