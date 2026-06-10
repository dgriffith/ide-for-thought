# Authoring Skills

A **skill** is a markdown file that drives one of Minerva's Tools-for-Thought
menus (**Learning**, **Research**, **Analysis**). It's the only way to add a
tool — there is no `.ts` registry anymore. A skill is YAML frontmatter (what it
is, where it goes, what context it needs) plus a markdown body (the prompt). The
body is a small template language, so one file can adapt to whether a note is
open, what the user selected, or which option they picked — no code.

Skills are loaded at app startup and recompiled into the same tool registry the
menu bar, command palette, slash commands, and conversation engine all read
from. Stock skills ship with Minerva; your own live in `~/.minerva/skills/` and
apply across every thoughtbase on this machine.

## Where skills live

| Source | Location | Editable |
|---|---|---|
| **Stock** | bundled in the app (`src/main/skills/stock/*.md`) | no |
| **User** | `~/.minerva/skills/` | yes |

A user skill is either:

- a single file — `~/.minerva/skills/my-skill.md`, or
- a folder with a `SKILL.md` — `~/.minerva/skills/my-skill/SKILL.md` (use this
  when the skill ships assets alongside the prompt).

Open the folder from **Settings → Skills → Reveal skills folder**, or
**Import skill…** to copy a `.md` file / folder in. After editing files by hand,
hit **Reload** in the same panel (no restart needed).

The stock skills double as reference examples — copy one out of the app's
`stock/` directory, change the `id`/`name`, and tweak from there.

## Quickstart

Drop this in `~/.minerva/skills/devils-advocate.md` and hit Reload:

```markdown
---
name: Devil's Advocate
description: Argue the strongest case against the current note
menu: Analysis
outputMode: openConversation
context: [fullNote]
web: true
firstMessage: "{{#if note}}Make the strongest case against this note.{{/if}}"
---
You are a sharp, fair-minded critic. Argue the strongest case *against* the
position in the note below — steelman the opposition, don't strawman it.

{{#if note}}
Title: {{note.title}}

{{note.content}}
{{else}}
No note is open. Ask the user what position they want challenged.
{{/if}}

If the position turns out to be hard to attack, say so plainly — a weak
rebuttal you don't believe is worse than admitting the case is strong.
```

It appears under **Analysis** immediately, in the menu bar, the command
palette, and the editor right-click menu (because it requests `fullNote`).

## Frontmatter reference

### Required

