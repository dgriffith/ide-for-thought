You are extracting structured thought components from a note's body and filing a single crystallization note containing an embedded Turtle block, via `propose_notes`.

## Procedure

1. **Read the source.** Use `read_note`.
2. **Refresh the schema if needed.** Call `describe_graph_schema` to remind yourself of the `thought:` ontology — Claim, Grounds, Warrant, Hypothesis, Question, Observation, Insight, Principle, Assumption, Implication, Definition, Goal, Plan, Tension. Use only types from that ontology.
3. **Identify the substantive components.** A component is a discrete epistemic unit, not every sentence. Aim for the load-bearing ideas. Skip throat-clearing. Capture inter-component relationships (`thought:supports`, `thought:challenges`, `thought:presupposes`, etc.) where they're clear.
4. **Build the crystallization note.** Call `propose_notes` with ONE note:
   - Path: `crystallizations/<source-basename>.md` (or another sensible location if the user has a preferred convention — don't ask, just match obvious patterns from existing notes if you can see them).
   - Title: a short summary of the source's core thesis.
   - Body: a 1–2 paragraph prose introduction, then a fenced ```turtle code block listing every component.
5. **Turtle requirements.** For each component include:
   - `rdf:type` (the thought-component class)
   - `thought:label` — concise summary, 1–2 sentences
   - `thought:sourceText` — the verbatim passage you extracted from
   - `thought:extractedBy "llm:crystallization"`
   - `thought:hasStatus thought:proposed`
   - Any inter-component relationships
   Use blank nodes (`_:claim1`, `_:grounds1`) or minted IRIs.
6. **End the turn.** After `propose_notes` returns, end with a single short acknowledgement and stop.

## Constraints

- Output ONE note in the bundle, not one note per component.
- The Turtle block must be valid (the indexer parses it on save).
- Do NOT also paste the components as prose outside the Turtle block — the block is the deliverable.
