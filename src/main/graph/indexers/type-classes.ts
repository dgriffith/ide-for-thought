/**
 * Compile a type catalog into ontology triples (#1062).
 *
 * MOVED HERE from `src/main/types/compile.ts` by #2234 PR 3. It was the one
 * piece of code outside `graph/` holding a reference to the graph's internal
 * `IndexedFormula` and writing to it directly — no facade, no package
 * boundary — which is what made `GraphState.store` public in practice however
 * the type declared it. It was also half of a package-level cycle:
 * `types/compile` imported `graph/state` for the namespaces while
 * `graph/indexers/rebuild` imported `types/compile` for this function.
 * (File-level cycle detection didn't see it — `state.ts` imports nothing back —
 * which is why it survived `no-cycles.test.ts`.)
 *
 * Moving it inverts nothing and fixes both: the types package now only
 * DESCRIBES types (`loader`, `parse`, `write`), the graph package WRITES them,
 * and `types/` no longer depends on rdflib or on the graph at all. Each type becomes a
 * class in the `types:` namespace — `rdf:type rdfs:Class`, `rdfs:label`, its
 * expected property names, and optional icon/color — so `?x rdf:type types:Book`
 * is queryable and the graph, not just the registry, knows the type exists.
 *
 * These are global (un-named-graph) resource triples like `ensureTag`; the
 * wholesale store reset in `indexAllNotes` wipes and re-materializes them each
 * rebuild, so they never go stale.
 */
import * as $rdf from 'rdflib';
import { MINERVA, RDF, RDFS, TYPES, resolveStandardCurie } from '../state';
import type { TypeCatalog } from '../../../shared/objects/type-def';

export function materializeTypeClasses(store: $rdf.IndexedFormula, catalog: TypeCatalog): void {
  const byId = new Map(catalog.types.map((t) => [t.id, t]));
  for (const t of catalog.types) {
    const cls = TYPES(t.classLocalName);
    store.add(cls, RDF('type'), RDFS('Class'));
    store.add(cls, RDFS('label'), $rdf.lit(t.label));
    store.add(cls, MINERVA('typeId'), $rdf.lit(t.id));
    if (t.icon) store.add(cls, MINERVA('typeIcon'), $rdf.lit(t.icon));
    if (t.color) store.add(cls, MINERVA('typeColor'), $rdf.lit(t.color));
    for (const p of t.properties) {
      store.add(cls, TYPES('expectsProperty'), $rdf.lit(p.name));
    }
    // Subclassing (#1586): a parent (validated to exist by the loader) becomes
    // an `rdfs:subClassOf` edge, so `?x a/rdfs:subClassOf* types:Parent` returns
    // this type's instances too.
    const parent = t.parent ? byId.get(t.parent) : undefined;
    if (parent) store.add(cls, RDFS('subClassOf'), TYPES(parent.classLocalName));
    // External vocabulary alignment (#2036): an optional `externalClass`
    // (e.g. `foaf:Person`) becomes a SIBLING `rdfs:subClassOf` edge — not
    // `owl:equivalentClass` — specifically so it participates in the exact
    // same `?x a/rdfs:subClassOf* foaf:Person` property-path idiom this
    // codebase already uses everywhere for type hierarchy (this store does
    // no OWL/RDFS entailment, so equivalentClass wouldn't be chased the same
    // way). A class can carry both a Minerva `parent` and an `externalClass`
    // at once — multiple `subClassOf` values on one class is standard RDF.
    if (t.externalClass) {
      const external = resolveStandardCurie(t.externalClass);
      if (external) store.add(cls, RDFS('subClassOf'), external);
    }
  }
}
