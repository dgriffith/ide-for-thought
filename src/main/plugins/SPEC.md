---
id: plugins
type: module-design
status: draft
title: Plugins & extension points
parent: architecture
---

## Responsibility

The extensibility surface. Every seam Minerva can be extended through is declared
once in `src/shared/extensions/points.ts` (the rung ladder: setting → skill →
object-type → query-view → plugin → mcp → source), from which the docs, the
graph catalog, and the `list_extension_points` tools are all built. Owns the
plugin runtime: user plugins in `~/.minerva/plugins/<id>/`, and **core plugins**
shipped inside the app.

## Boundary

- **A new registry or `.minerva/` contribution folder must be declared** in
  `points.ts` (enforced by an architecture test).
- **Plugin code is approved natively** at install and on any change, pinned to a
  hash of every file it ships; a plugin never gets `process`.
- **A plugin's view runs sandboxed** on `minerva-plugin://<id>/`, with no
  preload and no navigation, under its own CSP. What plugin code can *do* goes
  through the capability-checked broker (`plugins/broker.ts`), scoped to the
  notes the host granted the session — never `.minerva/`, never the approval
  engine directly; every write is history origin `plugin`.
- **The plugin API is an ABI** (`plugin-api/`, generated from `shared/plugins/
  api.ts` with its own semver `PLUGIN_API_VERSION`); a breaking change needs a
  major bump.
- **Core plugins ship inside the app**, on/off by a `plugins.json` record. Off
  means not wired up (channels don't exist). Each is activated in
  `core-plugins.ts`. Python compute and local MCP servers are core plugins; the
  Kanban / Timeline / Calendar views are built-in plugins.
