---
id: llm
type: module-design
status: draft
title: LLM — approval engine, conversations & tools
parent: architecture
depends-on: [graph, notebase]
---

## Responsibility

Everything AI-originated, under the **Trust Principle**: the LLM proposes, the
human confirms. Owns the approval engine (`approval.ts`), conversations, the
tool-calling loop, and the prompt-injection gating around the tool surface.

## Boundary

- **One tier: everything is proposed.** Every LLM-originated write is filed as a
  pending `thought:Proposal` and applied only on user approval — there is no
  lower-trust tier. `operationType` is descriptive UI metadata, not a trust
  level. Even "quiet" paths (auto-tag) file a normal proposal and self-approve
  only after the user accepted on the card.
- **The approval engine is the only write path.** The LLM never writes the graph
  directly; approved writes run in trusted context (`enterTrustedContext`) and
  any new LLM-originated apply path wraps itself in `withLLMContext` so the
  [graph](../graph/SPEC.md) write guard catches a bypass. An executable
  integrity query (`findUnreviewedLLMWrites`) proves the invariant on every PR.
- **The tool surface is gated, the model is not.** Each tool registers with a
  class (read / propose / external / skill / interactive) and a `pathGuard` if
  any parameter names a path; path args route through `agentPathRefusal`
  (no `.minerva/`, etc.). `queryGraph` is read-only; `query_sql` / note-embedded
  SQL run through an allowlist guard; `mcp_call` reaches only advertised tools
  and a non-`readOnlyHint` tool waits for the user.
- **Skill context is user-turn data, never system prompt** — thoughtbase
  material is wrapped in `<thoughtbase-content>` with delimiters neutralized by
  escaping (not a nonce).
- **Depends on** `graph` (proposals mutate it) and `notebase` (reads notes).
  [Skills](../skills/SPEC.md) register the Tools-for-Thought tools consumed here.
