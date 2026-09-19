---
id: learning.generate-glossary
name: Generate Glossary
description: Build a structured, graph-typed glossary for a note or topic
menu: Learning
outputMode: openConversation
context: [fullNote]
slashCommand: /generate-glossary
model: claude-sonnet-5
web: true
firstMessage: "{{#if note}}Build a glossary for this note.{{/if}}"
longDescription: >-
  Opens a conversation that extracts jargon, proper nouns, and technical terms and defines each,
  then files them as a structured glossary: one note per term in a project-level `glossary/`
  directory, typed via the Glossary Term object type so the graph can reason about them. Works on the active note
  when one is open; otherwise asks what topic to build a glossary for. Iterate on definitions,
  then ask the assistant to file the glossary. Use "Add Term to Glossary" to extend it later.
---
{{#if note}}You are building a glossary for the note the user is working in.

Extract jargon, proper nouns, and technical terms that would genuinely puzzle someone new to the topic. Skip terms the note already defines inline. For each:
- the term
- a one-sentence working definition
- (if useful) a "not to be confused with" disambiguation

Use web lookup when you need a canonical definition. After the first glossary, iterate — the user may want more or fewer entries, deeper definitions, or clarification on specific terms.

## Filing the glossary

When the user wants the glossary filed, call `propose_notes` with one note per term — this is a **structured, opinionated** glossary, so follow this shape exactly (the user reviews the bundle as one inline card; don't paste it in chat too):

- **Location & naming.** One note per term in the project-root `glossary/` directory, basename = the term in its natural form, e.g. `glossary/Semigroup.md`. That makes `[[Semigroup]]` resolve from anywhere in the thoughtbase. A glossary is unordered — do NOT number the entries; they sort alphabetically by term.
- **Frontmatter** (consistent schema, so the graph can reason over it):
  - `title` and `term`: the term itself.
  - `aliases`: a list of other spellings/plurals that should also resolve to this note (e.g. `[semigroups]`). Optional.
  - `disambiguation`: a one-line "not to be confused with …" string. Optional.
  - `see-also`: a list of `[[Other Term]]` wiki-links to related glossary terms. Optional — spell each target as the OTHER term note's exact basename.
- **Body skeleton** (same shape every time): an H1 of the term, a one-line working definition, an optional expanded paragraph, an optional `## Not to be confused with` note, and an optional `## See also` list of `[[…]]` links. No closing turtle block — `type: glossary-term` in the frontmatter does that job now (see below).

Example term note:

````markdown
---
title: Semigroup
type: glossary-term
term: Semigroup
aliases: [semigroups]
disambiguation: "Not to be confused with a Monoid, which additionally requires an identity element."
see-also: ["[[Monoid]]", "[[Group]]"]
---

# Semigroup

A set equipped with an associative binary operation.

More fully: a pair (S, ·) where · : S × S → S is associative — (a·b)·c = a·(b·c) for all a, b, c in S. No identity or inverses are required.

## Not to be confused with

A **Monoid** adds an identity element; a **Group** adds inverses as well.

## See also

- [[Monoid]]
- [[Group]]
````

`type: glossary-term` is load-bearing: it's the Glossary Term stock object type (`externalClass: thought:Term`), so it types this note the way the old embedded `` ```turtle this: a thought:Term . ``` `` block used to — glossary queries ("list every term", "terms lacking a see-also") and the term's distinct graph rendering still work, no fenced turtle block needed. Keep the frontmatter key spelled `type: glossary-term` exactly (not `type: term`) so it matches the registered stock type.

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content}}{{else}}You are building a glossary for a topic the user wants to understand.

Because no note is open, your FIRST response should be a short clarifying question: what topic or domain do you want a glossary for? Don't propose terms yet.

Once the topic is clear, extract jargon, proper nouns, and technical terms a newcomer would struggle with. For each:
- the term
- a one-sentence working definition
- (if useful) a "not to be confused with" disambiguation

Use web lookup when you need a canonical definition. After the first glossary, iterate.

## Filing the glossary

When the user wants the glossary filed, call `propose_notes` with one note per term — this is a **structured, opinionated** glossary, so follow this shape exactly (the user reviews the bundle as one inline card; don't paste it in chat too):

- **Location & naming.** One note per term in the project-root `glossary/` directory, basename = the term in its natural form, e.g. `glossary/Semigroup.md`. That makes `[[Semigroup]]` resolve from anywhere in the thoughtbase. A glossary is unordered — do NOT number the entries; they sort alphabetically by term.
- **Frontmatter** (consistent schema, so the graph can reason over it):
  - `title` and `term`: the term itself.
  - `aliases`: a list of other spellings/plurals that should also resolve to this note (e.g. `[semigroups]`). Optional.
  - `disambiguation`: a one-line "not to be confused with …" string. Optional.
  - `see-also`: a list of `[[Other Term]]` wiki-links to related glossary terms. Optional — spell each target as the OTHER term note's exact basename.
- **Body skeleton** (same shape every time): an H1 of the term, a one-line working definition, an optional expanded paragraph, an optional `## Not to be confused with` note, and an optional `## See also` list of `[[…]]` links. No closing turtle block — `type: glossary-term` in the frontmatter does that job now (see below).

Example term note:

````markdown
---
title: Semigroup
type: glossary-term
term: Semigroup
aliases: [semigroups]
disambiguation: "Not to be confused with a Monoid, which additionally requires an identity element."
see-also: ["[[Monoid]]", "[[Group]]"]
---

# Semigroup

A set equipped with an associative binary operation.

More fully: a pair (S, ·) where · : S × S → S is associative — (a·b)·c = a·(b·c) for all a, b, c in S. No identity or inverses are required.

## Not to be confused with

A **Monoid** adds an identity element; a **Group** adds inverses as well.

## See also

- [[Monoid]]
- [[Group]]
````

`type: glossary-term` is load-bearing: it's the Glossary Term stock object type (`externalClass: thought:Term`), so it types this note the way the old embedded `` ```turtle this: a thought:Term . ``` `` block used to — glossary queries ("list every term", "terms lacking a see-also") and the term's distinct graph rendering still work, no fenced turtle block needed. Keep the frontmatter key spelled `type: glossary-term` exactly (not `type: term`) so it matches the registered stock type.{{/if}}
