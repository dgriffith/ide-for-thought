# Vision: Cross-Thoughtbase — When the Walls Become Permeable

> **Status: post-launch, and the most speculative doc in the folder.** Unlike the
> others, this one does *not* merely surface capability the substrate already has — 
> it challenges a boundary the whole architecture is currently built on. A
> thoughtbase today is a closed world: one folder, one graph, one namespace,
> self-contained provenance. Making that wall permeable is the easy-sounding request
> ("drag a note between thoughtbases") sitting on top of genuinely hard problems
> (identity, provenance, namespace collision). This doc foregrounds the hard
> problems rather than the drag-and-drop, because the drag-and-drop is the part
> that *isn't* the work. **One pre-launch guardrail** exists (see end); everything
> else is well post-launch and some of it is research.

## The current boundary, stated plainly

A Minerva thoughtbase is presently self-contained: a folder of plain files, one
knowledge graph over them, one namespace for note IDs and wiki-links, and
provenance records that only ever reference entities *inside* that graph. Every
design decision so far assumes this closure. Cross-thoughtbase functionality asks:
what happens when a note, a claim, a source, or an excerpt needs to exist in — or
move between — more than one closed world?

The request has an easy surface and a hard core. The easy surface is the
*interaction*: drag, drop, copy, paste a note from thoughtbase A to thoughtbase B.
The hard core is everything that interaction quietly assumes: that identity
survives the move, that provenance survives the move, that links survive the move,
and that two independently-built namespaces can be reconciled. The surface is a
week of UI; the core is the actual vision.

## The four hard problems (this is the real content)

**1. Identity across worlds.** When note X moves or is referenced from A into B, is
it *the same note* or a *copy*? Minerva's whole value rests on stable identity — a
claim is a first-class node with an ID, and edges point at that ID. Cross-thoughtbase
forces a choice Minerva has never had to make: is there such a thing as a note with
one identity that lives in two graphs, or does crossing a boundary always mint a new
identity with a *derived-from* link back? The RDF substrate actually helps here — 
IRIs can be global — but "the same IRI appears in two graphs" opens synchronization
questions the local-first, no-server architecture has no answer for yet.

**2. Provenance across worlds.** A claim in A carries provenance: who proposed it,
when, from which source, approved by whom. Move it to B and that provenance now
*references entities that don't exist in B's graph* — the source it cited, the
approval event, the agent that proposed it. Does the provenance travel (dragging a
whole subgraph of dependencies behind one note)? Does it flatten to "imported from
thoughtbase A on date D" (losing the chain)? Does it dangle (referencing IRIs B
can't resolve)? This is the problem most likely to be underestimated, because
provenance is exactly the thing Minerva can't afford to handle sloppily — the
product's entire trust story is that provenance is intact and inspectable. A
cross-thoughtbase feature that quietly breaks provenance would corrode the core
value to buy a convenience.

**3. Namespace collision.** Two thoughtbases built independently will reuse titles,
tags, wiki-link targets, and type names. A `[[Methodology]]` note exists in both,
meaning different things. Type `Person` is defined differently in each. Copy across
and links resolve to the wrong target, or types conflict. Any real cross-thoughtbase
capability needs a namespace-reconciliation story: prefix/qualify, prompt the user,
detect-and-merge, or keep worlds separate and only ever *reference* across a
qualified boundary.

**4. The dependency closure of a single note.** In a linked graph, no note is an
island. Drag one claim and it *supports* another claim, *cites* a source, *grounds*
a hypothesis, links to three notes. What comes with it? Just the note (arriving
broken, with dangling edges)? The note plus its immediate neighbors? The full
transitive closure (potentially half the thoughtbase)? This is the graph-theoretic
version of "copy this file" that file-based tools never face and graph-based tools
can't avoid.

None of these has an obvious right answer, and the *set of answers chosen* is
essentially the design of the feature. The interaction (drag/drop/paste) is
downstream of these four decisions, not upstream of them.

## The models being requested (\"inheritance or [con]fusion\")

The prompt named \"thoughtbase inheritance or confusion\" — reading the latter as a
placeholder for some form of *fusion / composition / confederation*. These are
genuinely different relationships between thoughtbases, and picking which one(s) to
support is the top-level fork:

