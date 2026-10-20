/**
 * The plugin format (#2632, epic #2631): what a plugin package is on disk.
 *
 * A plugin is a folder, `~/.minerva/plugins/<id>/`, holding a `plugin.json`
 * manifest and the files it contributes, each in its point's conventional
 * subfolder. Plugins are declarative (#2615): every contribution is a file the
 * matching seam already knows how to read — a skill, an object type, a saved
 * query — never code Minerva runs. Code ships as an MCP server (#2645).
 *
 * This module is the contract both processes and the docs share; reading and
 * checking a package is `src/main/plugins/`. Loading contributions into their
 * registries is the loader's job (#2633).
 *
 * Plugins built into Minerva (#2820) may also declare a `code` section: what
 * their code inside the app does, as capabilities (#2823). Installed plugins
 * can't yet (#2833).
 */
import type { PluginCapability } from './capabilities';

/** The manifest's file name, at the plugin folder's root. */
export const PLUGIN_MANIFEST = 'plugin.json';

/**
 * What a plugin may contribute to, by extension-point catalog id
 * (`src/shared/extensions/points.ts`): the subfolder its files go in, and
 * what one contribution is. Fail closed — a `contributes` key not listed here
 * refuses the plugin, so a point opens to plugins only when its story adds it
 * (#2637: inspections #2642, commands #2643, live blocks #2641, views #2640,
 * MCP servers #2645).
 */
export const PLUGIN_CONTRIBUTION_POINTS = {
  'skills': {
    folder: 'skills',
    /** A bare `.md` skill, or a folder holding `SKILL.md` — as in `~/.minerva/skills/`. */
    extensions: ['.md'],
    folderEntry: 'SKILL.md',
  },
  'object-types': { folder: 'types', extensions: ['.md'] },
  'saved-queries': { folder: 'queries', extensions: ['.rq', '.sql'] },
  'note-templates': { folder: 'templates', extensions: ['.md'] },
  'csl-styles': { folder: 'csl', extensions: ['.csl', '.xml'] },
  /** A colour theme: `{ label, base, tokens }` (#2787). */
  'themes': { folder: 'themes', extensions: ['.json'] },
} as const satisfies Record<string, { folder: string; extensions: readonly string[]; folderEntry?: string }>;

export type PluginContributionPoint = keyof typeof PLUGIN_CONTRIBUTION_POINTS;

/** The plugin a contribution came from (#2633): its provenance, carried on the skill or type. */
export interface PluginOrigin {
  id: string;
  name: string;
  version: string;
}

/** `plugin.json`, as validated. */
export interface PluginManifest {
  /** Lowercase letters, digits and single dashes; the folder's name. It namespaces every contribution. */
  id: string;
  name: string;
  /** Semver. */
  version: string;
  /** The Minerva versions it works with: a semver range (`>=4.0.0`, `^4.1.0`). */
  minerva: string;
  description: string;
  author?: string;
  /** An SPDX identifier, ideally. */
  license?: string;
  /** Catalog id → the files it contributes there, relative to the plugin folder. */
  contributes: Partial<Record<PluginContributionPoint, string[]>>;
  /** What the user can set for it on this machine (#2636), in manifest order. */
  settings?: PluginSetting[];
  /** MCP servers it ships (#2646), in manifest order: code, run only once the user approves each. */
  mcpServers?: PluginMcpServer[];
  /** What its code inside Minerva does (#2823). Built-in plugins only, until #2833. */
  code?: PluginCode;
}

/** A plugin's `code` section (#2823). */
export interface PluginCode {
  /** What the code may do, from `PLUGIN_CAPABILITIES`; the host refuses the rest. */
  capabilities: PluginCapability[];
  /**
   * The plugin API versions the code was written for, a semver range like
   * `"^1.0.0"` (#2826) — checked against `PLUGIN_API_VERSION`, never the app's
   * version. Required when the code uses the API (any capability but `process`).
   */
  api?: string;
}

/**
 * A stdio MCP server a plugin ships (#2646), as `plugin.json` declares it:
 *
 * ```json
 * "mcpServers": {
 *   "lookup": { "title": "Lookup", "command": "node", "args": ["server/index.js"],
 *               "env": { "API_TOKEN": "${settings.apiToken}" } }
 * }
 * ```
 *
 * The program is inside the plugin folder: `command` is a file there, or an
 * interpreter (`node`, `python3`, `python`) whose first argument is. It runs
 * in the plugin folder, with the allowlisted environment (#2560) plus `env`,
 * whose values may name the plugin's settings — secrets included.
 */
export interface PluginMcpServer {
  /** Letters, digits, `-` and `_`. The server is `<plugin id>.<key>` to the model and in Settings. */
  key: string;
  title: string;
  /** A path inside the plugin folder (`bin/server`), or one of `PLUGIN_MCP_INTERPRETERS`. */
  command: string;
  args: string[];
  /** Name → value; `${settings.<key>}` is replaced with that setting's value. */
  env: Record<string, string>;
}

