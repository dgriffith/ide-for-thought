/**
 * Recursive link-neighborhood traversal for View B (#843 / #846).
 *
 * Builds the depth-N neighborhood of a note as a node + edge graph the render
 * layer (#847) draws directly. BFS over typed links in both directions
 * (outgoing + backlinks) with a visited-set so cycles terminate and a node cap
 * so a hub note doesn't explode — truncation is flagged, not silent. Sources
 * (cite/quote targets) are included as leaves: they don't link out, so they end
 * the walk; a quote resolves through its excerpt to the owning source.
 *
 * Split into a pure BFS (`walkNeighborhood`, unit-tested over a mock hop) and a
 * store-backed one-hop (`noteHop`), so the traversal logic is testable without a
 * graph and the graph wiring is exercised end-to-end against a real store.
 *
 * **Every kind of connection** (#2957): besides the typed wiki-links, a hop
 * follows argument relations in both forms (a typed Claim's `supports:` and a
 * Turtle block's `thought:supports`), `link-to-type` properties and other
 * frontmatter links — `queries/relation-edges.ts` — and, when asked
 * (`tags: true`), the note's tags as leaf nodes. Each edge carries its kind
 * from the one registry, `shared/graph/edge-kinds.ts`, as `linkType`.
 */

import { LINK_TYPES, type LinkType } from '../../shared/link-types';
import { outgoingLinks, backlinks, getExcerptSource, termNotePaths } from './queries';
import { argumentEdgeIndex, frontmatterEdges, noteTags, titleOf, type RelationEdge } from './queries/relation-edges';
import { edgeKindForPredicate, TAG_EDGE_KIND } from '../../shared/graph/edge-kinds';
import { getState } from './state';
import type { ProjectContext } from '../project-context-types';
import { neighborhoodCache } from './note-caches';
import type {
  NeighborhoodNode, NeighborhoodEdge, NeighborhoodResult, NeighborhoodOptions, NeighborhoodHop,
} from '../../shared/types';

export type {
  NeighborhoodNode, NeighborhoodEdge, NeighborhoodResult, NeighborhoodOptions, NeighborhoodHop,
};

const TYPE_BY_NAME = new Map<string, LinkType>(LINK_TYPES.map((t) => [t.name, t]));
const DEFAULT_DEPTH = 1;
const DEFAULT_CAP = 200;
/** Cap on the per-project neighborhood memo (perf #1113). Bounds resident memory
 *  during a long read-only browse (the memo self-clears on any write); comfortably
 *  covers realistic back-and-forth navigation between recently-visited notes. */
const NEIGHBORHOOD_CACHE_MAX = 64;

const edgeKey = (e: NeighborhoodEdge): string => `${e.source}\u0000${e.target}\u0000${e.linkType}`;
const sourceNodeId = (sourceId: string): string => `source:${sourceId}`;

/** Parse the id out of a `…/source/<id>` or `…/excerpt/<id>` IRI. */
function idFromUri(uri: string, kind: 'source' | 'excerpt'): string | null {
  const m = new RegExp(`/${kind}/([^/#]+)$`).exec(uri);
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Pure BFS. `hop` yields the immediate neighbors of a node; this walks them to
 * `depth`, deduping nodes (by id) and edges (by origin/target/type), bounded by
 * `cap`. A node beyond the cap is dropped (and `truncated` set), and edges to a
 * dropped node are dropped with it — no orphan edges.
 */
export function walkNeighborhood(
  root: NeighborhoodNode,
  hop: (nodeId: string) => NeighborhoodHop,
  opts: { depth: number; cap: number },
): NeighborhoodResult {
  const nodes = new Map<string, NeighborhoodNode>([[root.id, root]]);
  const edges = new Map<string, NeighborhoodEdge>();
  const expanded = new Set<string>();
  let truncated = false;
  let frontier = [root.id];

  for (let d = 0; d < opts.depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (expanded.has(id)) continue;
      expanded.add(id);
      const hr = hop(id);
      for (const n of hr.nodes) {
        if (nodes.has(n.id)) continue;
        if (nodes.size >= opts.cap) { truncated = true; continue; }
        nodes.set(n.id, n);
      }
      for (const e of hr.edges) {
        // Skip an edge whose far end was capped out — never leave it dangling.
        if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
        const k = edgeKey(e);
        if (!edges.has(k)) edges.set(k, e);
      }
      for (const t of hr.expandTo) {
        if (nodes.has(t) && !expanded.has(t)) next.push(t);
      }
    }
    frontier = next;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], truncated };
}

