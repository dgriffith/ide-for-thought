---
id: renderer
type: module-design
status: draft
title: Renderer — Svelte 5 UI
parent: architecture
---

## Responsibility

The Svelte 5 (runes) UI. Components render the editor, sidebar, panels, dialogs,
and conversation surfaces; state lives in singleton stores under
`lib/stores/*.svelte.ts` (`notebase`, `editor`, conversations, settings, …) and
App-ops modules under `lib/app/`. `App.svelte` is the composition root.

## Boundary

- **The data-flow rule.** Components may call `api.*` directly **only** for reads
  and stateless OS side-effects (`shell.*`, native pickers, `view.*`, `export.
  csv`). **Every state mutation and every main→renderer event subscription routes
  through a store or an App-ops handler** — the store owns the `api` call and the
  observable state; the component calls the store method. Enforced by a
  `no-restricted-syntax` eslint rule plus `tests/renderer/dataflow-rule-
  coverage` (fails closed) and `tests/architecture/store-ownership`.
- **A new module that owns a mutation goes in `stores/` or `lib/app/`** — scope
  is responsibility, not file location; anywhere else, lint rejects the `api.*`
  call.
- **Reduce prop drilling by reading stores directly**; group genuine App-level
  orchestration callbacks into a typed ops bag rather than N props.
- **Uses Svelte 5 runes only** (`$state`/`$derived`/`$effect`/`$props`) — no
  `export let`, `$:`, `on:click`, or event modifiers.
- **Dialogs** come from the dialogs store (`showPrompt`/`showConfirm`); a confirm
  that guards code execution is asked by **main** natively instead.
- Uses the typed `api` surface from [ipc](../main/ipc/SPEC.md) via
  [preload](../preload) — see architecture.