/** The interpreters a plugin server may name instead of a file of its own; its first argument is then the script. */
export const PLUGIN_MCP_INTERPRETERS = ['node', 'python3', 'python'] as const;

/**
 * One setting a plugin declares (#2636): a JSON Schema subset — `string`,
 * `number`, `boolean`, a string `enum`, and `secret` — normalized from
 * `plugin.json`'s `settings` object. Values are per machine, never in a
 * thoughtbase; a `secret` is stored encrypted and never leaves main.
 */
export type PluginSetting =
  | (PluginSettingBase & { kind: 'string'; default?: string })
  | (PluginSettingBase & { kind: 'number'; default?: number; minimum?: number; maximum?: number })
  | (PluginSettingBase & { kind: 'boolean'; default?: boolean })
  | (PluginSettingBase & { kind: 'enum'; options: string[]; default?: string })
  | (PluginSettingBase & { kind: 'secret' });

interface PluginSettingBase {
  /** Letters, digits and `_`; a skill reads it as `{{plugin.settings.<key>}}`. */
  key: string;
  title: string;
  description?: string;
}

export type PluginSettingValue = string | number | boolean;

/** A plugin's settings as Settings → Plugins shows them: never a secret's value. */
export interface PluginSettingsView {
  fields: PluginSetting[];
  /** Each non-secret field's value: the saved one, else its default. Absent when neither. */
  values: Record<string, PluginSettingValue>;
  /** Each secret field: whether a value is saved. */
  secretsSet: Record<string, boolean>;
  /** Whether a secret saved now is encrypted by the OS key store (#2569). Set by the IPC handler. */
  secretsEncrypted?: boolean;
}

/**
 * A change from the form. A non-secret key set to `null` goes back to its
 * default; a secret is write-only — a string sets it, `null` clears it, and
 * leaving it out keeps it.
 */
export type PluginSettingsPatch = Record<string, PluginSettingValue | null>;

/** One contributed file (or skill folder), checked to sit inside the plugin. */
export interface PluginContribution {
  point: PluginContributionPoint;
  /** As written in the manifest, normalized (`/`-separated, no `./`). */
  path: string;
  /** Resolved and contained; links followed. */
  absolutePath: string;
  kind: 'file' | 'folder';
}

/** A package that passed every check. */
export interface PluginPackage {
  manifest: PluginManifest;
  /** The plugin folder, links resolved. */
  root: string;
  contributions: PluginContribution[];
  /** `plugin:<id>@<version>` — what each contribution's provenance will say (#2633). */
  provenance: string;
}

/**
 * A plugin that couldn't be read, reported rather than thrown — the same
 * per-item shape as `SKILLS_LIST`'s `errors[]`. A plugin with any problem is
 * refused whole: none of it loads.
 */
export interface PluginLoadError {
  /** The folder's name under `~/.minerva/plugins/`. */
  folder: string;
  /** The manifest's id and version, when it got that far. */
  label: string;
  problems: string[];
}

export interface PluginScan {
  plugins: PluginPackage[];
  errors: PluginLoadError[];
}

/** One installed plugin, as Settings → Plugins shows it (#2634). */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  enabled: boolean;
  /** Where it was installed from: a folder, an archive, a git URL, by hand into the plugins folder, or a draft from a conversation (#2652). */
  source:
    | { kind: 'folder'; path: string }
    | { kind: 'zip'; name: string; sha256: string }
    | { kind: 'git'; url: string; ref?: string; commit: string }
    | { kind: 'manual' }
    | { kind: 'draft' }
    | { kind: 'core' };
  installedAt?: string;
  /** How many contributions to each point. */
  contributes: Partial<Record<PluginContributionPoint, number>>;
  /** How many settings it declares (#2636); absent when none. */
  settings?: number;
  /** How many MCP servers it ships (#2646); absent when none. */
  mcpServers?: number;
  /** What its code may do (#2823); absent when it has none. */
  capabilities?: PluginCapability[];
}

/**
 * A plugin the open thoughtbase recommends that isn't in use here (#2635).
 * Every field but `status` is the thoughtbase's own text, checked for shape
 * only — shown, never acted on without the user.
 */
export interface PluginRecommendation {
  id: string;
  /** What the thoughtbase calls it. */
  name?: string;
  /** Why the thoughtbase recommends it, in its own words. */
  reason?: string;
  /** Where to get it, as written. */
  source?: string;
  /** `source`, when it's a git URL Minerva can install from. */
  installUrl?: string;
  /** Object types it provides, by the thoughtbase's account. */
  types: string[];
  /** Not installed, or installed and turned off. */
  status: 'missing' | 'disabled';
}

export interface PluginList {
  /** Built into Minerva (#2820): turned on or off, never installed or removed. */
  core: PluginSummary[];
  installed: PluginSummary[];
  /** Folders refused whole, with every problem (#2632). */
  errors: PluginLoadError[];
  /** The plugins folder. */
  folder: string;
}
