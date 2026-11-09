/**
 * A hierarchy of notes as a mindmap's tree (#2966): what main's walk returns
 * for a `:::mindmap` block, and how the block is written.
 */
import type { MindmapTree } from './mindmap-layout';

export interface MindmapNoteTree extends MindmapTree {
  /** The note this node is; null for one that isn't a note (a heading of the focus note's outline). */
  path: string | null;
  children: MindmapNoteTree[];
  /** The relation that joins it to its parent, when there's more than one kind (an argument's). */
  via?: string;
  /** `shared`: drawn in more than one place (several parents); `cycle`: it comes back round here, not walked again. */
  mark?: 'shared' | 'cycle';
  /** How many places it's drawn, when more than one. */
  appearances?: number;
  /** Children past the depth, not drawn. */
  more?: number;
}

export interface MindmapWalkOptions {
  /** `argument`, `decomposes`, `headings`, or a property / frontmatter key (`parent`, `property:part-of`). */
  relation: string;
  /** `in` (default): children link to their parent. `out`: a parent links to its children. */
  direction?: 'in' | 'out';
  depth?: number;
}

export interface MindmapWalkResult {
  tree: MindmapNoteTree;
  /** It stopped at the node cap. */
  truncated: boolean;
  /** The focus note is in the graph. */
  exists: boolean;
}

/** What a `:::mindmap` block says: its focus (`[[Note]]`) and `key: value` options. */
export interface MindmapBlockSpec {
  focus: string;
  relation: string;
  direction: 'in' | 'out';
  depth: number;
  layout: 'ltr' | 'radial';
}

/**
 * The block's body: a `[[focus]]` line and `relation:`, `direction:`,
 * `depth:`, `layout:` lines, in any order. Unknown keys are ignored; a
 * missing relation reads as `headings`, the focus note's own outline.
 */
export function parseMindmapBlock(body: string): MindmapBlockSpec {
  const spec: MindmapBlockSpec = { focus: '', relation: 'headings', direction: 'in', depth: 3, layout: 'ltr' };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const link = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(line);
    if (link) { spec.focus = link[1]!.trim(); continue; }
    const kv = /^([a-z-]+)\s*:\s*(.+)$/i.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    const v = value!.trim();
    if (key === 'relation' && v) spec.relation = v;
    else if (key === 'direction') spec.direction = v === 'out' ? 'out' : 'in';
    else if (key === 'depth' && Number.isFinite(Number(v))) spec.depth = Math.max(1, Math.min(6, Math.round(Number(v))));
    else if (key === 'layout') spec.layout = v === 'radial' ? 'radial' : 'ltr';
  }
  return spec;
}
