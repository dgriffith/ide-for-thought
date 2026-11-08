---
id: cli
type: module-design
status: draft
title: CLI & MCP server
parent: architecture
---

## Responsibility

The `minerva` command and its MCP server, which expose a thoughtbase to external
agents and to the shell headlessly, reusing the main-process libraries. Runs via
the fused binary in CLI mode (`Minerva --minerva-cli -- <args>`), never arbitrary
JS as Minerva.

## Boundary

- **Input is split by author.** The `Engine` separates the **user's** commands
  (`sql` / `read` — full root-locked DuckDB connection, any in-root path) from an
  **agent's** input (`agentSql` / `agentRead` behind MCP `sql_query` / `read_
  note` — the allowlist guard and the `.minerva/`-refusing path guard). An MCP
  tool never calls `engine.sql`/`engine.read`, and the CLI never calls the
  `agent*` methods. See [sources](../main/sources/SPEC.md) and [llm](../main/llm/SPEC.md).
- **SQL is never routed to a running app** — the substrate server has no SQL op;
  any added there must use `runAgentQuery`.
- **Registry is empty until the app asks** — the plugin scan is empty until
  `enablePlugins`, so the CLI, tests, and eval goldens never see a developer's
  installed plugins.
