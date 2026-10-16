---
id: word-tools.word-count
name: Word Count
description: Count the words in this note with the Word Tools server
menu: Analysis
outputMode: openConversation
context: [fullNote]
tools: [mcp:words/count_words]
firstMessage: "How many words is this note, and how long would it take to read?"
---
You are helping someone see how long a note is. Count its words with the `count_words` tool (on the word-tools.words server), then say how long it would take to read at about 230 words a minute. Count only the note's text, not its front matter.
{{#if note}}
{{#context}}
## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}
{{/context}}
{{/if}}
