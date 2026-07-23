# Pending proposals

Conversations and fleet agents never write to the graph directly — every
suggested change is filed as a proposal for you to approve or reject. The
Proposals panel is the review queue. The turtle cell below seeds a few example
proposals so the panel has something to show.

```turtle
<urn:minerva:proposal:rsb-demo-1> a thought:Proposal ;
  thought:proposalStatus thought:pending ;
  thought:operationType "note_rewrite" ;
  thought:proposalNote "Tighten the Gibson section and pin the F-5 to 1922" ;
  thought:proposedBy "llm:conversation:conv-1783724257383-952dlp" ;
  thought:proposedAt "2026-07-21T16:40:00Z" ;
  thought:autoExpires "2026-07-28T16:40:00Z" ;
  thought:affectsNode <https://minerva.dev/demo/note/America-and-the-Gibson-Revolution> ;
  thought:payloadJson """[{"kind":"note","relativePath":"notes/mandolin-history/America and the Gibson Revolution.md","content":"Lloyd Loar joined Gibson in 1919 and left in 1924, leaving behind the carved-top F-5."}]""" .

<urn:minerva:proposal:rsb-demo-2> a thought:Proposal ;
  thought:proposalStatus thought:pending ;
  thought:operationType "new_claim" ;
  thought:proposalNote "File a claim: Bill Monroe fixed the F-5 as the bluegrass standard" ;
  thought:proposedBy "mcp:claude-code" ;
  thought:proposedAt "2026-07-21T15:05:00Z" ;
  thought:autoExpires "2026-07-28T15:05:00Z" ;
  thought:payloadJson """[{"kind":"note","relativePath":"notes/mandolin-history/The Rise of Bluegrass.md","content":"Bill Monroe made the Gibson F-5 the definitive bluegrass mandolin."}]""" .

<urn:minerva:proposal:rsb-demo-3> a thought:Proposal ;
  thought:proposalStatus thought:approved ;
  thought:operationType "component_creation" ;
  thought:proposalNote "Note the tension effect of doubled courses" ;
  thought:proposedBy "llm:conversation:conv-1783724257383-952dlp" ;
  thought:proposedAt "2026-07-20T09:12:00Z" ;
  thought:autoExpires "2026-07-27T09:12:00Z" ;
  thought:payloadJson """[{"kind":"note","relativePath":"notes/mandolin-history/The Physics of the Mandolin.md","content":"Doubled courses raise the total string tension and brighten the attack."}]""" .
```
