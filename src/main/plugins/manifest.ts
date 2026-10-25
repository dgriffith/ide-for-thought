/**
 * `plugin.json` validation (#2632). Pure: the parsed JSON in, a manifest or
 * every problem out — all of them at once, so an author fixes a manifest in
 * one pass rather than one error per reload.
 *
 * Fail closed: an unknown top-level key is a problem (a typo of `contributes`
 * would otherwise be a plugin that silently contributes nothing), and so is a
 * `contributes` key that isn't a point plugins can contribute to yet.
 */
import semver from 'semver';
import { PLUGIN_API_VERSION } from '../../shared/plugins/api';
import {
  PLUGIN_CONTRIBUTION_POINTS,
  PLUGIN_VIEW_PLACES,
  PLUGIN_COMMAND_WHEN,
  PLUGIN_HANDLER_NAME,
  type PluginCommand,
  type PluginCommandRun,
  type PluginCommandWhen,
  type PluginBlock,
  type PluginCode,
  type PluginView,
  type PluginViewPlace,
  type PluginContributionPoint,
  type PluginManifest,
} from '../../shared/plugins/format';
import { isPluginCapability, PLUGIN_CAPABILITIES, type PluginCapability } from '../../shared/plugins/capabilities';
import { validatePluginSettings } from './settings-schema';
import { validatePluginMcpServers } from './mcp-schema';
import { LIVE_DIRECTIVE_OPENERS, LIVE_FENCE_LANGS } from '../../shared/live-blocks';
import { RUNNABLE_LANGUAGE_SET } from '../../shared/compute/fences';
import { validateExporters, validateIngestors, validateInspections } from './code-io-schema';

/** Lowercase letters and digits in dash-separated words: `reading-list`, `lab2`. */
export const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_PLUGIN_ID = 64;
const isId = (id: string) => PLUGIN_ID.test(id) && id.length <= MAX_PLUGIN_ID;

const KNOWN_KEYS = new Set(['$schema', 'id', 'name', 'version', 'minerva', 'description', 'author', 'license', 'contributes', 'settings', 'mcpServers', 'code']);
/** What a `code` section may hold (#2823). Entry points join it with the frame (#2824) and the worker host (#2830). */
const CODE_KEYS = new Set(['capabilities', 'api', 'views', 'blocks', 'worker', 'commands', 'ingestors', 'exporters', 'inspections']);
const COMMAND_KEYS = new Set(['id', 'title', 'when', 'editorMenu', 'run']);
const COMMAND_RUN_KINDS = ['handler', 'skill', 'query', 'view'] as const;
/** Most commands one plugin may add (#2643). */
export const MAX_PLUGIN_COMMANDS = 32;
/** A skill's id, as a command names it: what the skills catalog keys on. */
const SKILL_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const BLOCK_KEYS = new Set(['id', 'title', 'fence', 'directive', 'entry', 'query']);
/** Most live blocks one plugin may draw (#2641). */
export const MAX_PLUGIN_BLOCKS = 16;
/** A block's fence or directive name: lowercase, a letter first, dashes between words. */
const BLOCK_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VIEW_KEYS = new Set(['id', 'title', 'place', 'entry', 'query', 'icon']);
/** Most global views one plugin may draw (#2640). */
export const MAX_PLUGIN_VIEWS = 8;

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; problems: string[] };

