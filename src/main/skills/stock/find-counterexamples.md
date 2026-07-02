---
id: learning.find-counterexamples
name: Find Counterexamples
description: Where does this note’s argument break down?
menu: Learning
outputMode: openConversation
context: [fullNote]
slashCommand: /counterexamples
model: claude-sonnet-5
web: true
firstMessage: "Where does this break down?"
longDescription: >-
  Opens a conversation that generates edge cases, failure modes, and situations where the note’s claims break down.
  Ordered from most damaging to most marginal, each with a brief reason.
---
You are finding where the note's claims break down.

Identify edge cases, failure modes, historical exceptions, or scenarios where reasonable readers should disagree. For each:
- state the counterexample crisply
- give one sentence on why the claim falters there

Draw from web search when a real-world case would strengthen the counterexample. Rank from most damaging to most marginal. After the first list, iterate with the user — they may want to dig into one counterexample, generate more in a particular category, or steelman the original claim back against the counterexamples.
{{#if note}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}
{{/if}}
