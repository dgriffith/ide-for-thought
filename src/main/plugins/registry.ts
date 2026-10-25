/**
 * The installed plugins, as the app's seams read them (#2633, epic #2631).
 *
 * `enablePlugins` is called once at startup, synchronously, with the app's
 * version. Nothing is read then: the scan of `~/.minerva/plugins/` happens on
 * the first `getPluginScan()`, which the skill catalog and the type catalog
 * make from their own loads, so it never stands in front of the window
 * (#2223). Until `enablePlugins` runs (in tests, the CLI and the eval
 * harness), the scan is empty — plugins are the running app's, per machine,
 * and a golden-file eval must not see whatever a developer has installed.
 *
 * Each seam loads its own contributions from the scan, with the rules that
 * seam needs (`skills/loader.ts`, `types/loader.ts`). What they share:
 * - **Bare ids.** A contribution keeps the id it declares (a type stays
 *   `book-note`); the plugin is its provenance, `plugin:<id>@<version>`.
 * - **No shadowing.** A plugin can't take a stock or user id, and the second
 *   plugin to claim one is refused, naming the first.
 * - **Isolation.** A refused plugin, or one bad contribution, is reported
 *   against that plugin and skipped. Nothing here throws into a caller.
 */
import { logger } from '../../shared/logger';
import type {
  PluginContribution,
  PluginContributionPoint,
  PluginPackage,
  PluginScan,
} from '../../shared/plugins/format';
import { pluginsDir, readPluginPackages } from './package';
import { loadPluginRecords, recordFor, type PluginRecord } from './state';

const EMPTY: PluginScan = { plugins: [], errors: [] };

/**
 * Everything installed, enabled or not, with its record (#2634) — what
 * Settings → Plugins shows. The seams read {@link getPluginScan}, which is
 * the enabled ones only.
 */
export interface PluginInventory {
  installed: Array<{ plugin: PluginPackage; record: PluginRecord }>;
  /** Folders refused whole (#2632). */
  errors: PluginScan['errors'];
}
const EMPTY_INVENTORY: PluginInventory = { installed: [], errors: [] };

let config: { appVersion: string; dir?: string } | null = null;
// The PROMISE is cached, as `getSkillCatalog` does, so two seams loading at
// once share one scan.
let cached: Promise<PluginInventory> | null = null;
// The last scan that finished, for the one synchronous reader (saved queries,
// which the menu lists on every rebuild), and a counter it keys its memo on.
let loaded: PluginScan = EMPTY;
let version = 0;

/** Turn plugin loading on, for the running app. `dir` is for tests. */
export function enablePlugins(opts: { appVersion: string; dir?: string }): void {
  config = opts;
  cached = null;
}

/** Back to no plugins: `minerva plugin check` when it's done (#2654), and tests. */
export function disablePlugins(): void {
  config = null;
  cached = null;
  loaded = EMPTY;
  version += 1;
}

/** Back to no plugins — tests only. */
export const _disablePluginsForTests = disablePlugins;

/** Whether plugin loading is on: in the running app, or during a check. */
export function pluginsEnabled(): boolean {
  return config !== null;
}

/**
 * The last finished scan, synchronously — empty before the first one lands.
 * For a reader that can't await (`listSavedQueries`, on the menu's hot
 * path); it keys its memo on {@link pluginScanVersion}, so a scan that
 * finishes later is picked up on the next read.
 */
export function loadedPluginScan(): PluginScan {
  return config ? loaded : EMPTY;
}

/** Bumped each time a scan finishes. */
export function pluginScanVersion(): number {
  return version;
}

/** Everything installed, with its record. Empty unless `enablePlugins` ran. */
export function getPluginInventory(): Promise<PluginInventory> {
  if (!config) return Promise.resolve(EMPTY_INVENTORY);
  cached ??= scan(config);
  return cached;
}

/** The enabled plugins — what the seams load. Empty unless `enablePlugins` ran. */
export async function getPluginScan(): Promise<PluginScan> {
  return enabledOnly(await getPluginInventory());
}

/** Read `~/.minerva/plugins/` and `plugins.json` again — after an install,
 *  removal, toggle or outside edit (#2634). */
export function reloadPluginScan(): Promise<PluginScan> {
  cached = null;
  return getPluginScan();
}

/** The app version plugins are checked against (their `minerva` range). */
export function pluginsAppVersion(): string {
  return config?.appVersion ?? '0.0.0';
}

/** The plugins folder in use: the configured one, or `~/.minerva/plugins/`. */
export function activePluginsDir(): string {
  return config?.dir ?? pluginsDir();
}

/**
 * Whether a plugin's code is approved as it is now (#2833): a declarative
 * plugin needs no approval; one with code, an approval of this very hash.
 */
export function codeApprovalOf(plugin: PluginPackage, record: PluginRecord): 'none-needed' | 'approved' | 'needed' | 'changed' {
  if (!plugin.codeHash) return 'none-needed';
  if (!record.codeApproved) return 'needed';
  return record.codeApproved.hash === plugin.codeHash ? 'approved' : 'changed';
}

function enabledOnly(inv: PluginInventory): PluginScan {
  const loads = (i: PluginInventory['installed'][number]) => {
    const approval = codeApprovalOf(i.plugin, i.record);
    return i.record.enabled && (approval === 'none-needed' || approval === 'approved');
  };
  return { plugins: inv.installed.filter(loads).map((i) => i.plugin), errors: inv.errors };
}

async function scan(cfg: { appVersion: string; dir?: string }): Promise<PluginInventory> {
  try {
    const dir = cfg.dir ?? pluginsDir();
    const [result, records] = await Promise.all([readPluginPackages(cfg.appVersion, dir), loadPluginRecords(dir)]);
    for (const e of result.errors) {
      logger('plugins').warn(`plugin ${e.label} not loaded:`, e.problems.join(' '));
    }
    const inventory: PluginInventory = {
      installed: result.plugins.map((plugin) => ({ plugin, record: recordFor(records, plugin.manifest.id) })),
      errors: result.errors,
    };
    loaded = enabledOnly(inventory);
    version += 1;
    return inventory;
  } catch (e) {
    // An unreadable plugins folder costs the plugins, never the skills or
    // types that asked for them.
    logger('plugins').error('could not read the plugins folder:', e);
    return EMPTY_INVENTORY;
  }
}

/** Every contribution to `point`, with the plugin it came from, in plugin-name order. */
export function contributionsTo(
  scan: PluginScan,
  point: PluginContributionPoint,
): Array<{ plugin: PluginPackage; contribution: PluginContribution }> {
  return scan.plugins.flatMap((plugin) =>
    plugin.contributions.filter((c) => c.point === point).map((contribution) => ({ plugin, contribution })));
}
