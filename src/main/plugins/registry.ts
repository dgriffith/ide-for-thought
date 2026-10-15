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
import { readPluginPackages } from './package';

const EMPTY: PluginScan = { plugins: [], errors: [] };

let config: { appVersion: string; dir?: string } | null = null;
// The PROMISE is cached, as `getSkillCatalog` does, so two seams loading at
// once share one scan.
let cached: Promise<PluginScan> | null = null;

/** Turn plugin loading on, for the running app. `dir` is for tests. */
export function enablePlugins(opts: { appVersion: string; dir?: string }): void {
  config = opts;
  cached = null;
}

/** Back to no plugins — tests only. */
export function _disablePluginsForTests(): void {
  config = null;
  cached = null;
}

/** The installed plugins, read once. Empty unless `enablePlugins` ran. */
export function getPluginScan(): Promise<PluginScan> {
  if (!config) return Promise.resolve(EMPTY);
  cached ??= scan(config);
  return cached;
}

/** Read `~/.minerva/plugins/` again — after an install or removal (#2634). */
export function reloadPluginScan(): Promise<PluginScan> {
  cached = null;
  return getPluginScan();
}

async function scan(cfg: { appVersion: string; dir?: string }): Promise<PluginScan> {
  try {
    const result = await readPluginPackages(cfg.appVersion, cfg.dir);
    for (const e of result.errors) {
      logger('plugins').warn(`plugin ${e.label} not loaded:`, e.problems.join(' '));
    }
    return result;
  } catch (e) {
    // An unreadable plugins folder costs the plugins, never the skills or
    // types that asked for them.
    logger('plugins').error('could not read the plugins folder:', e);
    return EMPTY;
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
