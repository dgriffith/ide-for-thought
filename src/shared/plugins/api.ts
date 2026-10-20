/**
 * The plugin API, as the broker enforces it (#2825, design
 * docs/plugin-code.md → What it can reach, Writes).
 *
 * Plugin code (a view's frame, #2824; later the worker host, #2830) talks to
 * Minerva over ONE `MessagePort` per session, in JSON text messages:
 *
 *   → `{ "id": 1, "method": "notes.read", "params": { "path": "a.md" } }`
 *   ← `{ "id": 1, "result": { … } }`  or  `{ "id": 1, "error": { "code", "message" } }`
 *
 * Every method names the ONE capability it needs. The broker
 * (`main/plugins/broker.ts`) refuses a call whose capability the plugin didn't
 * declare, naming it. This table is the single source the broker checks
 * against, and what the typed package and ABI snapshot in `plugin-api/` are
 * generated from (#2826), so the two can't drift: after changing anything
 * here, run `node scripts/build-plugin-api.mjs`. A breaking change needs a
 * major bump of {@link PLUGIN_API_VERSION}, an addition a minor one.
 *
 * Core methods are `<area>.<name>`. A fork's are `<slug>:<name>` (its
 * `pluginApiExtensions`, docs/forking.md), outside the ABI snapshot.
 *
 * Text, not structured clone, on purpose: a size limit means something, and a
 * plugin can't transfer a port, a blob or a cyclic object into main.
 */
import type { PluginCapability } from './capabilities';

/**
 * The API's semver version (#2826), its own and not the app's: the host sends
 * it with the port, and a plugin's `code.api` range must accept it.
 */
export const PLUGIN_API_VERSION = '1.2.0';

export const PLUGIN_METHODS = {
  'notes.list': { capability: 'notes:read', describes: 'The notes this view or call was given.' },
  'notes.read': { capability: 'notes:read', describes: 'One of those notes: its text and properties.' },
  'graph.query': { capability: 'graph:query', describes: 'A read-only SPARQL query over the graph.' },
  'tables.query': { capability: 'graph:query', describes: 'A SQL query over the tables and views Minerva registered.' },
  'notes.setProperties': { capability: 'notes:write-properties', describes: 'Set or remove properties on a note it was given.' },
  'notes.write': { capability: 'notes:write', describes: 'Replace the text of a note it was given.' },
  'notes.create': { capability: 'notes:write', describes: 'Create a note, which it is then given.' },
  'ui.openNote': { capability: 'ui', describes: 'Open a note it was given.' },
  'ui.announce': { capability: 'ui', describes: 'Make an announcement for screen readers.' },
  'ui.copyText': { capability: 'ui', describes: 'Copy text to the clipboard.' },
  'ui.revealNote': { capability: 'ui', describes: 'Reveal a note it was given in the sidebar.' },
  'ui.showMenu': { capability: 'ui', describes: 'Show a context menu at the pointer, drawn by Minerva; answers the chosen item.' },
  'ui.releaseFocus': { capability: 'ui', describes: 'Give keyboard focus back to Minerva (what Escape does by default).' },
  'ui.forwardKey': { capability: 'ui', describes: "Pass on a shortcut the view didn't handle; Minerva runs it if it is one a plugin view may." },
  'view.setState': { capability: 'ui', describes: "Change the view's own settings (a board's column order); only the layout's own fields." },
  'llm.propose': { capability: 'llm:propose', describes: 'Ask the assistant for changes. Not available yet (#2858).' },
} as const satisfies Record<string, { capability: PluginCapability; describes: string }>;

export type PluginMethod = keyof typeof PLUGIN_METHODS;

export function isPluginMethod(name: string): name is PluginMethod {
  return Object.hasOwn(PLUGIN_METHODS, name);
}

/** What each method takes. */
export interface PluginMethodParams {
  'notes.list': Record<string, never>;
  'notes.read': { path: string };
  'graph.query': { sparql: string };
  'tables.query': { sql: string };
  'notes.setProperties': { path: string; properties: Record<string, unknown> };
  'notes.write': { path: string; content: string };
  'notes.create': { path: string; content: string };
  'ui.openNote': { path: string };
  'ui.announce': { text: string };
  'ui.copyText': { text: string };
  'ui.revealNote': { path: string };
  'ui.showMenu': { items: PluginMenuItem[] };
  'ui.releaseFocus': Record<string, never>;
  'ui.forwardKey': { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean };
  'view.setState': { patch: Record<string, unknown> };
  'llm.propose': Record<string, unknown>;
}

/** One row of a plugin's context menu: an item it can be answered with, or a separator. */
export type PluginMenuItem = { id: string; label: string; enabled?: boolean } | { separator: true };

