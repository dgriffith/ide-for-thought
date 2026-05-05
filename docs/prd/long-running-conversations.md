# PRD: Long-Running Conversations

**Status:** draft · **Author:** Dave · **Date:** 2026-05-04

## Summary

Replace the current set of modal, bounded "conversational commands" (`ConversationDialog`, `DecomposeDialog`, `CrystallizeDialog`, plus their per-command pipelines in `src/main/llm/`) with a single persistent, tabbed conversation surface anchored along the bottom of the main window. Each tab is a long-running, durable conversation backed by the existing agentic loop in `completeWithTools`. The same tools are available everywhere (`search_notes`, `read_note`, `query_graph`, `propose_notes`, `describe_graph_schema`, `web_search`, `web_fetch`). Today's "commands" become **prompt templates** invoked from menus — Claude-Code-style — that spawn a fresh tab and auto-send a templated first user turn.

## Why

Bounded one-shot dialogs no longer match how users want to work with assistants. Industry direction (Claude Code, Cursor, ChatGPT) is the persistent thread, with named operations expressed as prompt templates inside it rather than separate modal experiences. The user wants to interleave: explore a topic, then decompose a note in light of what was found, then web-search a citation — without flipping between dialogs. The current architecture forces context loss at every command boundary.

The substrate already exists: `completeWithTools` in `src/main/llm/index.ts` is a fully agentic streaming loop with the right toolset; `.minerva/conversations/*.json` already persists turns and projects to the graph as `thought:Conversation`. We have everything except the right surface.

## Goals

1. **Tabbed conversation surface** along the bottom of the main window. Multiple conversations live simultaneously; user switches between them like editor tabs.
2. **Durable** by default: persisted on every turn, restored on app launch. Closing a tab archives — no separate "resolve" step.
3. **Menu-driven slash-commands** (Decompose, Crystallize, freeform Explore) invoke prompt templates that spawn a fresh tab and auto-send the first user turn.
4. **Stable origin context + live current context.** Each conversation locks in the note path it was started from; it also has access to whatever note is currently open.
5. **Trust principle preserved.** Every graph mutation continues to flow through the approval engine and surfaces in the existing right-sidebar Proposals panel.

## Non-goals (this iteration)

These are *foreseeable*; the design must not paint us into a corner, but we won't build them now:

- Typed `/decompose` in the composer. Slash-commands are menu-driven only.
- A `propose_edit` tool for editing existing notes. Only `propose_notes` (new-note creation) is in scope.
- Cross-project conversations.
- Voice input.
- Multi-turn streaming edits applied directly to the active note from the conversation surface.
- Conversation sharing or sync across machines.
- **Auto-link and auto-tag stay as they are.** They have bespoke review UIs and don't benefit from the conversational surface.

## User experience

### The conversations tool window

Modeled on the IntelliJ terminal tool window: a bottom-docked panel toggled on/off via keyboard shortcut and a View menu entry. When hidden, it vanishes entirely — no residual strip, the editor reclaims the space. When visible, it occupies the bottom slice of the main window above the status bar.

Layout when visible:

- **Header bar** at the top of the panel.
  - **Tab strip** along the left of the header: one tab per active conversation, each with an auto-generated title and a close button (close-tab = archive). A `+` button at the right edge of the strip opens a fresh freeform conversation.
  - **Window controls** along the right: optional settings cog, hide-window button. Hiding the window does **not** archive any conversations; closing an individual tab does.
- **Content area** below the header: scrollback above, composer below.
- **Resize handle** on the top edge of the panel.

Closing the *last* tab does not auto-hide the window — the user may want to immediately open a new freeform tab via `+`. Hiding is a separate gesture.

### Inside a conversation

- **Header:** origin note (link, opens it); subtle live indicator of the *current* active note (so the user knows what "this note" will resolve to in the next turn).
- **Scrollback:** alternating user / assistant turns, inline tool-call indicators (already implemented in `format-tool-call.ts`), web search citations inline.
- **Composer:** textarea + send. `Enter` sends, `Shift+Enter` newline. (No `/foo` parsing in v1 — but the composer must not actively reject it, since v2 will add it.)
- **Drafts** produced by `propose_notes` appear inline as cards in scrollback **and** in the existing right-sidebar Proposals panel. Today's draft routing through `Channels.CONVERSATION_DRAFT` is unchanged.

