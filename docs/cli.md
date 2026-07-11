# Minerva CLI

Headless, scriptable access to a thoughtbase — the first slice of the Substrate
epic (#1145 → #1149). It reuses the exact `ctx`-based core the app uses (that
core is Electron-free), so an external agent or a shell script can query your
knowledge graph and notes without the app running.

> **Status: read-only.** `query`, `sql`, `search`, `semantic`, `read`, and `mcp`
> (a stdio MCP server exposing the reads to agent clients). Writes — through the
> approval gate — are a later child of the epic (#1147).

## Build & run

```sh
pnpm cli:build                     # → .vite/build/cli.js (standalone Node bundle)
node .vite/build/cli.js <command> [args] [--project <path>]
```

`pnpm cli` builds then runs in one step. The bundle externalizes node_modules, so
it resolves heavy/native deps (rdflib, comunica, DuckDB, onnxruntime) from the
repo's `node_modules` at runtime — no separate install.

## Commands

| Command | Purpose | Output |
|---|---|---|
| `query <sparql>` | SPARQL over the knowledge graph (standard prefixes auto-injected) | `{ columns, results }` |
| `sql <sql>` | DuckDB SQL over the vault's CSV tables (registered by derived name) | `{ columns, rows }` |
| `search <text>` | Full-text search over notes (`--limit <n>`, default 20) | `{ query, hits }` |
| `semantic <text>` | Embeddings search over notes (`--limit <n>`) | `{ query, hits }` |
| `read <relative-path>` | A note's raw markdown | `{ path, content }` |

Global options: `--project <path>` (thoughtbase root, default: cwd), `--help`.

`semantic` covers only content the app has already embedded; against a vault that
was never opened in the app it returns no hits (with a `note` saying so). `sql`
integer columns come back as JSON numbers (DuckDB BigInt is handled).

Every result is **grounded** — query bindings carry node IRIs, search hits carry
the note path, read echoes the path — and printed as JSON on stdout so it pipes
into `jq` or feeds an agent directly.

```sh
# What do I already know about photosynthesis?
node .vite/build/cli.js search photosynthesis --project ~/vault | jq '.hits[].relativePath'

# Every note with a title, alphabetized.
node .vite/build/cli.js query \
  'SELECT ?title WHERE { ?n a minerva:Note ; dc:title ?title } ORDER BY ?title' \
  --project ~/vault
```

## MCP server

`minerva mcp [--project <path>]` starts a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, exposing the read commands as tools so any MCP client — Claude
Desktop, a coding agent, an editor — can query the thoughtbase. It speaks
newline-delimited JSON-RPC 2.0 and stays running until stdin closes.

Tools: `query_graph`, `sql_query`, `search_notes`, `semantic_search`, `read_note`
— each returning the same grounded JSON as the matching CLI command.

Point an MCP client at it (the client launches it as a subprocess):

```json
{
  "mcpServers": {
    "minerva": {
      "command": "node",
      "args": ["/path/to/minerva/.vite/build/cli.js", "mcp", "--project", "/path/to/vault"]
    }
  }
}
```

The server inits each modality once and stays warm across tool calls. Because
that init is a point-in-time snapshot, a long-running server serves results as of
startup — restart it to pick up external edits (the write-coordination caveat in
`docs/vision/substrate-mcp-plan.md`). Read-only: writes will arrive as
approval-gated proposals in a later child (#1147).

## Exit codes

`0` success · `1` a core/query error (e.g. malformed SPARQL) · `2` a usage error
(unknown command, missing argument, bad `--project`). Errors print to stderr.

## Design

All logic is one pure function — `runCli(argv, { cwd })` in `src/cli/run.ts` —
returning `{ stdout, stderr, code }` without touching `process` or Electron. The
executable entry (`src/cli/main.ts`) is a thin write-and-exit shell, and the
forthcoming MCP subcommand will wrap the same function. That's why the whole
surface is testable under vitest (`tests/cli/run.test.ts`) with no spawned
process.