export interface ManifestContext {
  /** The plugin folder's name: the id must match it. */
  folder: string;
  /** The running app's version, checked against `minerva`. */
  appVersion: string;
  /**
   * A core plugin (#2820): one that ships inside the app, so its `minerva`
   * range isn't checked (it is this build), and it may contribute nothing
   * declared, because its wiring is the app's own code until plugin code
   * (#2823) gives it a `code` section to declare.
   */
  core?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validatePluginManifest(raw: unknown, ctx: ManifestContext): ManifestResult {
  if (!isRecord(raw)) return { ok: false, problems: ['plugin.json must be a JSON object.'] };
  const problems: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) problems.push(`Unknown field "${key}".`);
  }

  const str = (key: string, opts: { required: boolean; max: number }): string | undefined => {
    const v = raw[key];
    if (v === undefined) {
      if (opts.required) problems.push(`"${key}" is required.`);
      return undefined;
    }
    if (typeof v !== 'string' || v.trim() === '') {
      problems.push(`"${key}" must be a non-empty string.`);
      return undefined;
    }
    if (v.length > opts.max) problems.push(`"${key}" is ${v.length} characters; at most ${opts.max}.`);
    return v;
  };

  const id = str('id', { required: true, max: MAX_PLUGIN_ID });
  if (id !== undefined) {
    if (!PLUGIN_ID.test(id)) {
      problems.push(`"id" must be lowercase letters and digits in dash-separated words (like "reading-list"); got "${id}".`);
    } else if (id !== ctx.folder) {
      problems.push(`"id" is "${id}" but the folder is "${ctx.folder}"; they must match.`);
    }
  }
  const name = str('name', { required: true, max: 80 });
  const description = str('description', { required: true, max: 500 });
  const author = str('author', { required: false, max: 200 });
  const license = str('license', { required: false, max: 100 });

  const version = str('version', { required: true, max: 64 });
  if (version !== undefined && semver.valid(version) === null) {
    problems.push(`"version" must be a semver version like "1.0.0"; got "${version}".`);
  }

  const minerva = str('minerva', { required: true, max: 100 });
  if (minerva !== undefined) {
    if (semver.validRange(minerva) === null) {
      problems.push(`"minerva" must be a semver range like ">=4.0.0"; got "${minerva}".`);
    } else if (!ctx.core && !semver.satisfies(ctx.appVersion, minerva, { includePrerelease: true })) {
      problems.push(`It needs Minerva ${minerva}; this is ${ctx.appVersion}.`);
    }
  }

  const contributes: Partial<Record<PluginContributionPoint, string[]>> = {};
  const rawContributes = raw.contributes;
  // A plugin that only ships an MCP server (#2646) contributes no files…
  const shipsServers = isRecord(raw.mcpServers) && Object.keys(raw.mcpServers).length > 0;
  // …nor does one that is all code (#2833): its pages and logic are its contribution.
  const mayBeEmpty = shipsServers || ctx.core === true || isRecord(raw.code);
  if (rawContributes === undefined) {
    if (!mayBeEmpty) problems.push('"contributes" is required.');
  } else if (!isRecord(rawContributes)) {
    problems.push('"contributes" must be an object of extension point → files.');
  } else {
    for (const [point, files] of Object.entries(rawContributes)) {
      if (!Object.hasOwn(PLUGIN_CONTRIBUTION_POINTS, point)) {
        const open = Object.keys(PLUGIN_CONTRIBUTION_POINTS).join(', ');
        problems.push(`"contributes" names "${point}", which plugins can't contribute to; they can contribute to ${open}.`);
        continue;
      }
      if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string' && f.length > 0)) {
        problems.push(`"contributes.${point}" must be a non-empty list of file paths.`);
        continue;
      }
      contributes[point as PluginContributionPoint] = files as string[];
    }
    if (Object.keys(rawContributes).length === 0 && !mayBeEmpty) problems.push('"contributes" is empty; a plugin must contribute something.');
  }

  const settings = raw.settings === undefined ? undefined : validatePluginSettings(raw.settings, problems);
  const mcpServers = raw.mcpServers === undefined ? undefined : validatePluginMcpServers(raw.mcpServers, settings ?? [], problems);
  const code = raw.code === undefined ? undefined : validateCode(raw.code, ctx, problems, raw);

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    manifest: {
      id: id!, name: name!, version: version!, minerva: minerva!, description: description!,
      ...(author !== undefined ? { author } : {}),
      ...(license !== undefined ? { license } : {}),
      contributes,
      ...(settings !== undefined && settings.length > 0 ? { settings } : {}),
      ...(mcpServers !== undefined && mcpServers.length > 0 ? { mcpServers } : {}),
      ...(code !== undefined ? { code } : {}),
    },
  };
}

