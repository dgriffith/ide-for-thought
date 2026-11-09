/**
 * The Graph layout's model (#2960): a type or query view's notes as nodes and
 * its link properties as edges, one kind each. Shared, because the layout is
 * drawn by the built-in Graph plugin (`plugins/graph/`) while the app owns its
 * spec fields — `edges` (the link properties drawn, null for all) and
 * `outside` (whether a link to a note the view doesn't show draws that note,
 * muted, or is left out).
 */

/** Whether a linked note outside the view is drawn (muted) or left out. */
export type GraphOutside = 'show' | 'hide';

export const GRAPH_OUTSIDE: readonly GraphOutside[] = ['show', 'hide'];

export function parseGraphOutside(raw: unknown): GraphOutside {
  return raw === 'hide' ? 'hide' : 'show';
}

/** The link properties a graph draws: a list of names, or null for all of them. */
export function parseGraphEdges(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v !== ''))];
}

/** A note as the model needs it: the plugin's view instance has this shape. */
export interface GraphViewInstance {
  path: string;
  title: string;
  icon?: { label: string; color?: string } | undefined;
  /** The notes this one's link properties name, resolved by the host. */
  links?: readonly { property: string; path: string; title: string }[] | undefined;
}

export interface GraphViewProperty {
  name: string;
  type: string;
  label?: string | undefined;
}

export interface GraphViewNode {
  id: string;
  label: string;
  /** Its own type's colour and name, when the view knows them. */
  color: string | null;
  typeLabel: string | null;
  /** Named by a link, but not in the view. */
  outside: boolean;
}

export interface GraphViewEdge {
  source: string;
  target: string;
  /** The link property it comes from: the edge's kind. */
  property: string;
  outside: boolean;
}

export interface GraphViewKind {
  property: string;
  label: string;
  /** Drawn now (the spec's `edges` includes it). */
  on: boolean;
  /** How many links of this kind the view's notes have, drawn or not. */
  count: number;
}

export interface GraphViewModel {
  /** The view's notes in its order (the keyboard's), then any outside notes. */
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  /** Every link property of the view, for the legend. */
  kinds: GraphViewKind[];
}

export function graphViewModel(
  instances: readonly GraphViewInstance[],
  properties: readonly GraphViewProperty[],
  opts: { edges: readonly string[] | null; outside: GraphOutside },
): GraphViewModel {
  const linkProps = properties.filter((p) => p.type === 'link-to-type');
  const on = new Set(opts.edges ?? linkProps.map((p) => p.name));
  const inView = new Set(instances.map((i) => i.path));
  const nodes: GraphViewNode[] = instances.map((i) => ({
    id: i.path, label: i.title, color: i.icon?.color ?? null, typeLabel: i.icon?.label ?? null, outside: false,
  }));
  const outsideNodes = new Map<string, GraphViewNode>();
  const edges: GraphViewEdge[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const inst of instances) {
    for (const link of inst.links ?? []) {
      if (link.path === inst.path) continue;
      const key = `${inst.path}\u0000${link.path}\u0000${link.property}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(link.property, (counts.get(link.property) ?? 0) + 1);
      if (!on.has(link.property)) continue;
      const outside = !inView.has(link.path);
      if (outside) {
        if (opts.outside === 'hide') continue;
        if (!outsideNodes.has(link.path)) outsideNodes.set(link.path, { id: link.path, label: link.title, color: null, typeLabel: null, outside: true });
      }
      edges.push({ source: inst.path, target: link.path, property: link.property, outside });
    }
  }
  return {
    nodes: [...nodes, ...outsideNodes.values()],
    edges,
    kinds: linkProps.map((p) => ({ property: p.name, label: p.label ?? p.name, on: on.has(p.name), count: counts.get(p.name) ?? 0 })),
  };
}
