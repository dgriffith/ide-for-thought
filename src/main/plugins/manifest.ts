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
import {
  PLUGIN_CONTRIBUTION_POINTS,
  type PluginContributionPoint,
  type PluginManifest,
} from '../../shared/plugins/format';

/** Lowercase letters and digits in dash-separated words: `reading-list`, `lab2`. */
export const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const MAX_PLUGIN_ID = 64;

const KNOWN_KEYS = new Set(['$schema', 'id', 'name', 'version', 'minerva', 'description', 'author', 'license', 'contributes']);

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; problems: string[] };

export interface ManifestContext {
  /** The plugin folder's name: the id must match it. */
  folder: string;
  /** The running app's version, checked against `minerva`. */
  appVersion: string;
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
    } else if (!semver.satisfies(ctx.appVersion, minerva, { includePrerelease: true })) {
      problems.push(`It needs Minerva ${minerva}; this is ${ctx.appVersion}.`);
    }
  }

  const contributes: Partial<Record<PluginContributionPoint, string[]>> = {};
  const rawContributes = raw.contributes;
  if (rawContributes === undefined) {
    problems.push('"contributes" is required.');
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
    if (Object.keys(rawContributes).length === 0) problems.push('"contributes" is empty; a plugin must contribute something.');
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    manifest: {
      id: id!, name: name!, version: version!, minerva: minerva!, description: description!,
      ...(author !== undefined ? { author } : {}),
      ...(license !== undefined ? { license } : {}),
      contributes,
    },
  };
}