/**
 * `code` (#2823): the capabilities the plugin's code uses, from a closed list.
 * An installed plugin may have one since #2833, approved by the user against
 * a hash of everything it ships (`code-hash.ts`). Running a program
 * (`process`) stays Minerva's own plugins': an installed plugin's program
 * ships as an MCP server ("mcpServers"), approved server by server.
 */
function validateCode(raw: unknown, ctx: ManifestContext, problems: string[], rootRaw: Record<string, unknown>): PluginCode | undefined {
  if (!isRecord(raw)) {
    problems.push('"code" must be an object.');
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!CODE_KEYS.has(key)) problems.push(`Unknown field "code.${key}".`);
  }
  const caps = raw.capabilities;
  // Code that runs nothing inside Minerva (only MCP tools, #2880) may ask for nothing.
  if (!Array.isArray(caps) || (caps.length === 0 && runsInMinerva(raw))) {
    problems.push('"code.capabilities" must be a non-empty list of what the code does.');
    return undefined;
  }
  const out: PluginCapability[] = [];
  for (const c of caps) {
    if (typeof c !== 'string' || !isPluginCapability(c)) {
      problems.push(`"code.capabilities" names "${String(c)}", which isn't a capability; they are ${Object.keys(PLUGIN_CAPABILITIES).join(', ')}.`);
    } else if (out.includes(c)) {
      problems.push(`"code.capabilities" lists "${c}" twice.`);
    } else if (c === 'process' && !ctx.core) {
      problems.push('"code.capabilities" names "process", which only plugins built into Minerva may declare. A program a plugin runs ships as an MCP server instead ("mcpServers").');
    } else {
      out.push(c);
    }
  }
  const views = raw.views === undefined ? undefined : validateViews(raw.views, out, problems);
  const blocks = raw.blocks === undefined ? undefined : validateBlocks(raw.blocks, out, problems);
  // The logic module its worker host runs (#2830): a .js file in its folder, an ES module.
  const worker = raw.worker === undefined ? undefined : pluginFilePath(raw.worker, 'code.worker', '.js', problems);
  const commands = raw.commands === undefined ? undefined
    : validateCommands(raw.commands, { worker: raw.worker !== undefined, views: views ?? [] }, problems);
  const servers = isRecord(rootRaw.mcpServers) ? Object.keys(rootRaw.mcpServers) : [];
  const io = { worker: raw.worker !== undefined, isId, servers, capabilities: out, queryPath: (v: unknown, field: string, p: string[]) => pluginFilePath(v, field, '.rq', p) };
  const ingestors = raw.ingestors === undefined ? undefined : validateIngestors(raw.ingestors, io, problems);
  const exporters = raw.exporters === undefined ? undefined : validateExporters(raw.exporters, io, problems);
  const inspections = raw.inspections === undefined ? undefined : validateInspections(raw.inspections, io, problems);
  const withViews = {
    ...(views !== undefined && views.length > 0 ? { views } : {}),
    ...(blocks !== undefined && blocks.length > 0 ? { blocks } : {}),
    ...(worker !== undefined ? { worker } : {}),
    ...(commands !== undefined && commands.length > 0 ? { commands } : {}),
    ...(ingestors !== undefined && ingestors.length > 0 ? { ingestors } : {}),
    ...(exporters !== undefined && exporters.length > 0 ? { exporters } : {}),
    ...(inspections !== undefined && inspections.length > 0 ? { inspections } : {}),
  };
  // The plugin API's own version (#2826), not the app's.
  const api = raw.api;
  if (api === undefined) {
    if (out.some((c) => c !== 'process')) {
      problems.push(`"code.api" must say which plugin API versions the code was written for, like "^${PLUGIN_API_VERSION}".`);
    }
    return { capabilities: out, ...withViews };
  }
  if (typeof api !== 'string' || semver.validRange(api) === null) {
    problems.push(`"code.api" must be a semver range like "^${PLUGIN_API_VERSION}"; got ${JSON.stringify(api)}.`);
    return { capabilities: out, ...withViews };
  }
  if (!semver.satisfies(PLUGIN_API_VERSION, api)) {
    problems.push(`"code.api" asks for plugin API ${api}; this Minerva has ${PLUGIN_API_VERSION}.`);
  }
  return { capabilities: out, api, ...withViews };
}

