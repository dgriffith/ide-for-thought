# Minerva — Development Guide

## What This Is

Minerva is a desktop markdown IDE built with Electron + Svelte 5 + TypeScript. It manages knowledge bases backed by an RDF graph. (Git is only an opt-in *publish* target — see `src/main/git/` — not automatic version control; thoughtbases are not git-backed yet.) The codebase repo name is `miranda` but the app is called **Minerva**.

## Commands

- `pnpm dev` — Start the dev server (electron-forge + Vite HMR)
- `pnpm lint` — Full static-check gate: `tsc --noEmit` (`.ts` type errors), then `svelte-check --threshold error` (`.svelte` script/template drift, undefined references, wrong prop types), then `eslint .` (lint rules, incl. the renderer data-flow rule). Note `svelte-check` — not `tsc` or `eslint` — is what catches script↔template drift in `.svelte` files. Warnings (a11y, state-referenced-locally) are not fatal.
- `pnpm test` — Run tests once (vitest run). Use `pnpm test:watch` for the file-watcher loop.
- `pnpm build` — Build distributable (electron-forge make)

A **pre-push hook** (`.githooks/pre-push`, activated by the `prepare` script's
`core.hooksPath` on `pnpm install`) runs `pnpm lint` before each push so an
obvious failure is caught locally instead of in CI (#690). Bypass a single push
with `git push --no-verify` (or `SKIP_HOOKS=1 git push`).

## Architecture

Three-process Electron app with strict context isolation:

- **Main** (`src/main/`) — Node.js process. File I/O, git publishing, graph indexing, menus, window management. All file access goes through `notebase/fs.ts` which enforces path traversal protection.
- **Preload** (`src/preload/preload.ts`) — Bridges main and renderer via `contextBridge`. The renderer accesses everything through `window.api`.
- **Renderer** (`src/renderer/`) — Svelte 5 UI. State managed with runes (`$state`, `$effect`, `$derived`) in singleton stores under `src/renderer/lib/stores/*.svelte.ts` (`notebase` = project/files, `editor` = active file/content, plus source/conversation/settings/etc. stores). Stores own `api.*` mutations + event subscriptions; components call store methods (see **Renderer data flow** under Conventions).

IPC channels are defined in `src/shared/channels.ts`. Types in `src/shared/types.ts`.

## Conventions

### Svelte 5
This project uses **Svelte 5 runes** — not Svelte 4 syntax. Use `$state`, `$derived`, `$effect`, and `$props()` with `interface Props`. Do not use `export let`, `$:`, `on:click`, or `|self` event modifiers.

### Renderer data flow (#1086)

One rule for where `window.api` (`api.*`) may be called, so state changes have a
single, testable path instead of three competing ones:

> **Components may call `api.*` directly ONLY for reads and stateless OS
> side-effects. Every state mutation and every main→renderer event subscription
> goes through a store (`src/renderer/lib/stores/*.svelte.ts`) or an App ops
> handler (`src/renderer/lib/app/*-ops*`).**

- **Reads — allowed in components:** queries that return data and change nothing
  (`api.notebase.readFile`, `api.tags.list`, `api.graph.query`,
  `api.publish.listExporters`, `api.sources.listAll`, …).
- **Stateless OS side-effects — allowed in components:** actions with no
  observable in-app state change — `api.shell.*` (open/reveal/terminal),
  `api.export.csv`, `api.view.*`, and native OS pickers/reveal
  (`api.skills.revealFolder`). These are explicitly exempt.
- **Mutations — must route through a store/ops:** anything that writes
  thoughtbase / graph / source / settings state (`api.notebase.writeFile`,
  `api.sources.setReadStatus`, `api.collections.create`,
  `api.compute.saveCellOutput`, `api.tools.setSettings`, …). The store method
  owns the `api` call and updates observable state; the component calls the
  store method.
- **Event subscriptions — must live in a store:** `api.*.on*` listeners
  (`onExcerptsChanged`, `collections.onChanged`, `notebase.onRewritten`, …)
  belong in the store that owns the affected state, not in a component
  `$effect`. Components read the resulting reactive state.
- **`App.svelte` is the composition root**, not a leaf component: it wires ops
  clusters and may call `api.*` for top-level orchestration. Leaf settings
  dialogs front their config writes through a `settings-*` store.

The `no-restricted-syntax` block in `eslint.config.js` (scoped to
`src/renderer/lib/components/**`) enforces this — a mutation `api.*` call added
to a component fails `pnpm lint`. When you add a new mutation channel, add its
method name there too.

### UI & UX Philosophy
This is a **professional tool**. Design accordingly:

- **No danger styling.** Don't color destructive actions in red. Deleting a note is a normal operation, not a scary one.
- **Respect the user.** Every confirmation dialog must include a "Don't ask again" checkbox. Use `showConfirm(message, key, label)` in App.svelte — the `key` parameter allows each dialog type to be independently suppressed via localStorage.
- **Stay out of the way.** Prefer keyboard shortcuts and contextual actions (right-click menus) over modal UI. Don't add warnings, toasts, or interstitials unless absolutely necessary.
- **No hand-holding.** Don't add validation that prevents the user from doing what they asked. Don't add "are you sure?" unless there's genuine data loss risk — and even then, make it dismissable.

### Styling
- Catppuccin-inspired dark theme via CSS custom properties in `src/renderer/styles/global.css`
- Keep component styles scoped in `<style>` blocks
- Use the existing CSS variables (`--bg`, `--text`, `--accent`, `--border`, etc.)

### Dialogs
- `prompt()` and `confirm()` are blocked by Electron. Use the custom `showPrompt()` and `showConfirm()` functions in App.svelte.
- `showConfirm(message, key, confirmLabel)` returns `Promise<boolean>`. The `key` is used for "don't ask again" persistence in localStorage.
- Dialog components: `PromptDialog.svelte`, `ConfirmDialog.svelte`

### IPC Pattern
To add a new main-process operation:
1. Add channel constant to `src/shared/channels.ts`
2. Implement the operation in `src/main/notebase/fs.ts` (or appropriate module)
3. Register the handler in the appropriate `src/main/ipc/register-*.ts` module (`src/main/ipc.ts` is just the orchestrator that calls each `register*()`)
4. Expose it in `src/preload/preload.ts`
5. Add the type to the API interface in `src/renderer/lib/ipc/client.ts`

### IPC error handling (#1631)

One convention so every caller reasons about failure the same way. Electron's
`ipcRenderer.invoke` **rejects the renderer promise when a handler throws**, and
the typed `invoke` wrapper (`src/preload/typed-invoke.ts`) surfaces it — so a
thrown error already propagates cleanly. Build on that:

1. **Default: throw.** A handler that cannot complete throws; the caller uses
   `try/catch` / `.catch`. Do **not** invent an `{ ok: false }` object or a
   `null` for a *generic* failure — throwing is the failure channel.
2. **"No project open" throws.** Use `withRootPath` / `withRootPathWin`
   (`ipc/helpers.ts`). `withRootPathOr(fallback, …)` is only for handlers whose
   project-less answer is a *legitimate value* (an empty list `[]` a UI renders
   as "nothing yet"), **not** a way to signal failure — and that fallback must
   mean the same thing as a genuinely-empty result, never "error".
3. **Discriminated `{ ok, … }` union — only when the caller must branch on an
   EXPECTED, non-exceptional outcome.** A user's malformed SQL/SPARQL, a failed
   network/auth check, or user code that errors are normal inputs the UI renders
   inline, not bugs. These legitimately return a union: tables/graph query
   results, `ConnectionCheckResult` (S3 / GitHub / model key), `PUBLISH_TO_GIT`,
   compute `CellResult` / `PythonProbeResult` / `InterruptResult`. Give the
   *failure* arm a real discriminant (`{ ok: false; error }`), and document on
   the type that the call itself does not reject.
4. **Per-item outcome catalogs are fine.** A call that succeeds while reporting
   per-item problems (`SKILLS_LIST` / `TYPES_LIST` `errors[]`, the draft-filing
   `outcomes[].error`) is not a failure channel — the call worked; the array
   describes each item. Keep these.
5. **`null` marks exactly ONE expected absence, documented on the client type.**
   Either "user cancelled a native picker" **or** "not found" — never both, and
   never "error". A corrupt store, an IO failure, or "no project" must not fold
   into the same `null`.

**Anti-patterns (do not add; migrate when you touch one):**

- **Overloaded `null`/sentinel** — one `null` meaning several of {cancelled,
  not-found, no-project, corrupt, error}. Split them: real errors throw, and the
  sentinel keeps one meaning. Use `readJsonFileOr(absPath, fallback)`
  (`ipc/helpers.ts`) for JSON stores — it returns `fallback` on ENOENT but
  **rethrows a parse/IO error** instead of masquerading corruption as "empty".
- **Swallowing** — `catch { return null | [] | fallback }` that discards a real
  error. Only catch a *specific expected* condition (e.g. ENOENT → sentinel) and
  let the rest throw.
- **In-band `error?` on an otherwise-normal payload** — prefer the discriminated
  union of rule 3 over baking an optional `error` onto the success shape.

**Migration backlog** (audited outliers, fix incrementally per the rules above):

- `null` no-project↔not-found: `GRAPH_SOURCE_DETAIL`, `GRAPH_EXCERPT_SOURCE`,
  `PROPOSAL_DETAIL` (→ `withRootPath` so `null` means only "not found");
  `TEMPLATES_GET`, `CONVERSATION_LOAD` (corrupt → throw).
- boolean overloads: `NOTEBASE_FILE_EXISTS`, proposals `APPROVE` / `REJECT`
  (`false` = no-project ↔ failed).
- in-band `error?` → union: `GRAPH_QUERY` (`{ results, columns, error? }` should
  match the `TABLES_QUERY` `{ ok:false; error }` shape).
- swallows: `LINKS_CITATIONS_FOR_NOTE` (`.catch(()=>'')`), `CSL_REMOVE_STYLE` /
  `CSL_REMOVE_LOCALE` (unlink swallows non-ENOENT), `FORMATTER_LOAD_SETTINGS`
  (→ `readJsonFileOr`), `RUN_COMPUTE_DRAFT` (log-only append / audit-record).
- vestigial: `GIT_COMMIT.success` (hardcoded `true` — any failure throws).

### Config files (#1640)
- Load JSON config through the shared helper in `src/main/config/config-store.ts`
  (`loadConfigFile` / `loadConfigFileSync`), NOT a hand-rolled `try { readFile;
  JSON.parse } catch { return defaults }`. It gives one consistent behavior: a
  missing file → defaults (silent, expected); a corrupt/unreadable file → surfaced
  via `reportConfigError` (loud, not swallowed) then defaults; per-field coercion
  through the shared `as*` decoders (`asString`/`asBool`/`asFiniteNumber`/`asEnum`/
  `asRecord`/`asStringArray`), so each config's `decode(raw)` reads as its schema.
- Migrated so far: `ingest-settings`, `python-settings`, `project-config`. Still
  hand-rolled (migrate when you touch them): `clipper-config` (decrypt + lazy
  secret upgrade), `llm/settings` (nested providers/models), `menu-config-store`.

### File System
- All paths are relative to the project root
- `assertSafePath()` in `fs.ts` prevents path traversal — always use it//
- Hidden files (`.`) and `IGNORED_DIRS` (`.git`, `node_modules`, `.minerva`, `.obsidian`) are filtered from listings
- Empty folders are shown in the sidebar (not filtered out)

### Knowledge Graph
- Stored in `.minerva/graph.ttl` (Turtle format)
- Auto-indexed on file write
- Manual rebuild via Query menu
- Extracts: titles, tags, wiki-links, frontmatter metadata, embedded Turtle blocks, markdown tables (CSVW)
- Queryable via SPARQL through `api.graph.query()`
- Standard prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are auto-injected into all queries

### Thought Ontology
- Defined in `src/shared/ontology-thought.ttl`
- Separate namespace: `thought:` (`https://minerva.dev/ontology/thought#`)
- Models epistemic structure: claims, grounds, warrants, hypotheses, questions, and 30+ component types
- Includes epistemic defects: fallacies, biases, rhetorical moves, structural problems
- Proposals and conversations aligned with W3C PROV-O provenance model

### Tools for Thought (Skills)

The Learning / Research / Analysis menus are populated by **skills** — markdown
files (YAML frontmatter + a template body), not hardcoded `.ts` tools. There is
no longer a `definitions/` tool registry; do not add one.

- **Stock skills** live in `src/main/skills/stock/*.md` (bundled at build time
  via `import.meta.glob`). **User skills** live in `~/.minerva/skills/` (bare
  `.md` or a folder with `SKILL.md`), loaded at runtime; user skills are
  additive — they can't shadow stock.
- Pipeline (all in `src/main/skills/`): `parse.ts` → `loader.ts` (catalog) →
  `compile.ts` (→ `ThinkingToolDef`) → `register.ts` (into `shared/tools/registry.ts`).
  `template.ts` is the non-executing prompt language (`{{var}}`, `{{x | filter}}`,
  `{{#if}}…{{else}}…{{/if}}`), rendered in main at prepare/execute time.
- The renderer never sees prompt bodies — it gets serializable `SkillInfo` via
  `api.skills.list()` and registers it into its own copy of the registry.
- **Menu config** (`~/.minerva/menu-config.json`, per machine): enable/disable,
  reassign among the three menus, and order. Pure logic in
  `src/shared/skills/menu-config.ts` (`applyMenuConfig`) is applied identically
  by the native menu, the renderer registry, and the Settings → Skills UI.
- **Grouping** (#525): a skill's optional `group:` field renders thematic
  nested submenus within a menu (pure logic in `src/shared/tools/grouping.ts`;
  applied in `menu.ts`). A menu stays flat until one of its skills sets a group.
- **Source scope** (#103): `scope: source` routes a skill to the Source
  viewer's Tools menu (excluded from the note menus + editor right-click via
  `isSourceScoped` in `shared/tools/types.ts`) and feeds it `sourceMetadata` /
  `sourceBody` context (`{{source.*}}`). Source skills write back via the
  approval-gated `propose_source_properties` tool → `meta.ttl` upsert
  (`sources/source-meta-write.ts`). Worked example: `propose-source-summary.md`.
  Claim mining (#104): `propose_claims` files `thought:Claim` notes + anchored
  `thought:Excerpt` nodes (the approval engine's `excerpt` payload kind is now
  wired) via `extract-key-claims.md`.
- Authoring reference: `docs/authoring-skills.md`. To change a stock skill,
  disable it and author your own — don't edit bundled files.

## LLM Integration Principles

### The Trust Principle

> **The LLM proposes, the human confirms.** Conversation outputs are evidence to be evaluated and filed, not authoritative updates to the graph. This is the most important design decision in the system.

All LLM-originated graph mutations **must** go through the approval engine (`src/main/llm/approval.ts`). The LLM never writes directly to the knowledge graph. Instead:

1. LLM operations produce `thought:Proposal` nodes with status `thought:pending`
2. The user reviews proposals via the diff view and approves/rejects with a single keystroke
3. Only approved proposals mutate the graph
4. Proposals that aren't reviewed auto-expire after a configurable window

### One tier: everything is proposed

Every LLM-originated write is filed as a **pending** `thought:Proposal` and
applied only when the user approves it — there is no lower-trust tier. An
operation's `operationType` (new_claim, note_rewrite, component_creation,
note_refactor, note_delete, source_properties, …) is descriptive metadata for
the review UI, **not** a trust level. Even the "quiet" paths conform: auto-tag,
for instance, files a normal `note_rewrite` proposal and self-approves it only
after the user accepted the tags on the conversation card.

> **Historical note:** earlier designs sketched `notify_only` (apply + audit)
> and `autonomous` (apply silently) tiers, with an established-node escalation to
> pull them up to `requires_approval`. No write path ever used them, so the tiers
> and their orphan operation types (tag_addition, staleness_flag,
> confidence_update, status_change) were removed. If a genuine lower-trust
> operation is ever needed, re-introduce a tier deliberately rather than assuming
> one exists.

### Code Review Checklist for LLM/Graph PRs

When reviewing PRs that touch LLM integration or graph write paths:

- [ ] Does the code path go through the approval engine? If not, justify why.
- [ ] Are `thought:Component` nodes created with `thought:extractedBy` and `thought:proposedAt` provenance?
- [ ] Does the code create `thought:Proposal` nodes for operations that require approval?
- [ ] Is there a SPARQL integrity check that could detect if this write bypassed approval?
- [ ] Are there tests that verify the approval gate cannot be skipped?
- [ ] Does every new `register-*` IPC handler ship with a main-process test, and is its module covered by a `vitest.config.mts` threshold? An untested handler is how the `CONVERSATION_SEND` gap slipped in (#1612) — a new handler needs both a test and threshold enrollment so it can't silently regress.

### Write Guard

The graph module exposes `enterLLMContext()` / `exitLLMContext()` (and the
`withLLMContext(fn)` wrapper) to mark call paths originating from LLM operations.
Any graph write while in LLM context that doesn't go through the approval engine
(which marks its own writes with `enterTrustedContext()`, applied across the
whole `applyBundle`) trips `checkLLMWriteGuard`.

**The guard is fatal under test and non-fatal in dev/prod (#944):** under the
test runner it **throws**, so an accidental approval-engine bypass fails CI —
the invariant "every LLM-originated write goes through
`proposeWrite()`/`approveProposal()`" is *enforced*, not merely observed. In dev
and production it stays a `console.warn` (a development guardrail must never
crash the user's app; it's not a runtime security boundary).

For the guard to catch a bypass, the offending write must run in LLM context.
The converged LLM apply paths — auto-tag, auto-link (out/inbound),
`set_properties`, `propose_source_properties`, and the note-body rewrite — wrap
themselves in `withLLMContext` (or `enterLLMContext`) so a regression that writes
directly instead of via the approval engine is caught. **Wrap any new
LLM-originated apply path the same way.**

### Integrity Query

The integrity-check SPARQL below detects `thought:Component` nodes attributed to an LLM that lack a corresponding approved proposal. Run it (Graph > Query) after any LLM integration work to verify the trust principle holds. It used to ship as the "Trust: Unreviewed LLM writes" stock query, but the `Trust:` / `Claims:` / `Compute:` stock queries were pulled from the default set as too confusing for end users — keep this one handy for development.

It's also promoted to an automated gate (#1101): `findUnreviewedLLMWrites` in `src/main/graph/integrity.ts` is the canonical executable copy, asserted on every PR by `tests/main/graph/trust-integrity.test.ts` (honest path → empty; bypass / pending-only proposal → flagged). Keep the query below in sync with `UNREVIEWED_LLM_WRITES_QUERY` there.

```sparql
PREFIX thought: <https://minerva.dev/ontology/thought#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?component ?label ?extractedBy WHERE {
  ?component rdf:type/rdfs:subClassOf* thought:Component .
  ?component thought:extractedBy ?extractedBy .
  FILTER(CONTAINS(LCASE(?extractedBy), "llm"))
  OPTIONAL { ?component thought:label ?label }
  FILTER NOT EXISTS {
    ?proposal rdf:type thought:Proposal .
    ?proposal thought:affectsNode ?component .
    ?proposal thought:proposalStatus thought:approved .
  }
}
ORDER BY ?component
```
