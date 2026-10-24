/**
 * The plugin host broker (#2825): one session per plugin frame (#2824) or,
 * later, worker (#2830), over one port, speaking only the plugin API
 * (`shared/plugins/api.ts`). Part of the trusted core, never a plugin.
 *
 * Every call is checked, in this order, before anything runs:
 * 1. the message: text, under the size limit, JSON, a numeric `id`, a known
 *    method, params of the right shape;
 * 2. the session: still open, the plugin still enabled, the window still on
 *    the same thoughtbase (`stillValid`, asked per call, so a session can't
 *    outlive what it was opened for);
 * 3. the capability: the method's one capability must be declared;
 * 4. the scope: a note path must be one the host gave this session, and
 *    one `agentPathRefusal` allows (never `.minerva/`, a dot-folder, the root).
 *
 * A refusal answers the call with an error code, naming the capability or
 * path, and is logged against the plugin.
 *
 * Writes are the user's (a gesture in the plugin's view), not proposals — but
 * a plugin can fake a gesture, so they are scoped to the notes it was given
 * and recorded in history as `plugin:<id>@<version>`, findable and undoable
 * (#1157). Nothing here reaches the approval engine.
 *
 * The other direction (#2830): main can **call** a plugin's logic — a handler
 * it registered with `minerva.handle(name, fn)` in its worker. `session.call`
 * sends `{ "call": n, "handler", "args" }`, and the plugin answers
 * `{ "reply": n, "result" }` or `{ "reply": n, "error": "…" }`. The runtime's
 * `handle()` announces each handler (`{ "handles": name }`); a call waits for
 * its handler to be announced, so a module that registers late misses none.
 * Deadlines are the caller's (`plugin-worker-host.ts`): this only matches
 * replies to calls, and fails the calls still waiting when the session ends.
 *
 * The broker owns no I/O: `BrokerDeps` is wired by `main/plugin-sessions.ts`,
 * so this file is tested over a fake port with fake deps.
 */
import path from 'node:path';
import { logger } from '../../shared/logger';
import { isNotePath } from '../../shared/note-extensions';
import type { PluginCapability } from '../../shared/plugins/capabilities';
import {
  isPluginMethod,
  PLUGIN_MAX_IN_FLIGHT,
  PLUGIN_MESSAGE_LIMIT_BYTES,
  PLUGIN_METHODS,
  PLUGIN_QUERY_ROW_LIMIT,
  PLUGIN_MENU_MAX_ITEMS,
  PLUGIN_NOTE_MENU_MAX_PATHS,
  PLUGIN_MENU_MAX_LABEL,
  PLUGIN_PREVIEW_MAX_EXTRA,
  PLUGIN_RESCHEDULE_MAX_DAYS,
  PLUGIN_PREVIEW_MAX_EXTRA_CHARS,
  PLUGIN_BLOCK_MAX_HEIGHT,
  PLUGIN_BLOCK_MIN_HEIGHT,
  type PluginErrorCode,
  type PluginEventName,
  type PluginEvents,
  type PluginMenuItem,
  type PluginMoveTarget,
  type PluginMethod,
  type PluginResponse,
} from '../../shared/plugins/api';
import { readFrontmatterProperties, patchFrontmatterProperties } from '../../shared/refactor/frontmatter-patch';
import type { RevisionSource } from '../../shared/history';
import type { GraphQueryResult } from '../../shared/graph-query';
import type { PluginIntent } from '../../shared/plugins/session';

/** Who is calling: the plugin as installed now. */
export interface PluginIdentity {
  id: string;
  name: string;
  version: string;
  capabilities: readonly PluginCapability[];
}

/** One end of the session's channel, as the broker needs it. */
export interface BrokerPort {
  send(text: string): void;
  onMessage(fn: (data: unknown) => void): void;
  onClose(fn: () => void): void;
  close(): void;
}


