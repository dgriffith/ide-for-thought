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

```object-view
{
  "query": "SELECT ?tag ?title ?path WHERE {\n  ?note minerva:hasTag ?tagNode .\n  ?tagNode minerva:tagName ?tag .\n  ?note dc:title ?title .\n  ?note minerva:relativePath ?path .\n} ORDER BY ?tag ?title",
  "language": "sparql",
  "layout": "table",
  "title": "Tag Index",
  "note": "path",
  "columns": [
    "tag",
    "title",
    "path"
  ]
}
```

## Notes Over Time

:::query-timeseries
title: Notes Created
x: month
y: count
type: bar
height: 250
---
SELECT ?month (COUNT(?note) AS ?count) WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:created ?date .
  BIND(SUBSTR(STR(?date), 1, 7) AS ?month)
} GROUP BY ?month ORDER BY ?month
:::

## Connections Per Note

:::query-timeseries
title: Outgoing Links by Note
x: source
y: links
type: bar
height: 250
---
SELECT ?source (COUNT(?target) AS ?links) WHERE {
  ?s ?pred ?target .
  ?pred rdfs:subPropertyOf minerva:linksTo .
  ?s dc:title ?source .
} GROUP BY ?source ORDER BY ?source
:::

## Technology Stack (from Architecture note)

```object-view
{
  "query": "SELECT ?layer ?tech ?purpose WHERE {\n  ?table csvw:inNote ?note .\n  ?note dc:title \"Architecture Overview\" .\n  ?row csvw:cell ?cellLayer, ?cellTech, ?cellPurpose .\n  ?cellLayer csvw:column/csvw:name \"Layer\" .\n  ?cellLayer rdf:value ?layer .\n  ?cellTech csvw:column/csvw:name \"Technology\" .\n  ?cellTech rdf:value ?tech .\n  ?cellPurpose csvw:column/csvw:name \"Purpose\" .\n  ?cellPurpose rdf:value ?purpose .\n}",
  "language": "sparql",
  "layout": "table",
  "title": "Tech Stack (queried from markdown table)",
  "columns": [
    "layer",
    "tech",
    "purpose"
  ]
}
```
