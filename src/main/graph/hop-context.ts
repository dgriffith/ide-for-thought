/**
 * What building the graph reads once and every note shares (#2957, #2958):
 * the term notes, the argument edges in both forms, and the catalog's labels
 * for `link-to-type` properties. Used by `wholeGraph`; it was the per-note
 * walk's until that walk was retired onto the whole graph's focus (#3056).
 */
import { termNotePaths } from './queries';
import { argumentEdgeIndex, type RelationEdge } from './queries/relation-edges';
import { getState } from './state';
import type { ProjectContext } from '../project-context-types';

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