/**
 * One hop out of a note: its outgoing typed links (to notes and to sources via
 * cite/quote) plus its backlinks (notes that link in). Sources are leaves.
 */
/** What a walk reads once and every hop shares (#2957). */
export interface HopContext {
  termPaths: Set<string>;
  /** Argument edges by note path, in both forms. */
  argumentEdges: Map<string, RelationEdge[]>;
  /** A `link-to-type` property's label, as the catalog has it. */
  propertyLabel: (name: string) => string | undefined;
  /** Draw the note's tags as leaf nodes. */
  tags: boolean;
}

export function hopContext(ctx: ProjectContext, opts: { tags?: boolean } = {}): HopContext {
  const labels = new Map<string, string>();
  for (const t of getState(ctx)?.typeCatalog.types ?? []) {
    for (const p of t.properties) if (p.type === 'link-to-type' && p.label && !labels.has(p.name)) labels.set(p.name, p.label);
  }
  return { termPaths: termNotePaths(ctx), argumentEdges: argumentEdgeIndex(ctx), propertyLabel: (n) => labels.get(n), tags: opts.tags ?? false };
}

export function noteHop(
  ctx: ProjectContext,
  notePath: string,
  hc: HopContext = hopContext(ctx),
): NeighborhoodHop {
  const termPaths = hc.termPaths;
  const nodes: NeighborhoodNode[] = [];
  const edges: NeighborhoodEdge[] = [];
  const expandTo: string[] = [];
  // A note additionally typed thought:Term renders as a glossary term (#1142).
  const noteKind = (id: string): 'note' | 'term' => (termPaths.has(id) ? 'term' : 'note');

  for (const out of outgoingLinks(ctx, notePath)) {
    const kind = TYPE_BY_NAME.get(out.linkType)?.targetKind ?? 'note';
    if (kind === 'note') {
      // Existing targets carry a relativePath; a wiki-link to a not-yet-created
      // note has none, so recover its path from the target IRI and label it as
      // missing (#847 shows these muted).
      let id = out.target;
      let label = out.targetTitle;
      if (!id) {
        const m = /\/note\/([^#]+)$/.exec(out.targetTitle);
        if (!m) continue; // can't identify the target — skip
        const decoded = decodeURIComponent(m[1]!);
        id = /\.\w+$/.test(decoded) ? decoded : `${decoded}.md`;
        label = decoded.split('/').pop() ?? decoded;
      }
      nodes.push({ id, kind: noteKind(id), label, exists: out.exists });
      edges.push({ source: notePath, target: id, linkType: out.linkType, linkLabel: out.linkLabel, linkColor: out.linkColor, direction: 'out' });
      if (out.exists) expandTo.push(id); // only walk past notes that exist
    } else {
      // source or excerpt (quote) → resolve to the owning source leaf.
      const rawId = idFromUri(out.target, kind);
      const sourceId = rawId == null ? null
        : kind === 'source' ? rawId
          : getExcerptSource(ctx, rawId)?.sourceId ?? null;
      if (!sourceId) continue;
      const id = sourceNodeId(sourceId);
      nodes.push({ id, kind: 'source', label: out.targetTitle, exists: true });
      edges.push({ source: notePath, target: id, linkType: out.linkType, linkLabel: out.linkLabel, linkColor: out.linkColor, direction: 'out' });
    }
  }

  // Typed wiki-links only: frontmatter and argument edges come from relation-edges, both ways.
  for (const bl of backlinks(ctx, notePath)) {
    if (!TYPE_BY_NAME.has(bl.linkType)) continue;
    nodes.push({ id: bl.source, kind: noteKind(bl.source), label: bl.sourceTitle, exists: true });
    edges.push({ source: bl.source, target: notePath, linkType: bl.linkType, linkLabel: bl.linkLabel, linkColor: bl.linkColor, direction: 'in' });
    expandTo.push(bl.source);
  }

  // Argument relations, link properties and frontmatter links (#2957), each with its kind.
  const relationPairs = new Set<string>();
  for (const e of [...(hc.argumentEdges.get(notePath) ?? []), ...frontmatterEdges(ctx, notePath)]) {
    relationPairs.add(`${e.source}\u0000${e.target}`);
    const other = e.source === notePath ? e.target : e.source;
    const kind = edgeKindForPredicate(e.predicate, hc.propertyLabel);
    nodes.push({ id: other, kind: noteKind(other), label: titleOf(ctx, other), exists: true });
    edges.push({ source: e.source, target: e.target, linkType: kind.id, linkLabel: kind.label, linkColor: kind.color, direction: e.source === notePath ? 'out' : 'in' });
    expandTo.push(other);
  }

  // A `[[…]]` in frontmatter is also indexed as a plain wiki-link, so the same
  // connection would be drawn twice: the specific kind (a property, an argument
  // relation, a frontmatter key) wins over the generic `references`.
  const kept = edges.filter((e) => e.linkType !== 'references' || !relationPairs.has(`${e.source}\u0000${e.target}`));
  edges.length = 0;
  edges.push(...kept);

  // Tags, when asked: leaves, since a tag joins every note that carries it.
  if (hc.tags) {
    for (const name of noteTags(ctx, notePath)) {
      const id = `tag:${name}`;
      nodes.push({ id, kind: 'tag', label: `#${name}`, exists: true });
      edges.push({ source: notePath, target: id, linkType: TAG_EDGE_KIND.id, linkLabel: TAG_EDGE_KIND.label, linkColor: TAG_EDGE_KIND.color, direction: 'out' });
    }
  }

  return { nodes, edges, expandTo };
}

/** The root note as a graph node (always present, even for an orphan). Labelled
 *  from its filename stem — the render layer highlights it as the focus. A root
 *  that is itself a glossary term renders as one (#1142). */
function rootNode(relativePath: string, termPaths: Set<string>): NeighborhoodNode {
  const label = relativePath.split('/').pop()?.replace(/\.md$/i, '') ?? relativePath;
  return { id: relativePath, kind: termPaths.has(relativePath) ? 'term' : 'note', label, exists: true };
}

/** Build the depth-N neighborhood graph for a note. Memoized per project by
 *  `(path, depth, cap)` (perf #1113): re-selecting a note — which the graph and
 *  citations panels do reactively on every note switch — returns the cached
 *  build instead of re-running the BFS. The memo is cleared on any graph write
 *  via `invalidate()`, so a hit is always consistent with the current store. */
export function neighborhood(
  ctx: ProjectContext,
  relativePath: string,
  opts: NeighborhoodOptions = {},
): NeighborhoodResult {
  const depth = Math.max(1, opts.depth ?? DEFAULT_DEPTH);
  const cap = Math.max(1, opts.cap ?? DEFAULT_CAP);
  const tags = opts.tags ?? false;

  const cacheKey = `${relativePath}\u0000${depth}\u0000${cap}\u0000${tags}`;
  const cache = neighborhoodCache(ctx);
  if (cache) {
    const hit = cache.get(cacheKey);
    if (hit) {
      // Refresh recency so the LRU keeps the notes actually being revisited.
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit;
    }
  }

  // Read the term set, the argument edges and the property labels once and thread
  // them through every hop, so no hop re-scans the store for them.
  const hc = hopContext(ctx, { tags });
  const result = walkNeighborhood(
    rootNode(relativePath, hc.termPaths), (id) => noteHop(ctx, id, hc), { depth, cap },
  );

  if (cache) {
    cache.set(cacheKey, result);
    if (cache.size > NEIGHBORHOOD_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return result;
}

/** A single hop from a note id — for expand-on-demand in the render layer (#847). */
export function expandNode(ctx: ProjectContext, notePath: string, opts: { tags?: boolean } = {}): NeighborhoodHop {
  return noteHop(ctx, notePath, hopContext(ctx, opts));
}
