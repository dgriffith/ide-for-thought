# The Thought Ontology

`src/shared/ontology-thought.ttl` is the vocabulary Minerva uses to describe
the **shape of a thought** rather than the shape of a file. The core ontology
(`src/shared/ontology.ttl`, the `minerva:` namespace) knows about notes,
folders, tags and links — the filing system. This one knows about claims,
grounds, warrants, questions, excerpts, and the thirty-odd ways reasoning goes
wrong.

Namespace: `thought:` → `https://minerva.dev/ontology/thought#`.
It `owl:imports` `minerva:` and is versioned `0.1.0`.

Every class and property in the file carries an `rdfs:comment`. Read the Turtle
when you need the exact wording; read this when you need to know **which of the
ninety-two classes matters for what you're doing**, and — more urgently — **how
a component actually gets into the graph**, because there are two ways and a
query written against only one of them returns a confident wrong answer.

---

## The one thing to know first: two representations

A thought component reaches the graph two different ways, and they share almost
no triples.

**1. Hand-authored Turtle.** An embedded ` ```turtle ` block in a note, the
`crystallize` skill's output, the tutorial thoughtbase. These assert the
ontology directly:

```turtle
_:claim1 a thought:Claim ;
    thought:label "Caching the parse is safe because parseType is pure." ;
    thought:extractedBy "llm:crystallization" ;
    thought:hasStatus thought:proposed .
