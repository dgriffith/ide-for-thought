---
id: minerva
type: goal-and-requirements
status: draft
title: Minerva — Goal & Requirements
---

## Goal

Minerva is a local-first desktop workspace for thinking and building with AI.
The best thinking people do with an AI usually vanishes into throwaway chat
threads — unsourced, unstructured, impossible to build on. Minerva is where that
work lands and stays: a **thoughtbase** of linked markdown notes, backed by an
automatically maintained RDF knowledge graph, that you and an AI grow together —
with you in control of everything that lands.

The codebase repo is named `miranda`; the product is **Minerva**.

## Problem

- AI-assisted thinking is ephemeral and unstructured — knowledge is not
  retained, connected, or checkable.
- General note tools don't model the *shape* of reasoning (claims, grounds,
  warrants) or carry provenance for what an AI contributed.
- Tools that add AI usually let it write directly, so the human loses the
  authority over their own knowledge base.

## Audience

Deliberately broad, with two usage profiles supported **equally**:

- **Research-leaning, heavy AI usage** — researchers, analysts, and writers
  doing sourced, structured work who want citations, anchored excerpts,
  argument modeling, and a queryable graph.
- **General note-taking, light AI usage** — people who mainly write and link
  notes by hand and reach for the AI occasionally.

Neither profile is primary; the product must stay useful and out of the way for
both.

## Capabilities

What the product does today:

- **Thoughtbases of linked notes** — plain markdown files on disk, with
  `[[wiki-links]]` and 12 typed semantic links (supports, rebuts, depends-on,
  supersedes, …).
- **A live editor** — CodeMirror 6 with source / preview / split modes;
  callouts, tables, footnotes, math (KaTeX), and diagrams inline.
- **An automatic knowledge graph** — titles, tags, links, frontmatter, embedded
  Turtle, and markdown tables are read into an RDF graph on every save, queryable
  by SPARQL (and by SQL over CSV-derived DuckDB tables).
- **Runnable code cells** — Python, SQL, SPARQL, and Vega/Vega-Lite render live
  against the user's own data via a `minerva.*` API.
- **Sources & citations** — import PDFs (with OCR), DOI/ISBN/arXiv, BibTeX, and
  Zotero RDF; a web clipper; anchored excerpts; CSL citation styles.
- **Structured reasoning** — a thought ontology models claims, grounds,
  warrants, questions, hypotheses, and epistemic defects, with PROV-O
  provenance.
- **Tools for Thought (skills)** — markdown-authored prompt operations in the
  Learning / Research / Analysis menus; users can add their own.
- **AI as a proposer** — every AI-originated change arrives as a reviewable
  proposal the user approves or rejects.
- **On-device search** — semantic (embeddings) plus full-text, run locally.
- **Export & publish** — Markdown, HTML, PDF, static site, Anki, BibTeX,
  Pandoc, and RDF/Turtle; opt-in Git publishing.
- **Extensibility** — a ladder of extension points (settings → skills → object
  types → query views → plugins → MCP → sources), plus an MCP server (`minerva`
  CLI) exposing the thoughtbase to external agents.

## Principles

- **The Trust Principle** — the AI proposes, the human confirms. No AI-originated
  write ever reaches the knowledge graph without going through the approval
  engine; this is the single most important design decision in the system and is
  enforced, not merely observed.
- **Local-first and private** — notes are plain files the user owns; voice,
  embeddings, and search run on-device.
- **A professional tool that stays out of the way** — keyboard-first, no danger
  styling, no hand-holding, minimal interstitials; every confirmation is
  suppressible.
- **Untrusted by default** — everything a thoughtbase carries (notes, config,
  sources, embedded code) is treated as someone else's input at every
  privileged sink.

## Non-goals

Excluded by decision:

- **No cloud, no account** — Minerva is local-first; there is no sign-up and no
  hosted sync service.
- **Thoughtbases are not version-controlled by Git** — Git is an opt-in
  *publish* target only; thoughtbases are not automatically committed.

_Note: cross-platform parity is **open**, not a non-goal — macOS on Apple
Silicon is simply the only platform shipped today; Windows/Linux are tracked,
not forbidden._
