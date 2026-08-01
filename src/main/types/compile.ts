/**
 * Compile a type catalog into ontology triples (#1062). Each type becomes a
 * class in the `types:` namespace — `rdf:type rdfs:Class`, `rdfs:label`, its
 * expected property names, and optional icon/color — so `?x rdf:type types:Book`
 * is queryable and the graph, not just the registry, knows the type exists.
 *
 * These are global (un-named-graph) resource triples like `ensureTag`; the
 * wholesale store reset in `indexAllNotes` wipes and re-materializes them each
 * rebuild, so they never go stale.
 */
import * as $rdf from 'rdflib';
import { MINERVA, RDF, RDFS, TYPES } from '../graph/state';
import type { TypeCatalog } from '../../shared/objects/type-def';

export function materializeTypeClasses(store: $rdf.IndexedFormula, catalog: TypeCatalog): void {
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
  }
}
