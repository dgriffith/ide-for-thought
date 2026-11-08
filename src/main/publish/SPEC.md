---
id: publish
type: module-design
status: draft
title: Publish — export & publishing
parent: architecture
depends-on: [notebase, graph]
---

## Responsibility

No-lock-in output: export a single note or a whole folder tree to Markdown,
HTML, PDF, a browsable static site, Anki decks (`.apkg`), BibTeX, Pandoc (DOCX /
EPUB / …), or RDF/Turtle. Also owns the opt-in **Git publish** target.

## Boundary

- **Depends on** [notebase](../notebase/SPEC.md) (reads notes/assets) and
  [graph](../graph/SPEC.md) (RDF/Turtle export, graph-derived data). Exporters
  render notes through the shared markdown/vega pipeline.
- **Git is a publish target, not version control.** Thoughtbases are not auto-
  committed (a product non-goal); Git publishing is opt-in and uses
  `isomorphic-git` (no system git required). See the [git module](../git/SPEC.md).
- **Note-embedded SQL in exports is allowlisted** — a chart/query block rendered
  on HTML export runs through the same guard as in-app preview (see
  [sources](../sources/SPEC.md)); a refusal degrades to an error note and the
  export completes.
- **Plugin exporters** register their own Export menu family and are checked
  path-by-path before files are written (see [plugins](../plugins/SPEC.md)).
