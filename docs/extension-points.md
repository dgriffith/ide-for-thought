# Extension points

<!-- Generated from src/shared/extensions/points.ts by src/shared/extensions/doc.ts — do not edit.
     Change the catalog, then: pnpm test tests/shared/extensions/doc.test.ts -u -->

Every seam something can be added to Minerva through: what a contribution looks like, which rung
of the ladder it sits on, how it is picked up, and where its docs, an example and its test live.
The same catalog is in the knowledge graph (`minerva:ExtensionPoint`, with what is installed in
each as `minerva:Contribution`) and behind the `list_extension_points` / `describe_extension_point`
tools, in the app and over `minerva mcp`.

## The ladder

Reach for the lowest rung that does the job — declarative before code.

1. **setting** — A switch or value in Settings, or a configuration file Minerva reads (a CSL style, a site stylesheet).
2. **skill** — A markdown skill: a prompt template that becomes a menu item and, optionally, a slash command.
3. **object-type** — A markdown object type: a note type with properties, a form and views.
4. **query-view** — A saved query or a note template.
5. **plugin** — A declarative plugin bundle (#2631) in ~/.minerva/plugins/: docs/authoring-plugins.md.
6. **mcp** — An MCP server: code, out of process, capability-scoped and approval-gated.
7. **source** — A change to Minerva itself.

## At a glance

| Extension point | Rung | Picked up | From |
|---|---|---|---|
| [Citation styles and locales](#csl-styles--citation-styles-and-locales) | setting | hot | stock, plugin, thoughtbase |
| [Static site stylesheet](#static-site-css--static-site-stylesheet) | setting | hot | thoughtbase |
| [Ontology](#ontology--ontology) | setting | hot | stock, thoughtbase |
| [Thoughtbase guide](#thoughtbase-guide--thoughtbase-guide) | setting | hot | thoughtbase |
| [Skills](#skills--skills) | skill | reload-command | stock, user, plugin |
| [Object types](#object-types--object-types) | object-type | hot | stock, plugin, thoughtbase |
| [Saved queries](#saved-queries--saved-queries) | query-view | hot | stock, user, plugin, thoughtbase |
| [Note templates](#note-templates--note-templates) | query-view | hot | stock, plugin, thoughtbase |
| [Inspections](#inspections--inspections) | plugin | hot | stock, plugin |
| [Themes](#themes--themes) | plugin | hot | stock, plugin |
| [MCP servers (Minerva as client)](#mcp-servers--mcp-servers-minerva-as-client) | mcp | hot | user, plugin |
| [View layouts](#view-layouts--view-layouts) | source | rebuild | stock |
| [Property types](#property-types--property-types) | source | rebuild | stock |
| [Live blocks](#live-blocks--live-blocks) | source | rebuild | stock |
| [Commands](#commands--commands) | source | rebuild | stock |
| [Left sidebar panels](#left-sidebar-panels--left-sidebar-panels) | source | rebuild | stock |
| [Right sidebar panels](#right-sidebar-panels--right-sidebar-panels) | source | rebuild | stock |
| [Settings sections](#settings-sections--settings-sections) | source | rebuild | stock |
| [LLM tools](#llm-tools--llm-tools) | source | rebuild | stock |
| [Source ingestors](#ingestors--source-ingestors) | source | rebuild | stock |
| [Compute languages](#compute-languages--compute-languages) | source | rebuild | stock |
| [Exporters](#exporters--exporters) | source | rebuild | stock |
| [Publish targets](#publish-targets--publish-targets) | source | rebuild | stock |
| [MCP tools (Minerva as server)](#mcp-tools--mcp-tools-minerva-as-server) | source | rebuild | stock |

## `csl-styles` — Citation styles and locales

A CSL style or locale file, used when rendering citations and bibliographies. Imported from Settings → Bibliography.

- **Rung:** setting
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, plugin, thoughtbase
- **Goes in:** &lt;thoughtbase>/.minerva/csl-styles/, &lt;thoughtbase>/.minerva/csl-locales/, or a plugin's csl/ (#2633)
- **Contract:** CSL 1.0 XML (.csl style, .xml locale), checked by [`src/main/publish/csl/user-assets.ts`](../src/main/publish/csl/user-assets.ts) (`isValidCslStyle`)
- **Docs:** [`website/docs/_content/settings-bibliography.html`](../website/docs/_content/settings-bibliography.html)
- **Test:** [`tests/main/publish/user-csl-assets.test.ts`](../tests/main/publish/user-csl-assets.test.ts)

## `static-site-css` — Static site stylesheet

CSS linked after the static site's default stylesheet, so a few `:root { --accent: … }` lines restyle every published page.

- **Rung:** setting
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** thoughtbase
- **Goes in:** &lt;thoughtbase>/.minerva/site.css
- **Contract:** CSS, one file, checked by [`src/main/publish/exporters/static-site/index.ts`](../src/main/publish/exporters/static-site/index.ts)
- **Docs:** [`docs/publishing.md`](publishing.md)
- **Test:** [`tests/main/publish/static-site.test.ts`](../tests/main/publish/static-site.test.ts)

## `ontology` — Ontology

A vocabulary — classes, properties and prefixes — added beside the built-in `minerva:` and `thought:` ones. Imported from Settings → Ontology; its prefixes work in every query, and its terms show in completion and in the schema the model reads. It can add terms, not change Minerva's.

- **Rung:** setting
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, thoughtbase
- **Goes in:** &lt;thoughtbase>/.minerva/ontology/
- **Contract:** Turtle (.ttl), refused whole if it describes a built-in term, rebinds a standard prefix or contradicts itself or another vocabulary, checked by [`src/main/graph/user-ontology-check.ts`](../src/main/graph/user-ontology-check.ts) (`checkVocabulary`)
- **Docs:** [`docs/thought-ontology.md`](thought-ontology.md)
- **Example:** [`tests/main/graph/user-ontology.test.ts`](../tests/main/graph/user-ontology.test.ts)
- **Test:** [`tests/main/graph/user-ontology-check.test.ts`](../tests/main/graph/user-ontology-check.test.ts)

## `thoughtbase-guide` — Thoughtbase guide

A plain-English guide to one thoughtbase — its purpose, folders, naming, tags, how notes are written and how the user likes answers — shown to the assistant at the start of every conversation there. The cheapest way to change how the assistant works in one thoughtbase. Conventions only: it can't override safety rules or approval.

- **Rung:** setting
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** thoughtbase
- **Goes in:** &lt;thoughtbase>/thoughtbase.md (File → Edit Thoughtbase Guide…)
- **Contract:** Markdown, free-form, read fresh on every conversation turn, checked by [`src/main/llm/thoughtbase-doc.ts`](../src/main/llm/thoughtbase-doc.ts) (`readThoughtbaseDoc`)
- **Docs:** [`website/docs/_content/thoughtbase-operations.html`](../website/docs/_content/thoughtbase-operations.html)
- **Test:** [`tests/main/llm/thoughtbase-doc.test.ts`](../tests/main/llm/thoughtbase-doc.test.ts)

## `skills` — Skills

A thinking tool: a prompt template with parameters that becomes a Learning / Research / Analysis menu item and, optionally, a slash command. Its writes are proposals.

- **Rung:** skill
- **Picked up:** after an explicit reload (`reload-command`)
- **Contributions from:** stock, user, plugin
- **Goes in:** ~/.minerva/skills/, or a plugin's skills/ (#2633)
- **Contract:** Markdown with YAML frontmatter (a bare .md, or a folder with SKILL.md), checked by [`src/main/skills/parse.ts`](../src/main/skills/parse.ts) (`parseSkill`)
- **Registers in:** [`src/shared/tools/registry.ts`](../src/shared/tools/registry.ts) (`registerTool`), [`src/renderer/lib/tools/tool-registry.ts`](../src/renderer/lib/tools/tool-registry.ts) (`registerSkillInfos`)
- **Docs:** [`docs/authoring-skills.md`](authoring-skills.md)
- **Example:** [`src/main/skills/stock/propose-source-summary.md`](../src/main/skills/stock/propose-source-summary.md)
- **Test:** [`tests/main/skills-parse.test.ts`](../tests/main/skills-parse.test.ts)

## `object-types` — Object types

A note type: its properties, its form, the views of its instances, and the graph class its notes assert.

- **Rung:** object-type
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, plugin, thoughtbase
- **Goes in:** &lt;thoughtbase>/.minerva/types/, or a plugin's types/ (#2633)
- **Contract:** Markdown with YAML frontmatter, one type per file, checked by [`src/main/types/parse.ts`](../src/main/types/parse.ts) (`parseType`)
- **Docs:** [`docs/authoring-types.md`](authoring-types.md)
- **Example:** [`src/main/types/stock/place.md`](../src/main/types/stock/place.md)
- **Test:** [`tests/main/types/loader.test.ts`](../tests/main/types/loader.test.ts)

## `saved-queries` — Saved queries

A SPARQL or SQL query, listed under Query ▸ Saved Queries and runnable in the Query panel.

- **Rung:** query-view
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, user, plugin, thoughtbase
- **Goes in:** the app's user-data folder (queries/), &lt;thoughtbase>/.minerva/queries/, or a plugin's queries/ (#2633)
- **Contract:** .rq (SPARQL) or .sql, with optional comment front matter, checked by [`src/main/saved-query-files.ts`](../src/main/saved-query-files.ts) (`parseQueryContent`)
- **Docs:** [`website/docs/_content/query-menu-panel.html`](../website/docs/_content/query-menu-panel.html)
- **Example:** [`src/shared/stock-queries.ts`](../src/shared/stock-queries.ts)
- **Test:** [`tests/main/saved-queries.test.ts`](../tests/main/saved-queries.test.ts)

## `note-templates` — Note templates

A note body to start from, offered by the New Note dialog and by Insert Template….

- **Rung:** query-view
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, plugin, thoughtbase
- **Goes in:** &lt;thoughtbase>/.minerva/templates/, or a plugin's templates/ (#2633)
- **Contract:** Markdown, one template per file, checked by [`src/main/notebase/templates.ts`](../src/main/notebase/templates.ts) (`listTemplates`)
- **Example:** [`src/main/notebase/templates.ts`](../src/main/notebase/templates.ts)

## `inspections` — Inspections

A health check over the graph whose findings show in the Inspections panel: a SHACL shape — its target, its constraints, sh:severity and sh:message. Read-only: a shape can't change the graph or reach the network.

- **Rung:** plugin
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, plugin
- **Goes in:** a plugin's inspections/ (#2642)
- **Contract:** SHACL in Turtle: a sh:NodeShape with a target, sh:name, sh:description, sh:severity, sh:message, minerva:inspectionGroup and minerva:suggestedAction; any sh:select / sh:ask a SELECT / ASK, checked by [`src/main/graph/shacl/shapes.ts`](../src/main/graph/shacl/shapes.ts) (`parseShapesFile`)
- **Registers in:** [`src/main/graph/inspection-checks.ts`](../src/main/graph/inspection-checks.ts) (`INSPECTION_CHECKS`)
- **Docs:** [`docs/authoring-plugins.md`](authoring-plugins.md)
- **Example:** [`tests/fixtures/plugins/reading-list/inspections/finished-books.ttl`](../tests/fixtures/plugins/reading-list/inspections/finished-books.ttl)
- **Test:** [`tests/main/plugins/inspection-shapes.test.ts`](../tests/main/plugins/inspection-shapes.test.ts)

## `themes` — Themes

A colour theme: colours over the dark or light theme, listed after Dark, Light, High Contrast and System in every theme picker. Tokens only — it recolours Minerva, it can't restyle it.

- **Rung:** plugin
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** stock, plugin
- **Goes in:** a plugin's themes/ (#2787)
- **Contract:** JSON: { label, base: "dark" | "light", tokens: { "--token": colour } }, tokens from the built-in themes only, checked by [`src/main/plugins/themes.ts`](../src/main/plugins/themes.ts) (`parseThemeFile`)
- **Registers in:** [`src/shared/theme.ts`](../src/shared/theme.ts) (`THEME_MODES`)
- **Docs:** [`docs/authoring-plugins.md`](authoring-plugins.md)
- **Example:** [`tests/fixtures/plugins/solarized/themes/solarized-dark.json`](../tests/fixtures/plugins/solarized/themes/solarized-dark.json)
- **Test:** [`tests/main/plugins/themes.test.ts`](../tests/main/plugins/themes.test.ts)

## `mcp-servers` — MCP servers (Minerva as client)

An MCP server whose tools the conversation model may call through mcp_call. Code runs out of process; a tool not marked read-only waits for the user.

- **Rung:** mcp
- **Picked up:** at once, or on its next read (`hot`)
- **Contributions from:** user, plugin
- **Goes in:** ~/.minerva/mcp-servers.json, edited in Settings → MCP Servers; or a plugin's mcpServers, run once the user turns each on (#2646)
- **Contract:** A server entry: stdio command + args + env, or an HTTP URL, checked by [`src/main/mcp-servers/config-store.ts`](../src/main/mcp-servers/config-store.ts) (`decodeServer`)
- **Docs:** [`website/docs/_content/settings-mcp-servers.html`](../website/docs/_content/settings-mcp-servers.html)
- **Example:** [`src/main/plugins/scaffold-templates/`](../src/main/plugins/scaffold-templates/)
- **Test:** [`tests/main/mcp-servers/config-store.test.ts`](../tests/main/mcp-servers/config-store.test.ts)

## `view-layouts` — View layouts

A way to draw a type's instances: list, table, gallery, map, kanban, timeline, calendar.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/shared/objects/view-layouts.ts`](../src/shared/objects/view-layouts.ts) (`VIEW_LAYOUTS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2623
- **Test:** [`tests/architecture/view-layout-registry.test.ts`](../tests/architecture/view-layout-registry.test.ts)

## `property-types` — Property types

A kind of value an object type's property can hold: text, date, number, enum, link, geo….

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/shared/objects/type-def.ts`](../src/shared/objects/type-def.ts) (`PROPERTY_TYPES`); nothing outside the source can add one until plugins load (#2631)
- **Docs:** [`docs/authoring-types.md`](authoring-types.md)
- **Test:** [`tests/main/types/loader.test.ts`](../tests/main/types/loader.test.ts)

## `live-blocks` — Live blocks

A block that renders from data — a query result, a chart, an embedded view — in the preview and in every export.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/shared/live-blocks.ts`](../src/shared/live-blocks.ts) (`LIVE_BLOCKS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2624
- **Test:** [`tests/architecture/export-live-block-parity.test.ts`](../tests/architecture/export-live-block-parity.test.ts)

## `commands` — Commands

An action placed by id in the menu bar, the palette, the window keymap or the editor keymap.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/shared/commands.ts`](../src/shared/commands.ts) (`COMMANDS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2625
- **Test:** [`tests/architecture/command-registry.test.ts`](../tests/architecture/command-registry.test.ts)

## `left-sidebar-panels` — Left sidebar panels

A panel in the left sidebar's rail: Notes, Sources, Tags, Tables, Objects….

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/renderer/lib/components/sidebar/panels.ts`](../src/renderer/lib/components/sidebar/panels.ts) (`LEFT_PANELS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2626
- **Test:** [`tests/architecture/panel-registries.test.ts`](../tests/architecture/panel-registries.test.ts)

## `right-sidebar-panels` — Right sidebar panels

A panel about the active note: outline, properties, links, citations, inspections….

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/renderer/lib/components/right-sidebar/panels.ts`](../src/renderer/lib/components/right-sidebar/panels.ts) (`RIGHT_PANELS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2626
- **Test:** [`tests/architecture/panel-registries.test.ts`](../tests/architecture/panel-registries.test.ts)

## `settings-sections` — Settings sections

A section of the Settings dialog.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/renderer/lib/components/settings/sections.ts`](../src/renderer/lib/components/settings/sections.ts) (`SETTINGS_SECTIONS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2626
- **Test:** [`tests/architecture/panel-registries.test.ts`](../tests/architecture/panel-registries.test.ts)

## `llm-tools` — LLM tools

A tool the conversation model can call, registered with its class (read / propose / external / skill / interactive) and any path guard. A skill or an MCP server is usually the right rung instead.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/main/llm/tools/registry.ts`](../src/main/llm/tools/registry.ts) (`TOOL_REGISTRATIONS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2628
- **Test:** [`tests/main/llm/prompt-injection/tool-surface.test.ts`](../tests/main/llm/prompt-injection/tool-surface.test.ts)

## `ingestors` — Source ingestors

A way a Source comes in: a file type, a bibliographic identifier, or a web page.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/main/sources/ingestors.ts`](../src/main/sources/ingestors.ts) (`INGESTORS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2629
- **Test:** [`tests/main/sources/ingestors.test.ts`](../tests/main/sources/ingestors.test.ts)

## `compute-languages` — Compute languages

A language a runnable cell can be written in, and the executor that runs it.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/main/compute/executors/index.ts`](../src/main/compute/executors/index.ts) (`BUILTIN_EXECUTORS`); nothing outside the source can add one until plugins load (#2631)
- **Registers in:** [`src/main/compute/registry.ts`](../src/main/compute/registry.ts) (`registerExecutor`)
- **Made a registry by:** #2630
- **Test:** [`tests/shared/compute/fences.test.ts`](../tests/shared/compute/fences.test.ts)

## `exporters` — Exporters

An export format — markdown, HTML, PDF, a static site, a bibliography…—offered under Export.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/main/publish/registry.ts`](../src/main/publish/registry.ts) (`registerExporter`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2630
- **Docs:** [`docs/publishing.md`](publishing.md)
- **Test:** [`tests/main/publish/registry.test.ts`](../tests/main/publish/registry.test.ts)

## `publish-targets` — Publish targets

Somewhere an export can be pushed: a git remote, an S3 bucket.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/main/publish/transport/registry.ts`](../src/main/publish/transport/registry.ts) (`BUILTIN_TRANSPORTS`); nothing outside the source can add one until plugins load (#2631)
- **Made a registry by:** #2630
- **Docs:** [`docs/publishing.md`](publishing.md)
- **Test:** [`tests/main/publish/publish-transport.test.ts`](../tests/main/publish/publish-transport.test.ts)

## `mcp-tools` — MCP tools (Minerva as server)

A tool `minerva mcp` offers an external agent. Reads are guarded like the in-app model's; writes are proposals.

- **Rung:** source
- **Picked up:** only in a rebuilt app (`rebuild`)
- **Contributions from:** stock
- **Contract:** none yet — built-ins register in [`src/cli/mcp.ts`](../src/cli/mcp.ts) (`MCP_TOOLS`); nothing outside the source can add one until plugins load (#2631)
- **Docs:** [`docs/cli.md`](cli.md)
- **Test:** [`tests/cli/mcp.test.ts`](../tests/cli/mcp.test.ts)
