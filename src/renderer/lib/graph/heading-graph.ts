/**
 * Build Cytoscape elements for View A — a note's heading tree (#843 / #845).
 *
 * `extractHeadings` yields a flat list of headings with ATX `level` + `line`.
 * The tree nesting is reconstructed the same way `activeHeadingChain` does it:
 * a heading's parent is the nearest preceding heading of a *lower* level; with
 * none, it hangs off a synthetic root (the note title). Pure so the nesting
 * logic is unit-tested without a DOM / cytoscape.
 */

import type { Heading } from '../markdown/headings';

export interface GraphNode {
  data: {
    id: string;
    label: string;
    /** 1-based editor line the node navigates to (root → 1). */
    line: number;
    /** ATX level; 0 for the synthetic root. Drives depth styling. */
    level: number;
    /** Marks the synthetic note-title root for distinct styling. */
    root?: boolean;
  };
}
export interface GraphEdge {
  data: { id: string; source: string; target: string };
}
export interface HeadingElements {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const ROOT_ID = 'root';
const headingId = (i: number): string => `h${i}`;

/**
 * Reconstruct the heading tree as Cytoscape nodes + edges. The root is always
 * present (so a heading-less note still renders one tidy node); every heading
 * links to its nearest lower-level ancestor, or the root.
 */
export function buildHeadingElements(headings: Heading[], rootLabel: string): HeadingElements {
  const nodes: GraphNode[] = [
    { data: { id: ROOT_ID, label: rootLabel.trim() || 'Note', line: 1, level: 0, root: true } },
  ];
  const edges: GraphEdge[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!;
    nodes.push({ data: { id: headingId(i), label: h.text, line: h.line, level: h.level } });

    let parent = ROOT_ID;
    for (let j = i - 1; j >= 0; j--) {
      if (headings[j]!.level < h.level) { parent = headingId(j); break; }
    }
    edges.push({ data: { id: `e${i}`, source: parent, target: headingId(i) } });
  }

  return { nodes, edges };
}
