/**
 * Reading plugin packages from disk (#2632): `~/.minerva/plugins/<id>/`.
 *
 * Every package is checked whole, and a package with any problem is reported
 * (`PluginLoadError`) and refused — never thrown, and never half-read. One
 * bad plugin doesn't stop the others being read.
 *
 * Containment is the point of most of this. Every contributed path must:
 * - be relative, `/`-separated, with no `..` and no empty segment;
 * - sit inside its point's conventional folder (`skills/`, `types/`, …);
 * - exist, as a file with that point's extension — or, for a skill, a folder
 *   holding `SKILL.md`;
 * - resolve inside the plugin folder once links are followed
 *   (`assertSafePath`), and a contributed folder may hold no link that
 *   leaves it.
 *
 * A plugin folder may itself be a link (an author developing in place); its
 * resolved target is the root everything is contained in.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pluginCodeHash, PluginTooBigError } from './code-hash';
import { runsInMinerva } from './manifest';
import { isContainedPath } from '../path-containment';
import {
  PLUGIN_CONTRIBUTION_POINTS,
  PLUGIN_MANIFEST,
  type PluginContribution,
  type PluginContributionPoint,
  type PluginLoadError,
  type PluginMcpServer,
  type PluginPackage,
  type PluginScan,
  type PluginCode,
} from '../../shared/plugins/format';
import { validatePluginManifest } from './manifest';
import { isCorePluginId } from './core';
import { isInterpreter, pluginRelativePath } from './mcp-schema';

/** Where plugins live: per machine, never in a thoughtbase (#2615). */
export function pluginsDir(): string {
  return path.join(os.homedir(), '.minerva', 'plugins');
}

/** `plugin.json` is small; anything bigger isn't a manifest. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

/**
 * The most one contributed file may hold (#2655). Every seam reads its files
 * whole into memory, some on every catalog load, so an unbounded file is an
 * unbounded read each time; a 20 MB skill parsed without complaint. The
 * largest stock contribution is a few KB.
 */
export const MAX_CONTRIBUTION_BYTES = 1024 * 1024;

const tooBig = (where: string, bytes: number) =>
  `${where} is ${(bytes / (1024 * 1024)).toFixed(1)} MB; a contributed file may be at most ${MAX_CONTRIBUTION_BYTES / (1024 * 1024)} MB.`;

