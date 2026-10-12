/**
 * Minerva's extension points, and what is installed in each, as triples
 * (#2618, epic #2616) — so "which seams take a declarative contribution?" and
 * "what did this plugin add?" are one SPARQL query each.
 *
 * Everything goes in ONE named graph, `EXTENSIONS_GRAPH`, which
 * `serializeUserGraph` leaves out of `graph.ttl`. Two reasons it must never be
 * persisted: some contributions are per machine (your skills, your MCP
 * servers), and a thoughtbase is shared — a server list travelling with it is
 * the shape #2571 closed. And the catalog is derived, so it's rebuilt from
 * its sources rather than read back.
 *
 * Provenance is PROV-O. A contribution is `prov:wasAttributedTo` its supplier:
 * `minerva:stock` for what ships with the app, `minerva:localUser` for this
 * machine's folders, the thoughtbase's own `minerva:Project` for its
 * `.minerva/` folder, and (#2631) a `minerva:Plugin`. `prov:generatedAtTime`
 * is when this materialisation ran.
 *
 * App bookkeeping, like the type classes: the writes run in trusted context
 * through the store chokepoint (#2231), so the write guard never mistakes them
 * for an LLM write.
 */
import * as $rdf from 'rdflib';
import { DC, MINERVA, PROV, RDF, RDFS, XSD, projectUri, type GraphState } from '../state';
import { withTrustedContext } from '../write-guard';
import { EXTENSION_POINTS, type ContributionSource, type ExtensionPoint } from '../../../shared/extensions/points';
import type { Contribution } from '../../../shared/extensions/contributions';

/** The named graph the catalog lives in — never written to `graph.ttl`. */
export const EXTENSIONS_GRAPH = $rdf.sym('urn:x-minerva:extensions');

export const extensionPointIri = (id: string) => $rdf.sym(`urn:x-minerva:extension-point:${encodeURIComponent(id)}`);
const contributionIri = (point: string, id: string) =>
  $rdf.sym(`urn:x-minerva:contribution:${encodeURIComponent(point)}:${encodeURIComponent(id)}`);

function agentFor(state: GraphState, source: ContributionSource) {
  switch (source) {
    case 'stock': return MINERVA('stock');
    case 'user': return MINERVA('localUser');
    case 'thoughtbase': return projectUri(state);
    // No plugin loads yet (#2631); its contributions will carry the plugin's own IRI.
    case 'plugin': return MINERVA('Plugin');
  }
}

/** Replace the catalog with the points plus `contributions`. */
export function materializeExtensionCatalog(
  state: GraphState,
  contributions: readonly Contribution[],
  now: Date = new Date(),
): void {
  withTrustedContext(() => {
    const { store } = state;
    const g = EXTENSIONS_GRAPH;
    store.removeMatches(null, null, null, g);

    for (const point of EXTENSION_POINTS as readonly ExtensionPoint[]) {
      const p = extensionPointIri(point.id);
      store.add(p, RDF('type'), MINERVA('ExtensionPoint'), g);
      store.add(p, DC('identifier'), $rdf.lit(point.id), g);
      store.add(p, RDFS('label'), $rdf.lit(point.label), g);
      // rdfs:comment, as the ontology describes its terms — not dc:description,
      // which is a note's frontmatter description and would join every query for those.
      store.add(p, RDFS('comment'), $rdf.lit(point.description), g);
      store.add(p, MINERVA('rung'), $rdf.lit(point.rung), g);
      store.add(p, MINERVA('loadPath'), $rdf.lit(point.loadPath), g);
      for (const source of point.sources) store.add(p, MINERVA('acceptsSource'), $rdf.lit(source), g);
      if (point.contract.kind === 'parser') store.add(p, MINERVA('contractFormat'), $rdf.lit(point.contract.format), g);
      if (point.location) store.add(p, MINERVA('contributionLocation'), $rdf.lit(point.location), g);
    }

    const at = $rdf.lit(now.toISOString(), undefined, XSD('dateTime'));
    for (const c of contributions) {
      const iri = contributionIri(c.point, c.id);
      store.add(iri, RDF('type'), MINERVA('Contribution'), g);
      store.add(iri, MINERVA('contributesTo'), extensionPointIri(c.point), g);
      store.add(iri, DC('identifier'), $rdf.lit(c.id), g);
      store.add(iri, RDFS('label'), $rdf.lit(c.label), g);
      store.add(iri, PROV('wasAttributedTo'), agentFor(state, c.source), g);
      store.add(iri, PROV('generatedAtTime'), at, g);
      if (c.location) store.add(iri, MINERVA('contributionLocation'), $rdf.lit(c.location), g);
    }
  });
}
