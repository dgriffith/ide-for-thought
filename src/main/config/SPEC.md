---
id: config
type: module-design
status: draft
title: Config stores
parent: architecture
---

## Responsibility

The shared machinery for reading and writing JSON config, so every store behaves
the same way about missing vs. corrupt files and concurrent writes. Config lives
in three roots (`userData/`, `~/.minerva/`, `<thoughtbase>/.minerva/`),
inventoried in `docs/config-roots.md`.

## Boundary

- **Read through the shared helper** (`config-store.ts`: `loadConfigFile` /
  `loadConfigFileSync`), never a hand-rolled `try { read; JSON.parse } catch
  { defaults }`. Missing file → defaults (silent); corrupt → reported, then
  defaults; per-field coercion through the shared `as*` decoders.
- **Write atomically** (`writeJsonFileAtomic` in `json-file.ts`: temp file +
  rename), never a raw `writeFile` of `JSON.stringify`.
- **Read-modify-write reads *strictly*** (`loadConfigFileStrict` — throws on a
  corrupt file so the mutation rejects and the file is left byte-identical), and
  an async one takes the per-path file lock (`withFileLock`).
- **`.minerva/config.json`** is read through a stat-validated memo; a new writer
  owes an invalidation, and the lenient (memoized) reader differs deliberately
  from the strict, uncached `readRawProjectConfig`.
- The hand-rolled exceptions (e.g. secret-bearing or must-throw stores) are
  enumerated in `CLAUDE.md`; an architecture test ratchets the list.
