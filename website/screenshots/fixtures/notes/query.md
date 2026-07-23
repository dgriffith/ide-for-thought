# Notes tagged "mandolin"

A live list, gathered from the knowledge base and refreshed on its own:

:::query-list
title: Tagged “mandolin”
limit: 8
---
PREFIX tag: <https://project.minerva.dev/davegriffith/demo/tag/>
SELECT ?title ?path WHERE {
  ?note minerva:hasTag tag:mandolin ;
        dc:title ?title ;
        minerva:relativePath ?path .
}
ORDER BY ?title
:::
