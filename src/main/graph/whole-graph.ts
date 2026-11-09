/**
 * The whole thoughtbase as one graph (#2958, epic #2956): every note, and every
 * edge between notes of every kind the one edge model knows (#2957) — typed
 * wiki-links, citations to sources, argument relations in both forms, link
 * properties, other frontmatter links, and tags when asked.
 *
 * Unlike the neighbourhood walk there's no cap of 200: the graph tab filters
 * on the renderer side (kinds, folder, type, tag, orphans, depth from a
 * focused note), so it gets the whole set once per graph change. A hard
 * ceiling (`WHOLE_GRAPH_CEILING`) still holds, and the result says when it
 * was hit rather than quietly dropping notes.
 *
 * Each node carries what the filters read: its folder, its object type, and
 * its tags.
 */
import { LINK_TYPES, type LinkType } from '../../shared/link-types';
import { TAG_EDGE_KIND, edgeKindForPredicate } from '../../shared/graph/edge-kinds';
import type { NeighborhoodEdge, WholeGraphNode, WholeGraphResult } from '../../shared/types';
import type { ProjectContext } from '../project-context-types';
import { indexedNotePaths } from './note-index';
import { getExcerptSource, outgoingLinks, termNotePaths } from './queries';
import { frontmatterOutEdges, noteIriIndex, noteTags, titleOf } from './queries/relation-edges';
import { hopContext } from './hop-context';
import { getNoteTypeMap } from './note-properties';

export type { WholeGraphNode, WholeGraphResult };

/** More notes than this and the graph says it stopped, rather than freezing the app (#2958). */
export const WHOLE_GRAPH_CEILING = 20_000;

const TYPE_BY_NAME = new Map<string, LinkType>(LINK_TYPES.map((t) => [t.name, t]));
const sourceNodeId = (id: string) => `source:${id}`;

function folderOf(relativePath: string): string {
  const i = relativePath.lastIndexOf('/');
  return i === -1 ? '' : relativePath.slice(0, i);
}

export async function wholeGraph(ctx: ProjectContext, opts: { tags?: boolean; ceiling?: number } = {}): Promise<WholeGraphResult> {
  const ceiling = Math.max(1, opts.ceiling ?? WHOLE_GRAPH_CEILING);
  const allPaths = indexedNotePaths(ctx).filter((p) => p.endsWith('.md')).sort();
  const paths = allPaths.slice(0, ceiling);
  const inGraph = new Set(paths);
  const types = await getNoteTypeMap(ctx);
  const hc = hopContext(ctx, { tags: opts.tags ?? false });
  const terms = termNotePaths(ctx);
  const notesByIri = noteIriIndex(ctx, paths);

  const nodes = new Map<string, WholeGraphNode>();
  const edges = new Map<string, NeighborhoodEdge>();
  const addEdge = (e: NeighborhoodEdge) => { edges.set(`${e.source}\u0000${e.target}\u0000${e.linkType}`, e); };

  for (const p of paths) {
    nodes.set(p, { id: p, kind: terms.has(p) ? 'term' : 'note', label: titleOf(ctx, p), exists: true, folder: folderOf(p), type: types[p] ?? null, tags: noteTags(ctx, p) });
  }

  for (const p of paths) {
    const relationPairs = new Set<string>();
    // Argument relations (both forms) and frontmatter links: each edge once, from its source.
    for (const e of [...(hc.argumentEdges.get(p) ?? []), ...frontmatterOutEdges(ctx, p, notesByIri)]) {
      if (e.source !== p || !inGraph.has(e.target)) continue;
      relationPairs.add(e.target);
      const kind = edgeKindForPredicate(e.predicate, hc.propertyLabel);
      addEdge({ source: p, target: e.target, linkType: kind.id, linkLabel: kind.label, linkColor: kind.color, direction: 'out' });
    }
    for (const out of outgoingLinks(ctx, p)) {
      const lt = TYPE_BY_NAME.get(out.linkType);
      const targetKind = lt?.targetKind ?? 'note';
      if (targetKind === 'note') {
        // A link to a missing note draws nothing here: the whole graph is the notes there are.
        if (!out.target || !inGraph.has(out.target)) continue;
        // The specific kind wins over a `references` from the same `[[…]]` in frontmatter (#2957).
        if (out.linkType === 'references' && relationPairs.has(out.target)) continue;
        addEdge({ source: p, target: out.target, linkType: out.linkType, linkLabel: out.linkLabel, linkColor: out.linkColor, direction: 'out' });
      } else {
        // A citation's source, or a quote's excerpt resolved to its source: a leaf.
        const raw = new RegExp(`/${targetKind}/([^/#]+)$`).exec(out.target)?.[1];
        const sourceId = raw === undefined ? null
          : targetKind === 'source' ? decodeURIComponent(raw) : getExcerptSource(ctx, decodeURIComponent(raw))?.sourceId ?? null;
        if (!sourceId) continue;
        const sid = sourceNodeId(sourceId);
        if (!nodes.has(sid)) nodes.set(sid, { id: sid, kind: 'source', label: out.targetTitle, exists: true, folder: '', type: null, tags: [] });
        addEdge({ source: p, target: sid, linkType: out.linkType, linkLabel: out.linkLabel, linkColor: out.linkColor, direction: 'out' });
      }
    }
    if (hc.tags) {
      for (const name of nodes.get(p)!.tags) {
        const tid = `tag:${name}`;
        if (!nodes.has(tid)) nodes.set(tid, { id: tid, kind: 'tag', label: `#${name}`, exists: true, folder: '', type: null, tags: [] });
        addEdge({ source: p, target: tid, linkType: TAG_EDGE_KIND.id, linkLabel: TAG_EDGE_KIND.label, linkColor: TAG_EDGE_KIND.color, direction: 'out' });
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], total: allPaths.length, truncated: allPaths.length > paths.length };
}
