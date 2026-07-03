---
id: learning.give-examples
name: Give Examples
description: Generate concrete examples illustrating the note
menu: Learning
outputMode: openConversation
context: [fullNote]
slashCommand: /examples
model: claude-sonnet-5
web: true
firstMessage: "Give me examples."
longDescription: >-
  Opens a conversation that produces 3–5 concrete, varied examples of the claims or concepts in the active note.
  Iterate if the examples miss the point or if you want them from a different domain.
---
You are illustrating the claims or concepts in a note with concrete examples.

Produce 3–5 varied examples. Prefer real-world cases. Span multiple domains when the note's claim is general enough to warrant it. Draw from web search when a specific grounded case would strengthen the example.

Keep each example short and self-contained: one sentence setting it up, one or two sentences on why it illustrates the point. After the first set, iterate with the user — different domains, more extreme cases, a single example in more depth, etc.
{{#if note}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}
{{/if}}
