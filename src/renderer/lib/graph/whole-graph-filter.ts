/**
 * The graph tab's filters (#2958), applied to the whole graph on the renderer
 * side: main sends every note and edge once per graph change, and the filters
 * narrow it without another round trip.
 *
 * - **Kinds** hidden by the legend drop their edges.
 * - **Folder, type, tag** keep the notes that match (a folder includes its
 *   subfolders); a source or tag node stays while a kept note connects to it.
 * - **Hide orphans** drops a node left with no edge.
 * - **Depth from a focused note** keeps what's within that many steps of it,
 *   either way along an edge — today's neighbourhood graph, as a mode of this
 *   one.
 */
import type { NeighborhoodEdge, WholeGraphNode, WholeGraphResult } from '../../../shared/types';

export interface WholeGraphFilters {
  /** Edge kinds the legend has turned off. */
  hiddenKinds: readonly string[];
  folder: string | null;
  type: string | null;
  tag: string | null;
  hideOrphans: boolean;
  /** The focused note, and how far from it to draw; depth null draws everything. */
  focus: string | null;
  depth: number | null;
}

/** What a graph tab keeps (#2958): its filters, whether tags are drawn, and the camera. */
export interface ThoughtbaseGraphState extends WholeGraphFilters {
  showTags: boolean;
  camera: { zoom: number; pan: { x: number; y: number } } | null;
  /** Notes dragged into place (#2959): the layout leaves them there. */
  pins: Record<string, { x: number; y: number }>;
  /** How many steps around a selected note stay bright (#2959). */
  dimHops: number;
}

export const NO_FILTERS: WholeGraphFilters = { hiddenKinds: [], folder: null, type: null, tag: null, hideOrphans: false, focus: null, depth: null };

/** A new graph tab: everything, tags off, the camera fitted. */
export const NEW_GRAPH_STATE: ThoughtbaseGraphState = { ...NO_FILTERS, showTags: false, camera: null, pins: {}, dimHops: 1 };

/** A graph tab's state as read back from a saved session: anything it can't use falls back. */
export function restoredGraphState(raw: unknown): ThoughtbaseGraphState {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const cam = r.camera !== null && typeof r.camera === 'object' ? (r.camera as Record<string, unknown>) : null;
  const pan = cam && cam.pan !== null && typeof cam.pan === 'object' ? (cam.pan as Record<string, unknown>) : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const camera = cam && num(cam.zoom) !== null && pan && num(pan.x) !== null && num(pan.y) !== null
    ? { zoom: num(cam.zoom)!, pan: { x: num(pan.x)!, y: num(pan.y)! } } : null;
  const depth = num(r.depth);
  const dimHops = num(r.dimHops);
  const pins: Record<string, { x: number; y: number }> = {};
  if (r.pins !== null && typeof r.pins === 'object') {
    for (const [id, p] of Object.entries(r.pins as Record<string, unknown>)) {
      const q = p !== null && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      if (num(q.x) !== null && num(q.y) !== null) pins[id] = { x: num(q.x)!, y: num(q.y)! };
    }
  }
  return {
    hiddenKinds: Array.isArray(r.hiddenKinds) ? r.hiddenKinds.filter((k): k is string => typeof k === 'string') : [],
    folder: str(r.folder), type: str(r.type), tag: str(r.tag),
    hideOrphans: r.hideOrphans === true,
    focus: str(r.focus),
    depth: depth !== null && depth >= 1 ? Math.min(6, Math.round(depth)) : null,
    showTags: r.showTags === true,
    camera,
    pins,
    dimHops: dimHops !== null && dimHops >= 1 ? Math.min(6, Math.round(dimHops)) : 1,
  };
}

const isNote = (n: WholeGraphNode) => n.kind === 'note' || n.kind === 'term';

function matches(n: WholeGraphNode, f: WholeGraphFilters): boolean {
  if (f.folder !== null && n.folder !== f.folder && !n.folder.startsWith(`${f.folder}/`)) return false;
  if (f.type !== null && n.type !== f.type) return false;
  if (f.tag !== null && !n.tags.includes(f.tag)) return false;
  return true;
}

export function filterWholeGraph(g: Pick<WholeGraphResult, 'nodes' | 'edges'>, f: WholeGraphFilters): { nodes: WholeGraphNode[]; edges: NeighborhoodEdge[] } {
  const hidden = new Set(f.hiddenKinds);
  const notesKept = new Set(g.nodes.filter((n) => isNote(n) && matches(n, f)).map((n) => n.id));
  const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
  // A source or tag stays while a kept note connects to it.
  const kept = (id: string) => notesKept.has(id) || (byId.has(id) && !isNote(byId.get(id)!));
  let edges = g.edges.filter((e) => !hidden.has(e.linkType) && kept(e.source) && kept(e.target) && (notesKept.has(e.source) || notesKept.has(e.target)));
  let ids = new Set<string>(notesKept);
  for (const e of edges) { ids.add(e.source); ids.add(e.target); }

  if (f.focus !== null && f.depth !== null && ids.has(f.focus)) {
    const near = new Map<string, string[]>();
    for (const e of edges) {
      (near.get(e.source) ?? near.set(e.source, []).get(e.source)!).push(e.target);
      (near.get(e.target) ?? near.set(e.target, []).get(e.target)!).push(e.source);
    }
    const reached = new Set([f.focus]);
    let frontier = [f.focus];
    for (let d = 0; d < f.depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const o of near.get(id) ?? []) if (!reached.has(o)) { reached.add(o); next.push(o); }
      frontier = next;
    }
    ids = reached;
    edges = edges.filter((e) => reached.has(e.source) && reached.has(e.target));
  }

  if (f.hideOrphans) {
    const connected = new Set<string>();
    for (const e of edges) { connected.add(e.source); connected.add(e.target); }
    ids = new Set([...ids].filter((id) => connected.has(id) || id === f.focus));
  }
  return { nodes: g.nodes.filter((n) => ids.has(n.id)), edges };
}