export interface BrokerDeps {
  /** A note's text; throws when it can't be read. */
  readNote(rootPath: string, rel: string): Promise<string>;
  noteExists(rootPath: string, rel: string): Promise<boolean>;
  /** Write and reindex, recording history as `source`. */
  writeNote(rootPath: string, rel: string, content: string, source: RevisionSource): Promise<void>;
  /** Read-only SPARQL. */
  queryGraph(rootPath: string, sparql: string): Promise<GraphQueryResult>;
  /** SQL through the registered-relations allowlist, worded for a plugin. */
  querySql(rootPath: string, sql: string): Promise<{ ok: true; columns: string[]; rows: Record<string, unknown>[] } | { ok: false; error: string }>;
  /** Null when `rel` is a path a plugin may name; otherwise why not. Run on every call that uses one. */
  pathRefusal(rootPath: string, rel: string): string | null;
  /** The same, without touching the file system: what admits a path to the scope. */
  scopeRefusal(rel: string): string | null;
  intent(intent: PluginIntent): void;
  copyText(text: string): void;
  /** Draw a native context menu at the pointer; the chosen item's id, or null. */
  showMenu(items: PluginMenuItem[]): Promise<string | null>;
}

export interface PluginSessionOptions {
  identity: PluginIdentity;
  rootPath: string;
  scope: readonly string[];
  port: BrokerPort;
  deps: BrokerDeps;
  /** Asked before every call: null while the session is still good, else why it ended. */
  stillValid(): string | null;
}

export interface PluginSession {
  /** Replace the notes this session was given. */
  setScope(paths: readonly string[]): void;
  scope(): readonly string[];
  /** Add notes the user gave the view (a drop, #2827); refused paths are left out. */
  addToScope(paths: readonly string[]): string[];
  /** Tell the plugin something (#2827): `{ event, data }` on the port. */
  emit<E extends PluginEventName>(event: E, data: PluginEvents[E]): void;
  /**
   * Run one of the plugin's handlers (#2830) with `args`, JSON-able. Resolves
   * with what it returned; rejects with a `PluginCallError` when it threw, has
   * no such handler, or the session ended first.
   */
  call(handler: string, args: unknown): Promise<unknown>;
  close(): void;
  readonly closed: boolean;
  onClose(fn: () => void): void;
}

class Refusal extends Error {
  constructor(readonly code: PluginErrorCode, message: string) { super(message); }
}

/** A call to a plugin's handler that didn't return a result (#2830). The message names the plugin. */
export class PluginCallError extends Error {
  constructor(message: string) { super(message); this.name = 'PluginCallError'; }
}

/** A handler's name: what `minerva.handle(name, …)` registers. */
export const PLUGIN_HANDLER_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** JSON that survives DuckDB's BigInt columns. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v !== 'bigint') return v;
    return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  });
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** A note path as the scope stores it: forward slashes, no `./`. */
function normalizeRel(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '');
}

// ── params ──────────────────────────────────────────────────────────────────

/** A context menu as asked for: items with an id and a label, or separators, within limits. */
function menuItems(raw: unknown): PluginMenuItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Refusal('bad-request', '"items" must be a non-empty list.');
  if (raw.length > PLUGIN_MENU_MAX_ITEMS) throw new Refusal('bad-request', `A menu holds at most ${PLUGIN_MENU_MAX_ITEMS} items.`);
  return raw.map((item: unknown, i) => {
    if (item === null || typeof item !== 'object') throw new Refusal('bad-request', `items[${i}] must be an object.`);
    const r = item as Record<string, unknown>;
    if (r.separator === true) return { separator: true as const };
    if (typeof r.id !== 'string' || r.id.length === 0) throw new Refusal('bad-request', `items[${i}].id must be a string.`);
    if (typeof r.label !== 'string' || r.label.trim() === '') throw new Refusal('bad-request', `items[${i}].label must be a string.`);
    if (r.label.length > PLUGIN_MENU_MAX_LABEL) throw new Refusal('bad-request', `items[${i}].label is over ${PLUGIN_MENU_MAX_LABEL} characters.`);
    return { id: r.id, label: r.label, ...(r.enabled === false ? { enabled: false } : {}) };
  });
}

function asParams(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal('bad-request', 'params must be an object.');
  return raw as Record<string, unknown>;
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string') throw new Refusal('bad-request', `"${key}" must be a string.`);
  return v;
}

function moveTargetParam(raw: unknown): PluginMoveTarget {
  if (raw === null || typeof raw !== 'object') throw new Refusal('bad-request', '"target" must be a group: { value, label, kind }.');
  const t = raw as Record<string, unknown>;
  if (t.kind !== 'option' && t.kind !== 'off-list' && t.kind !== 'no-value') throw new Refusal('bad-request', '"target.kind" is "option", "off-list" or "no-value".');
  if (typeof t.label !== 'string') throw new Refusal('bad-request', '"target.label" must be a string.');
  if (t.kind === 'no-value' ? t.value !== null : typeof t.value !== 'string') throw new Refusal('bad-request', '"target.value" is the group\'s value, null only for No value.');
  return { value: t.value as string | null, label: t.label.slice(0, PLUGIN_MENU_MAX_LABEL), kind: t.kind };
}

