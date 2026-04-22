---
title: "Architecture Overview"
description: "System architecture for the project"
created: "2025-06-15T10:00:00Z"
status: draft
---

# Architecture

The system #architecture uses a layered approach.

This [[supports::notes/design-patterns]] and [[expands::research/overview]].
It also [[references::research/papers/lambda-calculus|Lambda Calculus paper]].

## Components

[[cite::arxiv-2604.18522]]
The core #component layer handles data flow.

```turtle
this: minerva:meta-complexity "high" .
this: minerva:meta-priority "1" .

@prefix arch: <https://minerva.dev/ontology#architecture/> .
arch:LayeredPattern rdf:type minerva:Concept .
arch:LayeredPattern dc:description "Separates concerns into distinct layers" .
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| UI | Svelte 5 | Reactive rendering |
| Editor | CodeMirror 6 | Text editing |
| Graph | RDFLib + N3 | Knowledge representation |
| Query | Comunica | SPARQL execution |
| Storage | Git | Version control |

```python
# This [[fake-link]] inside a code block should be ignored
x = "[[also-not-a-link]]"
```
