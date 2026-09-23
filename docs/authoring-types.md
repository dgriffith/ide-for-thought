# Authoring Object Types

An **object type** (Book, Person, Claim, Meeting, …) declares that a note is a
*kind of thing* with expected properties. A note picks one up with `type:` in
its frontmatter; the type then drives the property form, the gallery/table
views, the link cards, and — the part this document exists for — what the note
becomes in the knowledge graph.

A type is a markdown file: YAML frontmatter (the schema) plus an optional
markdown body (a template inserted into new instances). That is the whole
format. You can author one by hand, check it into git, and it travels with the
thoughtbase.

This is the contributor-facing format reference. For *using* types in the app,
see the user manual's **Notes: Typed notes**, **Left sidebar: Objects** and
**Settings: Object Types** pages.

## Where types live

| Source | Location | Editable |
|---|---|---|
| **Stock** | bundled in the app (`src/main/types/stock/*.md`) | no (but see below) |
| **User** | `<thoughtbase>/.minerva/types/*.md` | yes |

Unlike skills — which live in `~/.minerva/skills/` and apply machine-wide — the
type catalog is **per thoughtbase**. Your vocabulary of things is a property of
this library, not of this laptop, so it lives in-tree and version-controls with
the rest of the notes.

A flat listing, not a recursive walk: `.minerva/types/foo.md`, not
`.minerva/types/foo/TYPE.md`.

Nothing watches that directory, but nothing needs to — the catalog is re-read
from disk on every listing, so a file dropped in by hand or arriving via
`git pull` shows up on the next use with no reindex and no restart.

### Overriding a stock type

Stock types load first; an in-tree file claiming the **same `id`** replaces it.
That is how a thoughtbase customizes Book or Meeting (add a property, change the
icon) without forking the bundle. The override is a full local copy, marked
`overridesStock`, which is what drives the "customized" badge and the **Revert**
action.

Reverting is just deleting the in-tree file: the stock definition is still
loaded underneath and simply reappears. The `id` carries the override and the
class name derives from the `id`, so a customized Book keeps its `types:Book`
class and **every existing instance stays valid**.

Two files claiming one `id` within the *same* source — a duplicate stock id, or
two user files — is a genuine mistake, not an override. First-loaded wins and
the collision is reported as a load error.

## Quickstart

Drop this in `<thoughtbase>/.minerva/types/recipe.md`:

```markdown
---
label: Recipe
icon: 🍳
color: "#f9e2af"
properties:
  - name: servings
    type: number
  - name: time
    label: Total time
    type: text
  - name: cuisine
    type: enum
    options: [italian, japanese, mexican, other]
  - name: adapted-from
    type: link-to-type
    targetType: person
card: [cuisine, time]
---

## Ingredients

## Method

## Notes
```

Then in any note:

```yaml
---
title: Sunday ragù
type: recipe
servings: 6
cuisine: italian
adapted-from: "[[Marcella Hazan]]"
---
```

You now have `?x a types:Recipe` in the graph, a property form in the sidebar, a
row in the Recipe table view, and a `types:adapted-from` edge to the Marcella
Hazan note that shows up in her backlinks labelled by its role.

## Frontmatter reference

### Required

| Field | Type | Notes |
|---|---|---|
| `label` | string | Display name. `name` is accepted as an alias. **This is the only required field** — everything else has a default. |

A type with no `label` (and no `name`) is rejected outright, as is one whose
`label` slugifies to nothing.

