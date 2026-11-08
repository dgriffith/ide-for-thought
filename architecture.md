---
id: architecture
type: architecture-design
status: draft
title: Minerva — Architecture
parent: minerva
---

## Overview

Minerva is a three-process Electron app with strict context isolation, plus a
CLI/MCP entry point that reuses the main-process libraries headlessly. The
authoritative conventions for this codebase live in `CLAUDE.md`; this spec
captures the topology and the invariants, and the module specs below own each
boundary's detail.

## Topology

- **Main** (`src/main/`) — the Node.js process. Owns all file I/O, graph
  indexing, LLM/approval, compute, sources, search/embeddings, publishing,
  plugins, MCP, menus, and window management.
- **Preload** (`src/preload/`) — a thin, context-isolated bridge. Exposes the
  main process to the renderer as `window.api` via `contextBridge`; holds no
  business logic.
- **Renderer** (`src/renderer/`) — the Svelte 5 (runes) UI. State lives in
  singleton stores; components read stores and route mutations through them. See
  [renderer](src/renderer/SPEC.md).
- **CLI / MCP** (`src/cli/`) — the `minerva` command and its MCP server, which
  expose a thoughtbase to external agents by reusing main-process libraries. See
  [cli](src/cli/SPEC.md).
- **Shared** (`src/shared/`) — types, IPC channel constants, the `ChannelMap`
  contract, and pure logic usable from any process. Lint-enforced **pure**: no
  Node builtins.

## IPC contract

Renderer↔main communication is a typed contract, not ad-hoc channels:

- Channel string constants in `src/shared/channels.ts`; the renderer-facing
  signature for every invoke channel in `src/shared/ipc-contract.ts`
  (`ChannelMap`) — compile-blocking, since the only `ipcMain.handle` is the
  typed one in `ipc/typed-ipc.ts`.
- Handlers are registered per-domain under `src/main/ipc/`; the renderer surface
  is exposed in `src/preload/preload.ts` and typed in
  `src/renderer/lib/ipc/client.ts`. See [ipc](src/main/ipc/SPEC.md).
- **Every handler refuses a non-renderer sender** (sender guard), and any IPC
  that can end in code execution asks the user with a **native** dialog, not a
  renderer-drawn confirm. The window/protocol/CSP/IPC origin rules are the
  [electron origin model](docs/electron-origin-model.md).

## Dependency edges & invariants

The module graph is deliberately shaped, and several edges are enforced by
architecture tests (`tests/architecture/`, inventoried in
`docs/architecture-ratchets.md`):

- **`notebase` → `graph`** is one-way: saving a note drives the indexer.
  **`graph` never imports `notebase`**, and the rdflib store stays inside
  `graph/`. See [graph](src/main/graph/SPEC.md).
- **No two-way package cycles** between `src/main/<package>`s (ratcheted;
  `notebase ↔ sources` is a deliberate, documented exception).
- **The renderer data-flow rule** — components may call `api.*` only for reads
  and stateless OS side-effects; every mutation and every event subscription
  routes through a store or App-ops module. See [renderer](src/renderer/SPEC.md).
- **The Trust Principle / write guard** — all LLM-originated graph writes go
  through the approval engine; a write-guard chokepoint in `graph/state.ts`
  trips (fatally, under test) on any bypass. See [llm](src/main/llm/SPEC.md).
- **`src/shared` is pure** — no Node builtins; leaf utilities shared across
  packages live there.
- **Agent-chosen paths are gated** out of `.minerva/`, `.git/`, `node_modules/`
  and dot-segments (`path-containment.ts`), separate from the general
  path-traversal guard (`assertSafePath`).
- **Startup paints before it blocks** — nothing is awaited in front of window
  creation; the window is built hidden and shown on first paint.

## Packaging & security posture

The app ships as an integrity-checked `app.asar` with Electron fuses set
(`RunAsNode`/`NODE_OPTIONS`/`--inspect` off), served from the privileged
`app://minerva` scheme under CSP `'self'`. Signing/notarization is opt-in via
`MINERVA_RELEASE=1`. Build, fuse, and release-gate details are in `CLAUDE.md`
and `docs/`.
