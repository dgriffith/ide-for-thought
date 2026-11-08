---
created: "2025-02-15T14:00:00Z"
---

# Research Overview

This document surveys related work. It covers several areas of interest.

The first area is formal methods. The second area is type systems. Both are important for correctness.

See [[notes/architecture]] and [[notes/todo]] for action items.

## Research Papers

```object-view
{
  "query": "SELECT ?title ?path WHERE {\n  ?note minerva:inFolder ?folder .\n  ?folder minerva:relativePath \"research/papers\" .\n  ?note dc:title ?title .\n  ?note minerva:relativePath ?path .\n} ORDER BY ?title",
  "language": "sparql",
  "layout": "list",
  "title": "Papers in this thoughtbase"
}
```

## Link Map

```object-view
{
  "query": "SELECT ?source ?linkType ?target WHERE {\n  ?s ?pred ?t .\n  ?pred rdfs:subPropertyOf minerva:linksTo .\n  ?s dc:title ?source .\n  ?t dc:title ?target .\n  BIND(REPLACE(STR(?pred), \"https://minerva.dev/ontology#\", \"\") AS ?linkType)\n} ORDER BY ?source",
  "language": "sparql",
  "layout": "table",
  "title": "How notes connect",
  "columns": [
    "source",
    "linkType",
    "target"
  ]
}
```
