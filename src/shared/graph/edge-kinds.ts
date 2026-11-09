/**
 * The graph's one edge model (#2957, epic #2956): every kind of connection a
 * graph surface draws, with its label, colour and whether it shows by
 * default. The neighbourhood walk (`main/graph/neighborhood.ts`) labels each
 * edge it finds through here, and the legend and filter list what it found,
 * so every graph surface reads the same kinds.
 *
 * The kinds:
 * - **Links** — the `LINK_TYPES` kinds (`[[type::target]]` and plain
 *   `[[target]]`), as before. Citation kinds point at sources (`source`).
 * - **Argument relations** — the ontology's `thought:` structural relations.
 *   `thought:supports` / `thought:rebuts` are the SAME kinds as the
 *   `supports` / `rebuts` wiki-links: a typed Claim's `supports:` and a
 *   `[[supports::…]]` mean one thing (#2230), so they're one edge kind.
 * - **Link properties** — one kind per `link-to-type` property (`types:<name>`,
 *   `property:<name>`), labelled from the types catalog.
 * - **Other frontmatter links** — a frontmatter key whose value names a note
 *   (`see-also:`, `about:`, a custom key), one kind per key (`frontmatter:<key>`).
 * - **Tags** — a tag as a node with "has tag" edges. Off by default: a tag
 *   joins every note that carries it, which swamps a neighbourhood.
 */
import { LINK_TYPES } from '../link-types';

export type EdgeKindGroup = 'link' | 'source' | 'argument' | 'property' | 'frontmatter' | 'tag';

export interface EdgeKind {
  /** Stable id, carried by every edge (`NeighborhoodEdge.linkType`). */
  id: string;
  label: string;
  /** A colour the legend and the edge share. */
  color: string;
  group: EdgeKindGroup;
  /** Drawn unless the user turns it off. */
  defaultOn: boolean;
}

const THOUGHT = 'https://minerva.dev/ontology/thought#';
const TYPES = 'https://minerva.dev/ontology/types#';

/** A frontmatter-made edge's colour: muted, so body links keep the vocabulary's colours. */
export const FRONTMATTER_EDGE_COLOR = '#9399b2';

/** The `thought:` relations beyond supports / rebuts (which share the wiki-link kinds). */
const ARGUMENT_RELATIONS: ReadonlyArray<{ local: string; label: string; color: string }> = [
  { local: 'challenges', label: 'Challenges', color: '#eba0ac' },
  { local: 'grounds', label: 'Grounds', color: '#94e2d5' },
  { local: 'qualifies', label: 'Qualifies', color: '#f5c2e7' },
  { local: 'refines', label: 'Refines', color: '#b4befe' },
  { local: 'presupposes', label: 'Presupposes', color: '#fab387' },
  { local: 'exemplifies', label: 'Exemplifies', color: '#a6e3a1' },
  { local: 'contrasts', label: 'Contrasts', color: '#f9e2af' },
];

/** The wiki-link kinds, as edge kinds. */
export const LINK_EDGE_KINDS: readonly EdgeKind[] = LINK_TYPES.map((lt) => ({
  id: lt.name,
  label: lt.label,
  color: lt.color,
  group: lt.targetKind && lt.targetKind !== 'note' ? 'source' : 'link',
  defaultOn: true,
}));

export const ARGUMENT_EDGE_KINDS: readonly EdgeKind[] = ARGUMENT_RELATIONS.map((r) => ({
  id: `argument:${r.local}`, label: r.label, color: r.color, group: 'argument', defaultOn: true,
}));

export const TAG_EDGE_KIND: EdgeKind = { id: 'tag', label: 'Has tag', color: '#7f849c', group: 'tag', defaultOn: false };

/** "seeAlso" → "See Also", "meta-related" → "Related", "wasDerivedFrom" → "Was Derived From". */
export function humanizeKey(local: string): string {
  const key = local.startsWith('meta-') ? local.slice('meta-'.length) : local;
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
}

/** A `link-to-type` property's kind, labelled as the catalog labels it. */
export function propertyEdgeKind(name: string, label?: string): EdgeKind {
  return { id: `property:${name}`, label: label ?? humanizeKey(name), color: FRONTMATTER_EDGE_COLOR, group: 'property', defaultOn: true };
}

function localName(iri: string): string {
  return iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
}

const BY_ID = new Map<string, EdgeKind>([...LINK_EDGE_KINDS, ...ARGUMENT_EDGE_KINDS, TAG_EDGE_KIND].map((k) => [k.id, k]));

/**
 * The kind an edge between two notes is, from the predicate that made it.
 * `propertyLabel` names a `types:` property as the catalog does. Every
 * predicate that links two notes has a kind — a frontmatter key with no other
 * home is its own `frontmatter:<key>` kind — so nothing connecting notes is
 * left off the graph.
 */
export function edgeKindForPredicate(iri: string, propertyLabel?: (name: string) => string | undefined): EdgeKind {
  const local = localName(iri);
  if (iri.startsWith(THOUGHT)) {
    if (local === 'supports' || local === 'rebuts') return BY_ID.get(local)!;
    const argument = BY_ID.get(`argument:${local}`);
    if (argument) return argument;
  }
  if (iri.startsWith(TYPES)) return propertyEdgeKind(local, propertyLabel?.(local));
  return { id: `frontmatter:${local}`, label: humanizeKey(local), color: FRONTMATTER_EDGE_COLOR, group: 'frontmatter', defaultOn: true };
}

/** A registered kind by id (links, argument relations, tags); dynamic property and frontmatter kinds aren't registered. */
export function edgeKind(id: string): EdgeKind | undefined {
  return BY_ID.get(id);
}

/**
 * Every kind a thoughtbase can draw: the links, the argument relations, one
 * per `link-to-type` property in the catalog, and tags. The frontmatter kinds
 * depend on what notes say, so they appear as the walk finds them.
 */
export function edgeKinds(linkProperties: ReadonlyArray<{ name: string; label?: string }>): EdgeKind[] {
  const props = new Map<string, EdgeKind>();
  for (const p of linkProperties) if (!props.has(p.name)) props.set(p.name, propertyEdgeKind(p.name, p.label));
  return [...LINK_EDGE_KINDS, ...ARGUMENT_EDGE_KINDS, ...props.values(), TAG_EDGE_KIND];
}
