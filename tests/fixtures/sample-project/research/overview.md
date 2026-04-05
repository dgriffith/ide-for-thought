---
created: "2025-02-15T14:00:00Z"
---

# Research Overview

This document surveys related work. It covers several areas of interest.

The first area is formal methods. The second area is type systems. Both are important for correctness.

See [[notes/architecture]] and [[notes/todo]] for action items.

## Research Papers

:::query-list
title: Papers in this thoughtbase
---
SELECT ?title ?path WHERE {
  ?note minerva:inFolder ?folder .
  ?folder minerva:relativePath "research/papers" .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
} ORDER BY ?title
:::

## Link Map

:::query-table
title: How notes connect
columns: source, linkType, target
---
SELECT ?source ?linkType ?target WHERE {
  ?s ?pred ?t .
  ?pred rdfs:subPropertyOf minerva:linksTo .
  ?s dc:title ?source .
  ?t dc:title ?target .
  BIND(REPLACE(STR(?pred), "https://minerva.dev/ontology#", "") AS ?linkType)
} ORDER BY ?source
:::