```

**2. A typed note.** This is what every claim the app itself files looks like
since #2036 — `propose_claims`, Decompose-into-Claims, the glossary skills:

```markdown
---
title: Caching the parse is safe because parseType is pure.
type: claim
claimKind: factual
---
```

`type: claim` matches the **Claim object type** (`src/main/types/stock/claim.md`),
whose class is `types:Claim`. The type compiler
(`src/main/graph/indexers/type-classes.ts`) declares
`types:Claim rdfs:subClassOf thought:Claim`, and the note's `title:` lands as
`dc:title`.

So a typed claim carries **neither `a thought:Claim` nor `thought:label`**.

This is not a hypothetical. `health-checks.ts` asked for
`?claim a thought:Claim` with a `thought:label`, and after #2036 that matched
nothing: the Inspections panel reported "no unsupported claims" on thoughtbases
full of unsupported claims — a wrong answer, not a missing feature, from the one
feature whose job is finding gaps in reasoning. It went unnoticed for months.

### The consequence for anything you write

Do not write these patterns by hand. Build them from
`src/main/graph/argument-patterns.ts`, which is the one module that knows both
representations:

| Helper | What it emits | Why |
|---|---|---|
| `isA(v, cls)` | `?v rdf:type/rdfs:subClassOf* thought:<Class> .` | The property path is what reaches the `types:*` subclasses. A bare `a thought:<Class>` does not. |
| `labelOf(v, out)` | `OPTIONAL`s over `thought:label` then `dc:title`, `COALESCE`d | Hand-authored components have the first; typed notes have the second. |
| `supportedBy(s, v)` | `?s (thought:supports\|minerva:supports) ?v .` | Both predicates mean "this backs that up" — see below. |
| `unsupported(v, cls?)` | one `FILTER NOT EXISTS` **per** predicate | Not an alternation. See the warning below. |

`subClassOf` rather than `owl:equivalentClass` is deliberate: the store does no
OWL entailment, so `equivalentClass` would not be chased by the property-path
idiom this codebase already uses everywhere. A class may carry a Minerva
`parent` *and* an `externalClass` at once — multiple `rdfs:subClassOf` values on
one class is ordinary RDF.

> **Never write `FILTER NOT EXISTS { ?x (a|b) ?y }`.** Comunica evaluates an
> alternation (and the equivalent inner `UNION`) inside `NOT EXISTS` as matching
> *nothing* when neither predicate appears anywhere in the store — which inverts
> to excluding every row. On an empty or freshly-started thoughtbase that reports
> zero unsupported claims: the exact silent-empty-panel failure the check exists
> to catch. One `NOT EXISTS` per predicate. A single-predicate `NOT EXISTS` is
> fine, and so is an alternation in positive position.

### Two spellings of "supports"

`thought:supports` comes from `supports:` frontmatter and from the Claim object
type's `supports` property. `minerva:supports` comes from a `[[supports::note]]`
wiki-link or its frontmatter-link equivalent. Both are the user saying the same
thing, so any check for "nothing supports this" has to find neither.
`SUPPORT_PREDICATES` in `argument-patterns.ts` is the list.

---

## The core model

The spine is Toulmin's argument scheme, extended outward. `thought:Component` is
the abstract superclass of everything in this section; it is an `rdfs:subClassOf
prov:Entity`, so every component is something with provenance that can be
attributed, generated and traced.

### Toulmin proper

| Class | Means |
|---|---|
| `thought:Claim` | An assertion presented as true — the central node of an argument. |
| `thought:Grounds` | Evidence, data, or facts offered in support of a claim. |
| `thought:Warrant` | The reasoning principle connecting grounds to claim. |
| `thought:Backing` | Support for the warrant itself — why the principle holds. |
| `thought:Qualifier` | Conditions or degree of certainty limiting a claim. |
| `thought:Rebuttal` | Conditions under which the claim does not hold. |

The interesting one is `thought:Warrant`. Most real writing states grounds and
claim and leaves the warrant implicit, which is precisely why the
missing-warrant health check exists — the gap is the finding.

### Beyond argumentation

Toulmin covers arguing. A thoughtbase also explains, asks, plans, learns and
reads, so the vocabulary extends:

| Class | Means |
|---|---|
| `thought:Question` | An open inquiry — something the thoughtbase is trying to answer. |
| `thought:Hypothesis` | A tentative claim offered for investigation, not yet established. |
| `thought:Definition` | A stipulative or descriptive definition of a term or concept. |
| `thought:Distinction` | A differentiation between two concepts that might be confused. |
| `thought:Assumption` | A premise taken as given, not argued for within the current scope. |
| `thought:Principle` | A general rule, heuristic, or law appealed to in reasoning. |
| `thought:Example` | A concrete instance illustrating a more abstract component. |
| `thought:Analogy` | A structural mapping between two domains. |
| `thought:Narrative` | A causal or temporal sequence organizing events or ideas. |
| `thought:Goal` | A desired outcome motivating planning or action. |
| `thought:Plan` | A proposed sequence of actions toward a goal. |
| `thought:Observation` | A noted phenomenon or pattern, prior to interpretation. |
| `thought:Interpretation` | A reading or construal of an observation or text. |
| `thought:Tension` | An unresolved conflict between two components. |
| `thought:Synthesis` | An integration of multiple components into a unified position. |
| `thought:Implication` | A consequence that follows from one or more components. |

### Research and evidence

| Class | Means |
|---|---|
| `thought:Source` | A cited external authority or text. Abstract — use a subtype. |
| `thought:Excerpt` | A verbatim quotation lifted out of a Source. |
| `thought:Finding` | A reported result from research or investigation. |
| `thought:Methodology` | An approach or procedure used to produce findings. |
| `thought:Gap` | An identified absence in knowledge or coverage. |
| `thought:Corroboration` | Independent evidence converging on the same conclusion. |
| `thought:Contradiction` | Evidence or reasoning that directly conflicts with another component. |

**Claims cite Sources; they quote Excerpts.** The `thought:Excerpt` is the
atomic "I read this and pulled this out" unit, and it is what most externally-
grounded claims actually hang off — it knows its Source via
`thought:fromSource`, so following the chain backwards always terminates
somewhere citable.

`thought:Source` has seven subtypes on a single axis — *what kind of work is
this?* — orthogonal to file format, except for the catch-all:

| Subtype | For |
|---|---|
| `thought:WebPage` | A URL-addressable web resource. |
| `thought:Article` | A scholarly or journalistic article. Usually a DOI + `schema:inContainer`. |
| `thought:Book` | Monograph, textbook, trade publication. Usually an ISBN. |
| `thought:Preprint` | Not (yet) peer reviewed — arXiv, bioRxiv, SSRN. |
| `thought:Report` | Technical report, white paper, institutional publication. |
| `thought:PDFSource` | Catch-all for a PDF that fits nothing above. The long tail. |
| `thought:Document` | A plain-text/Markdown file ingested verbatim, no extraction step. |

### Learning, understanding, and the glossary

| Class | Means |
|---|---|
| `thought:Concept` | A unit of understanding — a named idea to be grasped. |
| `thought:Term` | A glossary entry. `rdfs:subClassOf thought:Concept`. |
| `thought:Prerequisite` | A concept or skill required before another can be understood. |
| `thought:Misconception` | A commonly held but incorrect understanding. |
| `thought:Insight` | A non-obvious understanding that shifts perspective. |
| `thought:Connection` | A recognized relationship between previously separate ideas. |

`thought:Term` is a subclass of `Concept` specifically so glossary entries form
a distinct queryable set — every term, terms lacking a definition, orphan terms.

### Meta-epistemic

| Class | Means |
|---|---|
| `thought:Framework` | A conceptual lens or paradigm organizing analysis. |
| `thought:Criterion` | A standard by which something is evaluated. |
| `thought:Scope` | A boundary condition defining what is and isn't under consideration. |
| `thought:Confidence` | An epistemic status assessment of a component. |
| `thought:Status` | Epistemic lifecycle state. |

`thought:Status` is a class with six named individuals, reached via
`thought:hasStatus`: `thought:proposed`, `thought:explored`,
`thought:established`, `thought:challenged`, `thought:revised`,
`thought:abandoned`. That progression is the point — a thoughtbase is supposed
to record that a position moved.

---

## Relations: the edges that make it a graph

Classes alone are a filing cabinet. These are what let you ask *"what does this
rest on, and what would break it?"*

### Component → Component

| Predicate | Means |
|---|---|
| `thought:supports` | Provides evidence or reasoning for another. |
| `thought:challenges` | Undermines or questions another. |
| `thought:grounds` | This evidence (typically an Excerpt) is the factual basis another rests on. |
| `thought:rebuts` | This evidence is the factual basis for rejecting another. |
| `thought:qualifies` | Limits or conditions another. |
| `thought:refines` | Clarifies or sharpens another. |
| `thought:presupposes` | Requires another to be accepted. |
| `thought:exemplifies` | Is a concrete instance of another. |
| `thought:contrasts` | Is distinguished from another. |
| `thought:synthesizes` | Integrates multiple others. |
| `thought:motivates` | Provides rationale for another. |
| `thought:contradicts` | Directly conflicts with another. |
| `thought:corroborates` | Independently confirms another. |
| `thought:requires` | Understanding this requires another (learning prerequisite). |
| `thought:connects` | Reveals a relationship between others. |

### Typed targets

| Predicate | Range |
|---|---|
| `thought:addresses` | `thought:Question` — responds to it |
| `thought:raises` | `thought:Question` — generates a new one |
| `thought:resolves` | `thought:Tension` |
| `thought:corrects` | `thought:Misconception` |
| `thought:identifies` | `thought:Gap` |
| `thought:cites` | `thought:Source` |
| `thought:quotes` | `thought:Excerpt` — the edge `[[quote::excerpt-id]]` creates |
| `thought:belongsTo` | `thought:Framework` |
| `thought:hasStatus` | `thought:Status` |
| `thought:loadBearingFor` | domain `thought:Claim` — the single highest-leverage assertion of a resource |
| `thought:seeAlso` | `thought:Term` → `thought:Term` |
| `thought:fromSource` | `thought:Excerpt` → `thought:Source` |
| `thought:extractedFrom` | the source note a component was extracted from |
| `thought:decomposes` | a parent index note → the source note it decomposes |

### Grounding a component to text

`thought:groundedIn` (→ `minerva:Note`), `thought:sourceOffset`,
`thought:sourceLength`, `thought:sourceText` pin a component to a character
range **inside a note in the thoughtbase**.

Keep these distinct from the **Excerpt** predicates, which carry the quotation
itself (`thought:citedText` — verbatim, never paraphrased) and pin it to a spot
in its *external Source*: `thought:page`,
`thought:pageRange`, `thought:charStart`, `thought:charEnd`,
`thought:selector` (CSS/XPath for HTML), and `thought:locationText` — the
free-form escape hatch for "Chapter 3, §2.1" or "timestamp 00:14:32". They
compose: a PDF excerpt can set both a page and a char range.

### Component metadata

`thought:label` (short human-readable summary), `thought:extractedBy` (a
`prov:wasAttributedTo` subproperty — the agent or method), and
`thought:confidenceValue` (0.0–1.0), plus `thought:verifiedBy` for the
provenance of a verification annotation specifically (`"llm:check-facts"`),
which is what distinguishes a machine verdict from a human-entered one.

### Claim verification and currency

Filed by the research-verification skills (#414–#417) through the approval
engine, stored as literals on the audited `thought:Claim` so it carries its
latest verdict inline; re-running a skill supersedes the prior value.

| Predicate | Values / meaning |
|---|---|
| `thought:verificationStatus` | `corroborated` / `contested` / `unverifiable`. "Unverifiable" is a first-class result, not a failure. |
| `thought:currencyStatus` | `current` / `scope-shifted` / `decayed` / `misstated`. |
| `thought:asOfDate` | When the check ran. Pair with a status to drive decay sweeps. |
| `thought:hasPrimarySource` | The actual primary source, traced past the citation chain. A literal, so it can record a citation before the source is ingested. |
| `thought:hasGroundedMagnitude` | A quantitative claim's magnitude re-grounded against base rate and baseline. |
| `thought:claimKind` | `factual` / `evaluative` / `definitional` / `predictive`. |

The `currencyStatus` value set is worth reading closely: it distinguishes
*was true and no longer is* (`decayed`) from *never held as stated*
(`misstated`) from *true only under conditions the stated form omits*
(`scope-shifted`). Those are different problems with different remedies, and
collapsing them into "wrong" is exactly the kind of resolution the ontology
exists to preserve.

### Source metadata: standard vocabularies, borrowed

Source metadata deliberately **reuses** Dublin Core, BIBO and schema.org rather
than minting Minerva IRIs: `dc:title`, `dc:creator`, `dc:issued`,
`dc:publisher`, `dc:language`, `dc:abstract`, `bibo:doi`, `bibo:isbn`,
`bibo:uri`, `bibo:numPages`, `bibo:pages`, `bibo:volume`, `bibo:issue`,
`schema:inContainer`. They are re-annotated with `rdfs:label`/`rdfs:comment` in
this file only so `describe_graph_schema` ships a self-documenting schema.

What Minerva does mint is the part no standard covers: `thought:tldr` (a
plain-language summary distinct from a formal abstract, typically LLM-proposed
and human-approved), `thought:accessedAt`, `thought:archivedAt`,
`thought:extractionMethod` (`text-layer` vs `ocr`), and the reference-stub
trio — `thought:stubStatus`, `thought:rawReference`, `thought:resolvedFrom` —
which let a citation scraped out of a bibliography exist as a partial Source
immediately, so the citing note has something to link to before anyone resolves
it against a metadata API. `thought:stubStatus`'s *presence* is what marks a
source as a stub at all, so completeness checks know to skip it.

---

## Epistemic defects: vocabulary for what goes wrong

This is the half of the ontology that has no counterpart in a normal knowledge
graph, and it is the reason the file is 1,260 lines. Real thoughtbases contain
flawed reasoning, biased thinking, rhetorical moves that persuade without
warranting, and structural gaps. An agent asked to review an argument needs
vocabulary to diagnose what is broken, not only to describe what is well-formed.

`thought:Defect` is the abstract superclass — and note it is deliberately
**not** a `thought:Component`. Defects describe problems *with* components;
they are not themselves units of thought. Five families hang off it:

**Logical fallacies** — `thought:FormalFallacy` (invalid form regardless of
content) and `thought:InformalFallacy`, which branches into
`thought:FallacyOfRelevance`, `thought:FallacyOfPresumption`,
`thought:FallacyOfAmbiguity` and `thought:FallacyOfInduction`. These are
*categories*; a specific fallacy name goes in `thought:defectLabel` rather than
getting its own class. (The `rdfs:comment` on each lists the usual members —
ad hominem under relevance, begging the question under presumption, and so on.)

**Cognitive biases** — `thought:CognitiveBias`, with eight named:
`thought:ConfirmationBias`, `thought:AnchoringBias`,
`thought:AvailabilityBias`, `thought:FramingEffect`, `thought:DunningKruger`,
`thought:StatusQuoBias`, `thought:SunkCostFallacy`, `thought:HindsightBias`.
Not logical errors — predictable tendencies in how humans process information.

**Rhetorical moves** — `thought:RhetoricalMove`: `thought:Strawman`,
`thought:Motte_and_Bailey`, `thought:Deepity`, `thought:Whataboutism`,
`thought:GishGallop`, `thought:SeaLioning`. Persuasion techniques that
substitute social or emotional force for epistemic warrant.

**Structural defects** — `thought:StructuralDefect`:
`thought:CircularReasoning`, `thought:NonSequitur`,
`thought:UnsupportedClaim`, `thought:MissingWarrant`,
`thought:OverGeneralization`, `thought:FalseEquivalence`,
`thought:MovingGoalposts`, `thought:UnfalsifiableClaim`. Problems with how
reasoning is assembled, independent of content — which is why these are the
ones a query can actually find on its own.

**Epistemic vices** — `thought:EpistemicVice`: `thought:Dogmatism`,
`thought:IntellectualCowardice`, `thought:MotivatedReasoning`,
`thought:IntellectualDishonesty`, `thought:Incuriosity`. Dispositional failures
in how a thinker relates to inquiry. These are about the thinker, not the
argument, and Minerva files them against *your own* notes — a design choice with
teeth.

A defect instance attaches via `thought:affects` (→ the Component it
undermines) and `thought:defectIn` (→ the `minerva:Note` where it was spotted),
and carries `thought:severity` (`minor` / `moderate` / `severe` / `fatal`),
`thought:remediation` (suggested action), and `thought:defectLabel` (the
specific name, e.g. which fallacy).

> **Declared and unused is normal here.** No code path in Minerva files a
> `thought:SeaLioning` node today. The defect taxonomy is vocabulary for an
> agent or a human to reach for by hand, and `ontology-terms.test.ts`
> deliberately does not assert the reverse direction (a declared term nothing
> writes) for exactly this reason.

---

## Proposals and conversations: the trust principle, in RDF

The ontology also encodes Minerva's most important design decision — *the LLM
proposes, the human confirms* — as graph structure, aligned with W3C PROV-O.

- `thought:Proposal` is an `rdfs:subClassOf prov:Entity`: an LLM-proposed
  mutation awaiting review. `thought:ComputeProposal` specializes it for a
  proposed code cell, where **approval is clicking Run**.
- `thought:Conversation` is an `rdfs:subClassOf prov:Activity`: the scoped
  interaction that generated the proposal.
- `thought:producedProposal` / `thought:producedComponent` are
  `rdfs:subPropertyOf prov:generated`; `thought:proposedBy` and
  `thought:extractedBy` subproperty `prov:wasAttributedTo`;
  `thought:conversationRef` subproperties `prov:wasGeneratedBy`;
  `thought:startedAt` / `thought:archivedAt` subproperty
  `prov:startedAtTime` / `prov:endedAtTime`.

The lifecycle individuals are `thought:pending`, `thought:approved`,
`thought:rejected`, `thought:expired` (instances of
`thought:ProposalStatus`, reached via `thought:proposalStatus`).
`thought:proposedAt` is creation time; `thought:statusChangedAt` is when it was
*decided* — a distinction added in #1159 after the provenance-over-time review
found `proposedAt` alone could not answer "when was this approved".
`thought:autoExpires` is the deadline after which an unreviewed proposal flips
to expired on its own.

A conversation likewise has `thought:ConversationStatus` individuals
`thought:active` and `thought:archived`, reached via
`thought:conversationStatus`, plus `thought:trigger` (the node that started it),
`thought:contextNote` (each note in its context bundle) and
`thought:conversationContent` (the transcript, JSON-serialized). An archived
transcript is filed as a `thought:Source`, so a proposal's provenance chain
terminates in something citable.

The proposal payload itself splits three ways, and the split is load-bearing:
`thought:payloadJson` is what the approval engine *replays* on approval (one
literal per payload; a proposal may carry several), `thought:proposalDiff` is
the human-facing rendering of the same change, and `thought:proposalNote` is the
prose explanation of what it does and why. A `thought:ComputeProposal` adds
`thought:language` (`sparql` / `sql` / `python`), `thought:code` (as proposed),
`thought:executedCode` (what actually ran — they differ when the user edited the
cell in the review card), `thought:executed` and `thought:executedAt`.
Separately, `thought:derivedFromCell` sits on a `minerva:Note` to record which
compute cell's output that note was pinned from, so re-running the cell updates
that note instead of writing a second one.

Because that structure is in the graph, the trust principle is **queryable**:
the integrity check in `src/main/graph/integrity.ts` looks for
`thought:Component` nodes whose `thought:extractedBy` names an LLM and that have
no matching approved `thought:Proposal` via `thought:affectsNode`. It runs on
every PR (`tests/main/graph/trust-integrity.test.ts`). An approval bypass is not
a code-review judgement call here; it is a failing test.

> `thought:ApprovalPolicy` / `thought:approvalTier` /
> `thought:forOperationType` describe a three-tier scheme
> (`requires_approval` / `notify_only` / `autonomous`) that **the code no longer
> implements** — there is exactly one tier now, and everything is proposed. The
> classes are vestigial. Same for the example values in `thought:operationType`'s
> comment (`confidence_update`, `tag_addition`, `staleness_flag`): those
> operation types were removed with the tiers. See CLAUDE.md, *"One tier:
> everything is proposed"*.

---

## How you actually meet this ontology

Nobody should have to hand-author Turtle to use it. Four surfaces exist
specifically so you don't have to:

**The Claim object type** (#2176) — `type: claim` frontmatter. Its
`externalClass: thought:Claim` is what bridges the typed note into this
ontology, and its properties carry `predicate:` CURIEs
(`thought:claimKind`, `thought:verificationStatus`, `thought:supports`, …) so
filling in a form field writes the ontology predicate directly. See
[Authoring Object Types](authoring-types.md).

**The Glossary Term object type** (#2177) — `type: glossary-term`,
`externalClass: thought:Term`, with `thought:term`,
`thought:disambiguation` and `thought:seeAlso` behind the form fields.

**The `:::argument` embed** (#907) — put this in a note:

```
:::argument
[[Some Claim]]
:::
```

and you get a rendered support/attack map around that claim. It traverses
incoming edges (the subject is the supporter, the object is what is supported)
over `supports`, `grounds`, `corroborates`, `presupposes`, `refines` (drawn as
support), `challenges`, `rebuts`, `contradicts` (attack), and `qualifies`
(qualify); anything else renders as "other". It walks at most
`MAX_DEPTH = 4` hops, as N sequential one-hop queries rather than a property
path.

**The `crystallize` skill** (Research → Decomposition) — reads a note and files
one crystallization note containing a ` ```turtle-hidden ` block of components.
That is the hand-authored path, automated: it is where a thoughtbase gets
`a thought:Claim` nodes with `thought:label`, as distinct from the typed-note
path above. Both end up in the same graph; only the triples differ.

