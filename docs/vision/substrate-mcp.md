# Vision: Minerva as Substrate — MCP / CLI for the Agent Entourage

> **Status: post-launch.** A categorical repositioning captured while fresh, not a
> build queued for the window. Nothing here is on the critical path to launch. Its
> value is that it reframes what Minerva *is* — and that the reframe turns out to be
> mostly *exposing* capability that already exists rather than building new.
>
> **One pre-launch guardrail** (see *Internal agnosticism* below): the in-product
> conversation layer should not hardcode Claude-specific assumptions so deeply that
> adding a provider later means rewriting the gate. Provider-agnostic-*ready* is a
> cheap launch-time architecture constraint; provider-agnostic-*shipped* is
> post-launch. That guardrail is the only part of this doc that touches the window.

## The inversion

Every other vision doc assumes Minerva is **the place you go**, and the AI *inside*
Minerva is the agent. A user pointed out the assumption is too small.

A serious person in 2026 does not have *an* AI. They have an **entourage**: a
coding agent in the terminal, an agent in the browser, something in the editor, a
task-runner doing multi-step work. Every one of those agents is currently **blind
to the user's thoughtbase** — the checked, sourced, provenance-bearing body of
everything the user knows sits in Minerva, and no other agent in the fleet can
reach it.

That is backwards. The knowledge graph is the single most valuable context object
those agents could have. So the move is not "add an API so other tools can operate
Minerva." It is:

**Minerva becomes the memory and knowledge substrate for a person's entire agent
fleet** — the trusted, human-curated store that every other AI reads from and
proposes to, through one protocol.

This is a categorical promotion: from *an app you use* to *the substrate your other
agents depend on*. The user's one-line comment ("MCP/CLI so other AIs can use it")
is the surface of a much larger idea.

## Why Minerva specifically — the two things that make this safe and cheap

Most tools could not safely expose their store to an arbitrary external agent, and
most would have to build a query layer from scratch. Minerva has already done both,
for other reasons:

- **The approval gate makes external write access *safe*.** An outside agent
  hitting Minerva's MCP server writes through the exact same "propose → human
  confirms" path as everything else. "Let other AIs use my thoughtbase" therefore
  does **not** mean "let other AIs silently mutate my thoughtbase." Proposals from
  a browser agent or a coding agent land in the same review queue, with the same
  provenance recording *which* agent proposed *what* and *when*. This is the
  feature that makes the whole vision responsible rather than reckless — and it
  already exists.
- **SPARQL / SQL over the graph is *already* the read interface.** An MCP server is
  substantially a protocol wrapper over query + propose primitives that already
  exist. The substrate was, in effect, designed for this before it was framed this
  way.

The through-line matches every other vision doc: the foundation is poured; this is
surfacing, not building anew. But this one has the largest leverage-to-effort
ratio, because it re-purposes the two hardest things already built (the gate and
the query layer) into an entirely new product position.

## Capability surface

**Read: query the thoughtbase.** MCP tools (and a CLI equivalent) exposing the
existing query capability — semantic search, full-text, SPARQL, SQL — so any
external agent can ask the user's own knowledge graph a question and get grounded,
cited answers instead of guessing. "What do I already know / believe / have
sourced about X" becomes available to every agent in the fleet.

**Propose: write through the gate.** External agents submit claims, notes, sources,
edits *as proposals* — never direct writes. They land in the same review queue,
carry provenance identifying the external agent, and require the same human
confirmation. The safety property is preserved by construction, not by trusting the
external agent.

**Context handoff.** A structured way for an external agent to pull a relevant
slice of the thoughtbase as context for its own task — the coding agent in the
terminal reads the design notes and decisions the user captured in Minerva; the
browser agent checks what the user already concluded before re-researching.

**CLI parity.** Everything the MCP server exposes, available from the command line
too — scriptable, pipeable, usable in automations and by agents that speak shell
rather than MCP. Fits the keyboard-first, power-user identity, and matches how the
target user already works.

**Provenance for the fleet.** Because every external interaction is
provenance-stamped, the thoughtbase gains a record of *which agent contributed
what* — the user can see that a given claim was proposed by the browser agent from
a page they were reading, or by the coding agent from a repo. The graph becomes the
audit log of the whole entourage's contributions.

## Internal agnosticism: multi-provider conversations

The substrate positioning has an internal mirror the MCP framing surfaces but does
not by itself resolve. Substrate-MCP makes Minerva agnostic about *which external
agents* read from and propose to the thoughtbase. The same principle, turned
inward, is agnosticism about *which model powers the conversation inside Minerva*.

