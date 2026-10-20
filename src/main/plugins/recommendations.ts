/**
 * Plugins a thoughtbase recommends (#2635).
 *
 * `.minerva/config.json` may list `recommendedPlugins: [{ id, source, … }]`.
 * That file travels with a shared thoughtbase, so every field is someone
 * else's text: it's read leniently (a bad entry is skipped, never an error
 * that stops the thoughtbase opening), bounded, and **only ever described**.
 * Nothing here installs, enables or fetches anything. An Install button in
 * the renderer sends the `source` back through `plugins:installGit`, the same
 * channel and the same checks as a URL the user typed, and only when the user
 * presses it.
 */
import type { PluginRecommendation } from '../../shared/plugins/format';
import { readProjectConfig } from '../project-config';
import { parseGitPluginSpec } from './git';
import { MAX_PLUGIN_ID, PLUGIN_ID } from './manifest';
import { activePluginsDir, getPluginInventory } from './registry';
import { readCorePluginStates } from './core';

/** Enough for any honest thoughtbase; a list past it is cut, not refused. */
export const RECOMMENDATION_LIMITS = { entries: 20, name: 80, source: 2048, reason: 200, types: 50 } as const;

const TYPE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : undefined;
};

/** A recommendation as the thoughtbase wrote it, once it's been checked. */
export type DeclaredRecommendation = Omit<PluginRecommendation, 'status'>;

/** Read `recommendedPlugins` leniently: anything malformed is left out. */
export function decodeRecommendations(raw: unknown): DeclaredRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: DeclaredRecommendation[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= RECOMMENDATION_LIMITS.entries) break;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    if (!PLUGIN_ID.test(id) || id.length > MAX_PLUGIN_ID || seen.has(id)) continue;
    seen.add(id);
    const source = str(e.source, RECOMMENDATION_LIMITS.source);
    let installUrl: string | undefined;
    if (source !== undefined) {
      try {
        parseGitPluginSpec(source);
        installUrl = source;
      } catch {
        // Not a URL Minerva can fetch from (a web page, a file path): shown
        // as text, with no Install button.
      }
    }
    const types = Array.isArray(e.types)
      ? [...new Set(e.types.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter((t) => TYPE_ID.test(t)))].slice(0, RECOMMENDATION_LIMITS.types)
      : [];
    const name = str(e.name, RECOMMENDATION_LIMITS.name);
    const reason = str(e.reason, RECOMMENDATION_LIMITS.reason);
    out.push({
      id,
      ...(name ? { name } : {}),
      ...(reason ? { reason } : {}),
      ...(source ? { source } : {}),
      ...(installUrl ? { installUrl } : {}),
      types,
    });
  }
  return out;
}

/**
 * The thoughtbase's recommendations that aren't in use on this machine:
 * not installed, or installed and turned off. One that's installed and on
 * is left out.
 */
export async function pluginRecommendations(rootPath: string): Promise<PluginRecommendation[]> {
  const declared = decodeRecommendations(readProjectConfig(rootPath).recommendedPlugins);
  if (declared.length === 0) return [];
  const inv = await getPluginInventory();
  const installed = new Map(inv.installed.map(({ plugin, record }) => [plugin.manifest.id, record.enabled]));
  // A built-in plugin is always installed; only whether it's on varies (#2820).
  for (const [id, on] of readCorePluginStates(activePluginsDir())) installed.set(id, on);
  const out: PluginRecommendation[] = [];
  for (const d of declared) {
    const enabled = installed.get(d.id);
    if (enabled === true) continue;
    out.push({ ...d, status: enabled === false ? 'disabled' : 'missing' });
  }
  return out;
}