/** What each method answers. */
export interface PluginMethodResults {
  'notes.list': { paths: string[] };
  'notes.read': { path: string; content: string; properties: Record<string, unknown> };
  'graph.query': { columns: string[]; rows: unknown[]; truncated: boolean };
  'tables.query': { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean };
  'notes.setProperties': { changed: string[] };
  'notes.write': Record<string, never>;
  'notes.create': { path: string };
  'ui.openNote': Record<string, never>;
  'ui.announce': Record<string, never>;
  'ui.copyText': Record<string, never>;
  'ui.revealNote': Record<string, never>;
  'ui.showMenu': { id: string | null };
  'ui.releaseFocus': Record<string, never>;
  'ui.forwardKey': Record<string, never>;
  'view.setState': Record<string, never>;
  'llm.propose': never;
}

/**
 * What Minerva tells a plugin without being asked (#2827): an event message
 * `{ "event": "<name>", "data": … }` on the same port. The runtime's
 * `minerva.on(name, fn)` delivers them.
 * - `theme`: the app's theme tokens, sent on connect and on every change; the
 *   runtime sets them on the frame's `:root` unless told not to.
 * - `drop`: the user dropped notes on the view. A drop is the user's gesture,
 *   so the notes join the session's scope before the event is sent; `x`/`y`
 *   are in the frame's own coordinates.
 * - `view` (#2828): a type view's state, for a plugin that draws a layout —
 *   sent on connect and whenever it changes. Its `instances` are the
 *   session's scope.
 */
export interface PluginEvents {
  theme: { mode: string; vars: Record<string, string> };
  drop: { paths: string[]; x: number; y: number };
  view: PluginViewState;
}

/** A type view, as a plugin drawing one of its layouts sees it (#2828). */
export type PluginViewState = {
  layout: string;
  type: { id: string; label: string; icon?: string; color?: string };
  /** The type's effective properties, in declared order. */
  properties: PluginViewProperty[];
  /** The view's visible property names; null = all. */
  visible: string[] | null;
  /** The notes the view shows, filtered, in the view's sort order. */
  instances: PluginViewInstance[];
  sortColumn: string | null;
  sortDir: 'asc' | 'desc';
  /** The layout's own spec fields (a board's `groupBy`, `columnOrder`, …). */
  spec: Record<string, unknown>;
  /** An embed or export: nothing that writes the spec or a note. */
  readOnly: boolean;
  /** Drawing for an export snapshot. */
  exportMode: boolean;
};

/** One of a type's properties. */
export type PluginViewProperty = { name: string; type: string; label?: string; options?: string[] };

/** One note in a view: its declared property values, null where unset. */
export type PluginViewInstance = { path: string; title: string; values: Record<string, string | null>; tags?: string[] };

export type PluginEventName = keyof PluginEvents;

/** A context menu's limits. */
export const PLUGIN_MENU_MAX_ITEMS = 50;
export const PLUGIN_MENU_MAX_LABEL = 120;

/**
 * Why a call failed. A plugin branches on these, so they are part of the API:
 * - `bad-request`: not JSON, no numeric `id`, or params of the wrong shape;
 * - `unknown-method`: not in {@link PLUGIN_METHODS};
 * - `capability`: the plugin didn't declare the method's capability;
 * - `scope`: a note it wasn't given, or a path a plugin may never name;
 * - `too-large`: the message or the answer is over {@link PLUGIN_MESSAGE_LIMIT_BYTES};
 * - `busy`: {@link PLUGIN_MAX_IN_FLIGHT} calls are already running;
 * - `unavailable`: the method isn't available yet, or the session has ended;
 * - `failed`: the call was allowed and didn't work (a query error, a missing note).
 */
export type PluginErrorCode =
  | 'bad-request' | 'unknown-method' | 'capability' | 'scope' | 'too-large' | 'busy' | 'unavailable' | 'failed';

export interface PluginRequest {
  id: number;
  method: string;
  params?: unknown;
}

export type PluginResponse =
  | { id: number; result: unknown }
  | { id: number | null; error: { code: PluginErrorCode; message: string } };

/** The largest message, either direction, in UTF-8 bytes. */
export const PLUGIN_MESSAGE_LIMIT_BYTES = 1024 * 1024;
/** Calls one session may have running at once. */
export const PLUGIN_MAX_IN_FLIGHT = 16;
/** Rows a query answers with; past this it says `truncated`. */
export const PLUGIN_QUERY_ROW_LIMIT = 5000;

/** The window message that carries a session's port into a plugin frame. */
export const PLUGIN_PORT_MESSAGE = 'minerva.plugin-port';
