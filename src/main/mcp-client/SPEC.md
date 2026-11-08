---
id: mcp
type: module-design
status: draft
title: MCP — client & local/remote servers
parent: architecture
---

## Responsibility

Model Context Protocol integration, both directions. `mcp-client/` connects
Minerva to configured MCP servers (including OAuth-authenticated ones) so the
conversation's `mcp_call` tool can reach their advertised tools. `mcp-servers/`
manages the server configs the user adds.

## Boundary

- **`mcp_call` reaches only advertised tools** of configured, connected servers,
  and a tool not marked `readOnlyHint: true` **waits for the user** — the
  conversation passes an inline Allow/Deny confirm; a caller with no UI (eval,
  CLI, background) is refused. "Don't ask again" is keyed by a hash of the
  server's connection config, so a changed command/args/env/URL voids it. See
  [llm](../llm/SPEC.md).
- **Local MCP servers are a core plugin, off by default.** Off, no stdio server
  starts (plugins' included) and `mcp_call` can't reach one. Remote servers stay
  core and refuse stdio. See [plugins](../plugins/SPEC.md).
- **The `minerva` MCP server** (the other direction — exposing a thoughtbase to
  external agents) lives in the [CLI](../../cli/SPEC.md) and reuses the same
  read-only/allowlist guards as the in-app tool surface.
