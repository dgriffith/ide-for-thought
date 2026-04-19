/**
 * Typed link registry.
 *
 * To add a new link type, add an entry here. Everything else — parsing,
 * rendering, ontology predicates, graph indexing — derives from this list.
 */

export interface LinkType {
  /** Syntax name used in `[[type::target]]` */
  name: string;
  /** Human-readable label */
  label: string;
  /** OWL predicate local name (appended to predicateNamespace, default minerva:) */
  predicate: string;
  /** Namespace the predicate belongs to. Default: 'minerva'. */
  predicateNamespace?: 'minerva' | 'thought';
  /** What the target resolves to. Default: 'note'. */
  targetKind?: 'note' | 'source' | 'excerpt';
  /** CSS color for preview rendering */
  color: string;
}

export const LINK_TYPES: LinkType[] = [
  {
    name: 'references',
    label: 'References',
    predicate: 'references',
    color: '#89b4fa', // accent blue
  },
  {
    name: 'supports',
    label: 'Supports',
    predicate: 'supports',
    color: '#a6e3a1', // green
  },
  {
    name: 'rebuts',
    label: 'Rebuts',
    predicate: 'rebuts',
    color: '#f38ba8', // red
  },
  {
    name: 'expands',
    label: 'Expands',
    predicate: 'expands',
    color: '#cba6f7', // purple
  },
  {
    name: 'depends-on',
    label: 'Depends On',
    predicate: 'dependsOn',
    color: '#fab387', // orange
  },
  {
    name: 'implements',
    label: 'Implements',
    predicate: 'implements',
    color: '#74c7ec', // teal
  },
  {
    name: 'alternative-to',
    label: 'Alternative To',
    predicate: 'alternativeTo',
    color: '#f9e2af', // yellow
  },
  {
    name: 'supersedes',
    label: 'Supersedes',
    predicate: 'supersedes',
    color: '#eba0ac', // pink
  },
  {
    name: 'related-to',
    label: 'Related To',
    predicate: 'relatedTo',
    color: '#9399b2', // grey
  },
  {
    name: 'cite',
    label: 'Cites',
    predicate: 'cites',
    predicateNamespace: 'thought',
    targetKind: 'source',
    color: '#94e2d5', // teal-green — distinct from references/implements
  },
  {
    name: 'quote',
    label: 'Quotes',
    predicate: 'quotes',
    predicateNamespace: 'thought',
    targetKind: 'excerpt',
    color: '#b4befe', // lavender — adjacent to cite but distinct
  },
];

/** Look up a link type by syntax name. Falls back to 'references'. */
export function getLinkType(name: string): LinkType {
  return LINK_TYPES.find((t) => t.name === name) ?? LINK_TYPES[0];
}

/** Map from syntax name to LinkType for fast lookup */
export const LINK_TYPE_MAP = new Map<string, LinkType>(
  LINK_TYPES.map((t) => [t.name, t]),
);
