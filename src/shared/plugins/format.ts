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
 * may too since #2833, approved by the user as the files they ship.
 */
import type { PluginCapability } from './capabilities';
import type { PluginExporter, PluginIngestor, PluginInspection } from './code-io';

// The code section's input/output types (#2647, #2648, #2831).
export * from './code-io';

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
  /** Health checks, as SHACL shapes in Turtle (#2642). */
  'inspections': { folder: 'inspections', extensions: ['.ttl'] },
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
  /** What its code inside Minerva does (#2823); an installed plugin's is approved by hash (#2833). */
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
  /** Global views it draws (#2640): panels in a sidebar, each fed by a query it declares. */
  views?: PluginView[];
  /** Live blocks it draws (#2641): a fence or a directive in a note, in the preview and every export. */
  blocks?: PluginBlock[];
  /**
   * Its logic (#2830): a `.js` ES module in its folder, run in a Web Worker in
   * a hidden, sandboxed host on the plugin's origin. It registers handlers
   * with `minerva.handle(name, fn)`; Minerva calls them with data and a
   * deadline, and does every file read and write itself.
   */
  worker?: string;
  /** Commands it adds (#2643): in the command palette, and the editor's menu when they ask. */
  commands?: PluginCommand[];
  /** File types it reads as Sources (#2647), each by one of its handlers. */
  ingestors?: PluginIngestor[];
  /** Export formats it writes (#2648), each by one of its handlers. */
  exporters?: PluginExporter[];
  /** Health checks it runs (#2831), each by one of its handlers, beside the SHACL ones. */
  inspections?: PluginInspection[];
}

