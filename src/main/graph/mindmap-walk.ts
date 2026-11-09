/**
 * A hierarchy of notes as a tree, for the `:::mindmap` block (#2966): out
 * from a focus note along one relation, to a depth.
 *
 * A relation is a set of edge kinds from the one edge model (#2957,
 * `shared/graph/edge-kinds.ts`) — a `link-to-type` property (`property:parent`),
 * a frontmatter link (`frontmatter:decomposes`), the argument relations
 * (`supports`, `rebuts`, `argument:*`). A node's children are the notes that
 * link TO it by one of them — a child's `parent:` points up, a reason points
 * at its claim — or, with `direction: 'out'`, the notes it links to.
 *
 * - A note reached from several parents appears under each, marked with how
 *   many places it appears.
 * - A cycle stops where it comes back round: the repeat is drawn, marked,
 *   and not walked again.
 * - The walk stops at `depth` levels and at `MINDMAP_NODE_CAP` nodes, and
 *   says it did.
 *
 * Built on the whole graph's edges (`whole-graph.ts`): one pass reads them
 * all, and the walk is in memory.
 */
import type { ProjectContext } from '../project-context-types';
import { wholeGraph } from './whole-graph';
import type { MindmapNoteTree, MindmapWalkOptions, MindmapWalkResult } from '../../shared/mindmap/note-hierarchy';

export const MINDMAP_NODE_CAP = 500;
export const MINDMAP_MAX_DEPTH = 6;

/** The edge kinds a relation names. */
export function relationKinds(relation: string): (kind: string) => boolean {
  if (relation === 'argument') return (k) => k === 'supports' || k === 'rebuts' || k.startsWith('argument:');
  if (relation === 'decomposes') return (k) => k === 'frontmatter:decomposes';
  if (relation.startsWith('property:') || relation.startsWith('frontmatter:')) return (k) => k === relation;
  // A bare name: a link-to-type property, or a frontmatter link of that key.
  return (k) => k === `property:${relation}` || k === `frontmatter:${relation}`;
}

export async function mindmapWalk(ctx: ProjectContext, focus: string, opts: MindmapWalkOptions): Promise<MindmapWalkResult> {
  const depth = Math.max(1, Math.min(MINDMAP_MAX_DEPTH, Math.round(opts.depth ?? 3)));
  const g = await wholeGraph(ctx, {});
  const label = new Map(g.nodes.map((n) => [n.id, n.label] as const));
  const matches = relationKinds(opts.relation);
  // Each note's children along the relation, with the kind that joins them.
  const kids = new Map<string, { path: string; kind: string; kindLabel: string }[]>();
  for (const e of g.edges) {
    if (!matches(e.linkType)) continue;
    const [parent, child] = opts.direction === 'out' ? [e.source, e.target] : [e.target, e.source];
    const list = kids.get(parent) ?? [];
    if (!list.some((c) => c.path === child && c.kind === e.linkType)) list.push({ path: child, kind: e.linkType, kindLabel: e.linkLabel });
    kids.set(parent, list);
  }
  for (const list of kids.values()) list.sort((a, b) => (label.get(a.path) ?? a.path).localeCompare(label.get(b.path) ?? b.path));

  let count = 0;
  let truncated = false;
  const appearances = new Map<string, number>();
  const build = (path: string, id: string, level: number, onPath: ReadonlySet<string>, via: string | null): MindmapNoteTree => {
    count++;
    appearances.set(path, (appearances.get(path) ?? 0) + 1);
    const node: MindmapNoteTree = { id, label: label.get(path) ?? path.replace(/\.md$/, ''), path, children: [], ...(via ? { via } : {}) };
    if (onPath.has(path)) { node.mark = 'cycle'; return node; }
    if (level >= depth) { if ((kids.get(path)?.length ?? 0) > 0) node.more = kids.get(path)!.length; return node; }
    const next = new Set(onPath).add(path);
    for (const c of kids.get(path) ?? []) {
      if (count >= MINDMAP_NODE_CAP) { truncated = true; break; }
      node.children.push(build(c.path, `${id}\u001f${c.path}`, level + 1, next, opts.relation === 'argument' ? c.kindLabel : null));
    }
    return node;
  };
  const tree = build(focus, focus, 0, new Set(), null);
  // A note drawn in more than one place says so, wherever it's drawn.
  const markShared = (n: MindmapNoteTree) => {
    const times = appearances.get(n.path ?? '') ?? 1;
    if (times > 1 && !n.mark) n.mark = 'shared';
    if (times > 1) n.appearances = times;
    n.children.forEach(markShared);
  };
  markShared(tree);
  return { tree, truncated, exists: label.has(focus) };
}