### Slash-commands as menu actions

Today's commands become entries in a **template registry**. A template is:

```ts
interface ConversationTemplate {
  id: string;                                    // 'decompose' | 'crystallize' | …
  label: string;
  buildPrompt(ctx: TemplateContext): string;     // user-turn text to auto-send
  suggestedTitle?(ctx: TemplateContext): string; // tab title; falls back to first 60 chars
  /**
   * Optional non-default tools this template needs in scope. The default
   * toolset (search/read/query/propose_notes/describe/web_*) is always
   * available; this list adds template-specific ones. See "Templates that
   * need to ask the user" below.
   */
  requiresTools?: ConversationToolKey[];
}
```

Menu items invoke `conversations.openWithTemplate(templateId, ctx)`, which:

1. Creates a new conversation with `originNote = ctx.notePath`,
2. Builds the user turn via `template.buildPrompt(ctx)`,
3. Sets the tab title via `suggestedTitle(ctx)` if provided,
4. Sends the turn through `completeWithTools`, with the toolset = default ∪ `template.requiresTools` — no special LLM path, no bespoke main-process pipeline.

Initial templates:

| Template      | Invoked from               | Effect                                                            |
| ------------- | -------------------------- | ----------------------------------------------------------------- |
| `decompose`   | Note context menu          | New tab; sends "Decompose `<note>` into linked smaller notes…"    |
| `crystallize` | Note context menu          | New tab; sends a crystallize prompt with the note's current body  |
| (freeform)    | `+` button, top-level menu | New empty tab, no auto-send                                       |

Auto-link and auto-tag are **not** templates — they keep their existing bespoke UIs.

#### Templates that need to ask the user

Some templates can't capture every required argument at invocation time. `/decompose` may need to ask "split by section, by topic, or by argument structure?" before producing a useful proposal. Today's bespoke pipelines hard-code such choices; in the unified surface, the agent must reach back to the user mid-turn.

The mechanism: a new tool, `ask_user`, modeled on Claude's `AskUserQuestion`.

- The agent calls `ask_user` with a question and an optional list of choices.
- The conversation surface renders an inline prompt (free text or chips) at the current scroll position; the agent's turn blocks until the user replies.
- The user's reply becomes the tool result the agent receives, and the turn continues.
- `ask_user` cannot mutate the graph and is exempt from the approval engine — it only collects input.

`ask_user` is **not** in the default toolset. Templates that need it declare `requiresTools: ['ask_user']`. This keeps "ask the user" from becoming a crutch the model leans on in freeform conversations where there's no UI affordance.

A new request/response IPC channel `CONVERSATION_ASK_USER` carries the question from main → renderer and the answer back. The dispatcher in `src/main/llm/tools.ts:executeNotebaseTool` gains a corresponding branch.

This is the first extension point of its kind; future tools that need template-scoped UI (e.g., `pick_note`, `confirm_action`) follow the same pattern: declared per-template, routed through their own IPC channel, never bypassing the approval engine for graph mutation.

## Architecture

### Renderer

- **`ConversationsPanel.svelte`** — new top-level component mounted in `App.svelte`. Owns the tab strip and the active conversation panel. Replaces `ConversationDialog`, `DecomposeDialog`, `CrystallizeDialog` (those are deleted).
- **`stores/conversations.svelte.ts`** — new store: `tabs[]`, `activeTabId`, per-tab `messages`, `composer`, `streaming`, `pendingDrafts`. Subscribes to `editor.svelte.ts` for the current note path so each conversation knows what's active.
- **`lib/conversation/templates.ts`** — registry of `ConversationTemplate` objects. Imported by both the menu wiring and (future) typed-slash dispatcher.
- **Persistence:** the open-tabs list is just `listActive()` — i.e., conversations whose `status === 'active'` in the existing JSON store. There is no parallel persisted "open tabs" list. Last-active tab id and tool-window state (visible / hidden, height) live in `.minerva/conversations/_ui.json`, written cheaply on change. Each tab's *content* loads from the per-conversation JSON via `api.conversation.load(id)`.

### Main

`src/main/llm/conversation.ts` survives with these changes:

