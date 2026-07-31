---
title: Writing Notes
tags: [tutorial, area/authoring]
---

# Writing Notes

Notes are plain **Markdown**, so everything you already know works: `**bold**`,
`*italic*`, lists, `> quotes`, `code`, headings, tables, and images. Minerva adds
a few things worth knowing on your first day.

## Three ways to look at a note

Minerva has three view modes — **Edit**, **Preview**, and a split **Live** view.
Toggle them from the toolbar (or the View menu). This note reads best in Preview,
where the callouts, math, and highlights below actually render.

## Callouts

Callouts are blockquotes whose first line is a `[!type]` marker. They're great
for asides, warnings, and definitions:

> [!note]
> A plain note. Use it for a neutral aside.

> [!warning] Watch out
> Warnings take an optional custom title, like this one.

> [!tip]- Collapsed by default
> Add `-` to start collapsed, or `+` to start expanded. Click the title to toggle.

## Highlights and emphasis

You can ==highlight text== inline, and even pick a color, like
==yellow:this flagged phrase== or ==green:this confirmed one==.

## Math

Inline math renders with KaTeX: the cost of a balanced-tree lookup is $O(\log n)$.
Block math gets its own line:

$$
E = mc^2
$$

## Footnotes

Claims can carry footnotes[^madison], which collect at the bottom of the note.

## Flashcards

A `card` callout becomes a reviewable flashcard, split front/back by `---`:

> [!card] Minerva Basics
> How many view modes does a Minerva note have?
> ---
> Three — Edit, Preview, and a split Live view.

---

Next: [[Links That Mean Something]] — the feature that turns notes into a graph. →

Related: [[Tags and Organization]] · back to [[Start Here]]

[^madison]: Footnotes are standard Markdown: a `[^id]` reference and a matching
    `[^id]:` definition anywhere in the note.
