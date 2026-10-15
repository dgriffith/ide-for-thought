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
 */

/** The manifest's file name, at the plugin folder's root. */
export const PLUGIN_MANIFEST = 'plugin.json';

/**
 * What a plugin may contribute to, by extension-point catalog id
 * (`src/shared/extensions/points.ts`): the subfolder its files go in, and
 * what one contribution is. Fail closed — a `contributes` key not listed here
 * refuses the plugin, so a point opens to plugins only when its story adds it
 * (#2637: inspections #2642, commands #2643, live blocks #2641, views #2640,
 * themes #2787, MCP servers #2645).
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
}

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
  /** Where it was installed from: a folder, or by hand into the plugins folder. */
  source: { kind: 'folder'; path: string } | { kind: 'manual' };
  installedAt?: string;
  /** How many contributions to each point. */
  contributes: Partial<Record<PluginContributionPoint, number>>;
}

export interface PluginList {
  installed: PluginSummary[];
  /** Folders refused whole, with every problem (#2632). */
  errors: PluginLoadError[];
  /** The plugins folder. */
  folder: string;
}
