# Minerva CLI

Headless, scriptable access to a thoughtbase — the first slice of the Substrate
epic (#1145 → #1149). It reuses the exact `ctx`-based core the app uses (that
core is Electron-free), so an external agent or a shell script can query your
knowledge graph and notes without the app running.

> **Status: read + propose.** Ten commands — `query`, `sql`, `search`, `grep`,
> `semantic`, `read`, `context`, `propose-note`, `mcp` (a stdio MCP server
> exposing the rest to agent clients), and `eval` (a development harness for
> skill prompts). Proposals go through the approval gate — they never touch the
> vault until a human approves them in Minerva.

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
| `grep <pattern>` | Exact literal / regex search over raw note text, grounded with path + line (`--regex`, `--case-sensitive`, `--limit <n>` default 50, max 200) | `{ pattern, total, truncated, matches }` |
| `semantic <text>` | Embeddings search over notes (`--limit <n>`) | `{ query, hits }` |
| `read <relative-path>` | A note's raw markdown | `{ path, content }` |
| `context <topic>` | A task-relevant slice: matching notes + link neighborhood + content (`--limit <n>`) | `{ topic, noteCount, notes[] }` |
| `propose-note <path>` | File a new note (body on **stdin**) as a pending proposal (`--by <id>`) | `{ status, proposalUri, … }` |
| `mcp` | Start a stdio MCP server exposing the read + propose tools — see *MCP server* | JSON-RPC 2.0 on stdio |
| `eval <case-dir>…` | Package a skill's prompt exactly as Minerva does, into each case's `output/` (`--all`, `--live`) — see *Skill eval* | `[{ case, skill, model, outputMode }]` |

Global options: `--project <path>` (thoughtbase root, default: cwd), `--limit <n>`,
`--help`. Per-command flags: `--regex` / `--case-sensitive` (`grep`), `--by <id>`
(`propose-note`), `--all` / `--live` (`eval`). `minerva --help` prints the same
surface from the `HELP` block in `src/cli/run.ts`, which is the source of truth
for this table.

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

## Three ways to find something

`search`, `grep`, and `semantic` are not interchangeable, and picking the wrong
one is the most common way to get an empty answer out of a vault that has the
content:

- **`search`** — ranked, word-based full-text. The default for "what do I know
  about X".
- **`grep`** — the exact characters, like `grep(1)`. Punctuation, symbols, code,
  casing and structure all survive, and every match comes back with its note path
  and line number. Use it for a known string or a structural pattern — unfinished
  tasks (`- [ ]`), `[[wiki-links]]`, a `status:` property, TODO / FIXME — or to
  verify whether something literally appears at all. Literal substring by
  default; `--regex` switches to a JavaScript regular expression,
  `--case-sensitive` stops folding case. The result reports the true `total`
  alongside a `truncated` flag, so a capped `matches` array never lies about how
  much matched.
- **`semantic`** — meaning-based, over embeddings the app has already computed.

```sh
node .vite/build/cli.js grep '- [ ]' --project ~/vault | jq '.matches[] | "\(.path):\(.line)"'
```

## Context handoff

`context <topic>` (MCP tool `gather_context`) is the one command that isn't a
single lookup: it assembles a **task-relevant slice** an agent seeds its own
context with. It full-text-retrieves the matching notes and expands each along the
graph — its backlinks (what references it) and outgoing links (what it references)
— returning each note's content plus that neighborhood as one bundle. A coding
agent grounds itself in your design notes before writing; a browser agent checks
what you already concluded before re-researching.

