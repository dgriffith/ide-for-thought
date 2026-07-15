# Plan: Substrate-MCP — Resolving the Open Decisions (epic #1145)

> **Companion to `substrate-mcp.md`.** The vision doc argues *why* Minerva should
> become the substrate for a person's whole agent fleet. This doc resolves the
> **open decisions** that vision left dangling and sequences the child issues
> (#1146–#1151) into a build order, grounded in what the code actually is today.
>
> **Status: still post-launch** — except the one pre-launch guardrail (#1148),
> which is independent of everything here and should be done on its own timeline.
> Nothing below is queued for the launch window; this is the map you follow *after*
> GA, written now while the shape is fresh and the codebase is fresh in mind.

## The finding that changes the plan

The vision doc's central claim — "this is mostly *exposure* of capability that
already exists" — turned out to be even more true than it reads. Two facts from a
codebase audit decide most of the open decisions:

1. **The read and propose cores are Electron-free.** `queryGraph`,
   `runQuery` (SQL), `searchRelated` (semantic), `search` (full-text), and
   `proposeWrite` (the approval gate) are all pure `ctx`-based functions with
   **zero** `electron` imports. `ProjectContext` is just `{ rootPath }`,
   constructible from a string via `projectContext(rootPath)`. The only Electron
   couplings anywhere near the path are two peripheral touchpoints:
   `notebase/fs.ts` imports `dialog` **only** for the open-project *picker* (not
   for `readFile`/`writeFile`), and `llm/settings.ts` uses `app.getPath('userData')`
   **only** to locate its config file.

2. **Provenance already has the seam.** Every proposal is already stamped with a
   free-form `proposedBy: string`, persisted as `thought:proposedBy` (see
   `approval.ts:136`, `:306`, `:855`). Internal writers already use a namespaced
   convention — `llm:conversation:<id>`, `llm:auto-tag`, `llm:auto-link`. An
   external agent is just a new namespace: `mcp:<client-id>`.

**Consequence:** the substrate is not a new server that reimplements the graph. It
is a **headless entry point** — a CLI binary — that constructs a `ProjectContext`
from a directory and calls the exact same functions the Electron main process
calls. MCP is then a *mode* of that binary. The entire epic reduces to: break two
tiny Electron couplings, wrap existing functions in a command surface, and speak
two protocols (shell and MCP-stdio) over it.

## Codebase anchor points

Everything the children need already exists. The build is exposure over these:

### Read surface (#1146, #1149)
| Capability | Function | File | Shape |
|---|---|---|---|
| SPARQL | `queryGraph(ctx, sparql)` | `graph/queries.ts:289` | `{ results, columns, error? }`; prefixes auto-injected (`:218`) |
| SQL | `runQuery(ctx, sql)` | `sources/tables.ts:63` | `{ ok, columns, rows }`; BigInt-safe serialization |
| Semantic | `searchRelated(ctx, query)` | `embeddings/vector-store.ts:206` | `RelatedHit[]` (`{kind, ref, chunkText, score}`); onnxruntime-web, offline |
| Full-text | `search(ctx, query, {limit})` | `search/index.ts:80` | `SearchResult[]` (`{relativePath, title, snippet, score}`) |
| Read note | `readFile(rootPath, relPath)` | `notebase/fs.ts:115` | raw markdown; `assertSafePath` (`:96`) blocks traversal |

All return structured results (never throw across the boundary) and are already
the read interface behind `api.graph.query()` etc. — the MCP/CLI layer adds no
query logic, only a protocol envelope.

### Propose surface (#1147, #1151)
- `proposeWrite(ctx, { operationType, payloads, note, proposedBy, expiryDays })`
  — `approval.ts:276`. Returns a pending `Proposal` (for `requires_approval`),
  applies-and-audits (for `notify_only`), or applies silently (`autonomous`).
- **7 wired payload kinds** (`WIRED_PAYLOAD_KINDS`, `:247`): `graph-triples`,
  `note`, `excerpt`, `source-meta`, `note-refactor`, `note-delete`,
  `note-rewrite`. Unwired kinds fail fast at creation.
- **Tier policy + established-node escalation** (`:159`, `:232`): any write
  touching a `thought:established` node escalates to `requires_approval`
  regardless of operation type. This protects the graph from external agents for
  free — the same rule that governs the internal AI.
- **Write Guard** (`graph/write-guard.ts`): `proposeWrite` wraps its applies in
  `enterTrustedContext()`, so it satisfies `checkLLMWriteGuard`. An external path
  that wrote directly (bypassing `proposeWrite`) while in LLM context would trip
  the guard — exactly the safety property #1147 requires, already enforced.
- **Review queue** already exists end-to-end: `PROPOSAL_LIST/DETAIL/APPROVE/
  REJECT/EXPIRE` channels → `ProposalsPanel.svelte`. External proposals land in
  the *same* panel with no new UI.

### Provider seam (#1148) — independent, pre-launch
- The conversation layer is thoroughly Anthropic-shaped: `index.ts` imports the
  SDK directly, instantiates `new Anthropic()` inline (`:218`), and threads
  `Anthropic.MessageParam` / `Anthropic.Tool` / `Anthropic.MessageStreamParams`
  through `index.ts`, `tools/types.ts`, `tools/registry.ts`. Streaming,
  `output_config.effort`, server-side web tools, and code-execution `container`
  ids are all Claude-specific. This is real (but contained) work and is tracked
  separately below — it does **not** block the CLI/MCP children.

## Open decisions — resolved

### 1. MCP server topology → **a headless `minerva` CLI binary; MCP is a subcommand**
Not a long-running daemon, not an HTTP port the app opens while running. The
external client spawns `minerva mcp` as a **stdio subprocess** (the canonical MCP
pattern — Claude Desktop, coding agents, editors all speak it). That subprocess
opens a project directory, builds a `ProjectContext`, and calls the same core
functions.

Why this and not an in-app HTTP endpoint:
- **Works headless.** The thoughtbase is answerable even when the Electron app
  isn't open — the whole point of "every agent in the fleet can reach it."
- **No discovery/port/lifecycle problem.** stdio spawn sidesteps all of it.
- **It doubles as CLI parity (#1149) for free** — the CLI *is* the substrate; MCP
  is one output mode of the same command handlers.
- **The core is already Electron-free**, so this costs a small refactor, not a
  rewrite.

**The one real risk this creates — graph write coordination.** If the Electron app
is running and holds the rdflib store in memory while a headless `minerva` process
writes `.minerva/graph.ttl`, the app's in-memory store goes stale until it
reindexes. Proposals are additive, but rdflib serializes the whole file, so
concurrent writers risk last-writer-wins clobbering. **Resolution for MVP:**
single-writer discipline documented + the app's existing file-watch/reindex picks
up headless-written proposals on next index. **Post-MVP option:** if a running app
instance is detected (lockfile/socket), the CLI routes its write *through* the
running instance rather than touching files directly. Flag this as the primary
engineering question for #1147; it does not affect read-only #1146.

### 2. Identity of external agents → **`mcp:<client-id>` in `proposedBy`; no tokens for MVP**
Reuse the existing `proposedBy` convention. Each client supplies an id — from the
MCP `initialize` handshake's client name, or a `--client-id` CLI flag — stamped as
`mcp:claude-code`, `mcp:browser`, etc. This makes the fleet audit trail
(#1151) a *query*, not new storage: `FILTER(STRSTARTS(?proposedBy, "mcp:"))`.
No auth tokens at MVP: the endpoint is a locally-spawned subprocess, so the OS
user is the trust boundary (consistent with local-first). Reserve a token option
for the day a network port is ever offered (it shouldn't be, per scope
discipline). A typed `thought:proposedByAgent` node (vs. a bare literal) is a
post-MVP nicety, not needed to ship.

### 3. Granularity of the propose API → **reuse the internal primitives; expose `propose_note` / `propose_source` only**
The on-brand answer the epic already leans toward. An external agent calls the
same high-level primitives the internal AI uses (`note` payload → `proposeWrite`),
**not** raw `graph-triples`. One gate, one queue, one provenance model. Hold raw
triple-level proposals *internal* until there's concrete external demand — handing
an arbitrary agent the Turtle firehose is a footgun and widens the trust surface
for no MVP benefit. Start with `propose_note` (maps to the `note` kind, the same
path `propose_notes` uses internally) and `propose_source` (source ingest);
everything else stays behind the existing internal tools.

### 4. Read scope / consent → **global on/off (default off) + per-client first-connect prompt; fine-grained scopes deferred**
Local-first does **not** mean every local process silently gets the whole graph.
Ship three things: (a) the MCP/CLI endpoint is **disabled by default**, enabled via
a Settings toggle; (b) on a new client's first connection, Minerva surfaces a
one-time consent naming the client (`"Allow 'claude-code' to read this
thoughtbase?"`) — reusing the "Don't ask again" pattern from `showConfirm`; (c)
reads are whole-graph once allowed. Per-client *read scopes* (this agent sees only
these folders/tags) are a real future feature but over-engineered for MVP — defer
until someone wants it. Writes are always gated regardless, so consent is really
about *read* exposure.

### 5. CLI vs MCP priority → **CLI first, MCP as a mode of it**
Settled by topology (#1). Sequence within the substrate work: extract core →
CLI read → CLI propose → MCP subcommand wrapping the same handlers. CLI is the
cheaper ship that validates demand, fits the keyboard-first identity, and is
immediately pipeable (`minerva query '...' | jq`). MCP reuses 100% of the command
layer; it adds only the stdio/JSON-RPC envelope and tool schemas.

### 6. Relationship to Minerva's own AI → **peers through one gate; adopt the frame**
Yes. `proposedBy: "llm:conversation:<id>"` (internal) and `"mcp:claude-code"`
(external) are peers in the same review queue — the internal assistant is simply
*the first member of the entourage*. This frame is also the through-line to
**#1148**: if the internal AI is just one fleet member, it has no business being
hardwired to a single provider. The substrate positioning and the provider seam
are the same principle pointed outward and inward.

## Build sequence

A prerequisite refactor unlocks four of the five children; #1148 runs on its own
track.

**#1148 — Provider seam (pre-launch, independent, do on its own timeline).**
Audit + extract an `LLMProvider` interface behind `index.ts` so the gate, skills,
and propose paths talk to an interface, not `Anthropic.*` types. `AnthropicProvider`
is the sole implementation. **No second provider wired** — deliverable is a clean
seam, not OpenAI support. This is the only piece that touches the launch window and
gets more expensive the longer other subsystems pile onto the current shape.

**0. Core extraction (prereq for #1146/#1147/#1149/#1150).** Make the read/propose
core runnable headless. Two touchpoints only: (a) split the directory-*picker* out
of `notebase/fs.ts` so importing `readFile`/`writeFile` doesn't drag in
`electron.dialog`; (b) abstract the user-data-dir lookup in `settings.ts` behind a
provider (env override / `~/.minerva`) so a headless process resolves config
without `app.getPath`. Small, mechanical, well-scoped — and independently useful.

**1. #1149 CLI parity — read.** `minerva query`, `minerva sql`, `minerva search`,
`minerva semantic`, `minerva read <path>` → JSON on stdout. Thin wrappers over the
table above. This is the demo that validates the whole thesis.

**2. #1149 CLI parity — propose.** `minerva propose-note` / `propose-source` →
`proposeWrite` with `proposedBy: mcp:<client-id>`. Confront the write-coordination
question (decision #1) here. Verify the Write Guard covers the path.

**3. #1146 MCP Read.** `minerva mcp` speaks stdio JSON-RPC, exposing the read
commands as MCP tools returning **grounded, cited** results (paths / node ids).
Pure envelope over step 1.

**4. #1147 MCP Propose.** Add `propose_note` / `propose_source` MCP tools over
step 2. Enforce the consent gate (decision #4).

**5. #1150 Context handoff.** A composite read tool — `thoughtbase-slice(topic)` =
semantic search + read top notes + their backlinks, bundled as one context blob for
an external agent's task. Built entirely from step-3 primitives; no new core.

**6. #1151 Provenance for the fleet.** Ship the audit view: a query/panel filtering
`proposedBy` by `mcp:` namespace so the user can see which agent contributed what.
Storage already exists (decision #2) — this is a saved query + a small UI.

## Scope discipline (unchanged, restated as build guardrails)

- **External agents propose; never commit.** Every write path goes through
  `proposeWrite`. An external write that skips it must trip the Write Guard — same
  invariant as the internal AI. Non-negotiable.
- **Not a sync/collaboration server.** One user, one local thoughtbase, local
  spawned subprocess. No hosted backend, no port exposed off localhost, no
  multi-user.
- **Not a plugin platform.** The surface is the protocol boundary (query +
  propose), not arbitrary third-party code in-process.
- **Reuse the internal primitives.** Don't build a parallel write path; every new
  external capability is an existing internal function behind a protocol envelope.

## Open questions this plan does *not* close

- **Graph write coordination** between a running app and a headless writer
  (decision #1) — the one genuine engineering risk; resolve during #1147.
- **How much skill/prompt tuning is provider-specific** (#1148) — answerable only
  by attempting a second provider, which is explicitly post-launch.
- **Whether MCP-stdio is sufficient** or some clients will want SSE/HTTP — revisit
  only if a target client can't spawn a subprocess.
