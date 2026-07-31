---
title: Running Code
tags: [tutorial, area/data, advanced]
---

# Running Code *(advanced)*

Minerva can run **Python** right inside a note, for when a query isn't enough and
you need real computation. This is powerful, so it's gated carefully — read this
lesson before you run anything.

> [!warning] This runs code on your machine
> Unlike SQL and SPARQL (which are read-only queries over your own data), a Python
> cell executes a real program locally. Minerva therefore asks for your consent
> **the first time** it sees a particular cell — consent is per-cell and per-machine,
> so nothing bundled can run behind your back. The cell below ships with its output
> already shown, so this lesson reads correctly whether or not you ever run it.

## A pre-rendered cell

This cell is self-contained — no files, no network — and computes each lesson
area's share of the tutorial. Press **Run** and approve the prompt to execute it;
or just read the baked result below.

```python {id=py-share}
# Runs locally, sandboxed, and only after you approve it.
areas = {"Authoring": 22, "Graph": 17, "Data": 17, "AI": 13, "Research": 8, "Publishing": 5}
total = sum(areas.values())
[{"area": a, "minutes": m, "share": round(m / total, 2)} for a, m in areas.items()]
```
```output
{"type":"table","columns":["area","minutes","share"],"rows":[["Authoring",22,0.27],["Graph",17,0.21],["Data",17,0.21],["AI",13,0.16],["Research",8,0.1],["Publishing",5,0.06]]}
```

## When to reach for Python

SQL and SPARQL cover most questions about your data and graph. Reach for Python
when you need something they can't express — a statistical model, a custom parse,
a transformation — and you're comfortable running the code. The consent gate keeps
you in control either way.

That's the whole tour. Nicely done — head back to [[Start Here]] and start making
this thoughtbase your own. 🎉
