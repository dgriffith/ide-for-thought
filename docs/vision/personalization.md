# Vision: Personalization — Level as Visible State, Not a Hidden Profile

> **Status: post-launch.** Not a launch-window feature, and not even an urgent
> post-launch one — it is a *reframe captured while fresh*, not a build queued up.
> The value of this doc is the design stance it records, so that if personalization
> is ever built, it is built the Minerva way and not the tutor way. Nothing here is
> on the critical path to launch.

## Position

The learning-oriented tools in the category (Heptabase's "AI Tutor" foremost)
personalize by *modeling the student*: the system infers the user's level from
conversation and silently adjusts what it says. Minerva already has the raw
capability that personalization is usually built to deliver — "Explain Like I'm…"
takes a level as a parameter, and the onboarding wizard already elicits the
intended user level for a thoughtbase. So the real question is **not** "should
Minerva add personalization." It is: *should the user's level become persistent,
ambient state that skills read by default, and if so, in what form?*

The answer this doc argues for: **yes, but as visible, inspectable, editable state
— never as a hidden profile the system owns.**

## The hazard this vision exists to prevent

A stored "user level: intermediate" is a **profile**: persistent, system-held
state that silently reshapes output. That is precisely the kind of invisible,
unprovenanced, system-owned state that the rest of Minerva is architected
*against*. The whole trust story is *the AI proposes, you confirm; nothing is
unprovenanced; you can prove nothing skipped approval.* A hidden difficulty dial
that reshapes every explanation without ever appearing in the graph is the
philosophical opposite of that.

Heptabase can do ambient personalization cheaply *because* it lacks these
commitments — a tutor models its student, nobody expects provenance. Minerva
importing a tutor's data model would be importing a data model built on the
opposite premise from its own. So the constraint is firm: **if level exists as
state, it is a thing the user can see, edit, and understand the effect of — not a
model of the user held behind the glass.**

## The differentiator (what the substrate makes possible that a tutor can't)

Personalization on a knowledge graph can be *grounded in evidence* rather than
*inferred from behaviour*:

- **A tutor guesses your level from conversation. Minerva can read it from what
  you've written.** If the graph holds forty well-linked claims on RDF semantics
  and three orphaned notes on category theory, the thoughtbase already contains
  evidence that the user is advanced on the former and a beginner on the latter.
- **Level is therefore per-topic, not one global dial.** "Explain this at my
  level" becomes a *query over what I've actually written* about the neighbouring
  topics — inspectable, defensible, and different per region of the graph.
- **The evidence is auditable.** Because the "level signal" derives from graph
  structure the user can see, the personalization is explainable in a way an
  opaque profile never is: *you get this framing because your notes here are
  sparse; you get that one because they're dense and cross-linked.*

This is the same pattern as the Objects vision: the mechanism a competitor uses is
available to Minerva, but Minerva's substrate lets it be done *transparently and
grounded*, which is the actual differentiator — not the feature, the honesty of
the feature.

## Capability surface (ascending ambition)

**1. Level as visible per-thoughtbase context (the cheap MVP).** The onboarding
wizard already elicits intended level; make it a *visible, editable setting*
("this thoughtbase is pitched at: intermediate") that Learning skills read as
their default. The user can see it, change it, and observe that changing it
changed the output. No hidden state — a labelled knob, not an inferred profile.
Almost free; rides existing wizard + skill-parameter machinery.

**2. Level as per-topic, graph-derived signal (the differentiated version).**
Derive an approximate per-topic level from graph density/connectedness around the
relevant nodes, and let "at my level" resolve against it. This is the version only
Minerva can ship, because only Minerva has the evidence base. Requires a defined,
inspectable heuristic (see open decisions) so it never becomes the opaque thing
this doc exists to prevent.

**3. Level as an explicit, editable graph citizen (the fully on-brand version).**
The user's self-described competence per area is itself a set of notes/claims in
the thoughtbase — first-class, editable, provenance-bearing — that skills consult.
Personalization state becomes *part of the thinking*, not metadata about the
thinker. Highest fidelity to Minerva's principles; most work; clearly post-MVP.

## The hard constraint: framing, never withholding

Adapting to a level must adjust the **entry point and framing** of an
explanation, and must **never remove the option to go deeper.** This is
load-bearing and follows directly from the product's stated identity ("no
hand-holding," a tool for building *superhuman* thinkers):

- Meeting a genuine beginner at a beginner's door is not dumbing down — it is the
  difference between a hard book with a good first chapter and a hard book that
  opens mid-proof.
- But a dial whose job is to *simplify* is dangerous in a tool whose job is to
  *elevate*. The advanced substance must always stay reachable; the level changes
  where you *start*, not how high you can *climb*.
- **Design principle:** personalization adjusts framing and entry point;
  it never gatekeeps depth. If a level setting ever makes deeper material
  *unavailable* rather than merely *not-the-default-entry-point*, it has crossed
  the line and violated the product's reason for existing.

## Scope discipline

- **Not a user profile.** No inferred, system-owned model of the user held outside
  the graph. If level is state, it is visible and editable state.
- **Not a simplifier.** Personalization never removes depth or the path to it.
  Framing only.
- **Not parental controls / content restriction.** Deliberately out of scope. See
  the education note below — this is a *filed open question*, not a feature and
  not a permanent refusal.
- **Not a hidden difficulty dial.** The effect of the level setting must be
  observable and reversible by the user. No silent reshaping.

## The education question (filed, not answered)

Minerva today declines to model or restrict its user, and that is the right stance
for a launch aimed at self-directed adults. Two distinct things are worth keeping
*separate* rather than fused:

- **An aesthetic:** Minerva is a tool for sovereign minds; controls-that-restrict
  feel wrong in it. Legitimate design identity, worth holding.
- **A fact about education products:** the moment a real minor uses this in a real
  classroom, "no guardrails whatsoever" stops being principled minimalism and
  becomes a liability someone has to own.

These don't need resolving now. The honest, non-foreclosing stance: *Minerva today
declines to model or restrict its user; if it ever enters education proper, that is
a real decision to revisit — not a betrayed principle.* Recorded here so a future
"should we add guardrails / age-appropriate levels?" is met with an open question
rather than a reflexive never, and so that today's correct minimalism isn't
mistaken later for a permanent architectural commitment.

## Open decisions

- **Global vs per-topic vs graph-derived — which MVP?** (1) is nearly free and
  low-risk and is the obvious first ship. (2) is the differentiator but needs a
  trustworthy, inspectable heuristic. Likely: ship (1), design (2) deliberately,
  treat (3) as a research direction.
- **What is the graph-derived level heuristic, concretely?** Node count in a
  topic neighbourhood? Link density? Presence of claims-with-grounds vs orphan
  notes? Whatever it is, it must be *explainable to the user in one sentence*, or
  it becomes the opaque profile this doc rejects.
- **Where does an explicit level setting live?** A thoughtbase config entry
  (simple) vs a note/claim in the graph (on-brand, consistent with "level as
  editable graph citizen"). The saved-query / settings precedents both exist.
- **Do skills read level implicitly or is it always an explicit invocation?**
  Implicit-default is more convenient and more tutor-like (and more dangerous);
  explicit-per-invocation is more transparent and more Minerva-like. Possibly:
  implicit default *with the current level always visible in the skill's UI*, so
  convenience doesn't cost transparency.
- **Interaction with the approval gate.** If a skill's output is shaped by level,
  does the proposal show *that* it was leveled and to what? Leaning yes — the
  provenance of a leveled explanation should record the level, keeping
  personalization inside the same "everything is inspectable" guarantee.

## Depends on / enables

- **Depends on**: the existing "Explain Like I'm…" leveled-skill machinery
  (already there); the onboarding wizard's level elicitation (already there); the
  knowledge graph + `rdf:type` indexing (already there, for the graph-derived
  version). As with Objects, the groundwork is laid — this is surfacing and
  disciplining an existing capability, not building a new subsystem.
- **Enables**: a real answer to "does Minerva personalize like the AI tutors?" —
  *yes, but grounded in what you've written and visible to you, not inferred and
  hidden* — which is a stronger and more honest story than the tutors can tell;
  and a second front (alongside Objects' type-picker) on the white-rectangle
  problem, since a level-aware onboarding can meet a genuine beginner where they
  are without ever capping where they can go.
