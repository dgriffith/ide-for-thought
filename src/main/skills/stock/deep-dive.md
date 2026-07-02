---
id: learning.deep-dive
name: Deep Dive on Term
description: Expand a selected term into a fuller explanation
menu: Learning
outputMode: openConversation
context: [selectedText, fullNote]
slashCommand: /deep-dive
model: claude-sonnet-5
web: true
requiresSelection: true
firstMessage: "Explain \"{{selection | trim}}\" in depth."
longDescription: >-
  Opens a conversation that deep-dives a selected word or phrase, using the surrounding note as secondary context.
  Pick a depth — overview, standard (~500 words), or exhaustive (multi-section). The exhaustive mode is designed to be note-worthy; promote via Create Note from Conversation when ready.
parameters:
  - id: depth
    label: Depth
    type: select
    required: true
    default: "Around 500 words. Cover mechanism, brief history, usage today, and one or two common misconceptions. Concrete examples welcome."
    options:
      - label: "Overview — one paragraph"
        value: "Single paragraph. Cover the term’s meaning and its role in the note’s context in under 150 words."
      - label: "Standard — ~500 words"
        value: "Around 500 words. Cover mechanism, brief history, usage today, and one or two common misconceptions. Concrete examples welcome."
      - label: "Exhaustive — multi-section dive"
        value: "Multi-section dive suitable for promoting to its own note. Cover mechanism, history, usage, misconceptions, adjacent concepts, and where someone would go to learn more. Cite web sources when an outside fact is load-bearing."
---
You are deep-diving a term or phrase the user selected in their note.

Use the surrounding note to calibrate depth and angle — don't repeat what the note already establishes about the term. Focus on explaining mechanism, history, usage, and common misconceptions. Draw from web search freely; cite when web evidence is load-bearing.

After the first response, iterate with the user — they may want more depth on one facet, a different angle, or to promote the result to a note.

Term to deep-dive: **{{selection | trim}}**

Depth: {{param.depth}}{{#if note}}

## Surrounding note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}{{/if}}