/**
 * Whether a `code` section runs anything inside Minerva (#2880): a page or a
 * logic module. One that only names its MCP servers' tools runs nothing here,
 * so it asks for no capabilities and needs no code approval (its servers are
 * approved one by one, #2646).
 */
export function runsInMinerva(code: Record<string, unknown> | PluginCode): boolean {
  return code.worker !== undefined || code.views !== undefined || code.blocks !== undefined;
}

/**
 * A file in the plugin's folder, as a view names it: relative, `/`-separated,
 * no `..`, no dot-segment (the frame protocol wouldn't serve one), with the
 * extension it must have.
 */
function pluginFilePath(v: unknown, field: string, ext: string, problems: string[]): string | undefined {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
    problems.push(`"${field}" must be a file in the plugin's folder.`);
    return undefined;
  }
  const segments = v.split('/');
  if (v.includes('\\') || v.includes('\0') || v.startsWith('/') || segments.some((s) => s === '' || s === '..' || s.startsWith('.'))) {
    problems.push(`"${field}" must be a path inside the plugin's folder, like "views/${ext === '.rq' ? 'queue.rq' : ext === '.js' ? 'logic.js' : 'index.html'}"; got ${JSON.stringify(v)}.`);
    return undefined;
  }
  if (!v.toLowerCase().endsWith(ext)) {
    problems.push(`"${field}" must be ${ext === '.rq' ? 'a SPARQL query, an .rq file' : ext === '.js' ? 'a JavaScript module, a .js file' : 'a page, an .html file'}; got ${JSON.stringify(v)}.`);
    return undefined;
  }
  return v;
}

/**
 * `code.views` (#2640): global views. A view is a framed page fed by a query
 * Minerva runs, so it needs `ui` (a frame) and `graph:query` (what its query
 * reads).
 */
function validateViews(raw: unknown, capabilities: readonly PluginCapability[], problems: string[]): PluginView[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"code.views" must be a non-empty list of views.');
    return undefined;
  }
  if (raw.length > MAX_PLUGIN_VIEWS) problems.push(`"code.views" lists ${raw.length} views; at most ${MAX_PLUGIN_VIEWS}.`);
  for (const cap of ['ui', 'graph:query'] as const) {
    if (!capabilities.includes(cap)) problems.push(`"code.views" needs the "${cap}" capability: a view is a page fed by a query.`);
  }
  const out: PluginView[] = [];
  raw.forEach((v: unknown, i) => {
    const at = `code.views[${i}]`;
    if (!isRecord(v)) {
      problems.push(`"${at}" must be an object.`);
      return;
    }
    for (const key of Object.keys(v)) {
      if (!VIEW_KEYS.has(key)) problems.push(`Unknown field "${at}.${key}".`);
    }
    const before = problems.length;
    const id = v.id;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id) || id.length > MAX_PLUGIN_ID) {
      problems.push(`"${at}.id" must be lowercase letters and digits in dash-separated words, like "queue".`);
    } else if (out.some((o) => o.id === id)) {
      problems.push(`"code.views" has two views with the id "${id}".`);
    }
    const title = v.title;
    if (typeof title !== 'string' || title.trim() === '' || title.length > 60) {
      problems.push(`"${at}.title" must be a name of at most 60 characters.`);
    }
    const place = v.place;
    if (typeof place !== 'string' || !(PLUGIN_VIEW_PLACES as readonly string[]).includes(place)) {
      problems.push(`"${at}.place" must be one of ${PLUGIN_VIEW_PLACES.join(', ')}; got ${JSON.stringify(place)}.`);
    }
    const entry = pluginFilePath(v.entry, `${at}.entry`, '.html', problems);
    const query = pluginFilePath(v.query, `${at}.query`, '.rq', problems);
    const icon = v.icon;
    if (icon !== undefined && (typeof icon !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(icon))) {
      problems.push(`"${at}.icon" must be one of Minerva's icon names, like "bookmark".`);
    }
    if (problems.length > before) return;
    out.push({
      id: id as string, title: (title as string).trim(), place: place as PluginViewPlace, entry: entry!, query: query!,
      ...(typeof icon === 'string' ? { icon } : {}),
    });
  });
  return out;
}