```sh
node .vite/build/cli.js context "retrieval augmented generation" --limit 5 --project ~/vault \
  | jq '.notes[] | {path, backlinks: [.backlinks[].source]}'
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

**Provenance for the fleet.** Every proposal is attributed by `proposedBy`, so the
graph is an audit log of who contributed what. In Minerva, the Proposals panel
labels external agents distinctly from the built-in AI, and the *Contributions by
agent* stock query (Graph → Query) groups proposals by proposer. Attribution
survives a graph reindex, so a proposal filed while the app is closed still shows
up (and stays attributed) once it reopens.

## Running alongside an open app

A proposal is persisted into `.minerva/graph.ttl`, and `semantic` needs the
DuckDB-backed vector store — both of which a running Minerva also owns. Rather
than racing it, the CLI **routes through the app when one is open** (#1524,
`src/cli/routed-engine.ts`):

- On every `propose-note` and `semantic` invocation the CLI looks for the runtime
  advert the app writes into `.minerva/` (pid, loopback port, token) and checks
  that the advertised process is still alive.
- If it is, the op is POSTed to the app over loopback and the app's answer is
  returned verbatim — same JSON shape either way. The app stays the single writer
  on the graph and the single holder of the DuckDB lock (#1272).
- If there is no advert, the pid is dead (a stale advert left by a crash or hard
  kill), or the transport fails for any reason, the CLI falls back to running the
  op in-process exactly as it would with the app closed.

Every other command — `query`, `sql`, `search`, `grep`, `read`, `context` — is
read-only or in-memory and always runs direct, unrouted. So a proposal filed
against an open app is visible there without waiting for a reindex, and nothing
about the CLI's behaviour changes when the app isn't running.

## MCP server

`minerva mcp [--project <path>]` starts a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, exposing the read commands as tools so any MCP client — Claude
Desktop, a coding agent, an editor — can query the thoughtbase. It speaks
newline-delimited JSON-RPC 2.0 and stays running until stdin closes.

Tools: `query_graph`, `sql_query`, `search_notes`, `grep_notes`,
`semantic_search`, `read_note` (reads, grounded JSON), `gather_context` (a topic
slice — see *Context handoff*), and `propose_note` (files a pending proposal
stamped `mcp:<client-name>` — see *Proposing* above).

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
that init is a point-in-time snapshot, a long-running server serves graph and
table reads as of startup — restart it to pick up external edits. `propose_note`
and `semantic_search` are the exceptions: they go through the same routed engine
the CLI uses (see *Running alongside an open app*), so with Minerva open they are
answered by the live app rather than the snapshot. Writes are limited to
`propose_note`, which is gated: an agent proposes, a human approves.

## Skill eval

`minerva eval <case-dir>… [--all] [--live]` is a development harness (#1522), not
an end-user command. It packages a skill's prompt **exactly the way Minerva does
at runtime** — reusing the real `buildConversationPayload` /
`buildOneShotPayload` seam rather than reconstructing it — and overwrites each
case's `output/`. Deterministic by default: same skill + same context + same
params ⇒ identical bytes, so the committed `request.json` doubles as a CI
snapshot (`tests/cli/eval.test.ts`) and a prompt or context change shows up as a
reviewable diff.

Cases live under `tests/skills-eval/<name>/`, each with an `input/case.json`
manifest; `--all` discovers every one of them. Each case declares its own
thoughtbase, so `eval` resolves its own roots and takes no `--project`.

```sh
pnpm cli eval --all                    # regenerate every case's output/, then diff
```

`--live` additionally makes a real model call, writing `response.md` and
`drafts.json` alongside the deterministic pair and enriching `meta.json` with
usage and timing. Opt-in, and it needs a provider key in the environment.

## Exit codes

`0` success · `1` a core/query error (e.g. malformed SPARQL) · `2` a usage error
(unknown command, missing argument, bad `--project`). Errors print to stderr.

## Design

All logic is one pure function — `runCli(argv, { cwd })` in `src/cli/run.ts` —
returning `{ stdout, stderr, code }` without touching `process` or Electron. The
executable entry (`src/cli/main.ts`) is a thin write-and-exit shell, and the `mcp`
subcommand wraps the same `Engine` every other command drives. That's why the
whole surface is testable under vitest (`tests/cli/run.test.ts`) with no spawned
process.

`tests/architecture/cli-docs-parity.test.ts` checks this page against the code: a
command added to the dispatch in `src/cli/run.ts`, or a tool added to `MCP_TOOLS`
in `src/cli/mcp.ts`, fails CI until it is documented here and in the CLI's own
`--help`.
