---
title: The Knowledge Graph
tags: [tutorial, area/graph]
---

# The Knowledge Graph

Here's the payoff. As you write, Minerva reads your notes into an **RDF knowledge
graph** — a big set of factual triples like *(this note) → (has tag) → (tutorial)*.
It indexes titles, tags, wiki-links and **typed links**, tables, embedded
structure, and sources. Then you can query it with **SPARQL**.

## A live query

The cell below finds every `supports` edge in this thoughtbase — the exact typed
links you met in [[Links That Mean Something]]. It ships with its result already
shown, so you can read it now; press **Run** to execute it live against your copy.

```sparql {id=graph-supports}
PREFIX tut: <https://project.minerva.dev/minerva/tutorial/>
SELECT ?fromTitle ?toTitle WHERE {
  ?from minerva:supports ?to .
  ?from dc:title ?fromTitle .
  ?to   dc:title ?toTitle .
}
ORDER BY ?fromTitle
```
```output
{"type":"table","columns":["fromTitle","toTitle"],"rows":[["Variety of interests","Large republics control faction"]]}
```

That one row *is* your argument, recovered from prose. Now try editing it: change
`minerva:supports` to `minerva:rebuts` and Run again to surface the objection
instead. Or list every note:

```sparql {id=graph-notes}
SELECT ?title WHERE { ?note a minerva:Note ; dc:title ?title } ORDER BY ?title
```
```output
{"type":"table","columns":["title"],"rows":[["Data and Tables"],["Diagrams and Embeds"],["Links That Mean Something"],["Start Here"],["Tags and Organization"],["The Knowledge Graph"],["Writing Notes"],["…and the rest"]]}
```

> [!note] Prefixes are free
> Standard prefixes — `minerva:`, `thought:`, `dc:`, `rdf:`, `rdfs:`, `xsd:`,
> `csvw:`, `prov:` — are injected automatically, so you rarely declare them. The
> `tut:` prefix above points at *this* thoughtbase's own namespace, handy when you
> want to name a specific note or tag by IRI.

The graph is rebuilt from your notes whenever they change (and on demand via the
**Query** menu), so it never drifts from what you wrote.

---

Next: [[Data and Tables]] → · back to [[Start Here]]
