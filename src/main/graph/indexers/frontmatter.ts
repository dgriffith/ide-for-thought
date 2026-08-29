/**
 * Frontmatter value → RDF conversion (#1905 — split out of indexers.ts).
 *
 * One cohesive value-mapping concern that never touches orchestration: given
 * a parsed frontmatter value (scalar, list, or nested mapping) and the key's
 * resolved predicate, emit the graph edge(s) it becomes. `indexNoteImpl` in
 * `../indexers.ts` is the sole caller of `emitFrontmatterValue`; the rest of
 * this module is its exclusive internal machinery.
 */
import * as $rdf from 'rdflib';
import { type FrontmatterValue, type FrontmatterMap } from '../parser';
import { getLinkType } from '../../../shared/link-types';
import { mapFrontmatterKey, type FrontmatterPredicate } from '../frontmatter-predicates';
import { parseWikiInner } from '../../../shared/wiki-link';
import {
  type GraphState,
  MINERVA, DC, XSD, BIBO, SCHEMA, PROV, THOUGHT, TYPES,
  sourceUri, linkPredicate,
} from '../state';
import type { PropertyType } from '../../../shared/objects/type-def';
import { resolveLinkTarget, type LinkResolveCtx } from '../index-helpers';

// A non-null leaf scalar — excludes lists AND nested maps (maps materialise as
// blank nodes in emitFrontmatterValue, never as a single edge).
type FrontmatterScalarNonNull = string | number | boolean | Date;

/**
 * Reconstitute YAML-eaten wiki-link shorthand. The user writes
 *
 *   about: [[sources/foo]]
 *
 * intending a wiki-link, but YAML's flow syntax interprets the outer
 * `[…]` as an array literal and the inner `[…]` as a nested array,
 * yielding `[['sources/foo']]`. The brackets the user typed are gone
 * by the time we see the value.
 *
 * The narrow signature `[[<single string>]]` is unambiguous —
 * authentic length-1 arrays of length-1 arrays of strings don't
 * occur in normal frontmatter. Translate that one shape back into
 * the wiki-link form a downstream consumer expects. Anything more
 * complex (multi-element inner array, mixed types) is left alone —
 * users who need lists should use the proper YAML list form anyway.
 */
function recoverYamlEatenWikiLink(value: FrontmatterValue): FrontmatterValue {
  if (
    Array.isArray(value)
    && value.length === 1
    && Array.isArray(value[0])
    && value[0].length === 1
    && typeof value[0][0] === 'string'
  ) {
    return `[[${value[0][0]}]]`;
  }
  return value;
}