| Field | Type | Notes |
|---|---|---|
| `name` | string | Human-readable; shown on the card and as the conversation tab title. |
| `description` | string | One short line; the card subtitle. |
| `menu` | `Learning` \| `Research` \| `Analysis` | The home menu. The user can override it per machine (see [Menu config](#menu-config)). |
| `outputMode` | see [Output modes](#output-modes) | How the result is delivered. |
| *body* | markdown | The prompt. The body is required — an empty body is rejected. |

### Optional

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | slug of `name` | Stable identifier used in logs, model overrides, and menu config. **Set it explicitly and never change it once shared** — overrides are pinned by id. Stock ids look like `analysis.steelman`; yours can be anything not already taken. |
| `longDescription` | string | `description` | 1–3 sentences; the expanded card view. Tell the user what to expect. |
| `context` | string list | `[]` | What to gather before running. See [Context](#context). |
| `parameters` | list | `[]` | Upfront form fields. See [Parameters](#parameters). |
| `tools` | string list | default set | Conversation tools to advertise. Currently only `ask_user` is honored as an extra. |
| `web` | boolean | `false` | Whether `web_search` / `web_fetch` are on by default (the global web setting still gates). |
| `model` | string | global default | Preferred model, e.g. `claude-opus-4-8` for deep reasoning, `claude-sonnet-4-6` otherwise. User and global settings win over this hint. |
| `slashCommand` | string | — | A `/command` alias. A leading `/` is added if you omit it. |
| `outputNotePrefix` | string | — | Basename prefix for `newNote` results (`<prefix>-<timestamp>.md`). |
| `requiresSelection` | boolean | `false` | Hide the skill unless there's a non-empty editor selection. |
| `firstMessage` | template | — | An auto-fired first user turn for `openConversation` skills. Omit to let the user type first. |

`id` can't collide with a stock skill or another user skill — user skills are
**additive only**. To change a stock skill, disable it (Settings → Skills) and
author your own.

## The body is a template

The body — and `firstMessage` — are rendered against the current editor context
at run time. The language is deliberately tiny and **non-executing**: no loops,
no arbitrary expressions.

### Interpolation

```
{{selection}}            the verbatim editor selection
{{note.title}}           the active note's title
{{note.content}}         the active note's full text
{{note.path}}            the active note's path
{{claim.label}}          the claim under the cursor
{{claim.uri}}            its graph URI
{{claim.sourceText}}     the passage the claim came from
{{param.<id>}}           the value of a parameter you declared
```

An unknown variable renders empty (and is flagged when the skill is validated,
so typos like `{{note.body}}` surface as a load error rather than silently
disappearing).

### Filters

Pipe a value through a transform with `|`:

```
{{claim.sourceText | blockquote}}     prefix every line with "> "
{{note.title | trim}}                 strip surrounding whitespace
{{note.title | upper}} / {{… | lower}}  case
{{note.path | stem}}                  drop a trailing ".md"
```

### Conditionals

```
{{#if note}} … {{else}} … {{/if}}
```

Blocks nest, and `!` negates: `{{#if !selection}}…{{/if}}`. Truthiness: an
object slot (`note`, `claim`) is truthy when present; a string slot
(`selection`, `param.x`) is truthy when non-empty. A block tag alone on its line
consumes the whole line, so `{{#if note}}` on its own line leaves no blank gap
when the block is taken or skipped.

This is how skills replace the old "no-note variant" files — one body branches:

```markdown
{{#if note}}
You are revising the note titled "{{note.title}}".

{{note.content}}
{{else}}
No note is open. Ask the user what they'd like to work on.
{{/if}}
```

## Context

List what to gather; the matching fields are populated before the body renders.

| Requirement | Exposes in template | Use for |
|---|---|---|
| `selectedText` | `{{selection}}` | Operating on a selected passage. Empty when nothing is selected. |
| `fullNote` | `{{note.*}}` | Needing the whole active note. |
| `relatedNotes` | (graph neighbors, internal) | Considering linked notes. |
| `taggedNotes` | (tag cohort, internal) | Considering notes sharing tags. |
| `claimUnderCursor` | `{{claim.*}}` | Operating on the `thought:Claim` at the cursor. |
| `selectionRange` | (offsets, planned) | Edits anchored to the original passage. |

Requirements are advisory — your template decides what to do when a field is
empty. To **hard-require** a selection instead, set `requiresSelection: true`
(the skill hides without one). To **adapt**, branch with `{{#if note}}`.

## Parameters

For an upfront decision (audience level, depth, which-of-many-cases), declare
`parameters`. The panel renders the form; read values with `{{param.<id>}}`.

```yaml
parameters:
  - id: difficulty
    label: Difficulty
    type: select
    required: true
    default: apply
    options:
      - label: "Recall — facts and definitions"
        value: recall
      - label: "Apply — application and inference"
        value: apply
      - label: "Synthesis — cross-topic and stress cases"
        value: synthesis
```

Types: `text`, `textarea`, `select`, `number`. `select` options may be bare
strings (label = value) or `{label, value}` pairs. `default` (friendly alias of
`defaultValue`) seeds the field. Because the template can't map a value to extra
prose, put any per-option wording directly in the `value`.

Parameters cover the **upfront known-decision** case. For ambiguity that only
appears after the agent reads the source, add `tools: [ask_user]` — the agent
gets an `ask_user` tool that pops an inline question and continues with the
answer. Prefer `parameters` where you can; reach for `ask_user` sparingly.

## Output modes

| Mode | Effect | Author |
|---|---|---|
| `openConversation` | Opens a tab in the conversations panel; the agent runs the standard tool loop. | The body is the **system prompt**; optionally add `firstMessage`. Most skills want this. |
| `newNote` | Runs the prompt once; files the result as a new note. | The body is the **one-shot prompt**; set `outputNotePrefix`. |
| `appendToNote` / `insertAtCursor` / `replaceSelection` / `multipleNotes` | One-shot variants; the dispatcher places the result. | The body is the one-shot prompt. |

Reach for `newNote` only when the result is a clean, self-contained artifact the
user won't iterate on inside the conversation.

## Prompt voice

- **Second person.** "You are X. Your goal is Y." — every stock skill opens this
  way.
- **Specify the output channel.** Free prose? A `propose_notes` bundle? An
  embedded Turtle block? Be concrete about what success looks like.
- **Number the procedure** when steps are ordered; don't when order is fluid.
- **Allow empty.** Models produce confident output even when the source yields
  nothing. If empty is a real answer, say so: "If the passage yields no claims,
  say so. Empty is a real answer." — this clause is load-bearing.

## The trust principle

The LLM proposes; the human confirms. **No skill may write to the graph
directly.** Express any graph facts (claims, typed links) as **frontmatter or
wiki-links inside a proposed note**, and emit them via the `propose_notes` tool
— it routes through the approval engine, and the user reviews the inline draft
card before anything lands. The graph indexer materializes the triples from the
note on save, so the note stays the audit trail. Don't paste the bundle inline
in the chat too; the card is the deliverable.

Other built-in tools the agent may use freely: `describe_graph_schema` (call it
before referencing thought-ontology types), the read-only `search_notes` /
`read_note` / `query_graph`, and `web_search` / `web_fetch` (set `web: true` to
default them on).

<a name="menu-config"></a>
## Menu config (per machine)

Settings → Skills also controls placement, stored per machine in
`~/.minerva/menu-config.json`:

- **Enable / disable** — hide a skill from the menu, palette, and slash commands
  without deleting it (the only way to turn off a stock skill).
- **Reassign menu** — move a skill into a different one of the three.
- **Reorder** — arrange skills within a menu.

Untouched and newly-added skills default to enabled, in their declared `menu`,
appended after any explicitly-ordered ones — so a fresh install needs no config,
and a new skill slots in sensibly.

## How loading works

At startup Minerva reads stock + `~/.minerva/skills/`, parses and validates each
file, applies the menu config, and compiles the survivors into the tool
registry. Parsing is **error-isolated**: one malformed skill is skipped and
reported (Settings → Skills lists load errors) without breaking the rest. Common
rejects: missing a required field, an invalid `menu`/`outputMode`, an unknown
template variable or filter, or unbalanced `{{#if}}`/`{{/if}}`.
