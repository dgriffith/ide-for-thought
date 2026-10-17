/**
 * `minerva plugin check` (#2654): what a plugin was put through, and how each
 * part did. One report per plugin, in stages, each listing its items:
 *
 * - `package`: the manifest and the whole-folder check Settings → Plugins
 *   runs, then an install into a scratch plugins folder;
 * - `contributions`: each contributed file, loaded into its registry;
 * - `thoughtbases`: each contribution against each fixture thoughtbase;
 * - `mcp`: each MCP server it ships, started and its tools listed (only
 *   when asked to: that runs the plugin's code);
 * - `uninstall`: removing it leaves nothing in any registry or the graph.
 *
 * A `fail` is something Minerva would refuse or a rule broken; a `warn` is
 * worth a look but loads; `skip` says what wasn't tried and why.
 */

export type PluginCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export const PLUGIN_CHECK_STAGES = ['package', 'contributions', 'thoughtbases', 'mcp', 'uninstall'] as const;
export type PluginCheckStage = (typeof PLUGIN_CHECK_STAGES)[number];

export interface PluginCheckItem {
  stage: PluginCheckStage;
  /** What was checked: `plugin.json`, `skills/x.md`, `skills/x.md × hostile`, `server words`. */
  subject: string;
  status: PluginCheckStatus;
  detail?: string;
}

export interface PluginCheckReport {
  folder: string;
  /** `id@version`, once the manifest could be read. */
  plugin: string | null;
  /** No item failed. */
  ok: boolean;
  items: PluginCheckItem[];
}
