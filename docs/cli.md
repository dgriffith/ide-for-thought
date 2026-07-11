# Minerva CLI

Headless, scriptable access to a thoughtbase — the first slice of the Substrate
epic (#1145 → #1149). It reuses the exact `ctx`-based core the app uses (that
core is Electron-free), so an external agent or a shell script can query your
knowledge graph and notes without the app running.

> **Status: read + propose.** `query`, `sql`, `search`, `semantic`, `read`,
> `propose-note`, and `mcp` (a stdio MCP server exposing them to agent clients).
> Proposals go through the approval gate — they never touch the vault until a
> human approves them in Minerva.

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
| `propose-note <path>` | File a new note (body on **stdin**) as a pending proposal (`--by <id>`) | `{ status, proposalUri, … }` |

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

## Proposing (writes go through the gate)

External agents never write the vault directly. `propose-note` files a note as a
**pending proposal** through Minerva's approval engine — the same gate the
built-in AI uses — stamped with provenance. Nothing lands until a human reviews
and approves it in Minerva's Proposals panel.

```sh
cat draft.md | node .vite/build/cli.js propose-note notes/idea.md --by cli --project ~/vault
```

`--by <id>` records who proposed it (default `cli`); MCP clients are stamped
`mcp:<client-name>` from the initialize handshake. The note body comes from
**stdin**, so it composes with anything upstream.

> **Coordination caveat.** A proposal is persisted into `.minerva/graph.ttl`. If
> Minerva has the same vault open, both processes rewrite that file, so it's
> last-writer-wins — file proposals when the app isn't actively editing the graph,
> and expect the app to surface them after its next reindex. A running-app-aware
> write path is future work (see `docs/vision/substrate-mcp-plan.md`).

## MCP server

`minerva mcp [--project <path>]` starts a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, exposing the read commands as tools so any MCP client — Claude
Desktop, a coding agent, an editor — can query the thoughtbase. It speaks
newline-delimited JSON-RPC 2.0 and stays running until stdin closes.

Tools: `query_graph`, `sql_query`, `search_notes`, `semantic_search`, `read_note`
(reads, grounded JSON) and `propose_note` (files a pending proposal stamped
`mcp:<client-name>` — see *Proposing* above).

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
`docs/vision/substrate-mcp-plan.md`). Writes are limited to `propose_note`, which
is gated: an agent proposes, a human approves.

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