- **Copy / move (transfer).** The simplest: a note leaves A and arrives in B, or is
  duplicated into B. Requires answers to identity (new ID vs preserved), provenance
  (travel vs flatten vs dangle), and dependency closure. No standing relationship
  between A and B afterward. The right *first* target — it validates the plumbing
  without committing to a live relationship.

- **Reference (federation).** A note in B *points at* a note in A without copying — 
  a cross-thoughtbase link, resolved live. Preserves single identity and full
  provenance (because the note stays home), at the cost of B now depending on A
  being available. This is the local-first-friendly version of \"the same thing in
  two places\": reference, don't duplicate — the same reference-not-copy principle
  the Objects and Living-Notes docs already lean on. Strong candidate for the
  *right* long-term model.

- **Inheritance (derivation).** B is built *on top of* A: B inherits A's notes,
  types, or ontology, and adds/overrides. Think \"a shared base thoughtbase of
  domain types and foundational claims, with per-project thoughtbases inheriting
  from it.\" Powerful and genuinely useful (a shared `Person`/`Source` type library;
  a lab's shared canon inherited by each member's working thoughtbase), but it
  imports every hard problem in software inheritance — override semantics, diamond
  problems, what happens when the base changes under a derived child. The RDF
  substrate makes *type* inheritance natural (`rdfs:subClassOf` across graphs); *note*
  inheritance is murkier and should be approached warily.

- **Fusion / merge (composition).** Two thoughtbases combine into one. The
  namespace-collision problem in full force, plus provenance reconciliation across
  two independent histories. The hardest model; likely the *last* to attempt, if
  ever, and possibly better served by \"reference both from a third\" than by true
  merge.

- **Confederation (query-across).** Not moving anything: a *query* that spans
  multiple thoughtbases and returns unified results, each result tagged with its
  home. \"Search all my thoughtbases for X.\" Read-only, so it sidesteps identity and
  provenance-mutation problems entirely — arguably the *safest high-value* feature
  in the whole doc, and a natural companion to Substrate-MCP (an agent querying
  across a user's whole thoughtbase collection, not just one).

## Related functionality this obviously pulls in

Once the boundary is permeable, several adjacent capabilities become natural — some
attractive, some cautionary:

- **A thoughtbase library / switcher.** Cross-thoughtbase anything presumes the user
  *has* several and can see them as a set. A registry of thoughtbases (already
  partially implied by multi-window support) is the substrate for all of this.

- **Shared type / ontology libraries.** The most immediately useful concrete
  payoff, and it connects straight to `objects.md`: a common set of domain types
  (Book, Person, Project) and the `thought:` ontology, defined once and *referenced*
  (not copied) by many thoughtbases. This is inheritance in its most tractable form
  (types, not notes) and might be the single best reason to build any of this.

- **Cross-thoughtbase provenance / attribution.** If a claim in B derives from A,
  the provenance model extends to record *cross-world* lineage — \"this belief came
  from my other thoughtbase, on this date, via this note.\" A natural extension of
  the provenance system, and on-brand precisely because it refuses to let a
  boundary-crossing erase where something came from.

- **Excerpt / source portability.** A source (with its anchored excerpts) is the
  most naturally *shared* object — the same paper cited across many thoughtbases.
  Sources may be the right *first real* cross-thoughtbase citizen: a shared source
  library referenced everywhere, rather than re-imported per thoughtbase. Connects
  to the excerpt-as-first-class-object work in `objects.md`.

- **Publication as the degenerate cross-boundary case.** Note that the Publication
  pillar *already* moves notes across a boundary — from thoughtbase to static site.
  Export is cross-thoughtbase's simplest, already-solved special case (crossing from
  the graph to the outside world, one-way, provenance-flattened). Worth studying
  what export already decided about dependency closure and link resolution before
  re-deciding it here.

- **Agent access across thoughtbases (ties to Substrate-MCP).** Once the MCP server
  exists, \"which thoughtbase(s) can this agent see\" is a cross-thoughtbase scope
  question. Confederation-query and the MCP read scope are the same feature from two
  directions.

## Scope discipline

- **Not sync, not cloud, not multi-user.** Cross-thoughtbase is one user's several
  local thoughtbases relating to each other — not collaboration, not a server, not
  real-time sync between machines. Local-first holds. \"Reference\" models must
  degrade gracefully when a referenced thoughtbase is simply not present on disk.
