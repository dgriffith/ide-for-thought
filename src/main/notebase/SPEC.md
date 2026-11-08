---
id: notebase
type: module-design
status: draft
title: Notebase — file I/O & containment
parent: architecture
depends-on: [graph]
---

## Responsibility

The single, sandboxed file-access layer for a thoughtbase. All reads, writes,
renames, merges, and the filesystem watcher go through `notebase/fs.ts` and the
write pipeline. Saving a note drives the graph indexer, so the save path
(`write-pipeline`, `rename`, `merge`, `watch-handlers`) calls into
[graph](../graph/SPEC.md). Live file sync re-indexes when changes hit disk.

## Boundary

- **Owns:** the filesystem API every other package uses; path-containment
  enforcement (`assertSafePath` in `path-containment.ts`, re-exported here);
  directory listing/filtering (hidden files and `IGNORED_DIRS` filtered, empty
  folders kept); the watcher.
- **Depends on:** `graph` only (one-way `notebase → graph`). `graph` must never
  import `notebase` — this is an enforced architecture invariant.
- **Deliberate exception:** a `notebase ↔ sources` package cycle is accepted and
  documented (dropping a file creates a Source; `merge-sources` uses `fs.ts`).
- **Walkers tolerate hostile trees:** an entry the filesystem refuses (dangling/
  looping symlink, permission-denied, escaping symlink) is skipped and the walk
  continues; only an unreadable **root** throws.
- **Agent-chosen paths** use `assertAgentPath` (not plain `assertSafePath`),
  which additionally refuses `.minerva/`, `.git/`, `node_modules/`, dot-segments,
  and the root itself — see [llm](../llm/SPEC.md).
