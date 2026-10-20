/**
 * The plugin API package, generated from the broker's own table (#2826).
 *
 * `src/shared/plugins/api.ts` is the one source: `PLUGIN_METHODS` (each
 * method's capability and description), `PluginMethodParams` /
 * `PluginMethodResults` (its shapes), `PluginErrorCode`, and
 * `PLUGIN_API_VERSION`. The broker enforces that file; this reads it with the
 * TypeScript compiler API and writes what a plugin imports, so the two can't
 * drift:
 *
 * - `index.js` — the runtime Minerva serves at `/@minerva/plugin-api.js` in
 *   every plugin frame: the handshake and one function per method;
 * - `index.d.ts` — its types;
 * - `abi.json` — the ABI snapshot `compareAbi` checks a change against.
 *
 * Pure: text in, text out. `scripts/build-plugin-api.mjs` does the I/O.
 */
import ts from 'typescript';

/** Core methods are `<area>.<name>`. */
export const CORE_METHOD = /^[a-z]+\.[a-z][A-Za-z]*$/;
/** A fork's methods are `<slug>:<name>` (#2826), outside the ABI snapshot. */
export const EXTENSION_METHOD = /^[a-z][a-z0-9-]*:[a-z][A-Za-z.]*$/;

/** Types the generator writes itself; any other type alias in api.ts is a support type. */
const SURFACE_TYPES = new Set(['PluginErrorCode', 'PluginMethod', 'PluginEventName', 'PluginResponse']);

function unwrap(node) {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) node = node.expression;
  return node;
}

function propName(p, sf) {
  const n = p.name;
  if (ts.isStringLiteral(n) || ts.isIdentifier(n)) return n.text;
  return n.getText(sf);
}

/** A type as the ABI records it: a type literal's members, or its text. */
function shapeOf(typeNode, sf) {
  if (ts.isTypeLiteralNode(typeNode)) {
    return {
      members: typeNode.members.filter(ts.isPropertySignature).map((m) => ({
        name: propName(m, sf),
        optional: !!m.questionToken,
        type: m.type ? m.type.getText(sf).replace(/\s+/g, ' ') : 'unknown',
      })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return { text: typeNode.getText(sf).replace(/\s+/g, ' ') };
}

/** Read the API's surface out of `api.ts`'s source. */
export function readApiSource(source, fileName = 'api.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out = { version: null, portMessage: null, methods: {}, params: {}, results: {}, events: {}, types: {}, errorCodes: [] };
  const typeText = {};
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText(sf);
        const init = unwrap(d.initializer);
        if (name === 'PLUGIN_API_VERSION' && init && ts.isStringLiteral(init)) out.version = init.text;
        if (name === 'PLUGIN_PORT_MESSAGE' && init && ts.isStringLiteral(init)) out.portMessage = init.text;
        if (name === 'PLUGIN_METHODS' && init && ts.isObjectLiteralExpression(init)) {
          for (const p of init.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            const body = unwrap(p.initializer);
            const fields = {};
            for (const f of body.properties) {
              if (ts.isPropertyAssignment(f) && ts.isStringLiteral(unwrap(f.initializer))) fields[propName(f, sf)] = unwrap(f.initializer).text;
            }
            out.methods[propName(p, sf)] = { capability: fields.capability, describes: fields.describes };
          }
        }
      }
    }
    if (ts.isInterfaceDeclaration(st) && ['PluginMethodParams', 'PluginMethodResults', 'PluginEvents'].includes(st.name.text)) {
      const into = { PluginMethodParams: out.params, PluginMethodResults: out.results, PluginEvents: out.events }[st.name.text];
      for (const m of st.members) {
        if (!ts.isPropertySignature(m) || !m.type) continue;
        into[propName(m, sf)] = shapeOf(m.type, sf);
        typeText[`${st.name.text}:${propName(m, sf)}`] = m.type.getText(sf);
      }
    }
    if (ts.isTypeAliasDeclaration(st) && st.name.text === 'PluginErrorCode' && ts.isUnionTypeNode(st.type)) {
      out.errorCodes = st.type.types.map((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : t.getText(sf)));
    } else if (ts.isTypeAliasDeclaration(st) && !SURFACE_TYPES.has(st.name.text)) {
      // A type the shapes refer to (PluginMenuItem): copied into the .d.ts,
      // and into the ABI as text, so a change to it is a change to the API.
      out.types[st.name.text] = st.type.getText(sf).replace(/\s+/g, ' ');
    }
  }
  out.typeText = typeText;
  return out;
}

