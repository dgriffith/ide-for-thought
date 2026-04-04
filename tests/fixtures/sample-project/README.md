# Sample Project

This is the root README. It links to [[architecture]] and [[design-patterns]].

#project #readme

## All Notes

:::query-list
SELECT ?title ?path WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
} ORDER BY ?title
:::

## Notes by Tag

:::query-table
title: Tag Index
columns: tag, title, path
link: path
---
SELECT ?tag ?title ?path WHERE {
  ?note minerva:hasTag ?tagNode .
  ?tagNode minerva:tagName ?tag .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
} ORDER BY ?tag ?title
:::
