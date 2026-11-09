/**
 * A type view's notes as a mindmap (#2966): the Mindmap layout's tree.
 * A type with a property that links to its own type (a task's `parent`) is a
 * hierarchy: each note sits under the note its property names.
 *
 * - The root is the view itself (labelled with the type), and its branches
 *   are the notes with no parent in the view — none set, or one the view
 *   doesn't show (filtered out, another folder).
 * - Children come in the view's order (its sort).
 * - Notes whose parents only loop among themselves would never be reached
 *   from the top; they're drawn at the top, each marked as looping, so no
 *   note in the view goes missing.
 */
import type { MindmapNoteTree } from './note-hierarchy';

export const VIEW_ROOT_ID = 'view-root';

export interface HierarchyNote {
  path: string;
  title: string;
  /** The note its parent property names, or null. */
  parent: string | null;
}

export function viewHierarchy(notes: readonly HierarchyNote[], rootLabel: string): MindmapNoteTree {
  const inView = new Set(notes.map((n) => n.path));
  const kids = new Map<string, HierarchyNote[]>();
  const tops: HierarchyNote[] = [];
  for (const n of notes) {
    if (n.parent && n.parent !== n.path && inView.has(n.parent)) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n);
    else tops.push(n);
  }
  const reached = new Set<string>();
  const build = (n: HierarchyNote): MindmapNoteTree => {
    reached.add(n.path);
    return { id: n.path, label: n.title, path: n.path, children: (kids.get(n.path) ?? []).filter((c) => !reached.has(c.path)).map(build) };
  };
  const children = tops.map(build);
  // What only a loop of parents reaches: drawn at the top, so it isn't lost.
  for (const n of notes) {
    if (reached.has(n.path)) continue;
    const loop = build(n);
    loop.mark = 'cycle';
    children.push(loop);
  }
  return { id: VIEW_ROOT_ID, label: rootLabel, path: null, children };
}
