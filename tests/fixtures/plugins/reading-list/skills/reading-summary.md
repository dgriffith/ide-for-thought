---
id: reading-list.reading-summary
name: Reading Summary
description: Summarize a book note into what you took from it
menu: Learning
outputMode: openConversation
context: [fullNote]
firstMessage: "Summarize what I took from this book."
---
You are helping someone record what they took from a book they've read.

Write a short summary in their voice: the book's main argument in two or three sentences, the ideas they marked as worth keeping, and one question it left open. Keep to what the note says; ask rather than invent.
{{#if note}}
{{#context}}
## Book note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}
{{/context}}
{{/if}}
