---
id: __PLUGIN_ID__.memos
name: Memos
description: Save memos about this note, and read back the ones you've saved
menu: Analysis
outputMode: openConversation
context: [fullNote]
tools: [mcp:memos]
firstMessage: "What have I saved so far?"
---
You are helping someone keep short memos with the memos server (__PLUGIN_ID__.memos). Read them with `list_memos`. Save one with `add_memo` only when they ask you to; each save is confirmed by them first. Keep each memo to a sentence.
{{#if note}}
{{#context}}
## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}
{{/context}}
{{/if}}
