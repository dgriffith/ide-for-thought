# Vision: Living Notes — The Category

> **Status: post-launch** (with one narrow exception, noted below). This is the
> positioning spine that ties the other vision docs together, plus the capability
> arc that earns the name. The arc is post-launch work; the *category claim* is a
> launch asset available now because a user already demonstrated it.
>
> **Pre-launch exception:** none of the *building* here is pre-launch. The only
> related pre-launch item is help/docs-to-LLM (see `## Pre-launch: help, not
> features`), which is a bug fix, not part of this arc.

## The category

Minerva's users can't agree on what it is, and all of them are right. Some see
"Obsidian with extras." Some see "Claude, but permanent." Some are building
Python / SQL / Vega-Lite artifacts *into their notebase* by asking the LLM to
write notes that compute. These look like three products. They are one primitive
seen from three angles:

**A note that is durable, linked, AI-augmentable, and alive.**

That primitive is the category, and its name is **living notes**. The three user
tribes each independently discovered a different facet of the same thing — linking
(Obsidian-plus), persistent AI content ("Claude but permanent"), and executable
structure (the Vega-app builder). The executable-notes user took the "IDE for
thought" framing literally and proved it was more right than intended.

### Why "living" is the right word

- **It names an enemy.** The received wisdom is *"wikis are where knowledge goes to
  die"* — inert text, linkrot, stale pages nobody maintains. "Living notes" picks
  that fight directly. A category with a named enemy is a category people remember.
- **It's the one property all three user tribes found on their own.** Obsidian's
  notes are inert text with links. Claude's outputs are alive but disposable.
  Notion's blocks are structured but not yours and not local. Minerva's notes are
  live, structured, executable, *and* permanent files you own — and no single
  competitor is all four at once. Living notes is the corner none of them occupy.
- **It implies real-but-unspecified capability.** "Living" promises motion,
  interactivity, growth — and then the capability arc below delivers on it, rather
  than the word overselling a static tool.

### Positioning lines to test

- *"Minerva: the first workspace where your notes are alive — you and the AI build
  structures you can query, compute, and keep."*
- *"Living notes. Everything a wiki was supposed to be before wikis went stale."*
- Category noun: **living notes** / **a living-notes workspace**.
- Retain "IDE for thought" as the evocative tagline; "living notes" is the
  category, "the AI proposes, you decide" is the trust claim. Three slots, three
  phrases — don't make one word carry all three jobs.

## The capability arc (what earns the name)

Ordered as the user's own progression suggests — from making notes *interactive*
to making them *executable* to making them *typed objects*, converging with the
Objects vision.

**1. Forms.** The first step past inert text: a note can contain input controls —
fields, selects, checkboxes, sliders — that write structured values back into the
note / graph. This is the seed of "interactive," and the natural bridge to the
typed-property editing in `objects.md` (a form *is* the non-YAML property editor
that vision requires). Forms are where "living" starts being literally true.

**2. Richer interactive preview panels.** Today's preview renders. Tomorrow's
preview *responds* — computed cells that recalc, controls that drive
visualizations, panels that react to input without leaving the note. The Compute
pillar (Python / SQL / Vega-Lite) already renders live against data; this makes
the rendered output *interactive* rather than static, closing the gap the Vega-app
user is currently working around. "Our functionality for that isn't great but can
be made to work" — this is the work that makes it good.

**3. Publication bells-and-whistles.** The Publication pillar already exports
browsable static sites (see the published Fleetwood Mac thoughtbase). "Living"
raises the ceiling: interactive published artifacts, richer layout control,
embeds, better read-only/mobile presentation — publishing a living note as a
living page, not a flattened snapshot. Extends `publication.md` rather than
replacing it.

**4. Convergence with Objects (Capacities-like functionality).** The arc merges
into `objects.md`: once notes carry forms, interactive computation, and typed
properties, "note type" + "type-keyed affordances" is the organizing layer over
all of it. Forms feed typed properties; typed properties feed multi-view browsing;
interactive previews render per type. Living Notes and Objects are the same
destination reached from two directions — Objects from the *data model*, Living
Notes from the *interactivity*. This doc and `objects.md` should be read as a pair.

## The single-user-Notion observation (and its trap)

The honest read: forms + interactive preview + typed objects lands Minerva much
closer to **single-user Notion** than originally intended, and implies a long
feature list. Two things must stay clear about that:

- **The list is a post-launch roadmap, not a launch scope.** It is the best
  roadmap the project has found — because it is *pulled by demonstrated user
  behavior* rather than pushed by competitive analysis. That makes it more
  trustworthy than a feature list derived from "what does Notion have." Build it in
  daylight after go-live.
- **You do not need to build it to claim the category.** A user is *already*
  building Vega apps into their notebase on today's imperfect functionality. That
  is an existence proof — a demo, a screenshot, a story — not a gap to close before
  launch. For go-live, the executable-note behavior is something to *show a user
  doing*, which is a stronger asset than three more block types. Let the user tell
  the story; ship the thing that made them build it.

## Pre-launch: help, not features

The one adjacent item that *is* pre-launch, and is a bug fix rather than part of
this arc: **expose Minerva's docs to the LLM.**

Signal from users is strong that they already ask the assistant "how do I do X in
Minerva," and get occasionally-odd answers — because the model is guessing from
training data about a product it has never seen. That is confidently-wrong help on
first run, which is exactly the impression that makes a new user conclude the tool
is half-baked. The hole is already open; the only question is whether it answers
well or badly.

Scope it tightly:

- **Minimum viable:** retrieval over the *existing* docs corpus at query time, so
  in-product "how do I…" answers come from the real documentation, not the model's
  imagination. Rides the existing docs + embedding/graph machinery; docs become
  just another queryable source.
- **Degrade honestly:** when the docs don't cover the question, the answer is *"the
  docs don't describe that"* + closest match — never a fallback to the model's
  priors, since the priors are what produce today's odd results. This is the same
  grounded-not-guessed principle the rest of the product runs on.
- **Explicitly not now:** an in-app onboarding tutor, a help chatbot persona, a
  tutorial engine. Those are the post-launch version. Pre-launch bar is only:
  *how-do-I questions get answered from docs, not hallucinated.*

## Depends on / enables

- **Depends on**: the Compute pillar (live Python / SQL / Vega-Lite — already
  there) for interactive preview; the preview pipeline (already there) for forms
  and interactivity; the Publication pillar (already there) for living published
  artifacts; the docs corpus + embeddings (already there) for the pre-launch help
  item. As everywhere in Minerva, the foundation is poured — this is surfacing and
  enlivening, not building anew.
- **Enables**: a defensible, memorable category ("living notes" vs the stale-wiki
  received wisdom) that unifies three otherwise-divergent user mental models;
  a demonstrated-demand roadmap (forms → interactive preview → publication →
  objects) more trustworthy than any competitor-derived list; and, via the Objects
  convergence, the single coherent destination both vision docs point at.
