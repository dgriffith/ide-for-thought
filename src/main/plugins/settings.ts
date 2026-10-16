/**
 * Plugin settings' values (#2636): `~/.minerva/plugin-settings.json`, beside
 * `plugins.json`. Per machine, like the plugins themselves — never in a
 * thoughtbase.
 *
 * `{ "plugins": { "<id>": { "<key>": value } } }`. A `secret` is stored as
 * `encryptSecret` gives it back, and the file is written 0600 (#2569: with no
 * system key store the secret is still saved, as plain text only this
 * account can read, and Settings says so). A secret's value never leaves
 * main: the view says only whether one is set, and templates can't read it.
 *
 * Read leniently to display and to render, strictly to change, under the
 * file lock (#2416). A value the manifest no longer declares is ignored, and
 * dropped on the next save.
 */
import path from 'node:path';
import type {
  PluginManifest,
  PluginSetting,
  PluginSettingsPatch,
  PluginSettingsView,
  PluginSettingValue,
} from '../../shared/plugins/format';
import { asRecord, loadConfigFile, loadConfigFileStrict, loadConfigFileSync, requireRecord } from '../config/config-store';
import { SECRET_FILE_MODE, writeJsonFileAtomic } from '../config/json-file';
import { withFileLock } from '../config/file-lock';
import { decryptSecret, encryptSecret } from '../secret-storage';
import { checkSettingValue } from './settings-schema';

type Stored = Record<string, Record<string, PluginSettingValue>>;

export function pluginSettingsFile(pluginsDir: string): string {
  return path.join(path.dirname(pluginsDir), 'plugin-settings.json');
}

const isValue = (v: unknown): v is PluginSettingValue =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function decodeValues(raw: unknown): Record<string, PluginSettingValue> {
  const out: Record<string, PluginSettingValue> = {};
  for (const [k, v] of Object.entries(asRecord(raw))) if (isValue(v)) out[k] = v;
  return out;
}

function decodeLenient(raw: unknown): Stored {
  const out: Stored = {};
  for (const [id, values] of Object.entries(asRecord(asRecord(raw).plugins))) out[id] = decodeValues(values);
  return out;
}

function decodeStrict(raw: unknown): Stored {
  const top = requireRecord(raw, 'plugin-settings.json');
  const out: Stored = {};
  for (const [id, values] of Object.entries(requireRecord(top.plugins ?? {}, 'plugin-settings.json "plugins"'))) out[id] = decodeValues(values);
  return out;
}

/** A stored value that still fits its field; anything else reads as unset. */
function fits(field: PluginSetting, v: PluginSettingValue | undefined): v is PluginSettingValue {
  return v !== undefined && field.kind !== 'secret' && checkSettingValue(field, v).ok;
}

function viewOf(fields: PluginSetting[], saved: Record<string, PluginSettingValue>): PluginSettingsView {
  const values: PluginSettingsView['values'] = {};
  const secretsSet: PluginSettingsView['secretsSet'] = {};
  for (const f of fields) {
    if (f.kind === 'secret') {
      secretsSet[f.key] = typeof saved[f.key] === 'string' && saved[f.key] !== '';
      continue;
    }
    const v = saved[f.key];
    if (fits(f, v)) values[f.key] = v;
    else if (f.default !== undefined) values[f.key] = f.default;
  }
  return { fields, values, secretsSet };
}

/** What Settings shows for a plugin: its fields, values (or defaults), and which secrets are set. */
export async function readPluginSettings(pluginsDir: string, manifest: PluginManifest): Promise<PluginSettingsView> {
  const stored = await loadConfigFile(() => pluginSettingsFile(pluginsDir), decodeLenient, {});
  return viewOf(manifest.settings ?? [], stored[manifest.id] ?? {});
}

/**
 * Save a change from the form. Every value is checked against its field
 * first; with any problem nothing is written and the problems are thrown
 * together.
 */
export async function savePluginSettings(
  pluginsDir: string,
  manifest: PluginManifest,
  patch: PluginSettingsPatch,
): Promise<PluginSettingsView> {
  const fields = new Map((manifest.settings ?? []).map((f) => [f.key, f]));
  const problems: string[] = [];
  const checked: Array<[string, PluginSettingValue | null]> = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    const field = fields.get(key);
    if (!field) { problems.push(`${manifest.name} has no setting "${key}".`); continue; }
    if (value === null) { checked.push([key, null]); continue; }
    const r = checkSettingValue(field, value);
    if (!r.ok) problems.push(r.problem);
    else checked.push([key, field.kind === 'secret' ? encryptSecret(r.value as string) : r.value]);
  }
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const abs = pluginSettingsFile(pluginsDir);
  const saved = await withFileLock(abs, async () => {
    const stored = await loadConfigFileStrict(abs, decodeStrict, {});
    const mine: Record<string, PluginSettingValue> = {};
    // Keep only what the manifest still declares.
    for (const [k, v] of Object.entries(stored[manifest.id] ?? {})) if (fields.has(k)) mine[k] = v;
    for (const [k, v] of checked) {
      if (v === null || v === '') delete mine[k];
      else mine[k] = v;
    }
    if (Object.keys(mine).length > 0) stored[manifest.id] = mine;
    else delete stored[manifest.id];
    await writeJsonFileAtomic(abs, { plugins: stored }, { trailingNewline: true, mode: SECRET_FILE_MODE });
    return mine;
  });
  return viewOf([...fields.values()], saved);
}

/** Forget a removed plugin's settings, secrets included: removing one leaves nothing behind. */
export async function removePluginSettings(pluginsDir: string, id: string): Promise<void> {
  const abs = pluginSettingsFile(pluginsDir);
  await withFileLock(abs, async () => {
    const stored = await loadConfigFileStrict(abs, decodeStrict, {});
    if (!Object.hasOwn(stored, id)) return;
    delete stored[id];
    await writeJsonFileAtomic(abs, { plugins: stored }, { trailingNewline: true, mode: SECRET_FILE_MODE });
  });
}

/**
 * The values a plugin's skills read as `{{plugin.settings.<key>}}`: every
 * non-secret field, saved or default, as text. Synchronous, because a
 * template renders synchronously; the file is small and read per render, so
 * a save shows in the next run with nothing to invalidate.
 */
export function pluginSettingsForTemplates(pluginsDir: string, manifest: PluginManifest): Record<string, string> {
  const fields = manifest.settings ?? [];
  if (fields.length === 0) return {};
  const stored = loadConfigFileSync(() => pluginSettingsFile(pluginsDir), decodeLenient, {});
  const { values } = viewOf(fields, stored[manifest.id] ?? {});
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
}

/**
 * Every value a plugin's MCP server receives (#2646), secrets decrypted: the
 * one place a secret leaves this file. Main only — it goes into a server's
 * environment, never a template or the renderer.
 */
export function pluginSettingsForServer(pluginsDir: string, manifest: PluginManifest): Record<string, string> {
  const fields = manifest.settings ?? [];
  if (fields.length === 0) return {};
  const saved = loadConfigFileSync(() => pluginSettingsFile(pluginsDir), decodeLenient, {})[manifest.id] ?? {};
  const out: Record<string, string> = Object.fromEntries(Object.entries(viewOf(fields, saved).values).map(([k, v]) => [k, String(v)]));
  for (const f of fields) {
    const v = saved[f.key];
    if (f.kind === 'secret' && typeof v === 'string') out[f.key] = decryptSecret(v);
  }
  return out;
}