- **Not provenance-lossy by default.** Any transfer that silently flattens or breaks
  provenance is a violation of the core value, not a convenience. If provenance must
  flatten (e.g. a plain copy), that flattening is itself recorded (\"imported from A,
  provenance chain not carried\") — the user is never misled about what's intact.
- **Not true merge, early.** Fusion/merge is the hardest and least reversible model.
  Prefer reference and confederation (which don't mutate) over copy (which does)
  over inheritance (standing relationship) over merge (irreversible combination).
  Build in that order of safety.
- **Not note-inheritance before type-inheritance.** Shared *type* libraries are
  tractable and high-value; inherited *notes* with override semantics are a
  complexity sink. If inheritance happens, types first, notes maybe never.
- **Not a reason to make a note's identity ambiguous.** Whatever is chosen, a user
  must always be able to tell whether they're looking at *the* note or *a copy of*
  the note. Ambiguous identity would undermine the stable-identity property the
  graph depends on.

## Open decisions

- **The top-level fork: which model(s) first?** Recommendation from the safety
  ordering above: **confederation-query first** (read-only, high-value, sidesteps
  the hard mutation problems), then **shared source/type libraries via reference**
  (the concrete useful payoff), then **copy/move** (validated plumbing), with
  inheritance-of-notes and merge left as \"only if real demand, and warily.\"
- **Identity model.** Global IRIs shared across graphs (powerful, sync-fraught) vs
  always-mint-new-with-derived-from (safe, lossy of \"sameness\"). Likely: references
  preserve identity (note stays home); copies mint new + derivedFrom.
- **Provenance-crossing semantics.** Travel (drag the dependency subgraph) vs
  flatten-with-record vs live-reference. Probably differs per model: references keep
  provenance live; copies flatten *and say so*.
- **Dependency closure on transfer.** Note-only (broken), note+neighbors, or full
  transitive closure? Likely user-choosable with a sane default (note + directly
  cited sources + directly supported/supporting claims), with a preview of \"what
  will come with it.\"
- **Namespace reconciliation.** Qualify-by-thoughtbase (safe, verbose), prompt on
  collision, or detect-and-merge (risky). Qualification is the local-first-friendly
  default.
- **Where the thoughtbase registry lives.** A user-level registry of known
  thoughtbases (needed for switching, referencing, confederation) — same design
  question as the type-registry location in `objects.md`, and probably wants the
  same answer.

## The one pre-launch guardrail

Everything above is post-launch and much of it is research. The only launch-time
concern is again *negative and cheap*, matching the guardrails in the
personalization, versioning, and substrate-MCP docs:

**Don't make note/claim/source identity un-globalizable.** If launch-day IDs are
purely local (a bare integer or a path-relative slug with no room to ever be
qualified or globalized), then any future cross-thoughtbase reference model becomes
a painful retrofit. The cheap insurance is ensuring the identity scheme *could*
carry a thoughtbase-qualifier or resolve to a global IRI later — not building any of
that now, just not choosing an ID format that forecloses it. Given the RDF
substrate, IRIs are probably already global-shaped, in which case this costs
nothing and is merely worth a five-minute confirmation. As with the other
guardrails: this is not building the feature; it is not *precluding* the feature.

## Depends on / enables

- **Depends on**: a thoughtbase registry/switcher (partially implied by multi-window
  support); the RDF/IRI identity scheme (already there — the thing that makes global
  identity *possible*); the provenance system (already there — the thing that must be
  extended, carefully, to cross boundaries); the Publication export path (already
  there — the already-solved degenerate case worth studying first). This is the one
  vision that also depends on *new* architecture, not just surfacing — specifically
  an answer to identity and provenance across graphs.
- **Enables**: shared type/source libraries (referenced, not duplicated) that make
  every thoughtbase lighter and more consistent; cross-thoughtbase confederation
  query (search across everything you know, not one silo) that pairs naturally with
  Substrate-MCP; and a genuine answer to the power user with a dozen thoughtbases who
  currently has a dozen disconnected islands — without sacrificing the local-first,
  provenance-intact, stable-identity properties the rest of Minerva depends on.
