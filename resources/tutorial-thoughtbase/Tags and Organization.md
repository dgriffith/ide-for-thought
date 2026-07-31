---
title: Tags and Organization
tags: [tutorial, area/authoring, reference]
---

# Tags and Organization

Two lightweight ways to organize a thoughtbase: **tags** (a flat, cross-cutting
web) and **folders** (a tree). Use both — they answer different questions.

## Tags

Add tags in a note's frontmatter — the `---` block at the very top:

```yaml
---
title: Tags and Organization
tags: [tutorial, area/authoring, reference]
---
```

That's exactly what this note declares. Tags become nodes in the graph, so you
can ask "what else is tagged `reference`?" and get an answer.

### Nested tags

A `/` makes a hierarchy. Several tutorial notes carry an `area/…` tag —
`area/authoring`, `area/graph`, `area/data` — so related lessons cluster without
needing a folder.

### Inline tags

You can also drop a tag mid-prose with a hash, like #worth-remembering, and it's
collected just the same.

## Folders

The left sidebar is an ordinary folder tree. This tutorial keeps its little
argument map in an `arguments/` folder and its data in `data/`. Folders are also
graph nodes — a note "in folder X" is a fact you can query.

> [!tip] Which to reach for
> Reach for a **folder** when something has one obvious home. Reach for a **tag**
> when it belongs to several cross-cutting themes at once.

---

Next: [[The Knowledge Graph]] → · back to [[Start Here]]