function isFrontmatterMap(value: FrontmatterValue): value is FrontmatterMap {
  return typeof value === 'object' && value !== null
    && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Emit the graph triples for one frontmatter value under `subject` (the note
 * IRI at the top level, a blank node when recursing into a nested mapping):
 *
 *  - scalar / wiki-link → one edge via `frontmatterValueToEdge`
 *  - list               → one edge per element, all under `keyPredicate`
 *  - nested mapping      → a fresh blank node linked under `keyPredicate`, with
 *    the map's own keys becoming `minerva:meta-<subkey>` predicates on that
 *    blank node (recursively). RDF's idiomatic way to carry structured
 *    metadata — so `address: { city: … }` is queryable via
 *    `?note minerva:meta-address/minerva:meta-city ?c` instead of being dropped.
 *    Nested keys always take the `meta-` form (not canonical mapping): a nested
 *    structure is opaque user data, so its keys stay predictable rather than
 *    sometimes resolving to dc:/schema:/… predicates. The blank node is linked
 *    in only if it received at least one child triple, so an
 *    all-unmaterialisable map leaves nothing.
 *
 * `depth` caps recursion (matches the parser's own sanitise cap).
 */
/** Recursion cap for nested frontmatter values — matches the parser's own
 *  sanitise cap. */
const MAX_FRONTMATTER_DEPTH = 8;

export function emitFrontmatterValue(
  state: GraphState,
  store: $rdf.IndexedFormula,
  subject: $rdf.NamedNode | $rdf.BlankNode,
  keyPredicate: ReturnType<typeof resolveFrontmatterPredicate>,
  value: FrontmatterValue,
  graph: $rdf.NamedNode,
  rc: LinkResolveCtx,
  depth: number,
  // When the key is a declared property of the note's type (#1063), its declared
  // property-type drives the RDF datatype (schema over value-guessing) — so a
  // `text` value that looks like a year stays a string, a numeric string becomes
  // xsd:integer, etc. Undefined for untyped notes / undeclared keys (unchanged).
  declaredType?: PropertyType,
): void {
  if (depth > MAX_FRONTMATTER_DEPTH) return;
  const recovered = recoverYamlEatenWikiLink(value);
  if (recovered === null || recovered === undefined) return;
  if (Array.isArray(recovered)) {
    for (const item of recovered) {
      emitFrontmatterValue(state, store, subject, keyPredicate, item, graph, rc, depth + 1, declaredType);
    }
    return;
  }
  if (isFrontmatterMap(recovered)) {
    const bnode = $rdf.blankNode();
    let childCount = 0;
    for (const [subkey, subval] of Object.entries(recovered)) {
      const before = store.statements.length;
      // Nested keys are always `meta-<subkey>` — predictable, opaque data
      // (not run through canonical key mapping like top-level keys are).
      emitFrontmatterValue(
        state, store, bnode, MINERVA(`meta-${subkey}`), subval, graph, rc, depth + 1,
      );
      if (store.statements.length > before) childCount++;
    }
    if (childCount > 0) store.add(subject, keyPredicate, bnode, graph);
    return;
  }
  const edge = frontmatterValueToEdge(recovered, state, keyPredicate, rc, declaredType);
  if (edge) store.add(subject, edge.predicate, edge.term, graph);
}

export function resolveFrontmatterPredicate(key: string) {
  const mapped: FrontmatterPredicate | null = mapFrontmatterKey(key);
  if (!mapped) return MINERVA(`meta-${key}`);
  switch (mapped.ns) {
    case 'dc': return DC(mapped.local);
    case 'bibo': return BIBO(mapped.local);
    case 'schema': return SCHEMA(mapped.local);
    case 'thought': return THOUGHT(mapped.local);
    case 'prov': return PROV(mapped.local);
  }
}

/**
 * The predicate a declared property's value is indexed under (#1073). A
 * `link-to-type` property materialises as a labeled **role edge** in the types
 * namespace — `types:author` — so the relation is queryable by its role and
 * shows that role in backlinks, instead of collapsing to a generic
 * `dc:creator`/`minerva:meta-*` predicate. Every other property keeps the
 * frontmatter-key predicate. The indexer (write) and the #1063 read-back +
 * #1070 projection (read) MUST both resolve through here so they stay in sync.
 */
export function declaredPropertyPredicate(name: string, type?: PropertyType) {
  return type === 'link-to-type' ? TYPES(name) : resolveFrontmatterPredicate(name);
}

/** Whole frontmatter value that is a single wiki-link — `[[…]]` and nothing
 *  else. The inner is then parsed by the shared body grammar (`parseWikiInner`)
 *  so type prefixes and anchors are honoured, not swept into the target. */
const WHOLE_WIKILINK_RE = /^\[\[([^\]\n]+?)\]\]$/;

/** ISO date / datetime / year-month / year shapes used to type frontmatter scalars (#1608). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;

/** A frontmatter edge's object term — a resolved link node or a literal. */
type FrontmatterEdgeTerm = ReturnType<typeof resolveLinkTarget> | ReturnType<typeof $rdf.lit>;

/**
 * Resolve a whole-value wiki-link (`[[…]]` spanning the entire frontmatter
 * value) to its `{ predicate, term }` edge, or null when `value` isn't one.
 * `[[sources/<id>]]` edges to the source node (#474). With `honorLinkType` (the
 * shape-guessing path), an explicit `[[type::target]]` switches the predicate to
 * that link type; the schema `link-to-type` path passes it false so the value
 * stays an untyped reference under the frontmatter key. (#1608)
 */
function resolveWholeWikiLink(
  value: string,
  state: GraphState,
  keyPredicate: ReturnType<typeof resolveFrontmatterPredicate>,
  rc: LinkResolveCtx,
  honorLinkType: boolean,
) {
  const inner = state.baseUri ? value.match(WHOLE_WIKILINK_RE) : null;
  if (!inner) return null;
  const link = parseWikiInner(inner[1]!);
  // #474: a bare `[[sources/<id>]]` edges to the actual source node.
  if (!link.type && link.target.startsWith('sources/')) {
    const sourceId = link.target.slice('sources/'.length);
    if (sourceId) return { predicate: keyPredicate, term: sourceUri(state, sourceId) };
  }
  // getLinkType falls back to `references` for untyped/unknown types. The
  // predicate only switches to the link type when one was written explicitly and
  // the caller honors it; otherwise the frontmatter key stays authoritative.
  const linkType = getLinkType(honorLinkType ? (link.type ?? 'references') : 'references');
  const predicate = honorLinkType && link.type ? linkPredicate(linkType) : keyPredicate;
  const anchor = link.anchor ? link.anchor.slice(1) : undefined; // parseWikiInner keeps the leading '#'
  return { predicate, term: resolveLinkTarget(state, linkType, link.target, rc, anchor) };
}

/**
 * Turn a frontmatter scalar into a graph edge — `{ predicate, term }`. The
 * caller supplies `keyPredicate` (derived from the frontmatter key); a value
 * with its own typed wiki-link overrides it.
 *
 * Wiki-link values are parsed with the SAME grammar as body links so a
 * frontmatter link renders IDENTICALLY to a body one (same predicate, same
 * anchored target IRI):
 * - `[[supports::x]]` — the link's own `type::` wins, mapped through
 *   `LINK_TYPES` exactly like a body `[[supports::x]]`, overriding `keyPredicate`.
 * - `[[x#heading]]` / `[[x#^block]]` — the anchor resolves + appends via the
 *   shared `resolveLinkTarget`, just as in the body.
 * - `[[x]]` / `[[x|display]]` — untyped: keeps `keyPredicate` (the
 *   frontmatter-key-as-type feature); the display alias is cosmetic and dropped.
 * - `[[sources/<id>]]` — the actual source node (#474 convention), untyped.
 *
 * Non-link scalars keep `keyPredicate`: `42`→xsd:integer, `3.14`→xsd:decimal,
 * `true`→xsd:boolean, `Date`/ISO shapes→xsd:date(Time)/gYear, a bare `https://…`
 * →an IRI node, everything else→a plain string literal.
 */
function frontmatterValueToEdge(
  value: FrontmatterScalarNonNull,
  state: GraphState,
  keyPredicate: ReturnType<typeof resolveFrontmatterPredicate>,
  rc: LinkResolveCtx,
  declaredType?: PropertyType,
) {
  const plain = (term: FrontmatterEdgeTerm) => ({ predicate: keyPredicate, term });

  // Schema-driven coercion (#1063): when the type declares this property, the
  // declared type — not a guess from the value's shape — picks the RDF datatype.
  if (declaredType) return coerceDeclared(value, declaredType, state, keyPredicate, rc);

  if (value instanceof Date) return plain($rdf.lit(value.toISOString(), undefined, XSD('dateTime')));
  if (typeof value === 'boolean') return plain($rdf.lit(String(value), undefined, XSD('boolean')));
  if (typeof value === 'number') {
    const datatype = Number.isInteger(value) ? 'integer' : 'decimal';
    return plain($rdf.lit(String(value), undefined, XSD(datatype)));
  }

  // Whole-value wiki-link → parse with the body grammar for full parity; an
  // explicit `[[type::x]]` here overrides the frontmatter-key predicate.
  const wikiEdge = resolveWholeWikiLink(value, state, keyPredicate, rc, true);
  if (wikiEdge) return wikiEdge;

  // Bare absolute URI → IRI node (e.g. `supports: https://minerva.dev/c/claim-…`).
  // The tail check excludes whitespace so a longer string that merely starts
  // with a URL isn't mis-classified.
  if (/^https?:\/\/\S+$/.test(value)) return plain($rdf.sym(value));
  if (ISO_DATE_RE.test(value)) return plain($rdf.lit(value, undefined, XSD('date')));
  if (ISO_DATETIME_RE.test(value)) return plain($rdf.lit(value, undefined, XSD('dateTime')));
  if (YEAR_RE.test(value)) return plain($rdf.lit(value, undefined, XSD('gYear')));
  return plain($rdf.lit(value));
}

/**
 * Coerce a frontmatter value to the datatype its type DECLARES (#1063), rather
 * than guessing from the value's shape. `text`/`enum` are always plain strings
 * (so an isbn `978…` or a title `2020` isn't mis-typed as a number/year);
 * `number` rescues numeric strings; `date` accepts the ISO shapes; `link-to-type`
 * resolves a whole-value wiki-link to its target (edge-labeling is #1073), else a
 * string. Anything that can't be coerced falls back to a plain string literal.
 */
function coerceDeclared(
  value: FrontmatterScalarNonNull,
  declaredType: PropertyType,
  state: GraphState,
  keyPredicate: ReturnType<typeof resolveFrontmatterPredicate>,
  rc: LinkResolveCtx,
) {
  const plain = (term: FrontmatterEdgeTerm) => ({ predicate: keyPredicate, term });
  const str = value instanceof Date ? value.toISOString() : String(value);
  const asString = () => plain($rdf.lit(str));

  switch (declaredType) {
    case 'text':
    case 'enum':
      return asString();
    case 'number': {
      const n = typeof value === 'number' ? value : Number(str.trim());
      if (str.trim() !== '' && Number.isFinite(n)) {
        return plain($rdf.lit(String(n), undefined, XSD(Number.isInteger(n) ? 'integer' : 'decimal')));
      }
      return asString();
    }
    case 'date': {
      if (value instanceof Date) return plain($rdf.lit(str.slice(0, 10), undefined, XSD('date')));
      const s = str.trim();
      if (ISO_DATE_RE.test(s)) return plain($rdf.lit(s, undefined, XSD('date')));
      if (ISO_DATETIME_RE.test(s)) return plain($rdf.lit(s, undefined, XSD('dateTime')));
      if (YEAR_MONTH_RE.test(s)) return plain($rdf.lit(s, undefined, XSD('gYearMonth')));
      if (YEAR_RE.test(s)) return plain($rdf.lit(s, undefined, XSD('gYear')));
      return asString();
    }
    case 'link-to-type':
      // Whole-value link only (edge-labeling is #1073) — untyped reference under
      // the frontmatter key, so honorLinkType is false.
      return resolveWholeWikiLink(str, state, keyPredicate, rc, false) ?? asString();
  }
}
