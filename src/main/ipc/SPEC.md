---
id: ipc
type: module-design
status: draft
title: IPC — typed main↔renderer boundary
parent: architecture
---

## Responsibility

The typed boundary between the renderer and main. `ipc.ts` orchestrates per-
domain `register-*.ts` modules; each handler is registered with the typed
`handle()` from `typed-ipc.ts` and the `withRootPath*` helpers from `helpers.ts`.
Adding an invoke channel follows a fixed recipe (channel constant → `ChannelMap`
entry → implementation → registrar → preload → client → regenerated snapshots +
registrar test) documented in `CLAUDE.md`.

## Boundary

- **The `ChannelMap` entry is compile-blocking.** The only `ipcMain.handle` is
  the typed one here, which is `<K extends keyof ChannelMap>`, so a channel with
  no contract entry does not typecheck.
- **Every handler refuses a non-renderer sender** (`sender-guard.ts`): the
  event's `senderFrame` must be the main window's top frame showing the expected
  page. A new `ipcMain.on` listener calls `isTrustedIpcSender` itself.
- **Code-execution sinks ask natively.** A channel that can end in code running
  on the machine goes in `privileged-channels.ts` and confirms via main's native
  dialog, not a renderer confirm (enforced by an architecture test).
- **Error handling is a convention** — handlers throw by default;
  `withRootPath` throws on "no project", `withRootPathOr` returns a legitimate
  empty value; a discriminated `{ ok, … }` union only for expected, non-
  exceptional outcomes; `null` marks exactly one documented absence.
- **The native menu is not a second command surface** — a menu item sends a
  channel, calls a window/lifecycle function, or calls a shared maintenance
  command; it may not `await` work inline (enforced).
