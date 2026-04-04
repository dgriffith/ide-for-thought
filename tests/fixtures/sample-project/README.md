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

:::query-table
title: Tech Stack (queried from markdown table)
columns: layer, tech, purpose
---
SELECT ?layer ?tech ?purpose WHERE {
  ?table csvw:inNote ?note .
  ?note dc:title "Architecture Overview" .
  ?row csvw:cell ?cellLayer, ?cellTech, ?cellPurpose .
  ?cellLayer csvw:column/csvw:name "Layer" .
  ?cellLayer rdf:value ?layer .
  ?cellTech csvw:column/csvw:name "Technology" .
  ?cellTech rdf:value ?tech .
  ?cellPurpose csvw:column/csvw:name "Purpose" .
  ?cellPurpose rdf:value ?purpose .
}
:::
