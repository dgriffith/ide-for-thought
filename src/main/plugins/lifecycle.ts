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
 * - **Remove** deletes the plugin's folder — or, when the folder is a link
 *   (an author working in place), only the link, never what it points to —
 *   and its record.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PLUGIN_MANIFEST, type PluginPackage } from '../../shared/plugins/format';
import { PLUGIN_ID } from './manifest';
import { readPluginPackage } from './package';
import { updatePluginRecords } from './state';

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

  const target = path.join(dir, id);
  if (!opts.replace && (await exists(target))) throw new PluginExistsError(id);

  await fs.mkdir(dir, { recursive: true });
  const staging = path.join(dir, `.install-${randomUUID()}`);
  const staged = path.join(staging, id);
  try {
    await fs.cp(src, staged, { recursive: true, errorOnExist: true });
    const checked = await readPluginPackage(staged, appVersion);
    if (!checked.ok) throw new Error(`It can't be installed: ${checked.error.problems.join(' ')}`);

    // Into place. A replaced copy is moved aside first and removed only once
    // the new one is in.
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
      records[id] = { enabled: true, source: { kind: 'folder', path: src }, installedAt: new Date().toISOString() };
    });
    const installed = await readPluginPackage(target, appVersion);
    if (!installed.ok) throw new Error(installed.error.problems.join(' '));
    return installed.plugin;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