### Optional

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | slug of `label` | Stable identifier. It is what a note's `type:` matches, what carries a stock override, and what `classLocalName` derives from. **Set it explicitly if you may rename the type**, because changing the derived id is a rename cascade over every instance. |
| `icon` | string | — | An emoji. Shown in the sidebar, pickers, and on cards. Materialized as `minerva:typeIcon`. |
| `color` | string | — | A CSS color. Quote it — an unquoted `#89dceb` is a YAML comment. Materialized as `minerva:typeColor`. |
| `properties` | list | `[]` | The schema. See [Properties](#properties). |
| `cover` | property name | — | The property whose value is the gallery card's cover image. |
| `card` | list *or* comma-separated string | derived | Ordered property names shown on the render card (link cards, hovers, preview). |
| `parent` | type id | — | The type this one specializes. `extends` is accepted as an alias. Materialized as `rdfs:subClassOf`. Single inheritance. |
| `externalClass` | CURIE | — | An *additional* `rdfs:subClassOf` edge to a standard vocabulary class. See [External vocabulary](#external-vocabulary). |
| *body* | markdown | — | Template inserted into new instances. Optional, unlike a skill's body. |

### Errors are soft where they can be

The parser never throws on content problems, so one malformed type can't break
the catalog. Only a missing `label`/`id` rejects the type. Everything else is
reported as a load error and the type still loads:

- a property with an unknown `type:` is skipped (the rest load);
- an `enum` with no `options` is flagged but kept;
- a `link-to-type` with no `targetType` is flagged but kept;
- `cover` or `card` naming a property that isn't declared is flagged and, for
  `card`, that one name is dropped;
- a `parent` that doesn't exist, or is the type itself, is flagged and cleared
  so nothing materializes a dangling `rdfs:subClassOf`.

This is the house style — no hand-holding, no refusing to load something you
asked for. Load errors surface in **Settings → Object Types**.

## Properties

Each entry under `properties:` is a mapping:

| Key | Required | Notes |
|---|---|---|
| `name` | yes | The **frontmatter key** the value is stored under on an instance. |
| `type` | no (`text`) | One of the six below. |
| `label` | no | Human label for the form. Defaults to a title-cased `name` (`first_name` → `First Name`). |
| `options` | `enum` only | The allowed values. Validated-but-not-enforced — a note may hold something else. |
| `targetType` | `link-to-type` only | The type id this property points at. `target` is accepted as an alias. |
| `predicate` | no | A CURIE to index this property's value under. See [External vocabulary](#external-vocabulary). |

### Property types

| `type` | Holds | Notes |
|---|---|---|
| `text` | a string | The default. Stays a plain literal even if the value looks like a year. |
| `date` | a date | Coerced to `xsd:date`, `xsd:dateTime`, `xsd:gYearMonth` or `xsd:gYear` depending on the shape written. |
| `number` | a number | Coerced to `xsd:integer` or `xsd:decimal`. |
| `enum` | one of `options` | Advisory, not enforced — a note may hold anything. |
| `link-to-type` | a wiki-link to a note of `targetType` | Written as `[[Target Note]]`. |
| `geo` | `"<lat>,<lng>"` | A plain string. Deliberately no coordinate parsing, no geocoding, no structured sub-fields. |

The declared type is **schema over value-guessing**: an untyped frontmatter key
gets its RDF datatype guessed from the value's shape, a declared one gets it
from the declaration. Anything that can't be coerced — a `number` property
holding `"soon"` — falls back to a plain string literal rather than failing.

Still deferred, so don't reach for them: computed properties, multi-valued
properties, and units.

### What a `link-to-type` property becomes

A `link-to-type` property materializes as a **labelled role edge in the `types:`
namespace** — Project's `owner` property becomes `types:owner` — rather than
collapsing to a generic `dc:creator` or `minerva:meta-*`. That is what makes the
relation queryable *by its role* and what makes the role visible in backlinks
rather than an anonymous "links here".

A value that isn't a whole wiki-link falls back to a plain string under the same
predicate, so a half-written link doesn't disappear from the graph.

## The graph shape a type produces

Two things get written, and they are worth separating in your head.

**The class**, materialized once per type (`graph/indexers/type-classes.ts`):

```turtle
types:Recipe a rdfs:Class ;
    rdfs:label "Recipe" ;
    minerva:typeId "recipe" ;
    minerva:typeIcon "🍳" ;
    minerva:typeColor "#f9e2af" ;
    types:expectsProperty "servings", "time", "cuisine", "adapted-from" .
```

`types:` is `https://minerva.dev/ontology/types#`. These are global resource
triples, wiped and re-materialized on every rebuild, so they never go stale.

**The instance**, materialized per note: an `rdf:type` edge to the class, plus
one edge per declared property that the note actually sets.

`type:` may be a **list** — a note can carry several types and gets an
`rdf:type` edge for each, with the union of their declared properties. An
unrecognized type id is silently ignored (no class edge), which is what lets a
note keep a `type:` for a type that hasn't been authored yet.

### Which predicate a property value lands under

Resolved in `declaredPropertyPredicate` (`graph/indexers/frontmatter.ts`), in
this order:

1. **An explicit `predicate:` CURIE on the property** — a deliberate opt-in to
   an external vocabulary. Wins over everything.
2. **`link-to-type`** → `types:<name>`, the role edge described above.
3. **Everything else** → the frontmatter-key predicate, which is itself either a
   canonical mapping (`author` → `dc:creator`, `doi` → `bibo:doi`, …) or the
   `minerva:meta-<key>` fallthrough.

The indexer (write) and the property read-back / table projection (read) both
resolve through that one function, so they cannot drift apart. If you add a
resolution rule, add it there.

## External vocabulary

Two keys bridge a Minerva type into a standard vocabulary (#2036). Both are
purely additive: omit them and you get today's exact behaviour, with the class
living only under `types:`.

### `externalClass:` — align the class

```yaml
label: Person
externalClass: foaf:Person
```

emits `types:Person rdfs:subClassOf foaf:Person`, so `?x a/rdfs:subClassOf*
foaf:Person` finds every Person note.

`rdfs:subClassOf` and **not** `owl:equivalentClass`, deliberately: the store
performs no OWL or RDFS entailment, so an `equivalentClass` edge would simply
not be chased. `subClassOf` participates in the `a/rdfs:subClassOf*`
property-path idiom this codebase already uses everywhere for type hierarchy.

A class can carry a `parent` **and** an `externalClass` at the same time —
multiple `rdfs:subClassOf` values on one class is ordinary RDF, and the two
edges are siblings, not a conflict.

This is also the bridge into the thought ontology. The stock **Claim** type sets
`externalClass: thought:Claim` and the stock **Glossary Term** type sets
`externalClass: thought:Term`; that single line is what makes a `type: claim`
note answer a query about `thought:Claim`. Read
[The Thought Ontology](thought-ontology.md) before writing such a query — a
typed note carries neither `a thought:Claim` nor `thought:label`, which is a
trap with a history.

### `predicate:` — align one property

```yaml
properties:
  - name: email
    type: text
    predicate: foaf:mbox
```

Instead of the frontmatter-key fallback, this property's value is indexed under
`foaf:mbox`.

### Recognized prefixes

Both keys resolve against one list (`STANDARD_PREFIXES` in
`src/main/graph/state.ts`) — the same prefixes auto-injected into every SPARQL
query:

| Prefix | IRI |
|---|---|
| `minerva` | `https://minerva.dev/ontology#` |
| `thought` | `https://minerva.dev/ontology/thought#` |
| `types` | `https://minerva.dev/ontology/types#` |
| `dc` | `http://purl.org/dc/terms/` |
| `rdf` | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` |
| `rdfs` | `http://www.w3.org/2000/01/rdf-schema#` |
| `xsd` | `http://www.w3.org/2001/XMLSchema#` |
| `owl` | `http://www.w3.org/2002/07/owl#` |
| `csvw` | `http://www.w3.org/ns/csvw#` |
| `prov` | `http://www.w3.org/ns/prov#` |
| `bibo` | `http://purl.org/ontology/bibo/` |
| `schema` | `http://schema.org/` |
| `dcat` | `http://www.w3.org/ns/dcat#` |
| `skos` | `http://www.w3.org/2004/02/skos/core#` |
| `foaf` | `http://xmlns.com/foaf/0.1/` |

An **unrecognized prefix is silently ignored** — that one mapping just doesn't
apply, and indexing continues. There is no way to declare your own prefix in a
type file today. If you need one, add it to `STANDARD_PREFIXES`; it is a single
list read by both the CURIE resolver and the query prefix injection, so adding
an entry there makes the prefix usable in types *and* in SPARQL at once.

Note what this means for a typo: `foaf:Persn` and `faof:Person` both fail
silently and identically. Nothing validates the local name against the remote
vocabulary — the prefix is expanded and the IRI is minted, whatever it says.

## Inheritance

```yaml
label: Preprint
parent: article
```

emits `types:Preprint rdfs:subClassOf types:Article`, so
`?x a/rdfs:subClassOf* types:Article` returns Preprints too.

Single inheritance for v1. A parent that doesn't exist, or a type that is its
own parent, is flagged and cleared. Cycles are *not* rejected — SPARQL property
paths handle them, and single inheritance keeps them rare.

Inheritance affects the **class hierarchy**, not property inheritance: a child
type does not automatically get its parent's declared properties in its form.
Declare what you want on the child.

## The template body

Everything after the frontmatter is a template inserted into new instances. It
is a **plain note scaffold** — not a prompt, and not a template language. There
is no `{{…}}` interpolation here; a skill's body has that, a type's body does
not. Headings you want every instance to start with, and nothing more:

```markdown
## Summary

## Notes

## Quotes
```

The body travels to the renderer with the rest of the type metadata, so the type
picker and inline creation can instantiate a note without a round trip.

## Editing types in the app

**Settings → Object Types** gives you an editor over the same format, and
**File → Save Note as Object Type** derives a type from an open note's
frontmatter.
Both write `.minerva/types/<id>.md` in exactly the shape this document
describes, so a type made in the dialog is a type you can then hand-edit, diff
and commit.

Two app-side behaviours worth knowing when you hand-edit:

- **Renaming** a type migrates its instances' `type:` frontmatter to the new id.
  If you rename by editing the file's `id` yourself, nothing migrates and the
  instances quietly lose their type.
- **Deleting** a type can clear `type:` from its instances. Deleting the file by
  hand leaves the frontmatter pointing at nothing — harmless (unknown ids are
  ignored) but invisible.

Both are direct frontmatter rewrites, not approval-engine proposals: they are
user-initiated, so they apply immediately.

## Stock types

Ten ship with the app, at `src/main/types/stock/*.md`. They double as the
reference examples — copy one out, change the `label`, and edit from there.

| Type | Notable for |
|---|---|
| `article.md` | `externalClass: thought:Article` |
| `book.md` | `externalClass: thought:Book` |
| `claim.md` | The thought-ontology bridge: `externalClass: thought:Claim`, and a `predicate:` on every property |
| `event.md` | Two `link-to-type` properties (`place`, `person`) |
| `glossary-term.md` | `externalClass: thought:Term`, `predicate: thought:seeAlso` |
| `idea.md` | A plain `enum` lifecycle |
| `meeting.md` | `link-to-type` organizer, free-text attendees |
| `person.md` | `externalClass: foaf:Person` plus a property-level `predicate: foaf:mbox` |
| `place.md` | The only `geo` property in the stock set |
| `project.md` | `enum` status + `link-to-type` owner |

`claim.md` is the one to read if you are doing anything with the thought
ontology, and `person.md` is the shortest complete illustration of both
vocabulary-bridging keys at once.

## What's checked

`tests/architecture/authoring-types-doc.test.ts` keeps this file honest against
the code: every frontmatter key the parser reads, every property-level key,
every entry in `PROPERTY_TYPES`, every prefix in `STANDARD_PREFIXES`, and every
stock type file must appear here. Add a key, a property type, a prefix or a
stock type and this document fails a test until it mentions it.

It checks **presence, not accuracy** — a row whose description has gone wrong
still passes. Naming the thing is the part that actually gets forgotten.

## See also

- [The Thought Ontology](thought-ontology.md) — what `externalClass:
  thought:Claim` buys you, and the two-representations trap.
- [`authoring-skills.md`](authoring-skills.md) — the sibling format, for the
  Tools-for-Thought menus.
- `src/main/types/parse.ts` — the parser. The source of truth for this schema.
- `src/main/types/loader.ts` — catalog assembly, stock/user precedence.
- `src/main/graph/indexers/type-classes.ts` — what a type becomes in the graph.
- `docs/vision/objects.md` — the design decisions this format encodes.
