# Authoring a ThinkingTool

This is the reference for adding a new tool to Minerva's ToolPanel. Follow
the conventions here and your tool slots into the same scaffold every other
tool uses — surfaced in the right category, rendered in the editor right-click
menu when context allows, registered for slash-command dispatch, and (when it
mutates the graph) routed through the trust gate.

The current home for tools-with-arguments is **ThinkingTool**. The smaller
**ConversationTemplate** registry exists only for menu-driven prompt templates
that don't need a parameter form (decompose, crystallize). When in doubt, use
ThinkingTool — the decision tree is at the bottom of this doc.

## Quickstart

```sh
pnpm new-tool <category> <id>          # plain tool
pnpm new-tool <category> <id> --with-params   # tool with a parameters form
```

`<category>` is one of `learning`, `research`, `analysis`. `<id>` is
kebab-case. The script generates two files:

```
src/shared/tools/definitions/<category>/<id>.ts          # registerTool stub
src/shared/tools/definitions/<category>/<id>.prompt.md   # placeholder prompt
```

…and appends a side-effect import to `src/shared/tools/definitions/index.ts`
under the right category section.

Edit the generated files — fill in the prompt body, the `description` /
`longDescription`, and tweak the `outputMode` if the default doesn't match
what your tool produces. Then `pnpm lint` to verify. The tool surfaces in the
ToolPanel on the next renderer reload.

## Where things live

```
src/shared/tools/
  types.ts                    # ThinkingToolDef, ToolContext, parameter shapes
  registry.ts                 # in-memory tool registry (registerTool / lookups)
  definitions/
    index.ts                  # side-effect imports — auto-extended by new-tool
    analysis/
      <id>.ts
      <id>.prompt.md
    research/<id>.ts          # ditto
    learning/<id>.ts          # ditto
```

The registry is populated by importing `definitions/index.ts` once at app
boot — every tool's module runs `registerTool({...})` as a side effect. There
is no auto-discovery; the index file is the source of truth for which tools
exist. The scaffold script keeps it up to date.

## The ThinkingTool shape

```ts
interface ThinkingToolDef {
  id: string;                 // 'category.kebab-id', stable, used in URLs/logs
  name: string;               // human-readable, shown in the panel
  category: ToolCategory;     // 'learning' | 'research' | 'analysis'
  description: string;        // ~80 chars; ToolPanel card subtitle
  longDescription: string;    // 1-3 sentences; expanded ToolPanel card

  context: ContextRequirement[];  // what to gather before invoking
  parameters?: ToolParameter[];   // optional upfront form
  outputMode: OutputMode;     // newNote | openConversation | …
  outputNotePrefix?: string;  // basename prefix when outputMode is newNote
  slashCommand?: string;      // optional '/foo' slash dispatch (legacy)

  buildPrompt: (ctx) => string;          // one-shot tools (newNote, etc.)
  buildSystemPrompt?: (ctx) => string;   // conversational tools
  buildFirstMessage?: (ctx) => string;   // optional auto-fired user turn

  preferredModel?: string;    // 'claude-sonnet-4-6' | 'claude-opus-4-7' | …
  web?: { defaultEnabled: boolean };
  requiresSelection?: boolean; // hides the tool unless selectedText is non-empty
}
```

A tool is either **one-shot** or **conversational**:

- **One-shot** (`outputMode: 'newNote'`): `buildPrompt(ctx)` returns the
  whole prompt; the result is filed as a new note.
- **Conversational** (`outputMode: 'openConversation'`):
  `buildSystemPrompt(ctx)` returns the system prompt; optionally
  `buildFirstMessage(ctx)` returns a user-turn auto-fired on launch. The
  tool opens a new tab in the conversations panel.

For conversational tools, `buildPrompt` is required by the type but
should return `''` — the system prompt path is what runs.

## Context requirements

Listing a requirement in `context: [...]` tells the gather pass to populate
the matching `ToolContext` field before `buildSystemPrompt` runs.