function isFsError(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

type ReadResult = { ok: true; plugin: PluginPackage } | { ok: false; error: PluginLoadError };

/** Read and check one plugin folder. */
export async function readPluginPackage(folderPath: string, appVersion: string): Promise<ReadResult> {
  const folder = path.basename(folderPath);
  const fail = (problems: string[], label = folder): ReadResult => ({ ok: false, error: { folder, label, problems } });

  let root: string;
  try {
    root = await fs.realpath(folderPath);
    if (!(await fs.stat(root)).isDirectory()) return fail(['It isn\'t a folder.']);
  } catch (e) {
    if (!isFsError(e)) throw e;
    return fail([`It couldn't be read (${e.code ?? 'error'}).`]);
  }

  // ── The manifest ──────────────────────────────────────────────────────────
  const manifestPath = path.join(root, PLUGIN_MANIFEST);
  let text: string;
  try {
    const st = await fs.lstat(manifestPath);
    if (!st.isFile()) return fail([`${PLUGIN_MANIFEST} must be a file in the plugin folder, not a link or a folder.`]);
    if (st.size > MAX_MANIFEST_BYTES) return fail([`${PLUGIN_MANIFEST} is ${Math.ceil(st.size / 1024)} KB; at most ${MAX_MANIFEST_BYTES / 1024} KB.`]);
    text = await fs.readFile(manifestPath, 'utf-8');
  } catch (e) {
    if (!isFsError(e)) throw e;
    return fail([e.code === 'ENOENT' ? `It has no ${PLUGIN_MANIFEST}.` : `${PLUGIN_MANIFEST} couldn't be read (${e.code ?? 'error'}).`]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail([`${PLUGIN_MANIFEST} isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`]);
  }
  const checked = validatePluginManifest(raw, { folder, appVersion });
  const rawRecord = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const label = typeof rawRecord.id === 'string'
    ? `${rawRecord.id}${typeof rawRecord.version === 'string' ? `@${rawRecord.version}` : ''}`
    : folder;
  if (!checked.ok) return fail(checked.problems, label);
  const { manifest } = checked;
  // A built-in plugin's id is reserved (#2820): nothing installed may stand in for it.
  if (isCorePluginId(manifest.id)) {
    return fail([`"${manifest.id}" is the id of a plugin built into Minerva; turn that one on or off in Settings → Plugins instead.`], label);
  }

  // ── Its contributions ─────────────────────────────────────────────────────
  const problems: string[] = [];
  const contributions: PluginContribution[] = [];
  const seen = new Map<string, string>();
  for (const [point, files] of Object.entries(manifest.contributes) as [PluginContributionPoint, string[]][]) {
    for (const written of files) {
      const result = await checkContribution(root, point, written);
      if (typeof result === 'string') { problems.push(result); continue; }
      const before = seen.get(result.path);
      if (before !== undefined) {
        problems.push(`"${result.path}" is listed twice (under ${before} and ${point}).`);
        continue;
      }
      seen.set(result.path, point);
      contributions.push(result);
    }
  }
  for (const server of manifest.mcpServers ?? []) {
    const problem = await checkMcpProgram(root, server);
    if (problem) problems.push(problem);
  }
  // Every file its code names is in the folder (#2833): a page, its logic, a query.
  if (manifest.code) {
    for (const rel of codeFiles(manifest.code)) {
      const abs = path.join(root, rel);
      if (!isContainedPath(root, abs) || !(await isFile(abs))) problems.push(`"${rel}", which its code names, isn't a file in the plugin.`);
    }
  }
  // Code is approved as the files it ships, all of them (#2833) — when it runs
  // inside Minerva. One that only names its MCP tools (#2880) has its servers
  // approved instead.
  let codeHash: string | undefined;
  if (manifest.code && runsInMinerva(manifest.code)) {
    try {
      codeHash = await pluginCodeHash(root);
    } catch (e) {
      if (e instanceof PluginTooBigError) problems.push(`It can't be approved: ${e.message}.`);
      else if (isFsError(e)) problems.push(`It can't be approved: a file couldn't be read (${e.code ?? 'error'}).`);
      else throw e;
    }
  }
  if (problems.length > 0) return fail(problems, label);

  return {
    ok: true,
    plugin: { manifest, root, contributions, provenance: `plugin:${manifest.id}@${manifest.version}`, ...(codeHash ? { codeHash } : {}) },
  };
}

/** The files a `code` section names: its logic, its pages, its queries — deduplicated. */
function codeFiles(code: PluginCode): string[] {
  return [...new Set([
    ...(code.worker ? [code.worker] : []),
    ...(code.views ?? []).flatMap((v) => [v.entry, v.query]),
    ...(code.blocks ?? []).flatMap((b) => [b.entry, ...(b.query ? [b.query] : [])]),
    ...(code.commands ?? []).flatMap((c) => ('query' in c.run ? [c.run.query] : [])),
    ...(code.inspections ?? []).flatMap((i) => (i.query ? [i.query] : [])),
  ])];
}

/**
 * A plugin server's program (#2646) is a file inside the plugin folder, links
 * followed: the `command` itself, or an interpreter's script. Anything else
 * would make the plugin a way to run something it doesn't carry.
 */
async function checkMcpProgram(root: string, server: PluginMcpServer): Promise<string | null> {
  const written = isInterpreter(server.command) ? server.args[0]! : server.command;
  const where = `"mcpServers.${server.key}": "${written}"`;
  const rel = pluginRelativePath(written);
  if (rel === null) return `${where} must be a relative path inside the plugin folder.`;
  let real: string;
  try {
    real = await fs.realpath(path.join(root, ...rel.split('/')));
  } catch (e) {
    if (!isFsError(e)) throw e;
    return e.code === 'ENOENT' ? `${where} doesn't exist.` : `${where} couldn't be read (${e.code ?? 'error'}).`;
  }
  if (!isContainedPath(root, real)) return `${where} leaves the plugin folder.`;
  if (!(await isFile(real))) return `${where} isn't a file.`;
  return null;
}

/** One contributed path, checked; a string is the problem. */
async function checkContribution(root: string, point: PluginContributionPoint, written: string): Promise<PluginContribution | string> {
  const spec = PLUGIN_CONTRIBUTION_POINTS[point];
  const where = `"${written}" (${point})`;
  if (written.includes('\\') || written.startsWith('/') || /^[A-Za-z]:/.test(written)) {
    return `${where} must be a relative path with "/" separators.`;
  }
  const segments = written.split('/').filter((s) => s !== '.');
  if (segments.some((s) => s === '' || s === '..')) {
    return `${where} may not contain ".." or empty segments.`;
  }
  const rel = segments.join('/');
  if (segments.length < 2 || segments[0] !== spec.folder) {
    return `${where} must be inside the plugin's ${spec.folder}/ folder.`;
  }
  const abs = path.join(root, ...segments);
  if (!isContainedPath(root, abs)) return `${where} leaves the plugin folder.`;

  let st;
  try {
    st = await fs.stat(abs);
  } catch (e) {
    if (!isFsError(e)) throw e;
    return e.code === 'ENOENT' ? `${where} doesn't exist.` : `${where} couldn't be read (${e.code ?? 'error'}).`;
  }

  if (st.isFile()) {
    const ext = path.extname(rel).toLowerCase();
    if (!(spec.extensions as readonly string[]).includes(ext)) {
      return `${where} must be a ${spec.extensions.join(' or ')} file.`;
    }
    if (st.size > MAX_CONTRIBUTION_BYTES) return tooBig(where, st.size);
    return { point, path: rel, absolutePath: abs, kind: 'file' };
  }

  if (st.isDirectory()) {
    const entry = 'folderEntry' in spec ? spec.folderEntry : undefined;
    if (!entry) return `${where} is a folder; list its files one by one.`;
    if (!(await isFile(path.join(abs, entry)))) return `${where} is a folder without a ${entry}.`;
    const entrySize = (await fs.stat(path.join(abs, entry))).size;
    if (entrySize > MAX_CONTRIBUTION_BYTES) return tooBig(`${where}'s ${entry}`, entrySize);
    const escape = await findEscapingLink(root, abs);
    if (escape) return `${where} holds a link that leaves the plugin folder: ${path.relative(root, escape)}.`;
    return { point, path: rel, absolutePath: abs, kind: 'folder' };
  }

  return `${where} is neither a file nor a folder.`;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch (e) {
    if (isFsError(e)) return false;
    throw e;
  }
}

/** The first link under `dir` that resolves outside `root`, if any. */
async function findEscapingLink(root: string, dir: string, depth = 0): Promise<string | null> {
  if (depth > 8) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const d of entries) {
    const full = path.join(dir, d.name);
    if (d.isSymbolicLink() && !isContainedPath(root, full)) return full;
    if (d.isDirectory()) {
      const deeper = await findEscapingLink(root, full, depth + 1);
      if (deeper) return deeper;
    }
  }
  return null;
}

/**
 * Every plugin under `dir` (default `~/.minerva/plugins/`), in name order.
 * Hidden entries and plain files are skipped; a missing folder is no plugins.
 */
export async function readPluginPackages(appVersion: string, dir = pluginsDir()): Promise<PluginScan> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (isFsError(e) && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { plugins: [], errors: [] };
    throw e;
  }
  const scan: PluginScan = { plugins: [], errors: [] };
  const names = entries
    .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isSymbolicLink()))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const result = await readPluginPackage(path.join(dir, name), appVersion);
    if (result.ok) scan.plugins.push(result.plugin);
    else scan.errors.push(result.error);
  }
  return scan;
}
