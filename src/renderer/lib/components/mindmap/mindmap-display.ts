/**
 * A walked hierarchy's tree as the Mindmap draws it (#2966): each node's
 * label says what the bare title can't — the relation that joins an argument
 * to its claim, a note drawn in several places, a cycle, children past the
 * depth — in words, so a screen reader hears it too.
 */
import type { MindmapTree } from '../../../../shared/mindmap/mindmap-layout';
import type { MindmapNoteTree } from '../../../../shared/mindmap/note-hierarchy';

export function mindmapDisplayLabel(n: MindmapNoteTree): string {
  const notes = [
    n.mark === 'cycle' ? 'loops back' : n.mark === 'shared' && n.appearances ? `in ${n.appearances} places` : null,
    n.more ? `+${n.more} more` : null,
  ].filter(Boolean);
  return `${n.via ? `${n.via}: ` : ''}${n.label}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

export function mindmapDisplayTree(n: MindmapNoteTree): MindmapTree {
  return { id: n.id, label: mindmapDisplayLabel(n), children: n.children.map(mindmapDisplayTree) };
}
