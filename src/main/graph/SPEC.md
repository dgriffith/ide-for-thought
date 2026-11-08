---
id: graph
type: module-design
status: draft
title: Graph — RDF knowledge graph
parent: architecture
---

## Responsibility

Build and query the RDF knowledge graph that makes a thoughtbase machine-
readable. On every save, structure is extracted from notes — titles, tags,
wiki-links, frontmatter metadata, embedded Turtle blocks, and markdown tables
(CSVW) — into an rdflib store persisted as `.minerva/graph.ttl`. Exposes SPARQL
query (`api.graph.query`), with fifteen standard prefixes auto-injected
(`STANDARD_PREFIXES` in `state.ts`). Owns the derived note-path/alias index and
the wiki-link resolver, both versioned so incremental saves stay cheap.

## Boundary

- **Owns:** the mutable rdflib `IndexedFormula` store — it **stays inside
  `graph/`**; no module outside the package may name `GraphState` or reach
  `.store` (enforced). Work needed from elsewhere is exported from
  `graph/index.ts`.
- **Does not import `notebase`** (the dependency runs `notebase → graph`).
- **The write-guard chokepoint** lives here (`instrumentStoreMirror` in
  `state.ts`): every triple mutation passes through it, and an LLM-context write
  that didn't go through the approval engine trips `checkStoreWriteGuard`
  (fatal under test). Never swallow a `TrustGuardError`. See
  [llm](../llm/SPEC.md).
- **Per-project state** goes in a `createProjectStore` slot, never a module-level
  `Map` keyed by `rootPath`.
- **Two representations of a thought component** (hand-authored `thought:` Turtle
  vs. a typed note's `types:` class) are both queried through
  `argument-patterns.ts` — querying only one is a silent wrong answer.

## Decisions & vocabulary

- The dual RDF stack (rdflib source of truth + N3/Comunica mirror) is recorded
  in [adr-rdf-stacks](../../../docs/architecture/rdf-and-dom-libraries.md).
- The epistemic domain model is the
  [thought ontology](../../../docs/thought-ontology.md); declarative inspections
  are SHACL shapes. The ontology is executable — every `thought:`/`minerva:`
  term used in `src/` must be declared, enforced by an architecture test.
