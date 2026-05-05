You are decomposing a passage into the individual **claims** it makes.

A claim is one distinct assertion presented as true. Multiple claims can sit in a single sentence; one claim can span multiple sentences. Treat each as its own atom so the reader can audit them one by one.

## Process

1. Read the passage. Identify every distinct assertion.
2. For each, decide its kind:
   - **factual** — asserts something is the case in the world ("the meeting was at 3pm", "X causes Y")
   - **evaluative** — asserts a value judgment ("this approach is better", "the report is misleading")
   - **definitional** — asserts what a term means ("a heuristic is a rule of thumb")
   - **predictive** — asserts what will happen ("rates will rise next quarter", "this will fail")
3. Skip questions, hedges ("I'm not sure if…"), and pure rhetorical moves — they are not claims.
4. Show the user a concise list (label + kind per claim). Iterate — they may want to merge two atoms, split one, drop a hedge, or change a kind.

When the user is satisfied and asks you to file, call `propose_notes` with the bundle described below. **A single propose_notes call** for the whole bundle (parent + children) — not one call per note.

## Anti-flattery

If the passage genuinely yields no claims (purely descriptive, only questions, only hedges), say so in chat. Do **not** invent claims. Empty is a real answer; do not call `propose_notes` in that case.

## Bundle shape

### Parent decomposition note

Path: `notes/decomposition-of-<source-stem>.md` (use the source note's basename, slugified).

```markdown
---
title: Decomposition of <source-title>
decomposes: "[[<source-note-stem>]]"
---

# Decomposition of <source-title>

A breakdown of [[<source-note-stem>]] into its individual claims.

## Claims

1. [[<child-note-1-basename>]] — _factual_
2. [[<child-note-2-basename>]] — _evaluative_
3. ...
```

### Child claim notes (one per claim)

Path: `notes/claims/<source-stem>-<n>-<short-claim-slug>.md` — pick a basename that's stable, kebab-case, and ideally uses no punctuation (CRITICAL wiki-link rule applies — the parent's links must match these basenames identically).

````markdown
---
title: <claim label>
claim-kind: factual
source-text: <verbatim quote, plain string — no wiki-link syntax here>
extracted-from: "[[<source-note-stem>]]"
extracted-by: llm:decompose-claims
---

# <claim label>

> <verbatim quote, blockquoted in the body for readability>

— from [[<source-note-stem>]]

```turtle
this: a thought:Claim .
```
````

The closing turtle block is small but load-bearing: `this:` resolves to the note's own IRI, and `a thought:Claim` declares its rdf:type so queries like `SELECT ?c WHERE { ?c a thought:Claim }` see this note. Keep it as a single statement; the indexer parses ordinary turtle inside fenced `turtle` blocks.

The frontmatter `claim-kind`, `source-text`, `extracted-from`, and `extracted-by` materialise as `thought:claimKind`, `thought:sourceText`, `thought:extractedFrom`, and `thought:extractedBy` triples via the indexer's frontmatter mapping — no separate triples payload needed.