**Why the positioning implies it.** The tagline is "thinking, learning, and
building *with AI*" — not "with Claude." The entourage frame makes Minerva's
built-in assistant simply *the first member of the fleet* (see the "Relationship to
Minerva's own AI" open decision). A Claude-only in-product conversation quietly
contradicts both: the tagline and the substrate story write a check that
single-provider support doesn't cash. If external agents can be anything but the
internal one must be Claude, the agnosticism is only half real.

**The strongest case is robustness, not tidiness.** The positioning argument is
real but secondary. The load-bearing argument is business continuity: a model you
depend on can become unavailable for reasons that have nothing to do with you
(provider outage, policy change, export-control suspension — the June 2026
Fable/Mythos suspension is the concrete example). A tool that holds a person's
life's thinking and can be knocked out of its core AI feature by one provider's
bad week is fragile in a way that matters more for *this* product than for most.
Provider-agnosticism is resilience, not just philosophy.

**The honest cost — why this is "need eventually," not "need at launch."**
Provider-agnostic is an ongoing *tax*, not a one-time feature, and it lands on the
hardest, most differentiated parts of Minerva. The gate, the skills, and the
structured propose path are presumably tuned against one model's behavior. Every
provider differs in tool-calling semantics, structured-output reliability, context
handling, and failure modes. "Support OpenAI and Gemini" does not mean "add two API
clients"; it means "make the gate and skills and structured proposals work
correctly across three models that behave differently, and *keep* them working as
all three keep changing." For a solo maintainer that is a standing maintenance
surface, not a shippable unit of work.

**The resolution is a split, same shape as the versioning and personalization
guardrails:**

- *We need the conversation layer to not foreclose it* — **pre-launch,
  architectural, cheap, real.** Keep a clean provider-abstraction boundary in the
  conversation layer so the gate, skills, and propose path talk to an interface,
  not to Claude-specific assumptions. If the boundary is already clean, this costs
  nothing and preserves the option. If it isn't, the cheap fix is *now*, before two
  more subsystems are built on top of it.
- *We need to actually ship it* — **post-launch, ongoing tax, demand- and
  robustness-driven.** Add providers when the abstraction has proven itself against
  real usage, driven by the resilience argument and genuine user demand rather than
  by positioning alone. Claude-only at launch is fine; "with AI" stays honest
  because the architecture is genuinely provider-shaped underneath even when only
  one provider is wired up.

**Open questions specific to this:** where exactly the provider boundary sits
(below the skills? below the gate? at the raw completion call only?); how much
skill/prompt tuning is provider-specific and whether that tuning is
abstractable or must be maintained per-provider; whether structured-output /
tool-calling differences can be normalized behind the interface or leak through to
the gate; and whether the user chooses a provider globally, per-thoughtbase, or
per-conversation.

## Scope discipline

- **Not unattended write access.** External agents *propose*; they never commit.
  The gate is non-negotiable and is the reason this vision is safe to pursue at all.
  Any design that lets an outside agent write directly has missed the entire point.
- **Not a sync/collaboration server.** This is one user's fleet reading and
  proposing to one user's local thoughtbase — not multi-user, not a hosted backend,
  not a cloud store. Local-first is preserved: the MCP server is a local endpoint
  over the local graph, consistent with the privacy posture.
- **Not a plugin platform.** Exposing query + propose over a protocol is not the
  same as inviting arbitrary third-party code into Minerva's process. Keep the
  surface to the protocol boundary.
- **Not a reason to weaken provenance.** More writers (more agents) makes
  provenance *more* important, not less. Every external contribution is attributed.

## Open decisions

- **MCP server topology.** A local server the user's other agents connect to
  (natural for local-first) — launched by Minerva, or a standalone daemon? Lifecycle
  and discovery need a design.
- **Identity of external agents.** How is "the browser agent" vs "the coding agent"
  distinguished in provenance? Per-client tokens/names, so the audit trail is
  meaningful? Likely yes — the fleet audit log is only useful if agents are
  distinguishable.
- **Granularity of the propose API.** Does an external agent propose a finished note,
  or call the same skill/claim primitives the internal AI uses? Reusing the internal
  propose path is the on-brand answer (one gate, one provenance model, one review
  queue).
- **Read scope / consent.** Does every external agent get the whole graph, or does
  the user grant per-client read scopes? Local-first doesn't automatically mean
  every local agent should see everything. A consent surface may be warranted.
- **CLI vs MCP priority.** CLI is simpler, scriptable, and immediately useful to the
  power user; MCP is the richer agent-native protocol. CLI may be the cheaper first
  ship that validates demand before the full MCP surface.
- **Relationship to Minerva's own AI.** If external agents and the internal AI both
  propose through the same gate, they are peers. Is that the right mental model — 
  Minerva's built-in AI as simply *the first* member of the entourage? Probably, and
  it's a clarifying frame.

## Depends on / enables

- **Depends on**: the approval gate + proposal/provenance system (already there — 
  the thing that makes external writes safe); the SPARQL/SQL/semantic query layer
  (already there — the thing that makes external reads rich); the local-first
  architecture (already there — the thing that keeps the server local). This vision
  is almost entirely *exposure* of existing capability through a new protocol
  boundary.
- **Enables**: the categorical repositioning from app to substrate — Minerva as the
  human-curated memory every other agent in the fleet reads from and proposes to;
  a defensible answer to "why not just let each agent keep its own notes?" (because
  only Minerva has the checked, sourced, gated, provenance-bearing graph); and a
  network-effect-like stickiness — the more of a user's fleet is wired into
  Minerva, the more central Minerva becomes to how they work.
