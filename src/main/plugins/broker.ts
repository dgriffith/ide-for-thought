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
  type PluginErrorCode,
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
  /** Null when `rel` is a path a plugin may name; otherwise why not. */
  pathRefusal(rootPath: string, rel: string): string | null;
  intent(intent: PluginIntent): void;
  copyText(text: string): void;
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
  close(): void;
  readonly closed: boolean;
  onClose(fn: () => void): void;
}

class Refusal extends Error {
  constructor(readonly code: PluginErrorCode, message: string) { super(message); }
}

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

  const setScope = (paths: readonly string[]) => {
    const next = new Set<string>();
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      const rel = normalizeRel(p);
      const why = deps.pathRefusal(rootPath, rel);
      if (why) {
        log.warn(`plugin ${identity.id}: left ${JSON.stringify(p)} out of its scope: ${why}`);
        continue;
      }
      next.add(rel);
    }
    scope = next;
  };
  setScope(opts.scope);

  const close = () => {
    if (closed) return;
    closed = true;
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

  port.onMessage((data) => { void handle(data); });
  port.onClose(close);

  return {
    setScope,
    scope: () => [...scope].sort(),
    close,
    get closed() { return closed; },
    onClose: (fn) => { if (closed) fn(); else closeListeners.push(fn); },
  };
}
