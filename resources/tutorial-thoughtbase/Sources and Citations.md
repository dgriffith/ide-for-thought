---
title: Sources and Citations
tags: [tutorial, area/research]
---

# Sources and Citations

Serious thinking leans on sources. Minerva lets you **ingest** a document once,
then **cite** it, pull **excerpts** from it, and render a formatted **citation** —
all wired into the graph so "what have I read about X?" is a query.

## A source you already have

This thoughtbase ships one pre-ingested source: **Madison's Federalist No. 10**
(1787, public domain). Look in the sidebar's **Sources** section — it's there,
with its metadata and body text, exactly as if you'd ingested it yourself.

## Cite it

Point at a source with a `cite::` link. Madison's argument about faction comes
from [[cite::federalist-10]] — that link is a real `thought:cites` edge in the
graph, not just text.

## Excerpt it

An **excerpt** is a verbatim passage anchored to a spot in the source. We've
anchored one for you; embed it with a `quote::` link:

> [[quote::federalist-10-faction]]

Open the source and you'll see that exact sentence highlighted where it lives in
the text. Excerpts are graph objects too, so a claim can point directly at the
words that back it.

## Format a citation

Because the source carries structured metadata (author, title, date, publisher),
Minerva can render a citation in whatever style you like — APA, Chicago, IEEE,
MLA, Vancouver. In APA, this source formats as:

> Madison, J. (1787). *The Federalist No. 10.* The New York Packet.

The Export tools (see [[Export and Publish]]) can drop a formatted bibliography
into any document that cites sources.

## Where this leads

The passage you just quoted is the seed of a full argument — modeled formally in
[[Structured Reasoning]], and mapped informally back in
[[Links That Mean Something]].

---

Next: [[Tools for Thought]] → · back to [[Start Here]]
