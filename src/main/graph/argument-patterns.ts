/**
 * Shared SPARQL fragments for querying argument structure (#2230).
 *
 * A thought component can reach the graph two ways, and until #2230 every
 * query that looked for one only ever saw the first:
 *
 *   - **Hand-authored Turtle** — an embedded ```turtle block, the
 *     `crystallize` skill's output, the tutorial thoughtbase — asserts
 *     `a thought:Claim` and carries a `thought:label`. This is the shape the
 *     health checks and the grounding query were written against.
 *   - **A typed note** — what every claim the app itself files looks like
 *     since #2036. `type: claim` frontmatter asserts `a types:Claim`, which
 *     the type compiler declares `rdfs:subClassOf thought:Claim` (deliberately
 *     `subClassOf` rather than `owl:equivalentClass`, so the store's
 *     property-path idiom reaches it without OWL entailment), and the note's
 *     title lands as `dc:title`. Neither `a thought:Claim` nor `thought:label`
 *     matches any of it.
 *
 * So `extract-key-claims` could mine claims all day and "which claims lack
 * support?" still answered "none" — an empty panel reading as "no problems"
 * from the one feature whose job is finding gaps in reasoning. The right
 * idiom already existed in the codebase (`integrity.ts`'s trust gate uses
 * `rdf:type/rdfs:subClassOf*`); it just wasn't applied uniformly, and nothing
 * made it the obvious thing to reach for. That's what this module is for:
 * one place that knows both representations, so the next query about claims
 * can't quietly be written against only half the graph.
 *
 * Every fragment returns SPARQL text for interpolation into a query body.
 * `queryGraph` auto-injects the standard prefixes (#1602), so nothing here
 * carries a PREFIX line.
 */

/** `?v` is an instance of `thought:<cls>`, directly or through any subclass
 *  chain — which is what picks up the `types:*` classes the object-type
 *  compiler materialises. */
export function isA(v: string, cls: string): string {
  return `?${v} rdf:type/rdfs:subClassOf* thought:${cls} .`;
}

/**
 * Bind `?<out>` to a component's display label from either representation,
 * preferring `thought:label` when a node somehow carries both — the fallback
 * is a fallback, so an existing thoughtbase's labels don't shift underneath it.
 *
 * The trailing FILTER preserves the inner-join behaviour of the
 * `?v thought:label ?label` pattern this replaces: a node with no label at all
 * can't be described in an inspection message, so it isn't reported.
 */
export function labelOf(v: string, out = `${v}Label`): string {
  return `
      OPTIONAL { ?${v} thought:label ?${out}Thought }
      OPTIONAL { ?${v} dc:title ?${out}Title }
      BIND(COALESCE(?${out}Thought, ?${out}Title) AS ?${out})
      FILTER(BOUND(?${out}))`;
}

/**
 * The two predicates that mean "this backs that up". `thought:supports` comes
 * from `supports: <uri>` frontmatter and the Claim object type's `supports`
 * property; `minerva:supports` from a `[[supports::note]]` wiki-link or its
 * frontmatter-link equivalent (#1351). Both are the user saying the same
 * thing, so a check for "nothing supports this" has to find neither.
 */
export const SUPPORT_PREDICATES = ['thought:supports', 'minerva:supports'] as const;

/** `?subject` supports `?v` by either predicate. Positive position only — see
 *  `unsupported` for why the negative position can't use this. */
export function supportedBy(subject: string, v: string): string {
  return `?${subject} (${SUPPORT_PREDICATES.join('|')}) ?${v} .`;
}

/**
 * "Nothing (of kind `cls`, when given) supports `?v`" — one
 * `FILTER NOT EXISTS` per support predicate, which is logically the same as a
 * single NOT EXISTS over their union.
 *
 * Written the long way deliberately. The query engine (Comunica) evaluates
 * `FILTER NOT EXISTS { ?x (a|b) ?y }` — and the equivalent inner `UNION` — as
 * matching *nothing* when neither predicate appears anywhere in the store,
 * which inverts to excluding every row: an empty thoughtbase, or one whose
 * claims nobody has linked yet, would report zero unsupported claims. That is
 * exactly the silent-empty-panel failure these checks exist to catch, so the
 * extra clause is worth it. A single-predicate NOT EXISTS has no such problem,
 * and neither does an alternation in positive position — hence `supportedBy`
 * staying as it is.
 */
export function unsupported(v: string, cls?: string): string {
  return SUPPORT_PREDICATES
    .map((predicate, i) => {
      const s = `${v}Supporter${i}`;
      const typed = cls ? `\n        ${isA(s, cls)}` : '';
      return `FILTER NOT EXISTS {
        ?${s} ${predicate} ?${v} .${typed}
      }`;
    })
    .join('\n      ');
}
