/**
 * Minerva's extension points (#2617, epic #2616): every seam something can be
 * added through, declared in one place, so that "how would I add X?" has an
 * answer that doesn't start with reading the source.
 *
 * Each record says what a contribution looks like (its contract), which rung
 * of the ladder it sits on, how it's picked up, where contributions may come
 * from, and where its docs, a worked example and its test harness live.
 *
 * Honest about today. A seam a user can't extend yet — the built-ins register
 * in a registry, but nothing loads a contribution into it — is declared with
 * `rung: 'source'`, its registry, and the registries-epic story (#2622) that
 * made it one. The plugin loader (#2631) is what moves those up the ladder.
 *
 * This file only DESCRIBES. The graph copy (#2618), the agent tools (#2619)
 * and the generated docs page (#2620) are built from it, so the three can't
 * disagree.
 */

/**
 * The ladder, cheapest rung first. When something can't be done, reach for
 * the lowest rung that solves it — declarative before code.
 */
export const RUNGS = [
  /** A switch or value in Settings, or a configuration file Minerva reads. */
  'setting',
  /** A markdown skill: a prompt template that becomes a menu item and a slash command. */
  'skill',
  /** A markdown object type: a note type with properties and views. */
  'object-type',
  /** A saved query or a note template. */
  'query-view',
  /** A declarative plugin bundle (#2631) in `~/.minerva/plugins/`. */
  'plugin',
  /** An MCP server: code, out of process, capability-scoped and approval-gated. */
  'mcp',
  /** A change to Minerva itself. */
  'source',
] as const;
export type Rung = (typeof RUNGS)[number];

/** Each rung in a sentence — the ladder as the docs page (#2620) states it. */
export const RUNG_DESCRIPTIONS: Record<Rung, string> = {
  setting: 'A switch or value in Settings, or a configuration file Minerva reads (a CSL style, a site stylesheet).',
  skill: 'A markdown skill: a prompt template that becomes a menu item and, optionally, a slash command.',
  'object-type': 'A markdown object type: a note type with properties, a form and views.',
  'query-view': 'A saved query or a note template.',
  plugin: 'A declarative plugin bundle (#2631) in ~/.minerva/plugins/: docs/authoring-plugins.md.',
  mcp: 'An MCP server: code, out of process, capability-scoped and approval-gated.',
  source: 'A change to Minerva itself.',
};

/** How a new contribution is picked up. */
export type LoadPath =
  /** At once, or on its next read — nothing to do. */
  | 'hot'
  /** After an explicit reload (a Settings button). */
  | 'reload-command'
  /** After restarting the app. */
  | 'restart'
  /** Only in a rebuilt app — a `source` seam. */
  | 'rebuild';

/** Where a contribution can come from. */
export type ContributionSource =
  /** Shipped with Minerva. */
  | 'stock'
  /** Per machine: `~/.minerva/…` or the app's user-data folder. */
  | 'user'
  /** Inside the thoughtbase: `<thoughtbase>/.minerva/…`, or `thoughtbase.md` at its root. */
  | 'thoughtbase'
  /** A plugin (#2631). */
  | 'plugin';

/** A place in the repo: a file, and optionally a symbol declared in it. */
export interface CodeRef {
  file: string;
  symbol?: string;
}

/**
 * What one contribution is, and what checks it.
 * - `parser`: a file in `format`, accepted by `at` — the existing parser is
 *   the contract (it reports what's wrong with a bad one).
 * - `registry`: built-ins register in `at`; there is no contribution format
 *   yet, because nothing outside the source can contribute.
 */
export type Contract =
  | { kind: 'parser'; format: string; at: CodeRef }
  | { kind: 'registry'; at: CodeRef };

export interface ExtensionPoint {
  id: string;
  label: string;
  /** One or two sentences: what a contribution adds. */
  description: string;
  rung: Rung;
  contract: Contract;
  loadPath: LoadPath;
  sources: readonly ContributionSource[];
  /** Where a contribution goes, when it's a file. */
  location?: string;
  /** Authoring docs, a worked example and the test that holds the seam — repo paths. */
  docs?: string;
  example?: string;
  harness?: string;
  /** For a `source` seam: the registries-epic story that made it a registry (#2622). */
  story?: number;
  /**
   * Further registries this seam's contributions land in, beyond its contract
   * — skills compile into the tool registry, executors register by language.
   * `extension-points-declared.test.ts` matches registries it finds to these.
   */
  registries?: readonly CodeRef[];
}

