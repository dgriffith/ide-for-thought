# Concerts and costs, drawn from a query

A result block turns a query's answer into a chart that redraws itself whenever
you open the note — no pasting fresh numbers by hand.

:::query-timeseries
title: Revenue vs cost by season
x: year
y: revenue, cost
type: area
height: 260
---
SELECT ?year ?revenue ?cost WHERE {
  VALUES (?year ?revenue ?cost) {
    ("2019" 42 30)
    ("2020" 55 38)
    ("2021" 61 45)
    ("2022" 78 52)
    ("2023" 96 61)
  }
}
ORDER BY ?year
:::
