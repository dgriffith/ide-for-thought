---
id: sources
type: module-design
status: draft
title: Sources — import, excerpts & tables
parent: architecture
depends-on: [notebase, graph]
---

## Responsibility

Everything about external material a thoughtbase cites: importing sources (PDFs
with OCR, DOI/ISBN/arXiv, BibTeX, Zotero RDF, the web clipper), source metadata
(`meta.ttl`), anchored excerpts, citations/CSL, and CSV → DuckDB typed tables
for in-note SQL and charts.

## Boundary

- **Depends on** [notebase](../notebase/SPEC.md) (file storage under
  `.minerva/sources/<id>/`) and [graph](../graph/SPEC.md) (citations, excerpt
  nodes). The `notebase ↔ sources` package cycle is a deliberate, documented
  exception (dropping a file dispatches to the owning importer).
- **DuckDB is locked to the thoughtbase root** — `allowed_directories` is the
  realpath'd root, external access off and configuration locked, so no caller of
  that instance can read outside it. Markdown tables are typed by a private
  sniffer instance, not a temp CSV on the shared connection.
- **Agent/LLM SQL is allowlisted** — `query_sql`, note-embedded chart/query SQL,
  and the MCP `sql_query` tool run through `llm-sql-guard` (see
  [llm](../llm/SPEC.md)); what the user runs deliberately (Query panel, `sql`
  cells) keeps the full root-locked connection.
- **Source-skill writes are approval-gated** — `propose_source_properties`
  upserts `meta.ttl` through the approval engine.
