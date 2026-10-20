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
  type PluginCode,
  type PluginContributionPoint,
  type PluginManifest,
} from '../../shared/plugins/format';
import { isPluginCapability, PLUGIN_CAPABILITIES, type PluginCapability } from '../../shared/plugins/capabilities';
import { validatePluginSettings } from './settings-schema';
import { validatePluginMcpServers } from './mcp-schema';

/** Lowercase letters and digits in dash-separated words: `reading-list`, `lab2`. */
export const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_PLUGIN_ID = 64;

const KNOWN_KEYS = new Set(['$schema', 'id', 'name', 'version', 'minerva', 'description', 'author', 'license', 'contributes', 'settings', 'mcpServers', 'code']);
/** What a `code` section may hold (#2823). Entry points join it with the frame (#2824) and the worker host (#2830). */
const CODE_KEYS = new Set(['capabilities', 'api']);

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
  // A plugin that only ships an MCP server (#2646) contributes no files.
  const shipsServers = isRecord(raw.mcpServers) && Object.keys(raw.mcpServers).length > 0;
  const mayBeEmpty = shipsServers || ctx.core === true;
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
  const code = raw.code === undefined ? undefined : validateCode(raw.code, ctx, problems);

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
 * Only a plugin built into Minerva may have one until plugin code opens to
 * installed plugins (#2833); code an installed plugin needs ships as an MCP
 * server, out of process.
 */
function validateCode(raw: unknown, ctx: ManifestContext, problems: string[]): PluginCode | undefined {
  if (!ctx.core) {
    problems.push('"code" is only for plugins built into Minerva for now. A plugin you install can\'t run code inside Minerva yet; ship the code as an MCP server instead ("mcpServers").');
    return undefined;
  }
  if (!isRecord(raw)) {
    problems.push('"code" must be an object.');
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!CODE_KEYS.has(key)) problems.push(`Unknown field "code.${key}".`);
  }
  const caps = raw.capabilities;
  if (!Array.isArray(caps) || caps.length === 0) {
    problems.push('"code.capabilities" must be a non-empty list of what the code does.');
    return undefined;
  }
  const out: PluginCapability[] = [];
  for (const c of caps) {
    if (typeof c !== 'string' || !isPluginCapability(c)) {
      problems.push(`"code.capabilities" names "${String(c)}", which isn't a capability; they are ${Object.keys(PLUGIN_CAPABILITIES).join(', ')}.`);
    } else if (out.includes(c)) {
      problems.push(`"code.capabilities" lists "${c}" twice.`);
    } else {
      out.push(c);
    }
  }
  // The plugin API's own version (#2826), not the app's.
  const api = raw.api;
  if (api === undefined) {
    if (out.some((c) => c !== 'process')) {
      problems.push(`"code.api" must say which plugin API versions the code was written for, like "^${PLUGIN_API_VERSION}".`);
    }
    return { capabilities: out };
  }
  if (typeof api !== 'string' || semver.validRange(api) === null) {
    problems.push(`"code.api" must be a semver range like "^${PLUGIN_API_VERSION}"; got ${JSON.stringify(api)}.`);
    return { capabilities: out };
  }
  if (!semver.satisfies(PLUGIN_API_VERSION, api)) {
    problems.push(`"code.api" asks for plugin API ${api}; this Minerva has ${PLUGIN_API_VERSION}.`);
  }
  return { capabilities: out, api };
}