| Requirement | Populates | Use for |
|---|---|---|
| `selectedText` | `ctx.selectedText` (verbatim selection) | Tools that operate on a selected passage. Empty string when nothing selected. |
| `fullNote` | `ctx.fullNoteContent`, `ctx.fullNotePath`, `ctx.fullNoteTitle` | Tools that need the whole note. |
| `relatedNotes` | `ctx.relatedNotes[]` (graph-linked notes) | Tools that should consider near neighbors. |
| `taggedNotes` | `ctx.taggedNotes[]` (notes sharing tags) | Tools that should consider tag-cohort context. |
| `claimUnderCursor` | `ctx.claimUri`, `ctx.claimLabel`, `ctx.claimSourceText` | Tools that operate on the `thought:Claim` at the cursor (Find Supporting / Opposing). |
| `selectionRange` | (planned, #509) `selectionStartOffset`/`End`, line numbers | Tools that propose edits anchored to the original passage. |

Requirements are advisory — the tool's prompt builder decides what to do when
a field is empty. Patterns from existing tools:

- **Hard-require**: set `requiresSelection: true`. The right-click menu
  hides the tool unless there's a selection.
- **Adapt**: branch in `buildSystemPrompt`. `define-terms` and
  `explain-like-im` pair a `<id>.prompt.md` with a `<id>.no-note.prompt.md`,
  picking based on `ctx.fullNoteContent`. Pattern: when the with-context
  prompt would force the agent to invent context, the no-context variant
  asks the user a clarifying question first.
- **Fall back silently**: just append an empty string. `summarize` does this.

## Parameters

For tools that need an upfront decision (audience level, depth, difficulty,
which-of-many-cases), declare `parameters: [...]`:

```ts
parameters: [
  {
    id: 'difficulty',
    label: 'Difficulty',
    type: 'select',
    options: [
      { label: 'Recall — facts and definitions', value: 'recall' },
      { label: 'Apply — application and inference', value: 'apply' },
      { label: 'Synthesis — cross-topic and stress cases', value: 'synthesis' },
    ],
    defaultValue: 'apply',
    required: true,
  },
],
```

The ToolPanel renders the form automatically. Read values via
`ctx.parameterValues?.<id>` in the prompt builder. Today's parameter
types: `text`, `textarea`, `select`, `number`. Richer types
(note-picker, multi-select, tag-picker) are tracked in #516.

Parameters cover the **upfront known-decision** case. For
**mid-conversation ambiguity**, see `ask_user` in the
`ConversationTemplate` system (#500) — currently scoped per-template;
ThinkingTool support is tracked in #514.

## Output modes

| Mode | Effect | Authoring |
|---|---|---|
| `newNote` | Run the prompt once; file result as a new note. | Implement `buildPrompt`; set `outputNotePrefix` for the basename. |
| `openConversation` | Open a tab in the conversations panel; agent uses the standard tool loop. | Implement `buildSystemPrompt`; optionally `buildFirstMessage`. `buildPrompt: () => ''`. |
| `appendToNote` / `insertAtCursor` / `replaceSelection` / `multipleNotes` | Variants on the one-shot pattern. | Implement `buildPrompt`; the dispatcher does the right thing with the result. |

Most new tools want `openConversation` (default in the scaffold). Reach for
`newNote` only when the result is a clean self-contained artifact the user
won't iterate on inside the conversation surface.

## Prompt conventions

The static prompt body lives in `<id>.prompt.md`. Imports via Vite's
`?raw`:

```ts
import SYSTEM_PROMPT from './<id>.prompt.md?raw';
```

For parameter-driven branching, use `{{PLACEHOLDER}}` markers in the
markdown and substitute in TS:

```md
The word "{{TERM}}" is now banned. It cannot appear in your analysis.
```

```ts
return PROMPT_BODY.replace(/\{\{TERM\}\}/g, term);
```

The placeholder convention matches `find-arguments-shared.prompt.md`,
`taboo.prompt.md`, and `excavate.prompt.md`.

### Voice and structure

- **Second person.** "You are X. Your goal is Y." — every existing tool
  opens this way.
- **Specify the output channel.** What does success look like? Free
  prose? A `propose_notes` bundle? An embedded Turtle block? Inline
  markdown sections with a specific schema? Be concrete.
- **Number the procedure** when the tool has discrete steps the agent
  should follow in order. Don't number when the order is fluid.
- **Anti-flattery clause** for tools that could plausibly produce
  empty-but-truthful output. Say so explicitly: "If the passage
  yields no claims, say so. Empty is a real answer." Models default
  to producing something, so the empty-OK clause is load-bearing.

### When to call which tool

- **`propose_notes`** for "file this as a new note (or bundle)." Routes
  through the approval engine. The user reviews the inline draft card
  before anything lands. Don't paste the bundle contents inline in
  the chat too — the card is the deliverable.
- **`describe_graph_schema`** at the start of any tool whose prompt
  references thought-ontology types or properties. Cheap; gives the
  agent a current snapshot.
- **`search_notes` / `read_note` / `query_graph`** freely. These are
  read-only and don't mutate.
- **`web_search` / `web_fetch`** when the tool benefits from external
  grounding. Set `web: { defaultEnabled: true }` on the tool to
  enable by default; users can still toggle.
- **`ask_user`** (template-scoped today, ThinkingTool support tracked
  in #514) for mid-flight ambiguity that `parameters` couldn't have
  collected upfront.

## Trust principle

Every graph mutation routes through the approval engine via
`propose_notes`. **No tool may bypass it.** Direct `store.add()` from
a tool path is forbidden — the development-time write guard
(`enterLLMContext` / `exitLLMContext` in `src/main/llm/conversation.ts`)
will warn if you do.

In practice: if your tool produces graph triples (claims, components,
typed wiki-links), express them as **frontmatter or inline wiki-links
inside the proposed note's body**. The graph indexer extracts those
on save. The note becomes the audit trail; the graph reflects its
content. Examples:

- `decompose-into-claims` proposes child claim notes with frontmatter
  (`claim-kind`, `extracted-from`, `extracted-by`) and a small
  ` ```turtle this: a thought:Claim . ``` ` block. The indexer
  materializes the triples on file save.
- `find-supporting-arguments` proposes a single note whose frontmatter
  is `supports: <claim-uri>`. Indexer materializes
  `<note-uri> thought:supports <claim-uri>`.
- `crystallize` proposes one note containing an embedded Turtle block
  enumerating the components.

This pattern keeps the user-visible artifact (the note) in sync with
the graph projection (the triples). No bespoke graph-triples payloads.

## ConversationTemplate vs ThinkingTool

Use **ThinkingTool** by default. It supports parameters, categories,
the ToolPanel, slash-command dispatch, all output modes, and is the
only path that scales to the 50+ tools we're aiming at.

Reach for **ConversationTemplate** only when the tool is invoked from
a **non-ToolPanel surface** (today: the editor right-click menu) AND
needs no parameter form. The two existing templates (decompose,
crystallize) match this shape.

The migration ticket #515 may collapse ConversationTemplate into
ThinkingTool entirely — at which point this doc updates and the
question goes away.

## Common pitfalls

- **Forgetting the index import.** The scaffold handles it; if you copy
  a sibling instead, double-check `definitions/index.ts` has the
  side-effect line under the right category header.
- **Returning the prompt from `buildPrompt` for a conversational tool.**
  `buildPrompt` is for one-shot output modes; conversational tools use
  `buildSystemPrompt` + `buildFirstMessage`. The scaffold defaults
  `buildPrompt: () => ''` for conversational tools.
- **Inventing results for empty input.** Without an anti-flattery clause,
  models will produce confident output even when the source genuinely
  yields nothing. Say "empty is a real answer" explicitly when it's
  possible.
- **Pasting the proposed bundle inline.** When calling `propose_notes`,
  end the turn with a one-line acknowledgement and stop. The inline
  card is the deliverable; pasting the bundle text twice is duplicate
  noise the system prompt already steers against.
- **Wiki-link basename mismatches in bundles.** `propose_notes` does
  exact-match resolution on basenames. If a parent links to
  `[[Sets, Functions, and the Need for Types]]`, the child's
  `relativePath` must end in `Sets, Functions, and the Need for Types.md`
  — spelled identically. Pick simple basenames you're willing to use as
  link targets unchanged.

## Field-by-field reference

For exhaustive types see `src/shared/tools/types.ts`. The fields most
worth a second read:

- **`id`** — `<category>.<kebab>`. Used in URLs, persisted overrides,
  logs. Don't change once a tool ships; users may have model overrides
  pinned by id.
- **`name`** — title-case, shown in the ToolPanel card and as the tab
  title for `outputMode: 'openConversation'`.
- **`description`** — one short line; subtitle on the card.
- **`longDescription`** — 1-3 sentences; expanded view on the card.
  Tell the user what to expect, not just what the tool does.
- **`preferredModel`** — author's hint, lowest priority. User overrides
  (LLMSettings.toolModelOverrides) win; global default fills in when
  both absent. Use `'claude-opus-4-7'` for tools where reasoning depth
  matters (decompose, learning-journey); `'claude-sonnet-4-6'` is the
  sensible default.
- **`web.defaultEnabled`** — whether `web_search` / `web_fetch` are on
  by default. Global `LLMSettings.web.enabled` still gates; this is a
  hint about whether the tool benefits from web grounding.
- **`outputNotePrefix`** — the basename prefix for `outputMode: 'newNote'`
  results. Final path becomes `<prefix>-<timestamp>.md` under the
  user's notes dir.
