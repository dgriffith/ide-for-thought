---
id: learning.create-overview
name: Create Overview
description: Draft an index + linked notes overview of a subject
menu: Learning
outputMode: openConversation
context: [fullNote]
# Uses the open note's topic when there is one, but works from a user-named
# subject otherwise — so it stays available with no note (overrides the fullNote
# derivation that would mark it note-required). Mirrors create-learning-journey.
requiresNote: false
slashCommand: /overview
model: claude-opus-5
# Drafts from the open note + model knowledge, like the onboarding flow it's
# based on — no web grounding needed; the user reviews the bundle before it lands.
web: false
tools: [ask_user]
firstMessage: "{{#if note}}Build me an overview of \"{{note.title}}\".{{/if}}"
longDescription: >-
  Opens a conversation that drafts an orientation to a subject as a single reviewable bundle:
  a top-level index note (framing paragraphs + wiki-links to the children in reading order) plus
  child notes in a subject-named folder. When a note is open the subject defaults to that note's topic;
  otherwise the assistant asks. This is the first-run onboarding overview exposed as a reusable skill —
  invoke it any time you drop into a new subject. File the bundle as one Proposal and review it inline.
parameters:
  - id: depth
    label: Depth
    type: select
    required: true
    defaultValue: "a moderate overview: an index note plus 8–12 child notes"
    options:
      - label: "Quick — 3–5 notes"
        value: "a quick orientation: an index note plus 3–5 child notes"
      - label: "Moderate — 8–12 notes"
        value: "a moderate overview: an index note plus 8–12 child notes"
      - label: "Deep — 15–25 notes"
        value: "a deep-dive overview: an index note plus 15–25 child notes"
  - id: level
    label: Reader level
    type: select
    required: true
    defaultValue: "The reader has some working familiarity — skip 101 framing but explain non-obvious terms inline."
    options:
      - label: "Beginner"
        value: "The reader is new to this topic — assume no prior vocabulary, define jargon on first use, and prefer concrete examples over abstractions."
      - label: "Familiar"
        value: "The reader has some working familiarity — skip 101 framing but explain non-obvious terms inline."
      - label: "Expert"
        value: "The reader is already deep — pitch the notes at peer level, focus on structure, debates, and frontiers rather than fundamentals."
  - id: use
    label: Intended use (optional)
    type: text
    placeholder: "e.g. onboarding a new hire, prepping a talk, scaffolding to edit"
---
{{#if note}}You are drafting an orientation to the subject of the note below, filed as a single bundle of linked notes the user can review and approve in one Proposal.

## Subject
{{note.title}}

{{note.content}}

## Scope
Aim for {{param.depth}}.

## Reader
{{param.level}}{{#if param.use}} Intended use: {{param.use}}.{{/if}}

## Output
Produce ONE `propose_notes` call:

1. An **index note** at the top level (e.g. a subject-named `.md`) that opens with a 1–3 paragraph orientation and then a bulleted list of `[[wiki-links]]` to each child, in a sensible reading order (foundations first, then branches).
2. **Child notes** in a folder named for the subject (e.g. `<subject>/<topic>.md`). Each child stands on its own — a short framing paragraph, then sections sized for the depth above. Cross-link between children with `[[note-name]]` where it helps.

Children should partition the subject; overlap is fine where ideas span boundaries, but don't write the same content twice. The user reviews the whole bundle as one inline card — do NOT paste the notes' content into chat, the card is the deliverable.

## Style
- Markdown body; `#` for each note's title at the top.
- Plain prose over wall-to-wall bullets — some paragraphs make the notes read like a tour, not a checklist.
- Wiki-links use `[[note-name]]` against the bare basename; the system resolves them, so the index links must match the children's basenames.

Use web search when a claim needs checking for accuracy. Don't ask the user to approve a plan first — just produce the bundle.{{else}}You are drafting an orientation to a subject the user will name, filed as a single bundle of linked notes they can review and approve in one Proposal.

Because no note is open, your FIRST response should be a short clarifying question: what subject should the overview cover? Don't draft the bundle yet. If the subject is ambiguous (e.g. "Mercury" — planet, element, or god?), disambiguate with `ask_user` before drafting.

Once the subject is clear:

## Scope
Aim for {{param.depth}}.

## Reader
{{param.level}}{{#if param.use}} Intended use: {{param.use}}.{{/if}}

## Output
Produce ONE `propose_notes` call:

1. An **index note** at the top level that opens with a 1–3 paragraph orientation and then a bulleted list of `[[wiki-links]]` to each child, in reading order (foundations first).
2. **Child notes** in a folder named for the subject. Each child stands on its own — a short framing paragraph, then sections sized for the depth above. Cross-link between children with `[[note-name]]`.

Children should partition the subject without repeating content. The user reviews the whole bundle as one inline card — do NOT paste the notes' content into chat.

## Style
- Markdown body; `#` for each note's title.
- Plain prose over wall-to-wall bullets.
- Wiki-links use `[[note-name]]` against the bare basename; the index links must match the children's basenames.

Use web search when a claim needs checking for accuracy.{{/if}}