/** A seam built-ins register through and nothing else can yet. */
const sourceSeam = (at: CodeRef, extra: { story?: number; harness?: string; docs?: string; registries?: readonly CodeRef[] } = {}) => ({
  rung: 'source' as const,
  contract: { kind: 'registry' as const, at },
  loadPath: 'rebuild' as const,
  sources: ['stock'] as const,
  ...extra,
});

export const EXTENSION_POINTS = [
  // ── Settings ─────────────────────────────────────────────────────────────
  {
    id: 'csl-styles',
    label: 'Citation styles and locales',
    description: 'A CSL style or locale file, used when rendering citations and bibliographies. Imported from Settings → Bibliography.',
    rung: 'setting',
    contract: { kind: 'parser', format: 'CSL 1.0 XML (.csl style, .xml locale)', at: { file: 'src/main/publish/csl/user-assets.ts', symbol: 'isValidCslStyle' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin', 'thoughtbase'],
    location: '<thoughtbase>/.minerva/csl-styles/, <thoughtbase>/.minerva/csl-locales/, or a plugin\'s csl/ (#2633)',
    docs: 'website/docs/_content/settings-bibliography.html',
    harness: 'tests/main/publish/user-csl-assets.test.ts',
  },

  {
    id: 'static-site-css',
    label: 'Static site stylesheet',
    description: 'CSS linked after the static site\'s default stylesheet, so a few `:root { --accent: … }` lines restyle every published page.',
    rung: 'setting',
    contract: { kind: 'parser', format: 'CSS, one file', at: { file: 'src/main/publish/exporters/static-site/index.ts' } },
    loadPath: 'hot',
    sources: ['thoughtbase'],
    location: '<thoughtbase>/.minerva/site.css',
    docs: 'docs/publishing.md',
    harness: 'tests/main/publish/static-site.test.ts',
  },

  {
    id: 'ontology',
    label: 'Ontology',
    description: 'A vocabulary — classes, properties and prefixes — added beside the built-in `minerva:` and `thought:` ones. Imported from Settings → Ontology; its prefixes work in every query, and its terms show in completion and in the schema the model reads. It can add terms, not change Minerva\'s.',
    rung: 'setting',
    contract: { kind: 'parser', format: 'Turtle (.ttl), refused whole if it describes a built-in term, rebinds a standard prefix or contradicts itself or another vocabulary', at: { file: 'src/main/graph/user-ontology-check.ts', symbol: 'checkVocabulary' } },
    loadPath: 'hot',
    sources: ['stock', 'thoughtbase'],
    location: '<thoughtbase>/.minerva/ontology/',
    docs: 'docs/thought-ontology.md',
    example: 'tests/main/graph/user-ontology.test.ts',
    harness: 'tests/main/graph/user-ontology-check.test.ts',
  },

  {
    id: 'thoughtbase-guide',
    label: 'Thoughtbase guide',
    description: 'A plain-English guide to one thoughtbase — its purpose, folders, naming, tags, how notes are written and how the user likes answers — shown to the assistant at the start of every conversation there. The cheapest way to change how the assistant works in one thoughtbase. Conventions only: it can\'t override safety rules or approval.',
    rung: 'setting',
    contract: { kind: 'parser', format: 'Markdown, free-form, read fresh on every conversation turn', at: { file: 'src/main/llm/thoughtbase-doc.ts', symbol: 'readThoughtbaseDoc' } },
    loadPath: 'hot',
    sources: ['thoughtbase'],
    location: '<thoughtbase>/thoughtbase.md (File → Edit Thoughtbase Guide…)',
    docs: 'website/docs/_content/thoughtbase-operations.html',
    harness: 'tests/main/llm/thoughtbase-doc.test.ts',
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    id: 'skills',
    label: 'Skills',
    description: 'A thinking tool: a prompt template with parameters that becomes a Learning / Research / Analysis menu item and, optionally, a slash command. Its writes are proposals.',
    rung: 'skill',
    contract: { kind: 'parser', format: 'Markdown with YAML frontmatter (a bare .md, or a folder with SKILL.md)', at: { file: 'src/main/skills/parse.ts', symbol: 'parseSkill' } },
    loadPath: 'reload-command',
    sources: ['stock', 'user', 'plugin'],
    location: '~/.minerva/skills/, or a plugin\'s skills/ (#2633)',
    docs: 'docs/authoring-skills.md',
    example: 'src/main/skills/stock/propose-source-summary.md',
    harness: 'tests/main/skills-parse.test.ts',
    // A loaded skill compiles into the tool registry, in main and in the renderer's copy.
    registries: [
      { file: 'src/shared/tools/registry.ts', symbol: 'registerTool' },
      { file: 'src/renderer/lib/tools/tool-registry.ts', symbol: 'registerSkillInfos' },
    ],
  },

  // ── Object types ─────────────────────────────────────────────────────────
  {
    id: 'object-types',
    label: 'Object types',
    description: 'A note type: its properties, its form, the views of its instances, and the graph class its notes assert.',
    rung: 'object-type',
    contract: { kind: 'parser', format: 'Markdown with YAML frontmatter, one type per file', at: { file: 'src/main/types/parse.ts', symbol: 'parseType' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin', 'thoughtbase'],
    location: '<thoughtbase>/.minerva/types/, or a plugin\'s types/ (#2633)',
    docs: 'docs/authoring-types.md',
    example: 'src/main/types/stock/place.md',
    harness: 'tests/main/types/loader.test.ts',
  },

  // ── Queries and templates ────────────────────────────────────────────────
  {
    id: 'saved-queries',
    label: 'Saved queries',
    description: 'A SPARQL or SQL query, listed under Query ▸ Saved Queries and runnable in the Query panel.',
    rung: 'query-view',
    contract: { kind: 'parser', format: '.rq (SPARQL) or .sql, with optional comment front matter', at: { file: 'src/main/saved-query-files.ts', symbol: 'parseQueryContent' } },
    loadPath: 'hot',
    sources: ['stock', 'user', 'plugin', 'thoughtbase'],
    location: 'the app\'s user-data folder (queries/), <thoughtbase>/.minerva/queries/, or a plugin\'s queries/ (#2633)',
    docs: 'website/docs/_content/query-menu-panel.html',
    example: 'src/shared/stock-queries.ts',
    harness: 'tests/main/saved-queries.test.ts',
  },
  {
    id: 'note-templates',
    label: 'Note templates',
    description: 'A note body to start from, offered by the New Note dialog and by Insert Template….',
    rung: 'query-view',
    contract: { kind: 'parser', format: 'Markdown, one template per file', at: { file: 'src/main/notebase/templates.ts', symbol: 'listTemplates' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin', 'thoughtbase'],
    location: '<thoughtbase>/.minerva/templates/, or a plugin\'s templates/ (#2633)',
    example: 'src/main/notebase/templates.ts',
  },

  // ── Plugins only ─────────────────────────────────────────────────────────
  {
    id: 'inspections',
    label: 'Inspections',
    description: 'A health check over the graph whose findings show in the Inspections panel: a SHACL shape — its target, its constraints, sh:severity and sh:message. Read-only: a shape can\'t change the graph or reach the network.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'SHACL in Turtle: a sh:NodeShape with a target, sh:name, sh:description, sh:severity, sh:message, minerva:inspectionGroup and minerva:suggestedAction; any sh:select / sh:ask a SELECT / ASK', at: { file: 'src/main/graph/shacl/shapes.ts', symbol: 'parseShapesFile' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin', 'thoughtbase'],
    location: 'a plugin\'s inspections/ (#2642), or the thoughtbase\'s .minerva/shapes/ (#2874); a check a shape can\'t say is a plugin\'s code.inspections, run by its worker (#2831)',
    docs: 'docs/authoring-plugins.md',
    example: 'tests/fixtures/plugins/reading-list/inspections/finished-books.ttl',
    harness: 'tests/main/plugins/inspection-shapes.test.ts',
    registries: [{ file: 'src/main/graph/inspection-checks.ts', symbol: 'INSPECTION_CHECKS' }],
  },
  {
    id: 'themes',
    label: 'Themes',
    description: 'A colour theme: colours over the dark or light theme, listed after Dark, Light, High Contrast and System in every theme picker. Tokens only — it recolours Minerva, it can\'t restyle it.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'JSON: { label, base: "dark" | "light", tokens: { "--token": colour } }, tokens from the built-in themes only', at: { file: 'src/main/plugins/themes.ts', symbol: 'parseThemeFile' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s themes/ (#2787)',
    docs: 'docs/authoring-plugins.md',
    example: 'tests/fixtures/plugins/solarized/themes/solarized-dark.json',
    harness: 'tests/main/plugins/themes.test.ts',
    registries: [{ file: 'src/shared/theme.ts', symbol: 'THEME_MODES' }],
  },

  // ── Plugin code (#2833): built in, and from a plugin's `code` section ───
  {
    id: 'live-blocks',
    label: 'Live blocks',
    description: 'A block that renders from data — a query result, a chart, an embedded view — in the preview and in every export. A plugin\'s is a fence or :::directive drawn by a page of its own, in a sandboxed frame.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'plugin.json code.blocks: { id, title, fence | directive, entry (a page), query? (an .rq) }, with the ui capability', at: { file: 'src/main/plugins/manifest.ts', symbol: 'validateBlocks' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s plugin.json, code.blocks (#2641), approved with its code (#2833)',
    docs: 'docs/plugin-code.md',
    harness: 'tests/architecture/export-live-block-parity.test.ts',
    registries: [{ file: 'src/shared/live-blocks.ts', symbol: 'LIVE_BLOCKS' }],
  },
  {
    id: 'commands',
    label: 'Commands',
    description: 'An action placed by id in the menu bar, the palette, the window keymap or the editor keymap. A plugin\'s is in the palette, and the editor menu, a menu of the menu bar and on a key of its own if it asks; it runs a handler in its worker, a skill, a query, one of its views, or its MCP tool.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'plugin.json code.commands: { id, title, when, editorMenu?, menu?, key?, run: { handler | skill | query | view | mcpTool } }', at: { file: 'src/main/plugins/manifest.ts', symbol: 'validateCommands' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s plugin.json, code.commands (#2643), approved with its code (#2833)',
    docs: 'docs/authoring-plugins.md',
    example: 'tests/fixtures/plugins/note-stats/plugin.json',
    harness: 'tests/architecture/command-registry.test.ts',
    registries: [{ file: 'src/shared/commands.ts', symbol: 'COMMANDS' }],
  },
  {
    id: 'left-sidebar-panels',
    label: 'Left sidebar panels',
    description: 'A panel in the left sidebar\'s rail: Notes, Sources, Tags, Tables, Objects…. A plugin\'s is a global view: a page fed by a query it declares, which Minerva runs.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'plugin.json code.views: { id, title, place: "left-sidebar", entry (a page), query (an .rq), icon? }, with ui and graph:query', at: { file: 'src/main/plugins/manifest.ts', symbol: 'validateViews' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s plugin.json, code.views (#2640), approved with its code (#2833)',
    docs: 'docs/authoring-plugins.md',
    example: 'tests/fixtures/plugins/note-stats/plugin.json',
    harness: 'tests/architecture/panel-registries.test.ts',
    registries: [{ file: 'src/renderer/lib/components/sidebar/panels.ts', symbol: 'LEFT_PANELS' }],
  },
  {
    id: 'right-sidebar-panels',
    label: 'Right sidebar panels',
    description: 'A panel about the active note: outline, properties, links, citations, inspections…. A plugin\'s is a global view: a page fed by a query it declares, which Minerva runs.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'plugin.json code.views: { id, title, place: "right-sidebar", entry (a page), query (an .rq), icon? }, with ui and graph:query', at: { file: 'src/main/plugins/manifest.ts', symbol: 'validateViews' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s plugin.json, code.views (#2640), approved with its code (#2833)',
    docs: 'docs/plugin-code.md',
    harness: 'tests/architecture/panel-registries.test.ts',
    registries: [{ file: 'src/renderer/lib/components/right-sidebar/panels.ts', symbol: 'RIGHT_PANELS' }],
  },
  {
    id: 'ingestors',
    label: 'Source ingestors',
    description: 'A way a Source comes in: a file type, a bibliographic identifier, or a web page. A plugin\'s is a file type, a site or an identifier prefix, read by its worker or its own MCP tool, returning a draft Minerva checks and writes.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'plugin.json code.ingestors: { id, label, accepts: { extensions | urlMatch | identifierPrefixes }, parse: { handler | mcpTool } }; it returns { title, body, … }', at: { file: 'src/main/plugins/code-io-schema.ts', symbol: 'validateIngestors' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s plugin.json, code.ingestors (#2647, #2880), approved with its code (#2833) or its MCP server (#2646)',
    docs: 'docs/plugin-code.md',
    example: 'tests/fixtures/plugins/book-shelf/plugin.json',
    harness: 'tests/main/sources/ingestors.test.ts',
    registries: [{ file: 'src/main/sources/ingestors.ts', symbol: 'INGESTORS' }],
  },
  {
    id: 'exporters',
    label: 'Exporters',
    description: 'An export format — markdown, HTML, PDF, a static site, a bibliography…—offered under Export. A plugin\'s is a family of its own, written by its worker from the rendered notes; Minerva writes the files.',
    rung: 'plugin',
    contract: { kind: 'parser', format: 'plugin.json code.exporters: { id, label, input: "html" | "markdown", scopes, write: { handler | mcpTool } }; it returns { files: [{ path, text | base64 }] }', at: { file: 'src/main/plugins/code-io-schema.ts', symbol: 'validateExporters' } },
    loadPath: 'hot',
    sources: ['stock', 'plugin'],
    location: 'a plugin\'s plugin.json, code.exporters (#2648), approved with its code (#2833)',
    docs: 'docs/publishing.md',
    harness: 'tests/main/publish/registry.test.ts',
    registries: [{ file: 'src/main/publish/registry.ts', symbol: 'registerExporter' }],
  },

  // ── MCP ──────────────────────────────────────────────────────────────────
  {
    id: 'mcp-servers',
    label: 'MCP servers (Minerva as client)',
    description: 'An MCP server whose tools the conversation model may call through mcp_call. Code runs out of process; a tool not marked read-only waits for the user.',
    rung: 'mcp',
    contract: { kind: 'parser', format: 'A server entry: stdio command + args + env, or an HTTP URL', at: { file: 'src/main/mcp-servers/config-store.ts', symbol: 'decodeServer' } },
    loadPath: 'hot',
    sources: ['user', 'plugin'],
    location: '~/.minerva/mcp-servers.json, edited in Settings → MCP Servers; or a plugin\'s mcpServers, run once the user turns each on (#2646)',
    docs: 'website/docs/_content/settings-mcp-servers.html',
    example: 'src/main/plugins/scaffold-templates/',
    harness: 'tests/main/mcp-servers/config-store.test.ts',
  },

  // ── Source: built-ins register, nothing else can yet ─────────────────────
  {
    id: 'view-layouts',
    label: 'View layouts',
    description: 'A way to draw a type\'s instances: list, table, gallery, map, kanban, timeline, calendar.',
    ...sourceSeam({ file: 'src/shared/objects/view-layouts.ts', symbol: 'VIEW_LAYOUTS' }, { story: 2623, harness: 'tests/architecture/view-layout-registry.test.ts' }),
  },
  {
    id: 'property-types',
    label: 'Property types',
    description: 'A kind of value an object type\'s property can hold: text, date, number, enum, link, geo….',
    ...sourceSeam({ file: 'src/shared/objects/type-def.ts', symbol: 'PROPERTY_TYPES' }, { docs: 'docs/authoring-types.md', harness: 'tests/main/types/loader.test.ts' }),
  },
  {
    id: 'settings-sections',
    label: 'Settings sections',
    description: 'A section of the Settings dialog.',
    ...sourceSeam({ file: 'src/renderer/lib/components/settings/sections.ts', symbol: 'SETTINGS_SECTIONS' }, { story: 2626, harness: 'tests/architecture/panel-registries.test.ts' }),
  },
  {
    id: 'llm-tools',
    label: 'LLM tools',
    description: 'A tool the conversation model can call, registered with its class (read / propose / external / skill / interactive) and any path guard. A skill or an MCP server is usually the right rung instead.',
    ...sourceSeam({ file: 'src/main/llm/tools/registry.ts', symbol: 'TOOL_REGISTRATIONS' }, { story: 2628, harness: 'tests/main/llm/prompt-injection/tool-surface.test.ts' }),
  },
  {
    id: 'compute-languages',
    label: 'Compute languages',
    description: 'A language a runnable cell can be written in, and the executor that runs it.',
    ...sourceSeam({ file: 'src/main/compute/executors/index.ts', symbol: 'BUILTIN_EXECUTORS' }, { story: 2630, harness: 'tests/shared/compute/fences.test.ts', registries: [{ file: 'src/main/compute/registry.ts', symbol: 'registerExecutor' }] }),
  },
  {
    id: 'publish-targets',
    label: 'Publish targets',
    description: 'Somewhere an export can be pushed: a git remote, an S3 bucket.',
    ...sourceSeam({ file: 'src/main/publish/transport/registry.ts', symbol: 'BUILTIN_TRANSPORTS' }, { story: 2630, docs: 'docs/publishing.md', harness: 'tests/main/publish/publish-transport.test.ts' }),
  },
  {
    id: 'mcp-tools',
    label: 'MCP tools (Minerva as server)',
    description: 'A tool `minerva mcp` offers an external agent. Reads are guarded like the in-app model\'s; writes are proposals.',
    ...sourceSeam({ file: 'src/cli/mcp.ts', symbol: 'MCP_TOOLS' }, { docs: 'docs/cli.md', harness: 'tests/cli/mcp.test.ts' }),
  },
] as const satisfies readonly ExtensionPoint[];

export type ExtensionPointId = (typeof EXTENSION_POINTS)[number]['id'];

/** The extension points on a rung, in declared order. */
export function extensionPointsOn(rung: Rung): ExtensionPoint[] {
  return (EXTENSION_POINTS as readonly ExtensionPoint[]).filter((p) => p.rung === rung);
}
