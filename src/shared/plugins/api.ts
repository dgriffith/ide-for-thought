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
 * against, and what the typed package and ABI snapshot are built from (#2826),
 * so the two can't drift.
 *
 * Text, not structured clone, on purpose: a size limit means something, and a
 * plugin can't transfer a port, a blob or a cyclic object into main.
 */
import type { PluginCapability } from './capabilities';

/** The API's version, which the host announces when it hands over the port. */
export const PLUGIN_API_VERSION = 1;

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
  'llm.propose': Record<string, unknown>;
}

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
  'llm.propose': never;
}

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
