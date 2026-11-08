---
id: compute
type: module-design
status: draft
title: Compute — runnable code cells
parent: architecture
depends-on: [notebase]
---

## Responsibility

Executes the runnable code cells embedded in notes — Python (notebook-style, via
a `minerva.*` API), and the registration surface for in-note SQL/SPARQL/Vega.
The Python kernel runs arbitrary code with the user's privileges, so this module
owns the defense-in-depth around it: eyes-on-code consent, a real consent
boundary in main (asked natively, never a renderer confirm), network-off-by-
default, an execution audit log, and a static red-flag scan.

## Boundary

- **Consent is a main-side, native gate.** A new interpreter or any code-
  execution path is confirmed by main with `confirmNative`; the renderer can't
  draw or answer it.
- **Python is a core plugin, off by default** on a new install (a machine with
  prior Python settings or recorded consent keeps it on). Off means not wired up:
  the `compute:*Python*` channels don't exist, drafts are refused, and the
  preview renders Python fences as plain code.
- **OS sandboxing** (network + filesystem containment) is recorded in
  [adr-compute-sandbox](../../../docs/architecture/compute-sandbox.md).
- **Writes are proposals.** Saving a cell's output and any AI-originated compute
  draft route through the approval engine ([llm](../llm/SPEC.md)), not direct
  graph writes.
