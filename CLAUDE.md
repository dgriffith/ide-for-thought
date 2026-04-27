# Minerva — Development Guide

## What This Is

Minerva is a desktop markdown IDE built with Electron + Svelte 5 + TypeScript. It manages knowledge bases backed by an RDF graph and git. The codebase repo name is `miranda` but the app is called **Minerva**.

## Commands

- `pnpm dev` — Start the dev server (electron-forge + Vite HMR)
- `pnpm lint` — Type check: `tsc --noEmit` for `.ts` files, then `svelte-check --threshold error` for `.svelte` files (script/template drift, undefined references, wrong prop types). Warnings (a11y, state-referenced-locally) are not fatal.
- `pnpm test` — Run tests once (vitest run). Use `pnpm test:watch` for the file-watcher loop.
- `pnpm build` — Build distributable (electron-forge make)

## Architecture

Three-process Electron app with strict context isolation:

- **Main** (`src/main/`) — Node.js process. File I/O, git, graph indexing, menus, window management. All file access goes through `notebase/fs.ts` which enforces path traversal protection.
- **Preload** (`src/preload/preload.ts`) — Bridges main and renderer via `contextBridge`. The renderer accesses everything through `window.api`.
- **Renderer** (`src/renderer/`) — Svelte 5 UI. State managed with runes (`$state`, `$effect`, `$derived`). Two stores: `notebase.svelte.ts` (project/files) and `editor.svelte.ts` (active file/content).

IPC channels are defined in `src/shared/channels.ts`. Types in `src/shared/types.ts`.

## Conventions

### Svelte 5
This project uses **Svelte 5 runes** — not Svelte 4 syntax. Use `$state`, `$derived`, `$effect`, and `$props()` with `interface Props`. Do not use `export let`, `$:`, `on:click`, or `|self` event modifiers.

### UI & UX Philosophy
This is a **professional tool**. Design accordingly:

- **No danger styling.** Don't color destructive actions in red. Deleting a note is a normal operation, not a scary one — especially with git backing every project.
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
3. Register the handler in `src/main/ipc.ts`
4. Expose it in `src/preload/preload.ts`
5. Add the type to the API interface in `src/renderer/lib/ipc/client.ts`

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

## LLM Integration Principles

### The Trust Principle

> **The LLM proposes, the human confirms.** Conversation outputs are evidence to be evaluated and filed, not authoritative updates to the graph. This is the most important design decision in the system.

All LLM-originated graph mutations **must** go through the approval engine (`src/main/llm/approval.ts`). The LLM never writes directly to the knowledge graph. Instead:

1. LLM operations produce `thought:Proposal` nodes with status `thought:pending`
2. The user reviews proposals via the diff view and approves/rejects with a single keystroke
3. Only approved proposals mutate the graph
4. Proposals that aren't reviewed auto-expire after a configurable window

### Approval Tiers

Operations are classified by trust level:

| Tier | Operations | Behavior |
|------|-----------|----------|
| `requires_approval` | New claims, evidence links, component creation | Queued as pending proposal; user must approve |
| `notify_only` | Confidence updates, status changes | Applied immediately but surfaced in activity feed |
| `autonomous` | Tag additions, staleness flags | Applied silently |

Nodes with `thought:hasStatus thought:established` automatically escalate to `requires_approval` regardless of operation type.

### Code Review Checklist for LLM/Graph PRs

When reviewing PRs that touch LLM integration or graph write paths:

- [ ] Does the code path go through the approval engine? If not, justify why.
- [ ] Are `thought:Component` nodes created with `thought:extractedBy` and `thought:proposedAt` provenance?
- [ ] Does the code create `thought:Proposal` nodes for operations that require approval?
- [ ] Is there a SPARQL integrity check that could detect if this write bypassed approval?
- [ ] Are there tests that verify the approval gate cannot be skipped?

### Write Guard

The graph module exposes `enterLLMContext()` / `exitLLMContext()` to mark call paths originating from LLM operations. Any direct `store.add()` call while in LLM context that doesn't go through the approval engine will log a warning. This is a development-time guardrail, not a runtime security boundary — the goal is to catch accidental bypasses during development.

### Integrity Query

The stock query "Trust: Unreviewed LLM writes" (in Graph > Stock Queries) detects `thought:Component` nodes attributed to an LLM that lack a corresponding approved proposal. Run this after any LLM integration work to verify the trust principle holds.