/**
 * `code.commands` (#2643): what a command runs is one of four things the
 * plugin declares here, so a command can't run anything its manifest doesn't
 * show: one of its own handlers (it needs `code.worker`), a skill, a query in
 * its folder, or one of its own views.
 */
function validateCommands(raw: unknown, has: { worker: boolean; views: readonly PluginView[] }, problems: string[]): PluginCommand[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"code.commands" must be a non-empty list of commands.');
    return undefined;
  }
  if (raw.length > MAX_PLUGIN_COMMANDS) problems.push(`"code.commands" lists ${raw.length} commands; at most ${MAX_PLUGIN_COMMANDS}.`);
  const out: PluginCommand[] = [];
  raw.forEach((c: unknown, i) => {
    const at = `code.commands[${i}]`;
    if (!isRecord(c)) {
      problems.push(`"${at}" must be an object.`);
      return;
    }
    for (const key of Object.keys(c)) {
      if (!COMMAND_KEYS.has(key)) problems.push(`Unknown field "${at}.${key}".`);
    }
    const before = problems.length;
    const id = c.id;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id) || id.length > MAX_PLUGIN_ID) {
      problems.push(`"${at}.id" must be lowercase letters and digits in dash-separated words, like "sort-selection".`);
    } else if (out.some((o) => o.id === id)) {
      problems.push(`"code.commands" has two commands with the id "${id}".`);
    }
    const title = c.title;
    if (typeof title !== 'string' || title.trim() === '' || title.length > 60) {
      problems.push(`"${at}.title" must be a name of at most 60 characters.`);
    }
    const when = c.when ?? 'project';
    if (typeof when !== 'string' || !(PLUGIN_COMMAND_WHEN as readonly string[]).includes(when)) {
      problems.push(`"${at}.when" must be one of ${PLUGIN_COMMAND_WHEN.join(', ')}; got ${JSON.stringify(c.when)}.`);
    }
    if (c.editorMenu !== undefined && c.editorMenu !== true) problems.push(`"${at}.editorMenu" may only be true.`);
    const run = validateCommandRun(c.run, `${at}.run`, has, problems);
    if (problems.length > before || !run) return;
    out.push({
      id: id as string, title: (title as string).trim(), when: when as PluginCommandWhen,
      ...(c.editorMenu === true ? { editorMenu: true } : {}), run,
    });
  });
  return out;
}

function validateCommandRun(raw: unknown, at: string, has: { worker: boolean; views: readonly PluginView[] }, problems: string[]): PluginCommandRun | undefined {
  const kinds = isRecord(raw) ? Object.keys(raw) : [];
  if (!isRecord(raw) || kinds.length !== 1 || !(COMMAND_RUN_KINDS as readonly string[]).includes(kinds[0]!)) {
    problems.push(`"${at}" must be an object with exactly one of ${COMMAND_RUN_KINDS.map((k) => `"${k}"`).join(', ')}.`);
    return undefined;
  }
  const v = raw[kinds[0]!];
  switch (kinds[0] as (typeof COMMAND_RUN_KINDS)[number]) {
    case 'handler':
      if (typeof v !== 'string' || !PLUGIN_HANDLER_NAME.test(v)) {
        problems.push(`"${at}.handler" must be the name a handler registers with minerva.handle(), like "sortSelection".`);
        return undefined;
      }
      if (!has.worker) {
        problems.push(`"${at}.handler" needs "code.worker": a handler is a function in the plugin's logic module.`);
        return undefined;
      }
      return { handler: v };
    case 'skill':
      if (typeof v !== 'string' || !SKILL_ID.test(v)) {
        problems.push(`"${at}.skill" must be a skill's id, like "steelman".`);
        return undefined;
      }
      return { skill: v };
    case 'query': {
      const query = pluginFilePath(v, `${at}.query`, '.rq', problems);
      return query === undefined ? undefined : { query };
    }
    case 'view':
      if (typeof v !== 'string' || !has.views.some((view) => view.id === v)) {
        problems.push(`"${at}.view" must be the id of one of the plugin's own views in "code.views"; got ${JSON.stringify(v)}.`);
        return undefined;
      }
      return { view: v };
  }
}

