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
export const PLUGIN_API_VERSION = '1.11.0';

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
  'ui.showNoteMenu': { capability: 'ui', describes: "Show Minerva's own menu for notes it was given, at a point in the frame; the user picks, Minerva acts." },
  'ui.previewNote': { capability: 'ui', describes: "Show Minerva's hover preview of a note it was given, beside a box in the frame." },
  'ui.hidePreview': { capability: 'ui', describes: 'Let the hover preview of a note go.' },
  'view.provideExport': { capability: 'ui', describes: "Answer an export request: the view as static HTML, inline styles only; Minerva sanitizes it." },
  'view.click': { capability: 'ui', describes: "Click a note in the view, as the view's own rows are: a plain click opens it, ⌘/⇧ select." },
  'view.selectAll': { capability: 'ui', describes: "Select every note in the view (⌘A)." },
  'view.clearSelection': { capability: 'ui', describes: "Clear the view's selection (Escape)." },
  'view.moveCard': { capability: 'notes:write-properties', describes: "Move a note to one of the view's groups: Minerva sets its grouping property, with undo." },
  'view.undoMove': { capability: 'notes:write-properties', describes: "Undo the view's last move (⌘Z on a board)." },
  'view.moveColumn': { capability: 'ui', describes: "Move one of the view's groups before or after another; the order stays with the view." },
  'view.reschedule': { capability: 'notes:write-properties', describes: "Move a dated note by whole days: Minerva shifts its start and end, with undo (a calendar's drag)." },
  'view.setHeight': { capability: 'ui', describes: "Say how tall a live block's frame should be, in CSS pixels; Minerva sizes it, within limits." },
  'llm.propose': { capability: 'llm:propose', describes: "Ask the assistant for changes to notes it was given, or new notes: each one is filed as a proposal the user reviews. Uses the user's model, asked first." },
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
  'ui.showNoteMenu': { paths: string[]; x: number; y: number; target?: boolean; label?: string };
  /**
   * `extra`: plain lines the preview shows under the note's (a timeline's
   * dates, say), at most PLUGIN_PREVIEW_MAX_EXTRA of PLUGIN_PREVIEW_MAX_EXTRA_CHARS.
   * `omit`: properties left off the preview's field strip, because the
   * drawing already shows them (#2829).
   */
  'ui.previewNote': { path: string; x: number; y: number; width: number; height: number; via?: 'pointer' | 'focus'; extra?: string[]; omit?: string[] };
  'ui.hidePreview': { path: string; via?: 'pointer' | 'focus' };
  'view.provideExport': { requestId: string; html: string };
  'view.click': { path: string; meta?: boolean; ctrl?: boolean; shift?: boolean };
  'view.selectAll': Record<string, never>;
  'view.clearSelection': Record<string, never>;
  'view.moveCard': { path: string; target: PluginMoveTarget };
  'view.undoMove': Record<string, never>;
  'view.moveColumn': { key: string; target: string; side: 'before' | 'after' };
  /** `days`: a whole number, not 0, at most PLUGIN_RESCHEDULE_MAX_DAYS either way. */
  'view.reschedule': { path: string; days: number };
  /** `height`: CSS pixels, from PLUGIN_BLOCK_MIN_HEIGHT to PLUGIN_BLOCK_MAX_HEIGHT; outside it is clamped. */
  'view.setHeight': { height: number };
  /**
   * `prompt`: what to ask, at most PLUGIN_LLM_MAX_PROMPT_CHARS. `notes`: notes
   * it was given, at most PLUGIN_LLM_MAX_NOTES, which the model reads and may
   * propose rewriting or setting properties on (#2858).
   */
  'llm.propose': { prompt: string; notes?: string[] };
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
  'ui.showNoteMenu': Record<string, never>;
  'ui.previewNote': Record<string, never>;
  'ui.hidePreview': Record<string, never>;
  'view.provideExport': Record<string, never>;
  'view.click': Record<string, never>;
  'view.selectAll': Record<string, never>;
  'view.clearSelection': Record<string, never>;
  'view.moveCard': Record<string, never>;
  'view.undoMove': Record<string, never>;
  'view.moveColumn': Record<string, never>;
  'view.reschedule': Record<string, never>;
  'view.setHeight': Record<string, never>;
  /**
   * What was filed: one proposal per change, which the user reviews. `leftOut`
   * names each change the answer asked for that Minerva didn't file, and why.
   */
  'llm.propose': {
    summary: string;
    proposals: { kind: 'rewrite' | 'create' | 'setProperties'; path: string }[];
    leftOut: { change: number; reason: string }[];
    model: string;
    usage: { inputTokens: number; outputTokens: number };
  };
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
 * - `export` (#2828): draw the view for an export (`view.exportMode`) and
 *   answer with `view.provideExport({ requestId, html })`.
 * - `preview` (#2828): what Minerva's hover preview of a note says, while it
 *   shows (null when it goes) — for the note's accessible description in the
 *   frame, since `aria-describedby` can't reach the preview outside it.
 * - `query` (#2640): a global view's declared query, as Minerva ran it — sent
 *   on connect and whenever the graph changes. The notes its rows name are
 *   the session's scope.
 * - `block` (#2641): a live block — its text, the note it sits in, its
 *   declared query's results, and whether it's drawing for an export. Sent
 *   on connect and whenever the graph changes; an export's `export` request
 *   follows it.
 */
export interface PluginEvents {
  theme: { mode: string; vars: Record<string, string> };
  drop: { paths: string[]; x: number; y: number };
  view: PluginViewState;
  export: { requestId: string };
  preview: { path: string; description: string | null };
  query: PluginQueryResults;
  block: PluginBlockState;
}

/**
 * A live block, as the plugin drawing it sees it (#2641). Its scope is
 * `notePath` plus the notes `query` names.
 */
export type PluginBlockState = {
  /** Which of the plugin's blocks (its `code.blocks` id). */
  block: string;
  /** The block's own text: a fence's body, or a directive's lines between its opening and `:::`. */
  source: string;
  /** The note it sits in. */
  notePath: string;
  /** Its declared query, as Minerva ran it; null when it declares none. */
  query: PluginQueryResults | null;
  /** Drawing for an export: answer the `export` event with static HTML. */
  exportMode: boolean;
};

/**
 * A global view's query, as Minerva ran it (#2640). `rows` are the SPARQL
 * results, each variable's lexical value; `notes` maps every value in them
 * that is a note's IRI to its path — what `ui.openNote` and `notes.read`
 * take, since those notes are the view's scope. A query that failed has no
 * rows and says why in `error`.
 */
export type PluginQueryResults = {
  columns: string[];
  rows: Record<string, string>[];
  notes: Record<string, string>;
  truncated: boolean;
  error: string | null;
};

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
  /** The view's filters, already applied to `instances` (#2829): a timeline's Fit stays inside a date range one. */
  filters: PluginViewFilter[];
  /** The viewer's week (#2829), from their settings on this machine: what a calendar draws its rows by. */
  week: PluginViewWeek;
  /** An embed or export: nothing that writes the spec or a note. */
  readOnly: boolean;
  /** Drawing for an export snapshot. */
  exportMode: boolean;
  /** The notes selected in the view (#2828) — the host's selection, drawn by the plugin. */
  selected: string[];
  /** The view multi-selects (the panel); false in an embed or export. */
  selectable: boolean;
  /** A note has a menu (`ui.showNoteMenu`), so it takes focus and the menu key. */
  rowMenu: boolean;
  /** A grouped layout (a board, #2828): the grouping property, null when the type has none. */
  groupProperty: string | null;
  /** …and its groups, in order — Minerva's, with the view's filters and column order applied. */
  groups: PluginViewGroup[];
  /** The notes can be moved between groups (`view.moveCard`) and the order changed (`view.moveColumn`). */
  movable: boolean;
  /** There is a move to undo (`view.undoMove`). */
  canUndoMove: boolean;
  /** The last move or undo that wrote something, so a moved card can keep focus. */
  lastMove: { seq: number; paths: string[] } | null;
};

/**
 * One of the view's filters: the values a property may hold (`tags` with how
 * they combine), or a range on it — dates or numbers as the note writes them.
 */
export type PluginViewFilter =
  | { property: string; values: string[]; match?: 'any' | 'all' | 'none' }
  | { property: string; min: string | null; max: string | null };

/**
 * The viewer's week: the day it starts on, ISO (1 = Monday … 7 = Sunday) —
 * "automatic" already resolved from their region — and whether week numbers
 * show.
 */
export type PluginViewWeek = { start: 1 | 2 | 3 | 4 | 5 | 6 | 7; numbers: boolean };

/** One group of a grouped view: a board's column. */
export type PluginViewGroup = {
  /** Its key in `columnOrder`: what `view.moveColumn` names. */
  key: string;
  label: string;
  /** `option` — one of the property's options; `off-list` — a value it doesn't declare; `no-value` — empty. */
  kind: 'option' | 'off-list' | 'no-value';
  /** The value its notes hold; null for No value. */
  value: string | null;
  /** Its notes, in the view's order. */
  paths: string[];
};

/** Where `view.moveCard` moves a note: a group's value, label and kind. */
export type PluginMoveTarget = { value: string | null; label: string; kind: 'option' | 'off-list' | 'no-value' };

/** One of a type's properties. */
export type PluginViewProperty = { name: string; type: string; label?: string; options?: string[] };

/**
 * One note in a view: its declared property values (null where unset), and —
 * prepared by Minerva (#2828), so a plugin draws what the app would — its card
 * fields as display text, with the note a link field names, and its own type's
 * icon (a subtype's, in a parent's view).
 */
export type PluginViewInstance = {
  path: string;
  title: string;
  values: Record<string, string | null>;
  tags?: string[];
  fields: PluginViewField[];
  icon?: PluginViewIcon;
};

/** One field on a note's card: as the app shows it, and the note a link names. */
export type PluginViewField = { name: string; label: string; text: string; ref?: string };

/** A type's icon: a glyph (an emoji, usually), its colour, and what it reads as. */
export type PluginViewIcon = { glyph: string; color?: string; label: string };

export type PluginEventName = keyof PluginEvents;

/** The most notes one `ui.showNoteMenu` may name. */
export const PLUGIN_NOTE_MENU_MAX_PATHS = 500;

/** A live block's frame height (`view.setHeight`), in CSS pixels. */
export const PLUGIN_BLOCK_MIN_HEIGHT = 24;
export const PLUGIN_BLOCK_MAX_HEIGHT = 4000;

/** `llm.propose` (#2858): the most its prompt may be, in characters, and the most notes it may pass. */
export const PLUGIN_LLM_MAX_PROMPT_CHARS = 8000;
export const PLUGIN_LLM_MAX_NOTES = 20;

/** How far one `view.reschedule` may move a note, in days either way (about 270 years). */
export const PLUGIN_RESCHEDULE_MAX_DAYS = 100_000;

/** A preview's extra lines (`ui.previewNote`): how many, and how long. */
export const PLUGIN_PREVIEW_MAX_EXTRA = 8;
export const PLUGIN_PREVIEW_MAX_EXTRA_CHARS = 300;

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