/** An optional list of strings: at most `max` of them, each cut to `chars`. Absent → []. */
function stringsParam(params: Record<string, unknown>, key: string, max: number, chars: number): string[] {
  const raw = params[key];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Refusal('bad-request', `"${key}" must be a list of strings.`);
  if (raw.length > max) throw new Refusal('bad-request', `"${key}" has at most ${max} entries.`);
  return raw.map((v, i) => {
    if (typeof v !== 'string') throw new Refusal('bad-request', `${key}[${i}] must be a string.`);
    return v.slice(0, chars);
  });
}

function numberParam(params: Record<string, unknown>, key: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Refusal('bad-request', `"${key}" must be a number.`);
  return v;
}

function viaParam(params: Record<string, unknown>): 'pointer' | 'focus' {
  const v = params.via ?? 'pointer';
  if (v !== 'pointer' && v !== 'focus') throw new Refusal('bad-request', '"via" is "pointer" or "focus".');
  return v;
}

function recordParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Refusal('bad-request', `"${key}" must be an object.`);
  return v as Record<string, unknown>;
}

// ── the session ─────────────────────────────────────────────────────────────

export function createPluginSession(opts: PluginSessionOptions): PluginSession {
  const { identity, rootPath, port, deps } = opts;
  const provenance = `plugin:${identity.id}@${identity.version}`;
  const declared = new Set<PluginCapability>(identity.capabilities);
  const log = logger('plugins');
  let scope = new Set<string>();
  let inFlight = 0;
  let closed = false;
  const closeListeners: Array<() => void> = [];
  // Calls to the plugin's handlers (#2830), waiting for its reply.
  let nextCall = 1;
  const calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  // Handlers the plugin announced, and calls waiting for one to be.
  const handlers = new Set<string>();
  const awaitingHandler = new Map<string, Array<() => void>>();

  /** The paths a plugin may be given, normalized; the rest logged and dropped. */
  const admissible = (paths: readonly string[]): string[] => {
    const out: string[] = [];
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      const rel = normalizeRel(p);
      // Cheap here, on purpose: a big view's scope is thousands of paths, and
      // `scoped()` runs the full check (links included) on every call anyway.
      const why = deps.scopeRefusal(rel);
      if (why) {
        log.warn(`plugin ${identity.id}: left ${JSON.stringify(p)} out of its scope: ${why}`);
        continue;
      }
      out.push(rel);
    }
    return out;
  };
  const setScope = (paths: readonly string[]) => { scope = new Set(admissible(paths)); };
  setScope(opts.scope);

  const close = () => {
    if (closed) return;
    closed = true;
    for (const waiter of calls.values()) waiter.reject(new PluginCallError(`${identity.name}'s session ended before it answered.`));
    calls.clear();
    port.close();
    for (const fn of closeListeners.splice(0)) fn();
  };

  const reply = (response: PluginResponse) => {
    if (closed) return;
    let text = stringify(response);
    if (byteLength(text) > PLUGIN_MESSAGE_LIMIT_BYTES) {
      text = stringify({
        id: response.id,
        error: { code: 'too-large', message: `The answer is over ${PLUGIN_MESSAGE_LIMIT_BYTES} bytes. Ask for less.` },
      } satisfies PluginResponse);
    }
    port.send(text);
  };

  /** A path the session was given, normalized; refuses anything else. */
  const scoped = (raw: string): string => {
    const rel = normalizeRel(raw);
    const why = deps.pathRefusal(rootPath, rel);
    if (why) throw new Refusal('scope', `"${raw}" is not a note a plugin can reach: ${why}.`);
    if (!scope.has(rel)) throw new Refusal('scope', `"${raw}" is not one of the notes this view was given.`);
    return rel;
  };

  /** A scoped note's text; a missing one is `failed`, without main's path in the message. */
  const readScoped = async (rel: string): Promise<string> => {
    if (!(await deps.noteExists(rootPath, rel))) throw new Refusal('failed', `"${rel}" doesn't exist.`);
    return deps.readNote(rootPath, rel);
  };

  const historySource = (): RevisionSource => ({ origin: 'plugin', cause: `${identity.name} (${provenance})` });

  const truncate = <T>(rows: readonly T[]) => ({
    rows: rows.slice(0, PLUGIN_QUERY_ROW_LIMIT),
    truncated: rows.length > PLUGIN_QUERY_ROW_LIMIT,
  });

  const run = async (method: PluginMethod, params: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
      case 'notes.list':
        return { paths: [...scope].sort() };
      case 'notes.read': {
        const rel = scoped(stringParam(params, 'path'));
        const content = await readScoped(rel);
        return { path: rel, content, properties: readFrontmatterProperties(content) };
      }
      case 'graph.query': {
        const result = await deps.queryGraph(rootPath, stringParam(params, 'sparql'));
        if (!result.ok) throw new Refusal('failed', result.error);
        return { columns: result.columns, ...truncate(result.results) };
      }
      case 'tables.query': {
        const result = await deps.querySql(rootPath, stringParam(params, 'sql'));
        if (!result.ok) throw new Refusal('failed', result.error);
        return { columns: result.columns, ...truncate(result.rows) };
      }
      case 'notes.setProperties': {
        const rel = scoped(stringParam(params, 'path'));
        const patch = recordParam(params, 'properties');
        const before = await readScoped(rel);
        const { content, changedKeys } = patchFrontmatterProperties(before, patch);
        if (changedKeys.length > 0) await deps.writeNote(rootPath, rel, content, historySource());
        return { changed: changedKeys };
      }
      case 'notes.write': {
        const rel = scoped(stringParam(params, 'path'));
        await deps.writeNote(rootPath, rel, stringParam(params, 'content'), historySource());
        return {};
      }
      case 'notes.create': {
        const raw = stringParam(params, 'path');
        const rel = normalizeRel(raw);
        const why = deps.pathRefusal(rootPath, rel);
        if (why) throw new Refusal('scope', `"${raw}" is not a place a plugin can create a note: ${why}.`);
        if (!isNotePath(rel)) throw new Refusal('bad-request', `"${raw}" is not a note: use .md, .ttl, .csv or .py.`);
        if (await deps.noteExists(rootPath, rel)) throw new Refusal('failed', `"${raw}" already exists.`);
        await deps.writeNote(rootPath, rel, stringParam(params, 'content'), historySource());
        scope.add(rel);
        return { path: rel };
      }
      case 'ui.openNote':
        deps.intent({ kind: 'openNote', path: scoped(stringParam(params, 'path')) });
        return {};
      case 'ui.announce':
        deps.intent({ kind: 'announce', text: stringParam(params, 'text').slice(0, 500) });
        return {};
      case 'ui.copyText':
        deps.copyText(stringParam(params, 'text'));
        return {};
      case 'ui.revealNote':
        deps.intent({ kind: 'revealNote', path: scoped(stringParam(params, 'path')) });
        return {};
      case 'ui.showMenu':
        return { id: await deps.showMenu(menuItems(params.items)) };
      case 'ui.releaseFocus':
        deps.intent({ kind: 'releaseFocus' });
        return {};
      case 'ui.forwardKey': {
        const flag = (k: string) => params[k] === true;
        const key = stringParam(params, 'key');
        if (key.length === 0 || key.length > 32) throw new Refusal('bad-request', '"key" must be a key name, like "k".');
        deps.intent({ kind: 'key', key, meta: flag('meta'), ctrl: flag('ctrl'), alt: flag('alt'), shift: flag('shift') });
        return {};
      }
      case 'view.setState': {
        const patch = recordParam(params, 'patch');
        if (Object.keys(patch).length > 32) throw new Refusal('bad-request', 'A view state patch holds at most 32 fields.');
        deps.intent({ kind: 'setViewState', patch });
        return {};
      }
      case 'ui.showNoteMenu': {
        const raw = params.paths;
        if (!Array.isArray(raw) || raw.length === 0) throw new Refusal('bad-request', '"paths" must be a non-empty list.');
        if (raw.length > PLUGIN_NOTE_MENU_MAX_PATHS) throw new Refusal('bad-request', `A note menu names at most ${PLUGIN_NOTE_MENU_MAX_PATHS} notes.`);
        const paths = [...new Set(raw.map((p, i) => {
          if (typeof p !== 'string') throw new Refusal('bad-request', `paths[${i}] must be a string.`);
          return scoped(p);
        }))];
        const target = params.target === true;
        if (target && paths.length !== 1) throw new Refusal('bad-request', 'A menu for a named note names exactly one note.');
        const label = typeof params.label === 'string' ? params.label.slice(0, PLUGIN_MENU_MAX_LABEL) : null;
        deps.intent({ kind: 'showNoteMenu', paths, x: numberParam(params, 'x'), y: numberParam(params, 'y'), target, label });
        return {};
      }
      case 'ui.previewNote': {
        const path = scoped(stringParam(params, 'path'));
        const rect = { x: numberParam(params, 'x'), y: numberParam(params, 'y'), width: numberParam(params, 'width'), height: numberParam(params, 'height') };
        const extra = stringsParam(params, 'extra', PLUGIN_PREVIEW_MAX_EXTRA, PLUGIN_PREVIEW_MAX_EXTRA_CHARS);
        const omit = stringsParam(params, 'omit', PLUGIN_MENU_MAX_ITEMS, PLUGIN_MENU_MAX_LABEL);
        deps.intent({ kind: 'previewNote', path, rect, via: viaParam(params), extra, omit });
        return {};
      }
      case 'ui.hidePreview':
        deps.intent({ kind: 'hidePreview', path: normalizeRel(stringParam(params, 'path')), via: viaParam(params) });
        return {};
      case 'view.provideExport': {
        const requestId = stringParam(params, 'requestId');
        if (requestId.length === 0 || requestId.length > 64) throw new Refusal('bad-request', '"requestId" must be the id the export event carried.');
        deps.intent({ kind: 'exportHtml', requestId, html: stringParam(params, 'html') });
        return {};
      }
      case 'view.click': {
        const flag = (k: string) => params[k] === true;
        deps.intent({ kind: 'viewClick', path: scoped(stringParam(params, 'path')), meta: flag('meta'), ctrl: flag('ctrl'), shift: flag('shift') });
        return {};
      }
      case 'view.selectAll':
        deps.intent({ kind: 'selectAll' });
        return {};
      case 'view.clearSelection':
        deps.intent({ kind: 'clearSelection' });
        return {};
      case 'view.moveCard': {
        const path = scoped(stringParam(params, 'path'));
        deps.intent({ kind: 'moveCard', path, target: moveTargetParam(params.target) });
        return {};
      }
      case 'view.undoMove':
        deps.intent({ kind: 'undoMove' });
        return {};
      case 'view.moveColumn': {
        const side = params.side;
        if (side !== 'before' && side !== 'after') throw new Refusal('bad-request', '"side" is "before" or "after".');
        deps.intent({ kind: 'moveColumn', key: stringParam(params, 'key'), target: stringParam(params, 'target'), side });
        return {};
      }
      case 'view.reschedule': {
        const path = scoped(stringParam(params, 'path'));
        const days = params.days;
        if (typeof days !== 'number' || !Number.isInteger(days) || days === 0 || Math.abs(days) > PLUGIN_RESCHEDULE_MAX_DAYS) {
          throw new Refusal('bad-request', `"days" is a whole number of days, not 0, at most ${PLUGIN_RESCHEDULE_MAX_DAYS} either way.`);
        }
        deps.intent({ kind: 'reschedule', path, days });
        return {};
      }
      case 'view.setHeight': {
        const height = Math.round(numberParam(params, 'height'));
        deps.intent({ kind: 'setHeight', height: Math.min(PLUGIN_BLOCK_MAX_HEIGHT, Math.max(PLUGIN_BLOCK_MIN_HEIGHT, height)) });
        return {};
      }
      case 'llm.propose':
        throw new Refusal('unavailable', 'llm.propose is not available yet (#2858).');
    }
  };

  const handle = async (data: unknown) => {
    let id: number | null = null;
    let method: PluginMethod | null = null;
    try {
      if (typeof data !== 'string') throw new Refusal('bad-request', 'Messages are JSON text.');
      if (byteLength(data) > PLUGIN_MESSAGE_LIMIT_BYTES) throw new Refusal('too-large', `Messages are limited to ${PLUGIN_MESSAGE_LIMIT_BYTES} bytes.`);
      let msg: unknown;
      try {
        msg = JSON.parse(data);
      } catch {
        throw new Refusal('bad-request', 'The message is not JSON.');
      }
      if (msg === null || typeof msg !== 'object') throw new Refusal('bad-request', 'A message is an object.');
      const req = msg as Record<string, unknown>;
      // A handler announced, or withdrawn (#2830).
      if (typeof req.handles === 'string' && PLUGIN_HANDLER_NAME.test(req.handles)) {
        handlers.add(req.handles);
        for (const go of awaitingHandler.get(req.handles)?.splice(0) ?? []) go();
        return;
      }
      if (typeof req.unhandles === 'string') {
        handlers.delete(req.unhandles);
        return;
      }
      // A reply to a call of ours (#2830), not a request.
      if (typeof req.reply === 'number') {
        const waiter = calls.get(req.reply);
        if (!waiter) return;
        calls.delete(req.reply);
        if (req.error !== undefined) waiter.reject(new PluginCallError(`${identity.name}: ${(typeof req.error === 'string' ? req.error : JSON.stringify(req.error)).slice(0, 500)}`));
        else waiter.resolve(req.result);
        return;
      }
      if (typeof req.id !== 'number' || !Number.isFinite(req.id)) throw new Refusal('bad-request', 'A message needs a numeric "id".');
      id = req.id;
      if (typeof req.method !== 'string' || !isPluginMethod(req.method)) {
        throw new Refusal('unknown-method', `${JSON.stringify(req.method)} is not a plugin API method.`);
      }
      method = req.method;
      const params = asParams(req.params);

      const ended = opts.stillValid();
      if (ended) {
        reply({ id, error: { code: 'unavailable', message: ended } });
        close();
        return;
      }
      const capability = PLUGIN_METHODS[method].capability;
      if (!declared.has(capability)) {
        throw new Refusal('capability', `${method} needs the "${capability}" capability, which ${identity.name} doesn't declare.`);
      }
      if (inFlight >= PLUGIN_MAX_IN_FLIGHT) throw new Refusal('busy', `${PLUGIN_MAX_IN_FLIGHT} calls are already running.`);
      inFlight += 1;
      try {
        reply({ id, result: await run(method, params) });
      } finally {
        inFlight -= 1;
      }
    } catch (e) {
      if (e instanceof Refusal) {
        if (e.code !== 'failed') log.warn(`plugin ${identity.id}: refused (${e.code}): ${e.message}`);
        reply({ id, error: { code: e.code, message: e.message } });
        return;
      }
      // An unexpected error stays in main's log: its message can hold an
      // absolute path or other detail of this machine the plugin has no use for.
      log.warn(`plugin ${identity.id}: ${method ?? 'call'} failed:`, e);
      reply({ id, error: { code: 'failed', message: `${method ?? 'The call'} failed; the details are in Minerva's log.` } });
    }
  };

  const emit = <E extends PluginEventName>(event: E, data: PluginEvents[E]) => {
    if (closed) return;
    const text = stringify({ event, data });
    if (byteLength(text) > PLUGIN_MESSAGE_LIMIT_BYTES) {
      log.warn(`plugin ${identity.id}: a ${event} event was over the size limit and wasn't sent`);
      return;
    }
    port.send(text);
  };

  port.onMessage((data) => { void handle(data); });
  port.onClose(close);

  return {
    setScope,
    scope: () => [...scope].sort(),
    addToScope: (paths) => {
      const added = [...new Set(admissible(paths))];
      for (const rel of added) scope.add(rel);
      return added;
    },
    emit,
    call: (handler, args) => {
      if (closed) return Promise.reject(new PluginCallError(`${identity.name}'s session has ended.`));
      if (!PLUGIN_HANDLER_NAME.test(handler)) return Promise.reject(new PluginCallError(`"${handler}" isn't a handler name.`));
      const n = nextCall++;
      const text = stringify({ call: n, handler, args });
      if (byteLength(text) > PLUGIN_MESSAGE_LIMIT_BYTES) {
        return Promise.reject(new PluginCallError(`What ${identity.name} was to be given is over ${PLUGIN_MESSAGE_LIMIT_BYTES} bytes.`));
      }
      return new Promise((resolve, reject) => {
        calls.set(n, { resolve, reject });
        const send = () => { if (!closed && calls.has(n)) port.send(text); };
        if (handlers.has(handler)) send();
        else awaitingHandler.set(handler, [...(awaitingHandler.get(handler) ?? []), send]);
      });
    },
    close,
    get closed() { return closed; },
    onClose: (fn) => { if (closed) fn(); else closeListeners.push(fn); },
  };
}
