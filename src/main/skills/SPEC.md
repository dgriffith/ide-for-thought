---
id: skills
type: module-design
status: draft
title: Skills — Tools for Thought
parent: architecture
---

## Responsibility

The Learning / Research / Analysis menus are populated by **skills** — markdown
files (YAML frontmatter + a non-executing template body), not hardcoded `.ts`
tools. Owns parsing, cataloging, compiling to `ThinkingToolDef`, and registering
into the shared tool registry consumed by [llm](../llm/SPEC.md).

## Boundary

- **No `.ts` tool registry.** Stock skills live in `skills/stock/*.md` (bundled
  at build time); user skills live in `~/.minerva/skills/` and are additive —
  they can never shadow stock. To change a stock skill, disable it and author
  your own; don't edit bundled files.
- **Instructions go in `system`, thoughtbase material in the first user turn.**
  A template renders two channels; every thoughtbase variable renders wrapped in
  `<thoughtbase-content>` with spoofed tags neutralized. A variable used outside
  a `{{#context}}` block is auto-routed to the user turn — a user skill can't
  leak one into `system`.
- **The renderer never sees prompt bodies** — it gets serializable `SkillInfo`
  via `api.skills.list()` and registers into its own registry copy.
- **Menu config / grouping / source scope** are pure logic in
  `shared/skills/` and `shared/tools/`, applied identically by the native menu,
  the renderer, and Settings.
