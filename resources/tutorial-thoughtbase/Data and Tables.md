---
title: Data and Tables
tags: [tutorial, area/data]
---

# Data and Tables

Minerva treats data as a first-class citizen. Drop a `.csv` anywhere in the
thoughtbase and it becomes a **SQL table** you can query; write a captioned
Markdown table and it works the same way; then chart the result.

## The shipped dataset

This thoughtbase ships `data/lessons.csv` — a little dataset *about this very
tutorial* (each lesson, its area, its length, and a difficulty rating). A CSV's
table name comes from its path, so `data/lessons.csv` is the table `data_lessons`.

## Query it with SQL

The cell below aggregates minutes by area. It ships with its output shown; press
**Run** to execute it live in an in-memory DuckDB — nothing leaves your machine.

```sql {id=area-minutes}
SELECT area, SUM(minutes) AS minutes
FROM data_lessons
GROUP BY area
ORDER BY minutes DESC
```
```output
{"type":"table","columns":["area","minutes"],"rows":[["Authoring",22],["Graph",17],["Data",17],["AI",13],["Research",8],["Publishing",5]]}
```

## Chart it

Charts are Vega-Lite. This one uses inline values, so it renders immediately —
but a chart can also bind straight to a query with `"data": {"sql": "…"}` or
`"data": {"cell": "area-minutes"}` and update as your data changes.

```vega-lite
{
  "mark": {"type": "bar", "cornerRadiusEnd": 3},
  "data": {"values": [
    {"area": "Authoring", "minutes": 22},
    {"area": "Graph", "minutes": 17},
    {"area": "Data", "minutes": 17},
    {"area": "AI", "minutes": 13},
    {"area": "Research", "minutes": 8},
    {"area": "Publishing", "minutes": 5}
  ]},
  "encoding": {
    "x": {"field": "area", "type": "nominal", "sort": "-y", "title": "Area"},
    "y": {"field": "minutes", "type": "quantitative", "title": "Minutes of tutorial"}
  }
}
```

## Tables in prose

You don't need a file. Any Markdown table with a `Table:` caption above it also
becomes queryable (and joins the graph as structured data):

Table: Difficulty Legend

| difficulty | meaning        |
|------------|----------------|
| 1          | gentle         |
| 2          | some new ideas |
| 3          | a real concept |
| 4          | advanced       |

That caption registers a `Difficulty_Legend` table — so a SQL cell could even
join it against `data_lessons`.

---

Next: [[Diagrams and Embeds]] → · back to [[Start Here]]
