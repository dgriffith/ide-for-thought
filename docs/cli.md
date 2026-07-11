# Minerva CLI

Headless, scriptable access to a thoughtbase — the first slice of the Substrate
epic (#1145 → #1149). It reuses the exact `ctx`-based core the app uses (that
core is Electron-free), so an external agent or a shell script can query your
knowledge graph and notes without the app running.

> **Status: read-only, first cut.** `query`, `search`, `read`. Writes (through the
> approval gate) and an MCP subcommand are later children of the epic.

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
| `search <text>` | Full-text search over notes (`--limit <n>`, default 20) | `{ query, hits }` |
| `read <relative-path>` | A note's raw markdown | `{ path, content }` |

Global options: `--project <path>` (thoughtbase root, default: cwd), `--help`.

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
