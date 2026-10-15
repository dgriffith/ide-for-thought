/**
 * User-imported CSL styles + locales (#302).
 *
 * Project-scoped extension to the bundled style registry: a `.csl` file
 * dropped in `.minerva/csl-styles/<id>.csl` is recognised at export time
 * and exposed in the preview dialog's style picker. Same shape for
 * locales under `.minerva/csl-locales/<locale-id>.xml`.
 *
 * Merge policy: project files **win** on id collision against the
 * bundled set, so a user can override a built-in style with their own
 * variant without touching app source.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BUNDLED_STYLES, BUNDLED_STYLE_LABELS, BUNDLED_LOCALES } from './assets';
import type { PluginOrigin } from '../../../shared/plugins/format';
import { contributionsTo, getPluginScan } from '../../plugins/registry';
import { logger } from '../../../shared/logger';

export const USER_STYLES_DIR = '.minerva/csl-styles';
export const USER_LOCALES_DIR = '.minerva/csl-locales';

export interface UserStyleEntry {
  id: string;
  label: string;
  /** Absolute path on disk — useful for the settings UI's "remove" action. */
  filePath: string;
  /** Raw CSL XML, ready to feed citeproc-js. */
  xml: string;
}

export interface UserLocaleEntry {
  id: string;
  filePath: string;
  xml: string;
}

/**
 * Walk `.minerva/csl-styles/`, parse each `.csl` file, and return the
 * loaded entries keyed by their filename stem (the imported id).
 *
 * Files that don't parse as a CSL `<style>` are silently skipped — the
 * import path validates ahead of time, so the only way to land an
 * invalid file here is to drop it in by hand. We keep going rather
 * than failing the whole load.
 */
