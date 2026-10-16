/**
 * Installing, enabling, disabling and removing plugins (#2634). Files and
 * records only: re-applying the change to the running app — skills, types,
 * queries, templates, CSL, the graph, every window — is the composition
 * root's job (`plugins-apply.ts`), which calls these.
 *
 * - **Install from a folder** copies it into `~/.minerva/plugins/<id>/`. The
 *   copy is staged in a hidden folder (the reader skips those) and checked
 *   whole (#2632) before it is moved into place, so a refused plugin leaves
 *   nothing behind, and a reinstall replaces the old copy only once the new
 *   one has passed. A source folder holding any link is refused: a copied
 *   link would point back into wherever it was installed from.
 * - **Install from a zip** unpacks it into the same staging (`zip.ts` refuses
 *   an unsafe archive) and installs what's there the same way.
 * - **Remove** deletes the plugin's folder — or, when the folder is a link
 *   (an author working in place), only the link, never what it points to —
 *   and its record.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PLUGIN_MANIFEST, type PluginPackage } from '../../shared/plugins/format';
import { PLUGIN_ID } from './manifest';
import { readPluginPackage } from './package';
import { updatePluginRecords, type PluginSource } from './state';
import { pluginRootIn, unpackPluginZip } from './zip';

/** Thrown when installing over a plugin that's already there without `replace`. */
export class PluginExistsError extends Error {
  constructor(readonly id: string) {
    super(`A plugin "${id}" is already installed.`);
    this.name = 'PluginExistsError';
  }
}

function assertInstalledId(dir: string, id: string): string {
  if (!PLUGIN_ID.test(id)) throw new Error(`"${id}" isn't a plugin id.`);
  return path.join(dir, id);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/** Turn a plugin on or off. It stays installed either way. */
export async function setPluginEnabled(dir: string, id: string, enabled: boolean): Promise<void> {
  const folder = assertInstalledId(dir, id);
  if (!(await exists(folder))) throw new Error(`No plugin "${id}" is installed.`);
  await updatePluginRecords(dir, (records) => {
    records[id] = { ...(records[id] ?? { source: { kind: 'manual' } }), enabled };
  });
}

/** Remove a plugin: its folder (or only the link, if it is one) and its record. */
export async function removePlugin(dir: string, id: string): Promise<void> {
  const folder = assertInstalledId(dir, id);
  let st;
  try {
    st = await fs.lstat(folder);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (st?.isSymbolicLink()) await fs.unlink(folder);
  else if (st) await fs.rm(folder, { recursive: true, force: true });
  await updatePluginRecords(dir, (records) => { delete records[id]; });
}

/** The first link under `dir`, if any. */
async function findLink(dir: string): Promise<string | null> {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isSymbolicLink()) return full;
    if (d.isDirectory()) {
      const deeper = await findLink(full);
      if (deeper) return deeper;
    }
  }
  return null;
}

/** The id a source folder's manifest claims — enough to stage it under. */
async function claimedId(source: string): Promise<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(source, PLUGIN_MANIFEST), 'utf-8'));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(
      code === 'ENOENT' ? `That folder has no ${PLUGIN_MANIFEST}.` : `Its ${PLUGIN_MANIFEST} couldn't be read: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  const id = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).id : undefined;
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) {
    throw new Error(`Its ${PLUGIN_MANIFEST} has no valid "id" (lowercase letters and digits in dash-separated words).`);
  }
  return id;
}

/**
 * Check a plugin staged at `staged` (named for its id, inside `staging`),
 * move it into place — a replaced copy goes only once the new one is in — and
 * record where it came from.
 */
async function finishInstall(
  dir: string,
  staging: string,
  staged: string,
  id: string,
  source: PluginSource,
  appVersion: string,
): Promise<PluginPackage> {
  const target = path.join(dir, id);
  const checked = await readPluginPackage(staged, appVersion);
  if (!checked.ok) throw new Error(`It can't be installed: ${checked.error.problems.join(' ')}`);

  const aside = path.join(staging, `.previous-${id}`);
  const replacing = await exists(target);
  if (replacing) {
    const st = await fs.lstat(target);
    if (st.isSymbolicLink()) await fs.unlink(target);
    else await fs.rename(target, aside);
  }
  try {
    await fs.rename(staged, target);
  } catch (e) {
    if (replacing && (await exists(aside))) await fs.rename(aside, target);
    throw e;
  }
  await updatePluginRecords(dir, (records) => {
    records[id] = { enabled: true, source, installedAt: new Date().toISOString() };
  });
  const installed = await readPluginPackage(target, appVersion);
  if (!installed.ok) throw new Error(installed.error.problems.join(' '));
  return installed.plugin;
}

/** A hidden staging folder in `dir` (the reader skips it), removed after `fn`. */
async function withStaging<T>(dir: string, fn: (staging: string) => Promise<T>): Promise<T> {
  await fs.mkdir(dir, { recursive: true });
  const staging = path.join(dir, `.install-${randomUUID()}`);
  await fs.mkdir(staging);
  try {
    return await fn(staging);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/**
 * Copy the plugin in `source` into `dir`, checked whole first. Throws
 * `PluginExistsError` when one of that id is installed and `replace` isn't
 * set; throws with every problem when the plugin would be refused.
 */
export async function installPluginFromFolder(
  dir: string,
  source: string,
  appVersion: string,
  opts: { replace?: boolean } = {},
): Promise<PluginPackage> {
  const src = await fs.realpath(source);
  if (!(await fs.stat(src)).isDirectory()) throw new Error('Choose the plugin\'s folder.');
  if (path.resolve(src).startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('That folder is already in the plugins folder.');
  }
  const id = await claimedId(src);
  const link = await findLink(src);
  if (link) throw new Error(`It holds a link (${path.relative(src, link)}); a plugin is copied without links, so it can't be installed.`);
  if (!opts.replace && (await exists(path.join(dir, id)))) throw new PluginExistsError(id);

  return withStaging(dir, async (staging) => {
    const staged = path.join(staging, id);
    await fs.cp(src, staged, { recursive: true, errorOnExist: true });
    return finishInstall(dir, staging, staged, id, { kind: 'folder', path: src }, appVersion);
  });
}

/**
 * Unpack the plugin in a `.zip` (#2634) and install it, checked whole first —
 * the archive safely (`zip.ts`: no escaping names, no links, bounded), then
 * the plugin (#2632). The plugin may sit at the archive's root or in its
 * single top-level folder. Records the archive's name and SHA-256.
 */
export async function installPluginFromZip(
  dir: string,
  zipPath: string,
  appVersion: string,
  opts: { replace?: boolean } = {},
): Promise<PluginPackage> {
  return withStaging(dir, async (staging) => {
    const unpacked = path.join(staging, 'unpacked');
    // Unpacking checks the archive's size first, so the hash below never
    // reads something enormous into memory.
    await unpackPluginZip(zipPath, unpacked);
    const sha256 = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
    const root = await pluginRootIn(unpacked);
    const id = await claimedId(root);
    if (!opts.replace && (await exists(path.join(dir, id)))) throw new PluginExistsError(id);
    const staged = path.join(staging, id);
    await fs.rename(root, staged);
    return finishInstall(dir, staging, staged, id, { kind: 'zip', name: path.basename(zipPath), sha256 }, appVersion);
  });
}
