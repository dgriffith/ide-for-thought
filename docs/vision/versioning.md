# Vision: Versioning — Three Features Wearing a Trenchcoat

> **Status: post-launch, and *further* post-launch than the rest.** Unlike Objects
> or Substrate-MCP, none of the jobs here is a first-run credibility problem — a
> launch user won't hit these in the first hour if the app simply doesn't lose data.
> So this waits behind the other post-launch work. **But there is one pre-launch
> guardrail** (see *The one pre-launch constraint*): don't make a storage/gate
> decision that forecloses the provenance-over-time story later. That guardrail is
> the real "don't paint into a corner" — not the absence of a versioning feature.

## The reframe

"Living notebook" implies a versioning story, and versioning has felt like tough,
uncracked product management for a tool this complex. The difficulty is an
illusion of framing: **"versioning" is hiding three different features that want
three different mechanisms.** Trying to solve them with one mechanism forces a
false choice between "it's just text, use git" (fails half the users) and "build
version control" (paints into the corner). Split them and the corner disappears.

The three jobs:

1. **Undo / history** — "let me get back what I just lost." *Ship it.*
2. **Provenance-over-time** — "how did my thinking on this evolve." *Expose it — 
   this one is the differentiator.*
3. **Real version control** — branches, merges, "what if I reorganized everything."
   *Refuse it — git is the honest answer here.*

Nobody has "cracked versioning for a tool this complex" partly because they keep
trying to make a git-shaped thing answer an epistemic question. At the level of the
three actual jobs, two are near-shippable and one is a principled no.

## Job 1 — Undo / History (ship)

**What it is.** The emotional floor. A user deleted a paragraph, or accepted a bad
AI proposal, and needs to feel safe. Not about collaboration or provenance — about
*getting this note back to how it was*.

**What it needs.** Per-note time-travel: the Obsidian / Notion "version history"
panel that shows *this note* over the last N days/edits and lets you roll back.
Bounded, local, no branching, no merge.

**Why it's near-solved.** This is per-note file states — cheap, local, no graph
semantics required. The user base that "would not be fine with just use git" is
*mostly asking for this* and calling it versioning. Giving them a history panel
answers the real request without any of the hard machinery.

**Scope:** linear per-note history + restore. Not global, not branching. Retention
window is a setting. This is table stakes for the category, and it's the cheap one.

## Job 2 — Provenance-over-time (expose — the differentiator)

**What it is.** "How did my belief about X evolve? What did I think six months ago,
what changed it, which source moved me?" This is the intellectually rich version,
and it is *Minerva's alone* — no other PKM can answer it, because no other PKM
records the provenance to begin with.

**What it needs — and what it does NOT need.** Critically, this is **not general
versioning.** It is a **query over provenance the graph already records** through
the approval gate (who proposed what, when, from which source, approved when). "How
did my thinking change" is a provenance query, *not a diff over file states*. The
reason this feels hard under the "versioning" banner is that the banner suggests a
git-shaped diff mechanism; the actual answer is a SPARQL-shaped query over records
that already exist. This job is arguably closer to *done* than to *started*.

**Why it's the on-brand centerpiece.** A tool whose entire pitch is grounded,
sourced, checkable thinking should be able to show the *history of a belief* as a
first-class artifact — the evolution of a claim, with the evidence and approvals
that moved it, rendered as a timeline or a query result. This is the feature that
makes "living notebook" literally true in the temporal dimension, and it's
defensible precisely because it rides the provenance machinery competitors don't
have.

**Scope:** provenance-over-time as a query/view (belief timelines, "what changed
this claim," "show me this note's provenance history"). Built on existing gate
records, not on a new versioning subsystem.

## Job 3 — Real version control (refuse)

**What it is.** Branches, merges, "let me try a big reorganization and maybe roll
the whole thing back," diverging lines of a whole thoughtbase.

**Why to decline it.** Merge semantics over a knowledge graph with typed edges and
provenance is a genuine research problem. The population that actually wants to
branch-and-merge a *notebook* is small and technical — and *those* users really
will be fine with git, because the thoughtbase is plain files on disk (the
local-first / plain-files architecture makes git a first-class option for anyone
who wants it). "It's text, use git" is a perfectly good answer **for this third
thing specifically.** It is only a bad answer when it's offered for all three.

**This is the corner, and the escape is not entering the room.** The fear of
"painting into a corner" resolves here: you don't have to build branch/merge, and
declining it is a *decision*, not a gap. Plain-files-plus-git covers the power user;
the history panel covers the anxious user; the provenance query covers the thinker.
Nobody is left needing graph-native branch/merge except the small set already
served by git.

**Scope:** explicitly out. Document "use git, your notes are plain files" as the
supported answer for branching/whole-base version control. Revisit only if
real, repeated demand appears from users who genuinely can't use git — unlikely
given the audience.

## The one pre-launch constraint

Everything above is post-launch. The single thing that touches launch is a
*negative* constraint, same shape as the personalization "keep level out of a hidden
profile" guardrail:

**Do not make a storage-format or gate-record decision that forecloses
provenance-over-time.** The corner to avoid is not "shipping without versioning" — 
it's accidentally structuring the on-disk format or the approval-gate records so
that "how did my thinking evolve" becomes *unanswerable* later. Concretely, before
launch, sanity-check that: gate/proposal records retain enough (timestamps, source,
prior state or a reference to it, approver action) that a temporal query is
*possible* later; and that the on-disk format doesn't destroy prior-state
information the provenance timeline would need. This is cheap insurance now against
an expensive impossibility later. It is not building the feature — it is not
*precluding* the feature.

## Open decisions

- **Undo history storage.** Per-note snapshots, a local edit log, or lean on git
  under the hood invisibly? The user shouldn't *see* git, but git could be the
  quiet engine for Job 1. Decision: is history a bespoke store or a git-backed one
  the user never has to touch?
- **Retention.** How far back does per-note history go by default, and is it
  size-bounded, time-bounded, or edit-count-bounded? A setting, but needs a sane
  default.
- **Provenance timeline granularity.** Does the belief-evolution view work at the
  claim level, the note level, or both? Claim-level is richer and more on-brand;
  note-level is simpler. Likely both, claim-level as the showcase.
- **Does undo interact with the gate?** If a user rolls back a note to before an
  AI proposal was accepted, what happens to that proposal's provenance record? The
  provenance should probably *retain* that the proposal happened and was later
  rolled back — history is not erasure. Worth an explicit principle: rollback is a
  new event, not a deletion of the past.
- **Surfacing.** History panel per note (Job 1) and provenance timeline (Job 2) are
  different views of overlapping data. Are they one UI with two modes, or two
  distinct surfaces? They *feel* related to users even though they're mechanically
  different — a unified entry point may reduce confusion.

## Depends on / enables

- **Depends on**: per-note edit capture (modest new machinery, or git-backed) for
  Job 1; the approval-gate provenance records (already there) for Job 2; the
  local-first plain-files architecture (already there) for Job 3's "use git" answer.
  Two of the three jobs ride existing foundations; only Job 1 needs a small new
  store.
- **Enables**: the temporal dimension of "living notebook" made literal (notes that
  have a *past* you can inspect, not just a present); a differentiated
  belief-evolution feature no provenance-free competitor can match; and a clean,
  non-cornered answer to the versioning question that has been carried as a single
  hard lump — *ship one, expose one, refuse one.*