- **Replace `resolve` / `abandon` / `setStatus` with a single `archive(id)`.** Status set is reduced to `'active' | 'archived'`. The `thought:Source` filing on archive is preserved — provenance is still useful even when "archive" is the only terminal state.
- **Split context.** Today's `contextBundle.notePath` becomes a stable `originNotePath` set at creation. The renderer pushes the *current* note path with each user turn (or via a new `CONVERSATION_SET_CURRENT_NOTE` channel) so the agent's system prompt can reference it.
- **Drop `triggerNodeUri`** unless we find a use for it; the origin note covers the provenance need.

`src/main/llm/index.ts:completeWithTools` is **unchanged**. Long conversations are just repeated calls with growing message history. Existing prompt-cache breakpoint on the system prompt remains effective.

**Deleted from main:**

- `src/main/llm/crystallize.ts`
- `src/main/llm/decompose.ts`
- The freeform-conversation entry points in `src/main/llm/conversation.ts` (the agentic logic itself stays; just the bespoke command wrappers go).

**Kept untouched in main:**

- `src/main/llm/auto-link.ts`, `src/main/llm/auto-tag.ts`, `src/main/llm/approval.ts`, `src/main/llm/tools.ts`, `src/main/llm/index.ts` (besides minor type changes), `src/main/llm/format-tool-call.ts`, `src/main/llm/settings.ts`.

### Shared

- `src/shared/types.ts`: `ConversationStatus = 'active' | 'archived'`. Add `originNotePath`. Migration on load: any persisted `'resolved'` or `'abandoned'` becomes `'archived'`.
- `src/shared/conversation-templates.ts`: `ConversationTemplate` and `TemplateContext` types — shared so a future typed-slash dispatcher in main can use the same registry shape.

### IPC

Existing channels in `src/shared/channels.ts`:

- `CONVERSATION_CREATE`, `CONVERSATION_APPEND`, `CONVERSATION_LOAD`, `CONVERSATION_LIST` — keep.
- `CONVERSATION_RESOLVE` / `CONVERSATION_ABANDON` → **replaced** by `CONVERSATION_ARCHIVE`.
- **New** `CONVERSATION_SET_CURRENT_NOTE`: renderer pushes the active note path when it changes (debounced; cheap; pure metadata).
- **New** `CONVERSATION_ASK_USER` (request/response): main → renderer with a question (and optional choices), renderer → main with the user's answer. Used by template-scoped `ask_user` tool calls.
- `CONVERSATION_DRAFT` — unchanged.

### Trust principle

Unchanged. `propose_notes` still routes drafts via the `onDraft` callback to `Channels.CONVERSATION_DRAFT`, surfaced inline in the conversation **and** in the right-sidebar Proposals panel. The approval engine in `src/main/llm/approval.ts` is the only path to graph mutation. Every approval still its own card.

## Data model

Per-conversation JSON in `.minerva/conversations/<id>.json` after refactor:

```jsonc
{
  "id": "conv-1746…-xxx",
  "title": "Decompose: Logic of Categories",
  "status": "active",                       // | "archived"
  "originNotePath": "notes/categories.md",  // fixed at creation, may be null for freeform-from-+
  "createdViaTemplate": "decompose",        // null for freeform
  "model": "claude-opus-4-7",               // optional override
  "messages": [ { role, content, timestamp, citations? } ],
  "startedAt": "2026-05-04T…",
  "archivedAt": "2026-05-05T…"              // present iff status === "archived"
}
```

Graph projection (`thought:Conversation`) keeps current shape minus the resolved/abandoned distinction; `thought:conversationStatus thought:active | thought:archived`.

## Migration plan

No users yet. Greenfield: rip and replace, no compatibility shims for users — only the on-disk JSONs may need a one-pass status remap on load (`resolved` / `abandoned` → `archived`).

**Phase 1 — Surface scaffold.** Build `ConversationsPanel.svelte`, the tab strip, the store, localStorage persistence, the freeform `+`-button flow. Wire to existing `completeWithTools`. Old modals still mounted in parallel.

**Phase 2 — Template registry.** Define `ConversationTemplate`. Implement `decompose` and `crystallize` as templates. Wire note-context-menu items to `openWithTemplate`. **Validate parity** with bespoke pipelines on a couple of representative notes — does the unified agent, given the templated prompt + tool access, produce decompositions of comparable quality? If not, the template prompts need tuning before we delete the old paths.