/** A handler's name: what `minerva.handle(name, …)` registers (#2830), and what a command runs. */
export const PLUGIN_HANDLER_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * When a plugin command can run (#2643): with a thoughtbase open, a note
 * open in the active tab, or text selected in it.
 */
export const PLUGIN_COMMAND_WHEN = ['project', 'note', 'selection'] as const;
export type PluginCommandWhen = (typeof PLUGIN_COMMAND_WHEN)[number];

/**
 * What a plugin command runs (#2643), exactly one of:
 * - `handler`: a function its logic module registered with `minerva.handle`,
 *   run in its worker host (#2830) with the command's context as data. It
 *   returns what to do (`PluginCommandResult`); Minerva does it.
 * - `skill`: a skill, by id, as the palette runs it.
 * - `query`: a query in its folder (an `.rq` file), opened in a query tab.
 * - `view`: one of its own global views (#2640), opened.
 */
export type PluginCommandRun =
  | { handler: string }
  | { skill: string }
  | { query: string }
  | { view: string };

/**
 * A command a plugin adds (#2643):
 *
 * ```json
 * "commands": [{ "id": "sort-selection", "title": "Sort List in Selection",
 *                "when": "selection", "editorMenu": true,
 *                "run": { "handler": "sortSelection" } }]
 * ```
 */
export interface PluginCommand {
  /** Lowercase letters and digits in dash-separated words, unique in the plugin. */
  id: string;
  /** The palette's title and the menu item's label. */
  title: string;
  when: PluginCommandWhen;
  /** Also in the editor's right-click menu, under Plugins. */
  editorMenu?: true;
  run: PluginCommandRun;
}

/**
 * What a command's handler returns (#2643): data, which Minerva acts on.
 * `replaceSelection` replaces the text the command ran on, as one change the
 * editor can undo, and only if that text is still selected; `announce` is
 * said to a screen reader and shown. Either may be left out.
 */
export interface PluginCommandResult {
  replaceSelection?: string;
  announce?: string;
}

/** What the renderer gives a command to run on (#2643): the active note, and the selected text in it. */
export interface PluginCommandContext {
  note?: string;
  selection?: string;
}

/**
 * What running a plugin command asks the renderer to do (#2643), decided in
 * main: a handler's checked result, or what a declarative command names.
 */
export type PluginCommandAction =
  | { kind: 'result'; replaceSelection?: string; announce?: string }
  | { kind: 'skill'; skill: string }
  | { kind: 'query'; text: string }
  | { kind: 'view'; view: string };


/**
 * A live block (#2641): a fence (```` ```recipe-card ````) or a directive
 * (`:::reading-list` … `:::`) in a note, drawn by the plugin's page in a frame
 * in the preview, and for an export as static HTML it hands back (the
 * `export` event, `view.provideExport`), which Minerva sanitizes.
 *
 * The page is given the block's own text and the note it sits in; its scope
 * is that note, plus the notes its `query` names when it declares one —
 * Minerva runs that query, as for a global view, so nothing a note says can
 * widen what the block reaches.
 *
 * ```json
 * "blocks": [{ "id": "queue", "title": "Reading queue", "fence": "reading-queue",
 *              "entry": "index.html", "query": "queue.rq" }]
 * ```
 */
export interface PluginBlock {
  /** Lowercase letters and digits in dash-separated words, unique in the plugin. */
  id: string;
  /** What the block is, for the frame's accessible name. */
  title: string;
  /** The fence language it draws, or… */
  fence?: string;
  /** …the directive name (`:::<name>`); exactly one of the two. */
  directive?: string;
  /** The page to frame, in the plugin's folder: an `.html` file. */
  entry: string;
  /** A query in the plugin's folder (an `.rq` file) whose notes the block may also reach. */
  query?: string;
}

/**
 * Where a global view shows (#2640): a panel in a sidebar, or a tab in the
 * editor. A sidebar view can be opened in a tab too; `tab` is a view that
 * has no panel, opened from the command palette.
 */
export const PLUGIN_VIEW_PLACES = ['left-sidebar', 'right-sidebar', 'tab'] as const;
export type PluginViewPlace = (typeof PLUGIN_VIEW_PLACES)[number];

/**
 * A global view (#2640): a page of the plugin's, framed in a sidebar panel or
 * an editor tab, and the read-only SPARQL query that feeds it. Minerva runs the query, not
 * the plugin: the notes in its results are the view's scope, the way a type
 * view's instances are a layout's, so the query a plugin is shown with at
 * install is exactly what it can be given.
 *
 * ```json
 * "views": [{ "id": "queue", "title": "Reading Queue", "place": "left-sidebar",
 *             "entry": "index.html", "query": "queue.rq" }]
 * ```
 */
export interface PluginView {
  /** Lowercase letters and digits in dash-separated words, unique in the plugin. */
  id: string;
  /** The panel's title, and the frame's accessible name. */
  title: string;
  place: PluginViewPlace;
  /** The page to frame, in the plugin's folder: an `.html` file. */
  entry: string;
  /** The query, in the plugin's folder: an `.rq` file. */
  query: string;
  /** One of Minerva's icon names; a generic one when it isn't. */
  icon?: string;
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
  /**
   * For a plugin with `code` (#2833): the SHA-256 of every file it ships
   * (`main/plugins/code-hash.ts`), what its approval is pinned to. Absent for a
   * declarative plugin, which needs no approval.
   */
  codeHash?: string;
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
  /** The global views it draws (#2640); absent when none. */
  views?: PluginView[];
  /** The live blocks it draws (#2641); absent when none. */
  blocks?: PluginBlock[];
  /** The commands it adds (#2643); absent when none. */
  commands?: PluginCommand[];
  /** The file types it reads as Sources (#2647); absent when none. */
  ingestors?: PluginIngestor[];
  /** The export formats it writes (#2648); absent when none. */
  exporters?: PluginExporter[];
  /** The health checks it runs as code (#2831); absent when none. */
  inspections?: PluginInspection[];
  /**
   * An installed plugin whose code waits for the user (#2833): `needed`, never
   * allowed; `changed`, allowed for files it no longer has. It's off until then.
   */
  codeApproval?: 'needed' | 'changed';
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
