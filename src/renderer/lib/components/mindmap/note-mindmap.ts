/**
 * A note's outline as a mindmap's tree (#2965): the note's title the root,
 * its headings and list items the branches (`shared/outline/outline.ts`).
 *
 * A node's id is its path — the texts from the root, a repeated sibling text
 * numbered — not its line, so a selection and a fold survive edits elsewhere
 * in the note that move it down a few lines. The texts are joined by a
 * control character no heading or list item can hold, so an empty node (a
 * new one, before it's named) never shares an id with its parent.
 */
import type { Outline, OutlineNode } from '../../../../shared/outline/outline';
import type { MindmapTree } from '../../../../shared/mindmap/mindmap-layout';

export const ROOT_ID = 'root';
const SEP = '\u001f';
/** Marks the second, third… sibling with the same text. */
const NTH = '\u001e';

export interface NoteMindmap {
  tree: MindmapTree;
  /** Each id's outline node (the root's is the outline's root). */
  nodeOf: Map<string, OutlineNode>;
  idOf: Map<OutlineNode, string>;
}

export function noteMindmap(outline: Outline, title: string): NoteMindmap {
  const nodeOf = new Map<string, OutlineNode>();
  const idOf = new Map<OutlineNode, string>();
  const build = (n: OutlineNode, id: string): MindmapTree => {
    nodeOf.set(id, n);
    idOf.set(n, id);
    const seen = new Map<string, number>();
    return {
      id,
      label: n.kind === 'root' ? title : n.text,
      children: n.children.map((c) => {
        const k = (seen.get(c.text) ?? 0) + 1;
        seen.set(c.text, k);
        return build(c, `${id}${SEP}${c.text}${k > 1 ? `${NTH}${k}` : ''}`);
      }),
    };
  };
  return { tree: build(outline.root, ROOT_ID), nodeOf, idOf };
}

/** The id of the node whose own line starts at `offset` in a parse of the text. */
export function idAt(map: NoteMindmap, outline: Outline, offset: number): string | null {
  const n = outline.nodes.find((m) => m.head.start === offset);
  return n ? map.idOf.get(n) ?? null : null;
}