Plus the **Inspections panel**, which runs the structural checks
(`unsupported_claim`, missing warrant, missing backing, contradictions). Those
are marked `hidden` in `src/shared/inspections.ts` — they run and produce real
findings, they just aren't advertised in Settings until the argument map ships
to users.

---

## What is enforced, and what isn't

**The ontology is executable, not decorative.**
`tests/architecture/ontology-terms.test.ts` parses both `.ttl` files and asserts
that every `thought:` / `minerva:` term named anywhere in `src/` — prose, skill
bodies, stock type files and `THOUGHT('x')` call sites included — is a term one
of them declares. Adding a predicate to the code means adding it to the ontology
in the same PR.

This matters more than tidiness, because `describe_graph_schema` hands both
files to the model **verbatim** and tells it "the returned text is
authoritative" before it writes SPARQL. Nothing checked that claim until #2230,
and at that point `ontology.ttl` had been shipping *unparseable* (a stray `;x`)
for an unknown length of time, with ~17 load-bearing predicates undeclared —
and `describe_graph_schema`'s own tool description was advertising a
**hasClaim** predicate, in this namespace, that has never existed.

`tests/architecture/thought-ontology-doc.test.ts` extends the same idea to this
document: every CURIE *here* must be a declared term, and every class and
property the ontology declares must be named here. A term added to the Turtle
and not to this file fails a test.

