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
 * - `code`: its code inside Minerva (#2833), each handler called against each
 *   thoughtbase in a real worker host; a call outside its declared
 *   capabilities fails it. Only where the app's runtime is there to host it
 *   (`minerva`, which runs as the app); under plain Node it says it was skipped;
 * - `uninstall`: removing it leaves nothing in any registry or the graph.
 *
 * A `fail` is something Minerva would refuse or a rule broken; a `warn` is
 * worth a look but loads; `skip` says what wasn't tried and why.
 */

export type PluginCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export const PLUGIN_CHECK_STAGES = ['package', 'contributions', 'thoughtbases', 'mcp', 'code', 'uninstall'] as const;
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

/**
 * What the code stage (#2833) is handed: the scratch plugins folder the plugin
 * was installed into, approved, and the thoughtbase copies to run against.
 */
export interface PluginCodeStageInput {
  appVersion: string;
  pluginsDir: string;
  pluginId: string;
  thoughtbases: Array<{ name: string; root: string }>;
  /** A scratch folder the stage may write into (an ingestor's sample file). */
  scratch: string;
}

/** The code stage, as the app's runtime offers it. */
export type PluginCodeStage = (input: PluginCodeStageInput) => Promise<PluginCheckItem[]>;

/**
 * Where the app, run as the CLI (`--minerva-cli`, `main/cli-mode.ts`), puts
 * its code stage for the CLI to find: the CLI bundle carries no Electron
 * (`tests/cli/electron-free.test.ts`), so the app's own bundle hosts the code.
 */
export const PLUGIN_CODE_STAGE_GLOBAL = '__minervaPluginCodeStage';

