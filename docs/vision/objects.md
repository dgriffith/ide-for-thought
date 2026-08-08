# Vision: Typed Objects — Typed Notes as a First-Class Surface

## Position

Let the user **see and work with their thoughtbase as a set of typed objects** —
create a note _as_ a "Book" / "Person" / "Meeting," browse everything of a type,
and get type-specific affordances (templates, views, rendering) keyed off the
type. This is object-based note-taking (the Capacities / Tana / Heptabase idea)
implemented on a substrate that already models types and typed edges natively:
the RDF graph.

The load-bearing principle, above all else:

> **Frontmatter is the storage format, never the primary interface.** `type: book`
> on disk is Git-friendly, portable, inspectable — and the user should be able to
> ignore its existence. Every phase's interface target is a real UI gesture
> (inline creation, a picker, a property _form_), never "hand-edit this YAML." If
> the only demo is editing YAML, the feature has failed.

## Differentiator

Capacities, Tana, and Heptabase invented an object model and bolted a store
underneath it. Minerva already _has_ the model — an RDF graph with `rdf:type`
and typed edges — and a typed note is just a note with an extra type. So Minerva
can offer two things the category structurally cannot:

- **Typed objects that are also formal graph citizens.** A "Book" is queryable
  by SPARQL, joins CSV tables in SQL, and coexists with the epistemic `thought:`
  types (Claim, Warrant) in one system.
- **Typed _excerpts_.** `thought:Excerpt` — an anchored quotation from a source —
  becomes a browsable, first-class object type. No competitor has "every passage
  I've pulled, as objects" because none models excerpts as graph nodes.

## Capability surface

- A **type registry**: a type is declared once (label, expected properties,
  optional template body, optional icon/color) and compiles into the graph as an
  ontology class, so `?x rdf:type :Book` is queryable.
- **Inline typed creation** — the headline `/book` gesture in the note body.
- **Property editing as a form**, never raw YAML.
- **Promote** an untyped note to a type; **migrate** existing notes via an
  approval-gated inference skill.
- An **objects-by-type sidebar** browser (pure graph projection).
- **Multi-view** over a type's instances (list / table / gallery / cards) with
  **saved views**, and **type-keyed rendering** (previews, hovers, link cards).
- **Link-to-type properties as labeled graph edges** — where Minerva visibly
  exceeds the category.
- **Related content** — unlinked mentions of an object, cheap on existing
  embeddings.

## Scope discipline

- **Not a Notion-style database** — no formulas / rollups / relations-as-tables /
  view-filters-as-objects. Heavy relational compute is the Compute pillar's job.
- **Not a new storage format** — a typed note is still a plain `.md`; delete the
  registry and you have plain notes with a stray frontmatter key.
- **Not a replacement for `thought:`** — domain types (Book, Person) and
  epistemic types (Claim, Warrant) coexist.
- **Not schema enforcement** — properties are _expected_, never _required_. A
  Book with no author is fine (house UX: no hand-holding).
- **Not a canvas, not card-identity-with-placements** — Minerva's answer to "same
  thing in many contexts" is transclusion + typed links (note lives once,
  referenced anywhere).

## Timing

**Post-launch. Not on the critical path to launch.** Recorded loudly because this
feature's three most seductive qualities — architecturally elegant, externally
validated, craft-pleasurable — are exactly the profile of the most dangerous
scope creep. It is weeks of cross-cutting work across the three heaviest
subsystems (graph + renderer + editor). Do not pull it into the launch window.

## Resolved decisions

These close the epic's Phase 0 (design spike, #1061) so the registry format and
edge model aren't re-litigated mid-build. Each answer is grounded in a pass over
the current code; the load-bearing one — "a typed object is just a Note with an
extra `rdf:type`" — is already precedented in the tree.

### 1. Type registry location & format

- **Stock types** ship bundled in-app via `import.meta.glob('./stock/*')` in a
  new `src/main/types/` module, mirroring `src/main/skills/loader.ts`.