/** Problems with the surface itself, before anything is generated. */
export function checkApi(api) {
  const problems = [];
  if (!api.version || !/^\d+\.\d+\.\d+$/.test(api.version)) problems.push(`PLUGIN_API_VERSION must be a semver version; got ${JSON.stringify(api.version)}.`);
  if (!api.portMessage) problems.push('PLUGIN_PORT_MESSAGE is missing.');
  for (const name of Object.keys(api.methods)) {
    if (!CORE_METHOD.test(name) && !EXTENSION_METHOD.test(name)) {
      problems.push(`"${name}" is neither a core method ("<area>.<name>") nor a fork's extension ("<slug>:<name>").`);
    }
    if (!api.params[name]) problems.push(`"${name}" has no entry in PluginMethodParams.`);
    if (!api.results[name]) problems.push(`"${name}" has no entry in PluginMethodResults.`);
  }
  for (const name of [...Object.keys(api.params), ...Object.keys(api.results)]) {
    if (!api.methods[name]) problems.push(`"${name}" has shapes but isn't in PLUGIN_METHODS.`);
  }
  return [...new Set(problems)];
}

/** The ABI snapshot: core methods only; a fork's extensions are its own. */
export function abiOf(api) {
  const methods = {};
  for (const name of Object.keys(api.methods).filter((m) => CORE_METHOD.test(m)).sort()) {
    methods[name] = { capability: api.methods[name].capability, params: api.params[name], result: api.results[name] };
  }
  const events = Object.fromEntries(Object.keys(api.events).sort().map((e) => [e, api.events[e]]));
  const types = Object.fromEntries(Object.keys(api.types).sort().map((t) => [t, api.types[t]]));
  return { version: api.version, errorCodes: [...api.errorCodes].sort(), types, events, methods };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What changed between two ABI snapshots: `breaking` (a plugin written
 * against `prev` can fail against `next`) and `additions` (it can't).
 * Breaking: a method or error code removed; a capability changed; a param
 * removed, retyped, made required, or a required one added; a result field
 * removed or retyped; any change to a shape that isn't a type literal.
 */
export function compareAbi(prev, next) {
  const breaking = [];
  const additions = [];
  for (const code of prev.errorCodes) if (!next.errorCodes.includes(code)) breaking.push(`error code "${code}" removed`);
  for (const code of next.errorCodes) if (!prev.errorCodes.includes(code)) additions.push(`error code "${code}" added`);
  for (const [name, was] of Object.entries(prev.methods)) {
    const now = next.methods[name];
    if (!now) { breaking.push(`${name} removed`); continue; }
    if (was.capability !== now.capability) breaking.push(`${name} now needs "${now.capability}", not "${was.capability}"`);
    compareShape(`${name} params`, was.params, now.params, 'params', breaking, additions);
    compareShape(`${name} result`, was.result, now.result, 'result', breaking, additions);
  }
  for (const name of Object.keys(next.methods)) if (!prev.methods[name]) additions.push(`${name} added`);
  // Events are read by the plugin, like a result: a field removed or retyped breaks it.
  for (const [name, was] of Object.entries(prev.events ?? {})) {
    const now = (next.events ?? {})[name];
    if (!now) breaking.push(`event ${name} removed`);
    else compareShape(`event ${name}`, was, now, 'result', breaking, additions);
  }
  for (const name of Object.keys(next.events ?? {})) if (!(prev.events ?? {})[name]) additions.push(`event ${name} added`);
  // A support type is compared as text: any change to one already used is breaking.
  for (const [name, text] of Object.entries(prev.types ?? {})) {
    const now = (next.types ?? {})[name];
    if (now === undefined) breaking.push(`type ${name} removed`);
    else if (now !== text) breaking.push(`type ${name} changed from ${text} to ${now}`);
  }
  for (const name of Object.keys(next.types ?? {})) if (!(prev.types ?? {})[name]) additions.push(`type ${name} added`);
  return { breaking, additions };
}

function compareShape(label, was, now, side, breaking, additions) {
  if (!was.members || !now.members) {
    if (!same(was, now)) breaking.push(`${label} changed from ${JSON.stringify(was.text ?? was)} to ${JSON.stringify(now.text ?? now)}`);
    return;
  }
  const before = new Map(was.members.map((m) => [m.name, m]));
  const after = new Map(now.members.map((m) => [m.name, m]));
  for (const [key, m] of before) {
    const n = after.get(key);
    if (!n) { breaking.push(`${label}: "${key}" removed`); continue; }
    if (m.type !== n.type) breaking.push(`${label}: "${key}" is now ${n.type}, was ${m.type}`);
    if (side === 'params' && m.optional && !n.optional) breaking.push(`${label}: "${key}" is now required`);
    if (side === 'result' && !m.optional && n.optional) breaking.push(`${label}: "${key}" may now be absent`);
  }
  for (const [key, n] of after) {
    if (before.has(key)) continue;
    if (side === 'params' && !n.optional) breaking.push(`${label}: new required "${key}"`);
    else additions.push(`${label}: "${key}" added`);
  }
}

/**
 * The version rule (#2826): any change to the ABI changes the version; a
 * breaking one bumps the major, an addition at least the minor. Returns the
 * problems, empty when `next` may replace `prev`.
 */
export function versionProblems(prev, next) {
  const { breaking, additions } = compareAbi(prev, next);
  const [pM, pm] = prev.version.split('.').map(Number);
  const [nM, nm] = next.version.split('.').map(Number);
  const problems = [];
  if (breaking.length > 0 && !(nM > pM)) {
    problems.push(`Breaking change to the plugin API needs a major bump (${prev.version} → ${pM + 1}.0.0), and the old shape kept for one major:\n  - ${breaking.join('\n  - ')}`);
  } else if (additions.length > 0 && !(nM > pM || (nM === pM && nm > pm))) {
    problems.push(`Additions to the plugin API need at least a minor bump (${prev.version} → ${pM}.${pm + 1}.0):\n  - ${additions.join('\n  - ')}`);
  }
  // A bump with no change is allowed: a fix to behaviour behind the same shapes.
  return problems;
}

const HEADER = (version) =>
  `// GENERATED by scripts/build-plugin-api.mjs from src/shared/plugins/api.ts — do not edit.\n` +
  `// Minerva plugin API ${version} (#2826).`;

/** `notes.read` → ['notes', 'read']; an extension sits under `extensions`. */
function placeOf(name) {
  return CORE_METHOD.test(name) ? name.split('.') : ['extensions', name];
}

function paramsOptional(api, name) {
  const p = api.params[name];
  if (p.text) return /^Record<string, (never|unknown)>$/.test(p.text);
  return p.members.every((m) => m.optional);
}

/** The runtime, served at `/@minerva/plugin-api.js`. */
export function generateJs(api) {
  const methods = Object.keys(api.methods).sort();
  return `${HEADER(api.version)}
// Served by Minerva at /@minerva/plugin-api.js inside every plugin frame, so
// it always matches the Minerva running it:
//
//   import { connect } from '/@minerva/plugin-api.js';
//   const minerva = await connect();
//   const { paths } = await minerva.notes.list();

export const PLUGIN_API_VERSION = ${JSON.stringify(api.version)};
const PORT_MESSAGE = ${JSON.stringify(api.portMessage)};
const METHODS = ${JSON.stringify(methods, null, 2).replace(/\n/g, '\n')};

/** A call Minerva refused or couldn't complete; \`code\` says which. */
export class PluginApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PluginApiError';
    this.code = code;
  }
}

/**
 * Wait for Minerva to hand this frame its session, then answer with the API.
 * The port is taken only from the parent window, which the frame's CSP
 * (\`frame-ancestors\`) already limits to Minerva itself.
 *
 * By default (#2827) the runtime also: sets the app's theme tokens on this
 * frame's \`:root\` as they arrive (\`theme: false\` to do it yourself); gives
 * focus back to Minerva on an Escape nothing here handled; and passes on a
 * ⌘/Ctrl shortcut nothing here handled (\`keyboard: false\` for neither).
 * Both need the \`ui\` capability; without it they quietly do nothing.
 */
export function connect(options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new PluginApiError('unavailable', 'Minerva did not connect this frame in time.'));
    }, timeoutMs);
    function onMessage(e) {
      if (e.source !== window.parent || !e.data || e.data.type !== PORT_MESSAGE || !e.ports[0]) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(client(e.ports[0], String(e.data.apiVersion), options));
    }
    window.addEventListener('message', onMessage);
  });
}

function client(port, hostVersion, options) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  port.onmessage = (m) => {
    let reply;
    try { reply = JSON.parse(m.data); } catch { return; }
    if (typeof reply.event === 'string') {
      for (const fn of listeners.get(reply.event) ?? []) {
        try { fn(reply.data); } catch (err) { setTimeout(() => { throw err; }); }
      }
      return;
    }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.error) waiter.reject(new PluginApiError(reply.error.code, reply.error.message));
    else waiter.resolve(reply.result);
  };
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    port.postMessage(JSON.stringify({ id, method, params: params ?? {} }));
  });
  const quiet = (p) => { p.catch(() => {}); };
  const onKeydown = (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      quiet(call('ui.releaseFocus', {}));
    } else if ((e.metaKey || e.ctrlKey) && e.key.length > 0 && !['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) {
      quiet(call('ui.forwardKey', { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }));
    }
  };
  const api = {
    apiVersion: hostVersion,
    call,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => { listeners.get(event)?.delete(fn); };
    },
    close() {
      window.removeEventListener('keydown', onKeydown);
      port.close();
      for (const w of pending.values()) w.reject(new PluginApiError('unavailable', 'The session was closed.'));
      pending.clear();
    },
  };
  if (options.theme !== false) {
    api.on('theme', ({ mode, vars }) => {
      const root = document.documentElement;
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      root.dataset.minervaTheme = mode;
    });
  }
  if (options.keyboard !== false) window.addEventListener('keydown', onKeydown);
  for (const name of METHODS) {
    const parts = name.includes(':') ? ['extensions', name] : name.split('.');
    let at = api;
    for (const part of parts.slice(0, -1)) at = at[part] ??= {};
    at[parts[parts.length - 1]] = (params) => call(name, params);
  }
  return api;
}
`;
}

/** The types for `index.js`. */
export function generateDts(api) {
  const methods = Object.keys(api.methods).sort();
  const shapes = (side) => methods.map((m) => `  ${JSON.stringify(m)}: ${api.typeText[`${side}:${m}`]};`).join('\n');
  const tree = {};
  for (const m of methods) {
    const parts = placeOf(m);
    let at = tree;
    for (const part of parts.slice(0, -1)) at = at[part] ??= {};
    at[parts[parts.length - 1]] = m;
  }
  const render = (node, indent) => Object.entries(node).map(([key, v]) => {
    const pad = ' '.repeat(indent);
    const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    if (typeof v === 'string') {
      const { capability, describes } = api.methods[v];
      const opt = paramsOptional(api, v) ? '?' : '';
      return `${pad}/** ${describes} Needs \`${capability}\`. */\n${pad}${k}(params${opt}: PluginMethodParams[${JSON.stringify(v)}]): Promise<PluginMethodResults[${JSON.stringify(v)}]>;`;
    }
    return `${pad}readonly ${k}: {\n${render(v, indent + 2)}\n${pad}};`;
  }).join('\n');
  return `${HEADER(api.version)}

export declare const PLUGIN_API_VERSION: ${JSON.stringify(api.version)};

/** What each method takes. */
export interface PluginMethodParams {
${shapes('PluginMethodParams')}
}

/** What each method answers. */
export interface PluginMethodResults {
${shapes('PluginMethodResults')}
}

export type PluginMethod = keyof PluginMethodParams;

${Object.entries(api.types).map(([name, text]) => `export type ${name} = ${text};`).join('\n')}

/** What Minerva tells the plugin without being asked. */
export interface PluginEvents {
${Object.keys(api.events).sort().map((e) => `  ${JSON.stringify(e)}: ${api.typeText[`PluginEvents:${e}`]};`).join('\n')}
}

/** Why a call failed; see \`PluginApiError\`. */
export type PluginErrorCode = ${api.errorCodes.map((c) => JSON.stringify(c)).join(' | ')};

/** A call Minerva refused or couldn't complete. */
export declare class PluginApiError extends Error {
  readonly code: PluginErrorCode;
  constructor(code: PluginErrorCode, message: string);
}

/** This frame's session with Minerva. */
export interface MinervaPlugin {
  /** The plugin API version of the Minerva running this frame. */
  readonly apiVersion: string;
  call<M extends PluginMethod>(method: M, params: PluginMethodParams[M]): Promise<PluginMethodResults[M]>;
  /** Listen for an event; answers a function that stops listening. */
  on<E extends keyof PluginEvents>(event: E, listener: (data: PluginEvents[E]) => void): () => void;
  /** End the session; calls still waiting reject with \`unavailable\`. */
  close(): void;
${render(tree, 2)}
}

/**
 * Wait for Minerva to hand this frame its session (default 10s). \`theme: false\`
 * leaves the theme tokens to you; \`keyboard: false\` turns off Escape giving
 * focus back and unhandled shortcuts being passed on.
 */
export declare function connect(options?: { timeoutMs?: number; theme?: boolean; keyboard?: boolean }): Promise<MinervaPlugin>;
`;
}

/** The snapshot file's text. */
export function generateAbiJson(api) {
  return `${JSON.stringify(abiOf(api), null, 2)}\n`;
}