export async function loadUserStyles(rootPath: string): Promise<UserStyleEntry[]> {
  const dir = path.join(rootPath, USER_STYLES_DIR);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: UserStyleEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.csl')) continue;
    const id = entry.name.replace(/\.csl$/i, '');
    const filePath = path.join(dir, entry.name);
    let xml: string;
    try { xml = await fs.readFile(filePath, 'utf-8'); } catch { continue; }
    if (!isValidCslStyle(xml)) continue;
    out.push({ id, label: extractStyleTitle(xml) ?? id, filePath, xml });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export async function loadUserLocales(rootPath: string): Promise<UserLocaleEntry[]> {
  const dir = path.join(rootPath, USER_LOCALES_DIR);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: UserLocaleEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) continue;
    const id = entry.name.replace(/\.xml$/i, '').replace(/^locales-/, '');
    const filePath = path.join(dir, entry.name);
    let xml: string;
    try { xml = await fs.readFile(filePath, 'utf-8'); } catch { continue; }
    if (!isValidCslLocale(xml)) continue;
    out.push({ id, filePath, xml });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Installed plugins' citation styles and locales (#2633): a `.csl` is a
 * style, a `.xml` a locale, ids from the filename as for imported ones. A
 * plugin can't replace a bundled one, and the second plugin to claim an id is
 * skipped — both logged against the plugin. A file that isn't valid CSL is
 * skipped the same way.
 */
async function loadPluginCsl(kind: 'style' | 'locale', bundled: Readonly<Record<string, string>>): Promise<Array<{ id: string; label: string; xml: string; plugin: PluginOrigin }>> {
  const out = new Map<string, { id: string; label: string; xml: string; plugin: PluginOrigin }>();
  for (const { plugin, contribution } of contributionsTo(await getPluginScan(), 'csl-styles')) {
    const file = path.basename(contribution.absolutePath);
    const isStyle = file.toLowerCase().endsWith('.csl');
    if (isStyle !== (kind === 'style')) continue;
    const id = isStyle ? deriveStyleId(file) : deriveLocaleId(file);
    const origin = { id: plugin.manifest.id, name: plugin.manifest.name, version: plugin.manifest.version };
    const skip = (why: string) => logger('plugins').warn(`${origin.id}: CSL ${kind} ${contribution.path} skipped: ${why}`);
    if (Object.hasOwn(bundled, id)) { skip(`"${id}" is a bundled ${kind}; a plugin can't replace it`); continue; }
    const holder = out.get(id);
    if (holder) { skip(`"${id}" is already the ${holder.plugin.id} plugin's`); continue; }
    let xml: string;
    try { xml = await fs.readFile(contribution.absolutePath, 'utf-8'); } catch (e) { skip(`couldn't be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`); continue; }
    if (!(isStyle ? isValidCslStyle(xml) : isValidCslLocale(xml))) { skip(`it isn't a valid CSL ${kind}`); continue; }
    out.set(id, { id, label: (isStyle ? extractStyleTitle(xml) : null) ?? id, xml, plugin: origin });
  }
  return [...out.values()];
}

/**
 * Merged style registry: bundled < plugin < thoughtbase (#2633) — an
 * imported style wins on id collision, as it always has over bundled.
 * Returns both the raw XML map (for citeproc-js) and a labels map
 * (for UI pickers).
 */
export async function getMergedStyles(rootPath: string): Promise<{
  styles: Record<string, string>;
  labels: Record<string, string>;
  userIds: Set<string>;
  /** The styles an installed plugin supplies (and the thoughtbase hasn't replaced). */
  pluginIds: Map<string, PluginOrigin>;
}> {
  const styles: Record<string, string> = { ...BUNDLED_STYLES };
  const labels: Record<string, string> = { ...BUNDLED_STYLE_LABELS };
  const userIds = new Set<string>();
  const pluginIds = new Map<string, PluginOrigin>();
  for (const entry of await loadPluginCsl('style', BUNDLED_STYLES)) {
    styles[entry.id] = entry.xml;
    labels[entry.id] = entry.label;
    pluginIds.set(entry.id, entry.plugin);
  }
  for (const entry of await loadUserStyles(rootPath)) {
    pluginIds.delete(entry.id);
    styles[entry.id] = entry.xml;
    labels[entry.id] = entry.label;
    userIds.add(entry.id);
  }
  return { styles, labels, userIds, pluginIds };
}

export async function getMergedLocales(rootPath: string): Promise<{
  locales: Record<string, string>;
  userIds: Set<string>;
}> {
  const locales: Record<string, string> = { ...BUNDLED_LOCALES };
  const userIds = new Set<string>();
  for (const entry of await loadPluginCsl('locale', BUNDLED_LOCALES)) locales[entry.id] = entry.xml;
  for (const entry of await loadUserLocales(rootPath)) {
    locales[entry.id] = entry.xml;
    userIds.add(entry.id);
  }
  return { locales, userIds };
}

// ── Validation + metadata extraction ──────────────────────────────────────

/**
 * Cheap structural check for a CSL style file. Looks for the root
 * `<style>` element and the CSL namespace. Doesn't validate against
 * the full schema — citeproc-js will be the strict reader at render
 * time. The point here is to catch obvious garbage at import.
 */
export function isValidCslStyle(xml: string): boolean {
  return /<style\b[^>]*xmlns="http:\/\/purl\.org\/net\/xbiblio\/csl"/i.test(xml);
}

export function isValidCslLocale(xml: string): boolean {
  return /<locale\b[^>]*xmlns="http:\/\/purl\.org\/net\/xbiblio\/csl"/i.test(xml);
}

/**
 * Pull the human-readable title out of `<style><info><title>…</title></info>…`.
 * Falls back to null when not present so the caller can use the id as
 * a label of last resort.
 */
export function extractStyleTitle(xml: string): string | null {
  // Constrain the search to the <info> block so we don't pick up titles
  // appearing later in the body (e.g. macro examples).
  const info = xml.match(/<info\b[\s\S]*?<\/info>/i);
  if (!info) return null;
  const m = info[0].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return decodeXmlEntities(m[1]!.trim()) || null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ── Filename sanitisation ────────────────────────────────────────────────

/**
 * Turn an arbitrary import filename into a safe id. Allows letters,
 * digits, `-`, and `_`; everything else collapses to `-`. Empty result
 * means the caller should reject the import outright.
 */
export function deriveStyleId(filename: string): string {
  const stem = filename.replace(/\.csl$/i, '').replace(/^locales-/, '');
  const safe = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe;
}

export function deriveLocaleId(filename: string): string {
  const stem = filename.replace(/\.xml$/i, '').replace(/^locales-/, '');
  // Locale ids are short (e.g. "en-GB"); preserve case for compatibility.
  return stem.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}