- **User types** live in-tree at `.minerva/types/*.md`, mirroring
  `.minerva/sources` / `.minerva/excerpts` — so they travel with the library,
  work in Git, and sync across devices, while staying out of the note listing
  (`.minerva` is filtered from file views). This differs deliberately from
  skills (`~/.minerva/skills/`, per-machine): a type is part of _this library's_
  vocabulary, not a machine setting.
- **Loading is additive; an in-tree file of a stock id overrides it.** This is
  how a thoughtbase customizes Book or Meeting — add a property, change the
  icon — without forking the bundle. The override is a full local copy, marked
  `overridesStock`, and deleting it reverts to the bundled definition (which is
  still loaded underneath). The id carries the override and `classLocalName`
  derives from the id, so a customized Book keeps its `types:Book` class and
  every existing instance stays valid. Two ids colliding within the SAME source
  is still an error — those are mistakes, not overrides.

  A stock-derived type's **name and id are both fixed**: you customize its
  properties, icon and colour, not its identity. Duplicate gives you an
  independently-named type of your own.

  This deliberately diverges from the skills catalog, which stays additive-only
  (`docs/authoring-skills.md`): a skill is a prompt you can disable and replace
  wholesale, whereas a type is a schema that existing notes are already
  instances of, so editing in place has to preserve identity.
- **Format**: a type definition is a `.md` file — YAML frontmatter (`label`,
  `properties[]`, optional `icon` / `color`) plus an optional template body,
  matching the skills authoring model.

### 2. Relationship to `thought:` and to the Source/Excerpt model

- Domain types get a **new `types:` namespace**
  (`https://minerva.dev/ontology/types#`), registered alongside the standard
  prefixes in `src/main/graph/state.ts`, coexisting with `minerva:` and
  `thought:`.