**Phase 3 — Rip.** Delete `ConversationDialog.svelte`, `DecomposeDialog.svelte`, `CrystallizeDialog.svelte`, `src/main/llm/decompose.ts`, `src/main/llm/crystallize.ts`, the freeform wrappers in `conversation.ts`. Remove dead IPC handlers and preload bindings.

**Phase 4 — Lifecycle cleanup.** Replace `resolve` / `abandon` with `archive`. Migrate persisted conversations on load. Update graph projection. Update integrity queries (`Trust: Unreviewed LLM writes` etc. in stock queries) if they reference the old statuses.

**Phase 5 — Polish.** Auto-titles from first user turn (60-char truncation). Resize handle calibration. Restore-on-launch verified.

## Forward compatibility (foreseeable, not building)

- **Typed `/foo`** — composer parses leading `/`; matches against the same template registry. Registry already supports it.
- **`propose_edit`** — second tool kind. Approval engine and Proposals panel are draft-shape-agnostic; only the tool schema and the inline-card renderer need to extend.
- **Sharing / sync** — JSON-on-disk + graph projection means the artifact is already portable.
- **Voice input** — composer is a single textarea; STT wraps it cleanly.
- **Cross-project** — current `activeRootPath` scoping is per-project; the JSON schema must not bake the project id into the conversation document in a way that locks us in (`originNotePath` is project-relative — fine).
- **Compaction / summarization** — for long conversations exceeding token budgets. Defer.

## Open questions

- **Default expanded vs collapsed?** When the user opens a conversation via menu template, the panel must expand. When the app launches with N tabs from last session, default to **collapsed** (just the strip) so it doesn't shove the editor up unexpectedly.
- **Auto-titling at turn 1: heuristic vs LLM-generated?** Start heuristic (first 60 chars of first user turn). Revisit if it produces ugly tab titles for templated invocations — templates can override via `suggestedTitle()`.
- **History drawer for archived conversations?** Probably yes, reachable from the tab strip's overflow menu. Just `listAll().filter(c => c.status === 'archived')`. Cheap.
- **Tab strip overflow.** N+ open tabs: scroll horizontally, or collapse to a dropdown? Defer past v1.
- **`Cmd-K` command palette.** Future — invokes templates the same way menus do. Out of scope for v1.

## Risks

- **Token cost on long conversations.** Each turn re-sends the full message history. `completeWithTools` caches the system prompt block, but message history is uncached. We should at minimum surface a turn count + token estimate in the UI; compaction is a follow-up PRD.
- **Editor real estate.** Bottom panel competes with the editor and status bar. The collapsed strip needs to be compact (~32px). Resizing must be sticky per-window. Verify against existing right sidebar widths.
- **Parity loss when deleting bespoke pipelines.** `decompose.ts` and `crystallize.ts` may carry nuanced prompts. Phase 2's parity check is the gate; do not skip it.
- **Stale "current note" pushes.** `CONVERSATION_SET_CURRENT_NOTE` racing with composer sends could send a turn referencing a stale note path. Mitigation: include the current note path in the `appendMessage` payload itself, not as separate state.

## Code-review checklist for this work

When reviewing PRs implementing this PRD:

- [ ] No graph mutation path bypasses the approval engine.
- [ ] `propose_notes` drafts still route through `Channels.CONVERSATION_DRAFT` to both inline cards and the Proposals panel.
- [ ] Slash-command templates only emit user-turn text — they do **not** introduce new IPC channels, new tools, or new main-process LLM paths.
- [ ] The conversation JSON schema does not bake project identity into the document.
- [ ] Open-tabs list is derived from `listActive()`; no parallel persisted list of "open conversations." Tool-window UI state (visibility, height, last-active tab) is the only thing in `.minerva/conversations/_ui.json`.
- [ ] Template-declared tools (e.g. `ask_user`) are scoped per-conversation; they are *not* added to `buildConversationTools`'s default toolset.
- [ ] `ask_user` and any sibling input-collection tools cannot mutate the graph.
- [ ] Status migration on load handles legacy `resolved` / `abandoned` values.
- [ ] No `confirm()` / `prompt()` calls (use `showConfirm` / `showPrompt`).
- [ ] Svelte 5 runes only — no `export let`, no `$:`, no `on:click`.