**Not enforced:**

- The reverse direction in `src/` (a declared term nothing writes). Normal for
  vocabulary users author by hand — see the defect taxonomy above.
- Whether a term's `rdfs:domain` / `rdfs:range` match how the code uses it. Only
  the name is checked. There is no SHACL layer and no reasoner; the store does
  no entailment.
- Anything in `docs/` other than this file.

### Known warts

- **`thought:archivedAt` is declared twice**, with two incompatible meanings:
  once with `rdfs:domain thought:Source` / `rdfs:range xsd:string` (a
  thoughtbase-relative path to a local archival copy), and once with
  `rdfs:domain thought:Conversation` / `rdfs:range xsd:dateTime` (when the
  conversation was archived). Both are live — `llm/conversation.ts` writes the
  timestamp, `graph/frontmatter-predicates.ts` maps the source key to the path.
  In RDF these merge into one property with two domains and two ranges. Nothing
  reads `rdfs:domain`, so nothing breaks today; it is a schema the model is told
  is authoritative saying something self-contradictory. Splitting it means
  renaming a predicate that is already on disk in shipped thoughtbases.
- **`thought:ApprovalPolicy` and its two properties are vestigial** — see the
  note above.
- `thought:page` / `thought:pageRange` (Excerpt location) sit beside
  `bibo:pages` / `bibo:numPages` (Source metadata). Different domains, similar
  names; check which you want.

---

## Counting, for orientation

As of this writing `ontology-thought.ttl` declares **92 classes** and **104
distinct properties** (105 declarations — `thought:archivedAt` twice), of which
90 are in the `thought:` namespace and 14 are Dublin Core / BIBO / schema.org
terms re-annotated for the schema dump. Every one carries an `rdfs:comment`.

Don't trust those numbers in prose — they are here for scale, not for citation.
The Turtle is the source of truth, and the parity test above is what keeps this
document honest about *which* terms exist, not how many.

---

## See also

- `src/shared/ontology-thought.ttl` — the source of truth.
- `src/shared/ontology.ttl` — the `minerva:` core ontology (notes, folders,
  tags, links, sources, typed-object class metadata).
- [`authoring-types.md`](authoring-types.md) — how `externalClass:` and
  `predicate:` bridge a user-defined object type into this vocabulary.
- [`authoring-skills.md`](authoring-skills.md) — how a skill's prompt body
  names these terms for the model.
- `src/main/graph/argument-patterns.ts` — the query fragments that know both
  representations.
- CLAUDE.md, *"Two representations of one claim"* and *"The ontology is
  executable, not decorative"*.
