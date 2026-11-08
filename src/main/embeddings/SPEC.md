---
id: search
type: module-design
status: draft
title: Search & embeddings
parent: architecture
depends-on: [notebase]
---

## Responsibility

On-device discovery over a thoughtbase: full-text search plus semantic search
via on-device embeddings (`onnxruntime-web`). Covers `embeddings/` (the model,
vector index, and semantic query) and `search/` (full-text index). All of it
runs locally — no network, no cloud (a product principle).

## Boundary

- **Depends on** [notebase](../notebase/SPEC.md) to read note content and on the
  watcher to stay current; indexes are rebuilt incrementally on change.
- **Per-project state** (indexes, debounced persist timers) goes in a
  `createProjectStore` slot; a debounced-persist store exposes a narrow test-only
  escape hatch to cancel pending timers.
- **Precomputed artefacts key on content, not mtimes** — the help-docs corpus is
  embedded once and its rebuild check is a content hash (filenames + contents +
  model identity), matched by the CI cache key.
