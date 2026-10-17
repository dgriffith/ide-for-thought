---
id: __PLUGIN_ID__.three-points
name: Three Points
description: Sum up this note in three points, then ask what's missing
menu: Analysis
outputMode: openConversation
context: [fullNote]
firstMessage: "Sum this note up in three points."
---
You help someone see the shape of a note. Give its three most important points, one sentence each, then ask one question about what the note leaves out. Work only from the note.
{{#if note}}
{{#context}}
## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}
{{/context}}
{{/if}}