- The object layer **renders/browses the existing Source & Excerpt model rather
  than forking it** — one model, surfaced two ways. The stock "Article / Source"
  type bridges to the existing source model; `thought:Excerpt` becomes a
  browsable type (#1069) without changing how excerpts are stored or anchored.

### 3. Inline-creation sigil

- **`/book`** in the note editor body (confirmed; the "headline gesture" of
  #1065). Verified collision-free: the CodeMirror note editor claims only `[[`
  (wiki-links) and `#` (tags); `/` is used **only** in the conversation composer,
  which is a separate `<textarea>`, not the editor. The two surfaces are distinct
  contexts (writing a note vs. addressing the AI), so reusing `/` reads as the
  familiar Notion/Slack "insert" convention rather than an overload. A new
  CodeMirror `CompletionSource` on `/` joins the existing `override` array.

### 4. Property type system depth

- **MVP five**: `text`, `date`, `number`, `enum`, `link-to-type`. These map
  directly onto the indexer's existing datatype inference (`xsd:date`,
  `xsd:decimal` / `xsd:integer`, IRI, wiki-link resolution already exist).
- **Deferred** unless demand appears: derived / computed (→ Compute pillar),
  multi-value, units.

### 5. View persistence

- A saved view **reuses the `src/main/saved-queries.ts` persistence pattern** (a
  config entry, not a note). Detail lands in Phase 3 (#1072); recorded here so it
  isn't reinvented. Ephemeral view state (current sort/filter) stays UI-local
  until explicitly saved.

### 6. Migration of existing notes

- **Approval-gated inference skill** (on-brand with the Trust Principle — the LLM
  proposes types, the human confirms). Feeds #1075.

### 7. Subclassing (`rdfs:subClassOf`) user-facing?

- **Deferred for v1.** The substrate already supports it — `minerva:PythonModule
  rdfs:subClassOf minerva:Note`, so "list every note" transparently includes
  Python modules. This is recorded as a capability the substrate makes possible
  that Capacities/Tana structurally can't, to be surfaced when a concrete need
  (e.g. `Textbook` is-a `Book`) appears.

### Implementation-shaped decisions

- **A typed object is a Note with an extra `rdf:type` — NOT a new entity kind.**
  This is the minimal-blast-radius design and is already precedented:
  `indexPythonFile` stamps both `minerva:Note` and `minerva:PythonModule`
  (`indexers.ts:956-969`); `.ttl` / `.csv` companion notes do the same. A new
  first-class kind would instead ripple through `RefKind` + `ALL_KINDS`
  (`embeddings/vector-store.ts`) and ~10 independently-declared
  `'note' | 'source' | 'excerpt'` unions across shared / renderer / preload /
  main, plus a new URI minter, `index*` function, `contains*` predicate, on-disk
  storage home, and 5+ renderer open/goto/graph routing switches. The typed-object
  layer rides all existing Note machinery (editor, sidebar, `containsNote`,
  embeddings `kind:'note'`, link resolution defaulting to `note`).

  **Blast radius of the chosen design** is therefore small and localized:
  materialize the `type:` frontmatter key as an `rdf:type` edge in `indexNote`
  (right after the existing `store.add(subject, RDF('type'), MINERVA('Note'))` at
  `indexers.ts:519`, plus adding `'type'` to the frontmatter skip-list at
  `indexers.ts:603` so it isn't double-emitted), define the type classes, and add
  the registry. Nothing in the embeddings / RefKind / open-routing layers moves.

- **Canonical `type:` key.** `type` is currently unclaimed — not in the parser's
  special-cases, not in the `frontmatter-predicates.ts` `MAP`, not in
  `frontmatter-canonical-keys.ts`, not in the formatter alias table; today it
  silently becomes an opaque `minerva:meta-type "book"` literal. The canonical
  key is **`type`** (singular). It is **special-cased in `indexNote`**, not added
  to the predicate `MAP` — because `rdf:type`'s object must be a class IRI, not a
  `minerva:meta-*` literal. It is added to `frontmatter-canonical-keys.ts` for
  autocomplete. Per-type property keys flow through the existing
  `resolveFrontmatterPredicate` / `frontmatterValueToEdge` pipeline (which already
  infers datatypes); a type's declared property may name a predicate, defaulting
  to the `types:` namespace when it doesn't map to an existing canonical key.

## Phases

Each phase is independently shippable & demoable. Sub-issues under Epic #1060.

- **Phase 0 — design** (this doc): #1061.
- **Phase 1 — type registry + frontmatter storage + inline creation**: #1062
  (registry), #1063 (property model + frontmatter⇄graph), #1064 (type picker in
  NewNoteDialog), #1065 (inline `/book`), #1066 (property form), #1067 (promote
  to a type).
- **Phase 2 — objects-by-type sidebar**: #1068 (browser), #1069 (Excerpt as a
  browsable type).
- **Phase 3 — multi-view + type-keyed rendering**: #1070 (multi-view), #1071
  (type-keyed rendering + Excerpt card), #1072 (saved views).
- **Phase 4 — typed-edge properties**: #1073 (link-to-type as labeled edges +
  Excerpt as edge endpoint).
- **Phase 5 — related content**: #1074 (unlinked mentions), #1075 (approval-gated
  type inference for existing notes).

## Depends on / enables

**Depends on** (all already in place — this is surfacing, not foundation-pouring):
the RDF graph + `rdf:type` indexing (`graph/indexers.ts`, `queries.ts`), the
frontmatter parser (`graph/parser.ts`, `frontmatter-predicates.ts`), the preview
pipeline (`Preview.svelte`, `markdown/inline-tokens-plugin.ts`), the skills loader
(precedent for the registry — `skills/loader.ts`), `thought:Excerpt` anchoring +
the approval path (`indexers.ts` `indexExcerpt`, `shared/excerpt-note.ts`), and
on-device embeddings (`embeddings/related.ts`, `RelatedPanel.svelte`).

**Enables** a concrete answer to "why Minerva over Capacities _or_ Heptabase" —
typed notes, and typed _excerpts_, that are also formal graph citizens; a second
onboarding on-ramp (pick a type, get a template); and richer Compute queries once
domain types + typed edges give SPARQL/SQL more structure to bite on.