/**
 * Whether `name` belongs to Minerva already: a built-in live block's fence or
 * directive, or a language a code cell runs. A plugin can't take one over, or
 * every note's `mermaid` diagram or `python` cell would become its frame.
 */
function builtInBlockName(name: string): boolean {
  if (LIVE_FENCE_LANGS.has(name) || RUNNABLE_LANGUAGE_SET.has(name)) return true;
  return LIVE_DIRECTIVE_OPENERS.some(([, opener]) => opener.test(`:::${name}`));
}

/**
 * `code.blocks` (#2641): live blocks, each a fence or a directive drawn by a
 * page of the plugin's. A block is a frame, so it needs `ui`; one with a
 * query needs `graph:query`, for what the query reads.
 */
function validateBlocks(raw: unknown, capabilities: readonly PluginCapability[], problems: string[]): PluginBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"code.blocks" must be a non-empty list of blocks.');
    return undefined;
  }
  if (raw.length > MAX_PLUGIN_BLOCKS) problems.push(`"code.blocks" lists ${raw.length} blocks; at most ${MAX_PLUGIN_BLOCKS}.`);
  if (!capabilities.includes('ui')) problems.push('"code.blocks" needs the "ui" capability: a block is a page Minerva frames.');
  const out: PluginBlock[] = [];
  const names = new Set<string>();
  raw.forEach((b: unknown, i) => {
    const at = `code.blocks[${i}]`;
    if (!isRecord(b)) {
      problems.push(`"${at}" must be an object.`);
      return;
    }
    for (const key of Object.keys(b)) {
      if (!BLOCK_KEYS.has(key)) problems.push(`Unknown field "${at}.${key}".`);
    }
    const before = problems.length;
    const id = b.id;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id) || id.length > MAX_PLUGIN_ID) {
      problems.push(`"${at}.id" must be lowercase letters and digits in dash-separated words, like "card".`);
    } else if (out.some((o) => o.id === id)) {
      problems.push(`"code.blocks" has two blocks with the id "${id}".`);
    }
    const title = b.title;
    if (typeof title !== 'string' || title.trim() === '' || title.length > 60) {
      problems.push(`"${at}.title" must be a name of at most 60 characters.`);
    }
    const hasFence = b.fence !== undefined;
    const hasDirective = b.directive !== undefined;
    if (hasFence === hasDirective) {
      problems.push(`"${at}" must name exactly one of "fence" (a \`\`\`name block) and "directive" (a :::name block).`);
    }
    const which = hasFence ? 'fence' : 'directive';
    const name = hasFence ? b.fence : b.directive;
    if (hasFence !== hasDirective) {
      if (typeof name !== 'string' || !BLOCK_NAME.test(name) || name.length > 40 || name.endsWith('-hidden')) {
        problems.push(`"${at}.${which}" must be lowercase letters and digits in dash-separated words, like "recipe-card".`);
      } else if (builtInBlockName(name)) {
        problems.push(`"${at}.${which}" is "${name}", which Minerva draws itself; pick another name.`);
      } else if (names.has(`${which}:${name}`)) {
        problems.push(`"code.blocks" has two blocks drawing the ${which} "${name}".`);
      } else {
        names.add(`${which}:${name}`);
      }
    }
    const entry = pluginFilePath(b.entry, `${at}.entry`, '.html', problems);
    const query = b.query === undefined ? undefined : pluginFilePath(b.query, `${at}.query`, '.rq', problems);
    if (b.query !== undefined && !capabilities.includes('graph:query')) {
      problems.push(`"${at}.query" needs the "graph:query" capability: Minerva runs it for the block.`);
    }
    if (problems.length > before) return;
    out.push({
      id: id as string, title: (title as string).trim(), [which]: name as string, entry: entry!,
      ...(query !== undefined ? { query } : {}),
    });
  });
  return out;
}
